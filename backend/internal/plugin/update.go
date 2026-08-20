package plugin

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type UpdateService struct {
	manager *Manager
	client  *http.Client
}

func NewUpdateService(manager *Manager, client *http.Client) *UpdateService {
	return &UpdateService{manager: manager, client: clonePublicHTTPClient(client, PluginDownloadTimeout)}
}

func (s *UpdateService) Download(ctx context.Context, downloadURL string) ([]byte, error) {
	if err := ValidateRegistryURL(downloadURL); err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return nil, err
	}
	client := *clonePublicHTTPClient(s.client, PluginDownloadTimeout)
	client.CheckRedirect = publicRedirectPolicy(client.CheckRedirect)
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download HTTP status %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, (50<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > 50<<20 {
		return nil, ErrPackageTooLarge
	}
	return data, nil
}

func (s *UpdateService) Install(ctx context.Context, entry RegistryEntry) (Plugin, error) {
	if s.manager == nil {
		return Plugin{}, fmt.Errorf("plugin manager is required")
	}
	data, err := s.Download(ctx, entry.DownloadURL)
	if err != nil {
		return Plugin{}, err
	}
	if current, lookupErr := s.manager.repo.GetByEntryPath(ctx, entry.EntryPath); lookupErr == nil {
		return s.manager.updatePackage(ctx, current, entry, data)
	} else if !errors.Is(lookupErr, ErrPluginNotFound) {
		return Plugin{}, lookupErr
	}
	return s.manager.installPackage(ctx, data, &entry)
}

func (m *Manager) Update(ctx context.Context, entry RegistryEntry) (Plugin, error) {
	return NewUpdateService(m, nil).Install(ctx, entry)
}

func (m *Manager) updatePackage(ctx context.Context, current Plugin, entry RegistryEntry, data []byte) (Plugin, error) {
	entryPath := strings.TrimSpace(entry.EntryPath)
	if entryPath == "" {
		return Plugin{}, fmt.Errorf("entryPath is required")
	}
	if current.EntryPath != entryPath {
		return Plugin{}, fmt.Errorf("installed plugin %q does not match registry entryPath %q", current.EntryPath, entryPath)
	}
	m.packageMu.Lock()
	defer m.packageMu.Unlock()

	oldDir := filepath.Join(m.dataDir, current.EntryPath)
	backupDir := oldDir + ".update-backup"
	archivePath := m.archivePath(current)
	backupArchive := archivePath + ".update-backup"
	_ = os.RemoveAll(backupDir)
	_ = os.Remove(backupArchive)
	if err := os.Rename(oldDir, backupDir); err != nil {
		return Plugin{}, fmt.Errorf("stage existing plugin: %w", err)
	}
	archiveBackedUp := false
	if err := os.Rename(archivePath, backupArchive); err == nil {
		archiveBackedUp = true
	} else if !os.IsNotExist(err) {
		_ = os.Rename(backupDir, oldDir)
		return Plugin{}, fmt.Errorf("stage existing plugin archive: %w", err)
	}
	installedDir := ""
	rollback := func() {
		_ = os.RemoveAll(oldDir)
		if installedDir != "" && installedDir != oldDir {
			_ = os.RemoveAll(installedDir)
		}
		_ = os.Rename(backupDir, oldDir)
		_ = os.Remove(archivePath)
		if archiveBackedUp {
			_ = os.Rename(backupArchive, archivePath)
		}
	}
	installed, installErr := NewPackageInstaller(m.dataDir).InstallPackage(ctx, data)
	if installErr != nil {
		rollback()
		return Plugin{}, installErr
	}
	installedDir = installed.Dir
	manifest := installed.Manifest
	if err := validateRegistryPackage(entry, manifest); err != nil {
		rollback()
		return Plugin{}, err
	}
	if err := writeFileAtomic(archivePath, data, 0o644); err != nil {
		rollback()
		return Plugin{}, fmt.Errorf("store plugin archive: %w", err)
	}
	updated := current
	updated.Name, updated.Version, updated.Description, updated.Author = manifest.Name, manifest.Version, manifest.Description, manifest.Author
	updated.Homepage, updated.License, updated.Main = manifest.Homepage, manifest.License, manifest.Main
	updated.MinHostVersion, updated.Permissions, updated.PublicPaths, updated.ExternalPaths = manifest.MinHostVersion, manifest.Permissions, manifest.PublicPaths, manifest.ExternalPaths
	updated.Icon, updated.UpdateURL, updated.DownloadURL, updated.RenderEngine = manifest.Icon, manifest.UpdateURL, manifest.DownloadURL, manifest.RenderEngine
	updated.EntryHash, updated.ZipHash = manifest.EntryHash, manifest.ZipHash
	updated.FilePath = manifest.EntryPath + ".jsplugin.zip"
	saved, err := m.repo.Update(ctx, updated)
	if err != nil {
		rollback()
		return Plugin{}, err
	}
	if current.Status == StatusActive {
		if err := m.reload(ctx, entryPath); err != nil {
			_, _ = m.repo.Update(ctx, current)
			rollback()
			_ = m.reload(ctx, entryPath)
			return Plugin{}, fmt.Errorf("reload updated plugin: %w", err)
		}
	}
	_ = os.RemoveAll(backupDir)
	_ = os.Remove(backupArchive)
	return saved, nil
}

func validateRegistryPackage(entry RegistryEntry, manifest *Manifest) error {
	if manifest == nil || manifest.EntryPath != strings.TrimSpace(entry.EntryPath) {
		return fmt.Errorf("registry entryPath %q does not match package entryPath %q", entry.EntryPath, manifestEntryPath(manifest))
	}
	if entry.Version != "" && manifest.Version != entry.Version {
		return fmt.Errorf("registry version %q does not match package version %q", entry.Version, manifest.Version)
	}
	return nil
}

func manifestEntryPath(manifest *Manifest) string {
	if manifest == nil {
		return ""
	}
	return manifest.EntryPath
}
