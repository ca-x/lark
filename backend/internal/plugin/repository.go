package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

type Status string

const (
	StatusActive   Status = "active"
	StatusInactive Status = "inactive"
	StatusError    Status = "error"
)

type StorageNamespace string

const (
	StorageVolatile   StorageNamespace = "storage"
	StoragePersistent StorageNamespace = "persistent-storage"
)

const (
	MaxStorageValueBytes     = 1 << 20
	MaxStorageNamespaceBytes = 10 << 20
)

var (
	ErrPluginNotFound       = errors.New("plugin not found")
	ErrPluginConflict       = errors.New("plugin entryPath already exists")
	ErrStorageValueTooLarge = errors.New("plugin storage value exceeds limit")
	ErrStorageQuotaExceeded = errors.New("plugin storage quota exceeded")
	ErrInvalidStorageValue  = errors.New("plugin storage value must be valid JSON")
)

type Plugin struct {
	ID             int       `json:"id"`
	Name           string    `json:"name"`
	Version        string    `json:"version"`
	Description    string    `json:"description"`
	Author         string    `json:"author"`
	Homepage       string    `json:"homepage,omitempty"`
	License        string    `json:"license,omitempty"`
	EntryPath      string    `json:"entry_path"`
	Main           string    `json:"main"`
	MinHostVersion string    `json:"min_host_version,omitempty"`
	Permissions    []string  `json:"permissions"`
	PublicPaths    []string  `json:"public_paths"`
	ExternalPaths  []string  `json:"external_paths"`
	Icon           string    `json:"icon,omitempty"`
	UpdateURL      string    `json:"update_url,omitempty"`
	DownloadURL    string    `json:"download_url,omitempty"`
	RenderEngine   string    `json:"render_engine"`
	Status         Status    `json:"status"`
	ZipHash        string    `json:"zip_hash,omitempty"`
	EntryHash      string    `json:"entry_hash,omitempty"`
	FileModTime    string    `json:"file_mod_time,omitempty"`
	FilePath       string    `json:"file_path"`
	HasFrontend    bool      `json:"has_frontend"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

func (p Plugin) Manifest() *Manifest {
	return &Manifest{
		Name: p.Name, Version: p.Version, Description: p.Description,
		Author: p.Author, Homepage: p.Homepage, License: p.License,
		EntryPath: p.EntryPath, Main: p.Main, MinHostVersion: p.MinHostVersion,
		Permissions:   append([]string(nil), p.Permissions...),
		PublicPaths:   append([]string(nil), p.PublicPaths...),
		ExternalPaths: append([]string(nil), p.ExternalPaths...),
		Icon:          p.Icon, UpdateURL: p.UpdateURL, DownloadURL: p.DownloadURL,
		EntryHash: p.EntryHash, ZipHash: p.ZipHash, RenderEngine: p.RenderEngine,
	}
}

type Repository interface {
	List(context.Context) ([]Plugin, error)
	GetByID(context.Context, int) (Plugin, error)
	GetByEntryPath(context.Context, string) (Plugin, error)
	Create(context.Context, Plugin) (Plugin, error)
	Update(context.Context, Plugin) (Plugin, error)
	Delete(context.Context, int) error
	SetStatus(context.Context, int, Status) error
	StorageGet(context.Context, string, StorageNamespace, string) (json.RawMessage, bool, error)
	StorageSet(context.Context, string, StorageNamespace, string, json.RawMessage) error
	StorageDelete(context.Context, string, StorageNamespace, string) error
	StorageKeys(context.Context, string, StorageNamespace) ([]string, error)
}

func validStatus(status Status) bool {
	return status == StatusActive || status == StatusInactive || status == StatusError
}

func validStorageNamespace(namespace StorageNamespace) bool {
	return namespace == StorageVolatile || namespace == StoragePersistent
}
