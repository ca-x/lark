package plugin

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

var (
	ErrPackageExists   = errors.New("plugin package already installed")
	ErrUnsafePackage   = errors.New("unsafe plugin package")
	ErrPackageTooLarge = errors.New("plugin package exceeds limits")
)

// InstalledPackage is the validated, atomically installed plugin package.
type InstalledPackage struct {
	Manifest *Manifest
	Dir      string
}

type packageLimits struct {
	maxArchiveBytes int64
	maxEntries      int
	maxFileBytes    int64
	maxTotalBytes   int64
}

var defaultPackageLimits = packageLimits{
	maxArchiveBytes: 50 << 20,
	maxEntries:      2048,
	maxFileBytes:    20 << 20,
	maxTotalBytes:   100 << 20,
}

type packageEntry struct {
	file *zip.File
	name string
	dir  bool
}

type PackageInstaller struct {
	root   string
	limits packageLimits
}

func NewPackageInstaller(root string) *PackageInstaller {
	return &PackageInstaller{root: root, limits: defaultPackageLimits}
}

func (i *PackageInstaller) InstallPackage(ctx context.Context, zipData []byte) (*InstalledPackage, error) {
	return installPackage(ctx, i.root, zipData, i.limits)
}

func installPackage(ctx context.Context, root string, zipData []byte, limits packageLimits) (installed *InstalledPackage, err error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if limits.maxArchiveBytes <= 0 {
		limits.maxArchiveBytes = defaultPackageLimits.maxArchiveBytes
	}
	if limits.maxEntries <= 0 {
		limits.maxEntries = defaultPackageLimits.maxEntries
	}
	if limits.maxFileBytes <= 0 {
		limits.maxFileBytes = defaultPackageLimits.maxFileBytes
	}
	if limits.maxTotalBytes <= 0 {
		limits.maxTotalBytes = defaultPackageLimits.maxTotalBytes
	}
	if int64(len(zipData)) > limits.maxArchiveBytes {
		return nil, ErrPackageTooLarge
	}
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return nil, fmt.Errorf("%w: open zip: %v", ErrUnsafePackage, err)
	}
	if len(reader.File) > limits.maxEntries {
		return nil, ErrPackageTooLarge
	}

	// Validate every entry before creating anything on disk. In particular,
	// reject symlinks and both explicit and implicit file/directory conflicts.
	entries := make([]packageEntry, 0, len(reader.File))
	seen := make(map[string]bool, len(reader.File))
	var totalBytes uint64
	for _, file := range reader.File {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		isDir := file.FileInfo().IsDir() || strings.HasSuffix(file.Name, "/")
		name := strings.TrimSuffix(file.Name, "/")
		if err := validatePackagePath(name); err != nil {
			return nil, fmt.Errorf("%w: %s: %v", ErrUnsafePackage, file.Name, err)
		}
		if file.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("%w: symlink %q is not allowed", ErrUnsafePackage, file.Name)
		}
		if _, ok := seen[name]; ok {
			return nil, fmt.Errorf("%w: duplicate path %q", ErrUnsafePackage, file.Name)
		}
		seen[name] = isDir
		if !isDir {
			if file.UncompressedSize64 > uint64(limits.maxFileBytes) {
				return nil, ErrPackageTooLarge
			}
			if ^uint64(0)-totalBytes < file.UncompressedSize64 {
				return nil, ErrPackageTooLarge
			}
			totalBytes += file.UncompressedSize64
		}
		entries = append(entries, packageEntry{file: file, name: name, dir: isDir})
	}
	if totalBytes > uint64(limits.maxTotalBytes) {
		return nil, ErrPackageTooLarge
	}
	for name, isDir := range seen {
		if !isDir {
			prefix := name + "/"
			for other := range seen {
				if strings.HasPrefix(other, prefix) {
					return nil, fmt.Errorf("%w: file %q is also a directory", ErrUnsafePackage, name)
				}
			}
		}
	}

	manifestData, ok := readEntryData(entries, "plugin.json")
	if !ok {
		return nil, fmt.Errorf("%w: plugin.json not found", ErrUnsafePackage)
	}
	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("parse plugin.json: %w", err)
	}
	if err := ValidateManifest(&manifest); err != nil {
		return nil, err
	}
	if _, ok := seen[manifest.Main]; !ok {
		return nil, fmt.Errorf("%w: main %q not found", ErrUnsafePackage, manifest.Main)
	}
	entryHash, err := ComputeEntryHash(zipData, manifest.Main)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrManifestHashMismatch, err)
	}
	zipHash, err := ComputeCanonicalZipHash(zipData)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrManifestHashMismatch, err)
	}
	if manifest.EntryHash != entryHash || manifest.ZipHash != zipHash {
		return nil, fmt.Errorf("%w: entryHash declared=%s actual=%s; zipHash declared=%s actual=%s", ErrManifestHashMismatch, manifest.EntryHash, entryHash, manifest.ZipHash, zipHash)
	}

	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("create plugin directory: %w", err)
	}
	destination := filepath.Join(root, manifest.EntryPath)
	if _, statErr := os.Lstat(destination); statErr == nil {
		return nil, ErrPackageExists
	} else if !os.IsNotExist(statErr) {
		return nil, fmt.Errorf("check plugin destination: %w", statErr)
	}
	tmp, err := os.MkdirTemp(root, ".install-*")
	if err != nil {
		return nil, fmt.Errorf("create temporary install directory: %w", err)
	}
	keep := false
	defer func() {
		if !keep {
			_ = os.RemoveAll(tmp)
		}
	}()

	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		target := filepath.Join(tmp, filepath.FromSlash(entry.name))
		if entry.dir {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return nil, fmt.Errorf("create directory %q: %w", entry.name, err)
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return nil, fmt.Errorf("create parent for %q: %w", entry.name, err)
		}
		mode := entry.file.Mode().Perm()
		if mode == 0 {
			mode = 0o644
		}
		out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
		if err != nil {
			return nil, fmt.Errorf("create %q: %w", entry.name, err)
		}
		rc, openErr := entry.file.Open()
		if openErr == nil {
			_, openErr = copyWithContext(ctx, out, rc, limits.maxFileBytes)
			_ = rc.Close()
		}
		closeErr := out.Close()
		if openErr != nil {
			return nil, fmt.Errorf("extract %q: %w", entry.name, openErr)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("close %q: %w", entry.name, closeErr)
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, destination); err != nil {
		if errors.Is(err, os.ErrExist) {
			return nil, ErrPackageExists
		}
		return nil, fmt.Errorf("commit plugin package: %w", err)
	}
	keep = true
	return &InstalledPackage{Manifest: &manifest, Dir: destination}, nil
}

func validatePackagePath(name string) error {
	if err := validateArchivePath(name); err != nil {
		return err
	}
	if name == "plugin.json" || strings.HasPrefix(name, "plugin.json/") {
		// plugin.json itself is valid; a child path conflicts with it and is
		// rejected by the general file/directory conflict check.
		return nil
	}
	return nil
}

func readEntryData(entries []packageEntry, name string) ([]byte, bool) {
	for _, entry := range entries {
		if entry.name != name || entry.dir {
			continue
		}
		rc, err := entry.file.Open()
		if err != nil {
			return nil, false
		}
		data, readErr := io.ReadAll(rc)
		_ = rc.Close()
		if readErr != nil {
			return nil, false
		}
		return data, true
	}
	return nil, false
}

func copyWithContext(ctx context.Context, dst io.Writer, src io.Reader, max int64) (int64, error) {
	reader := io.LimitReader(src, max+1)
	var copied int64
	buf := make([]byte, 32*1024)
	for {
		if err := ctx.Err(); err != nil {
			return copied, err
		}
		n, readErr := reader.Read(buf)
		if n > 0 {
			written, writeErr := dst.Write(buf[:n])
			copied += int64(written)
			if writeErr != nil {
				return copied, writeErr
			}
			if written != n {
				return copied, io.ErrShortWrite
			}
			if copied > max {
				return copied, ErrPackageTooLarge
			}
		}
		if readErr == io.EOF {
			return copied, nil
		}
		if readErr != nil {
			return copied, readErr
		}
	}
}
