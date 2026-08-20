package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"lark/backend/ent"
	entplugin "lark/backend/ent/plugin"
	"lark/backend/ent/pluginstorage"
)

type EntRepository struct {
	client *ent.Client
}

func NewEntRepository(client *ent.Client) *EntRepository {
	return &EntRepository{client: client}
}

func (r *EntRepository) List(ctx context.Context) ([]Plugin, error) {
	items, err := r.client.Plugin.Query().Order(entplugin.ByID()).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list plugins: %w", err)
	}
	result := make([]Plugin, len(items))
	for i, item := range items {
		result[i] = pluginFromEnt(item)
	}
	return result, nil
}

func (r *EntRepository) GetByID(ctx context.Context, id int) (Plugin, error) {
	item, err := r.client.Plugin.Get(ctx, id)
	if err != nil {
		return Plugin{}, mapEntNotFound(err)
	}
	return pluginFromEnt(item), nil
}

func (r *EntRepository) GetByEntryPath(ctx context.Context, entryPath string) (Plugin, error) {
	item, err := r.client.Plugin.Query().Where(entplugin.EntryPath(entryPath)).Only(ctx)
	if err != nil {
		return Plugin{}, mapEntNotFound(err)
	}
	return pluginFromEnt(item), nil
}

func (r *EntRepository) Create(ctx context.Context, value Plugin) (Plugin, error) {
	item, err := setPluginCreate(r.client.Plugin.Create(), value).Save(ctx)
	if err != nil {
		if ent.IsConstraintError(err) {
			return Plugin{}, fmt.Errorf("%w: %s", ErrPluginConflict, value.EntryPath)
		}
		return Plugin{}, fmt.Errorf("create plugin: %w", err)
	}
	return pluginFromEnt(item), nil
}

func (r *EntRepository) Update(ctx context.Context, value Plugin) (Plugin, error) {
	if value.ID <= 0 {
		return Plugin{}, ErrPluginNotFound
	}
	item, err := setPluginUpdate(r.client.Plugin.UpdateOneID(value.ID), value).Save(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			return Plugin{}, ErrPluginNotFound
		}
		if ent.IsConstraintError(err) {
			return Plugin{}, fmt.Errorf("%w: %s", ErrPluginConflict, value.EntryPath)
		}
		return Plugin{}, fmt.Errorf("update plugin: %w", err)
	}
	return pluginFromEnt(item), nil
}

func (r *EntRepository) Delete(ctx context.Context, id int) error {
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return fmt.Errorf("begin plugin delete: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	item, err := tx.Plugin.Get(ctx, id)
	if err != nil {
		return mapEntNotFound(err)
	}
	if _, err := tx.PluginStorage.Delete().Where(
		pluginstorage.PluginEntryPath(item.EntryPath),
		pluginstorage.Namespace(string(StorageVolatile)),
	).Exec(ctx); err != nil {
		return fmt.Errorf("delete volatile plugin storage: %w", err)
	}
	if err := tx.Plugin.DeleteOneID(id).Exec(ctx); err != nil {
		return mapEntNotFound(err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit plugin delete: %w", err)
	}
	return nil
}

func (r *EntRepository) SetStatus(ctx context.Context, id int, status Status) error {
	if !validStatus(status) {
		return fmt.Errorf("invalid plugin status %q", status)
	}
	if _, err := r.client.Plugin.UpdateOneID(id).SetStatus(string(status)).Save(ctx); err != nil {
		return mapEntNotFound(err)
	}
	return nil
}

func (r *EntRepository) StorageGet(ctx context.Context, entryPath string, namespace StorageNamespace, key string) (json.RawMessage, bool, error) {
	if err := validateStorageAddress(entryPath, namespace, key); err != nil {
		return nil, false, err
	}
	item, err := r.client.PluginStorage.Query().Where(
		pluginstorage.PluginEntryPath(entryPath),
		pluginstorage.Namespace(string(namespace)),
		pluginstorage.Key(key),
	).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("get plugin storage: %w", err)
	}
	return json.RawMessage(item.Value), true, nil
}

func (r *EntRepository) StorageSet(ctx context.Context, entryPath string, namespace StorageNamespace, key string, value json.RawMessage) error {
	if err := validateStorageAddress(entryPath, namespace, key); err != nil {
		return err
	}
	if !json.Valid(value) {
		return ErrInvalidStorageValue
	}
	if len(value) > MaxStorageValueBytes {
		return ErrStorageValueTooLarge
	}
	tx, err := r.client.Tx(ctx)
	if err != nil {
		return fmt.Errorf("begin plugin storage write: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	items, err := tx.PluginStorage.Query().Where(
		pluginstorage.PluginEntryPath(entryPath),
		pluginstorage.Namespace(string(namespace)),
	).All(ctx)
	if err != nil {
		return fmt.Errorf("read plugin storage quota: %w", err)
	}
	total := len(value)
	var current *ent.PluginStorage
	for _, item := range items {
		if item.Key == key {
			current = item
			continue
		}
		total += len(item.Value)
	}
	if total > MaxStorageNamespaceBytes {
		return ErrStorageQuotaExceeded
	}
	if current == nil {
		_, err = tx.PluginStorage.Create().
			SetPluginEntryPath(entryPath).
			SetNamespace(string(namespace)).
			SetKey(key).
			SetValue(string(value)).
			Save(ctx)
	} else {
		_, err = tx.PluginStorage.UpdateOneID(current.ID).SetValue(string(value)).Save(ctx)
	}
	if err != nil {
		return fmt.Errorf("write plugin storage: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit plugin storage write: %w", err)
	}
	return nil
}

func (r *EntRepository) StorageDelete(ctx context.Context, entryPath string, namespace StorageNamespace, key string) error {
	if err := validateStorageAddress(entryPath, namespace, key); err != nil {
		return err
	}
	_, err := r.client.PluginStorage.Delete().Where(
		pluginstorage.PluginEntryPath(entryPath),
		pluginstorage.Namespace(string(namespace)),
		pluginstorage.Key(key),
	).Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete plugin storage: %w", err)
	}
	return nil
}

func (r *EntRepository) StorageKeys(ctx context.Context, entryPath string, namespace StorageNamespace) ([]string, error) {
	if err := validateStorageAddress(entryPath, namespace, "_"); err != nil {
		return nil, err
	}
	items, err := r.client.PluginStorage.Query().Where(
		pluginstorage.PluginEntryPath(entryPath),
		pluginstorage.Namespace(string(namespace)),
	).All(ctx)
	if err != nil {
		return nil, fmt.Errorf("list plugin storage keys: %w", err)
	}
	keys := make([]string, len(items))
	for i, item := range items {
		keys[i] = item.Key
	}
	sort.Strings(keys)
	return keys, nil
}

func validateStorageAddress(entryPath string, namespace StorageNamespace, key string) error {
	if !entryPathRegexp.MatchString(entryPath) {
		return fmt.Errorf("invalid plugin entryPath %q", entryPath)
	}
	if !validStorageNamespace(namespace) {
		return fmt.Errorf("invalid plugin storage namespace %q", namespace)
	}
	if key == "" || len(key) > 512 || stringsContainsUnsafeKey(key) {
		return fmt.Errorf("invalid plugin storage key %q", key)
	}
	return nil
}

func stringsContainsUnsafeKey(key string) bool {
	for _, marker := range []string{"/", "\\", "..", "\x00"} {
		if strings.Contains(key, marker) {
			return true
		}
	}
	return false
}

func mapEntNotFound(err error) error {
	if ent.IsNotFound(err) {
		return ErrPluginNotFound
	}
	return err
}

func pluginFromEnt(item *ent.Plugin) Plugin {
	return Plugin{
		ID: item.ID, Name: item.Name, Version: item.Version,
		Description: item.Description, Author: item.Author, Homepage: item.Homepage,
		License: item.License, EntryPath: item.EntryPath, Main: item.Main,
		MinHostVersion: item.MinHostVersion,
		Permissions:    append([]string(nil), item.Permissions...),
		PublicPaths:    append([]string(nil), item.PublicPaths...),
		ExternalPaths:  append([]string(nil), item.ExternalPaths...),
		Icon:           item.Icon, UpdateURL: item.UpdateURL, DownloadURL: item.DownloadURL,
		RenderEngine: item.RenderEngine, Status: Status(item.Status), ZipHash: item.ZipHash,
		EntryHash: item.EntryHash, FileModTime: item.FileModTime, FilePath: item.FilePath,
		CreatedAt: item.CreatedAt, UpdatedAt: item.UpdatedAt,
	}
}

func setPluginCreate(builder *ent.PluginCreate, value Plugin) *ent.PluginCreate {
	return builder.SetName(value.Name).SetVersion(value.Version).
		SetDescription(value.Description).SetAuthor(value.Author).SetHomepage(value.Homepage).
		SetLicense(value.License).SetEntryPath(value.EntryPath).SetMain(value.Main).
		SetMinHostVersion(value.MinHostVersion).SetPermissions(nonNil(value.Permissions)).
		SetPublicPaths(nonNil(value.PublicPaths)).SetExternalPaths(nonNil(value.ExternalPaths)).
		SetIcon(value.Icon).SetUpdateURL(value.UpdateURL).SetDownloadURL(value.DownloadURL).
		SetRenderEngine(value.RenderEngine).SetStatus(string(defaultStatus(value.Status))).
		SetZipHash(value.ZipHash).SetEntryHash(value.EntryHash).SetFileModTime(value.FileModTime).
		SetFilePath(value.FilePath)
}

func setPluginUpdate(builder *ent.PluginUpdateOne, value Plugin) *ent.PluginUpdateOne {
	return builder.SetName(value.Name).SetVersion(value.Version).
		SetDescription(value.Description).SetAuthor(value.Author).SetHomepage(value.Homepage).
		SetLicense(value.License).SetEntryPath(value.EntryPath).SetMain(value.Main).
		SetMinHostVersion(value.MinHostVersion).SetPermissions(nonNil(value.Permissions)).
		SetPublicPaths(nonNil(value.PublicPaths)).SetExternalPaths(nonNil(value.ExternalPaths)).
		SetIcon(value.Icon).SetUpdateURL(value.UpdateURL).SetDownloadURL(value.DownloadURL).
		SetRenderEngine(value.RenderEngine).SetStatus(string(defaultStatus(value.Status))).
		SetZipHash(value.ZipHash).SetEntryHash(value.EntryHash).SetFileModTime(value.FileModTime).
		SetFilePath(value.FilePath)
}

func defaultStatus(status Status) Status {
	if validStatus(status) {
		return status
	}
	return StatusInactive
}

func nonNil(value []string) []string {
	if value == nil {
		return []string{}
	}
	return value
}

var _ Repository = (*EntRepository)(nil)
