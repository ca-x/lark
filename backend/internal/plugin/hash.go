package plugin

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
)

var (
	ErrManifestHashMissing  = errors.New("plugin.json hash is required")
	ErrManifestHashInvalid  = errors.New("plugin.json hash must be 64-char lowercase hex")
	ErrManifestHashMismatch = errors.New("plugin.json hash does not match package content")
	manifestHashRegexp      = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func ValidateHashField(field, value string) error {
	if value == "" {
		return fmt.Errorf("%w: %s", ErrManifestHashMissing, field)
	}
	if !manifestHashRegexp.MatchString(value) {
		return fmt.Errorf("%w: %s=%q", ErrManifestHashInvalid, field, value)
	}
	return nil
}

// ComputeEntryHash returns the hash of the declared entry. SongLoft prefers a
// compiled .jsc sibling when the manifest declares a .js entry.
func ComputeEntryHash(zipData []byte, mainPath string) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return "", fmt.Errorf("open zip: %w", err)
	}
	candidates := []string{mainPath}
	if len(mainPath) > 3 && mainPath[len(mainPath)-3:] == ".js" {
		candidates = append([]string{mainPath[:len(mainPath)-3] + ".jsc"}, candidates...)
	}
	for _, candidate := range candidates {
		for _, file := range reader.File {
			if file.Name != candidate || file.FileInfo().IsDir() {
				continue
			}
			rc, err := file.Open()
			if err != nil {
				return "", fmt.Errorf("open entry %q: %w", candidate, err)
			}
			data, readErr := io.ReadAll(rc)
			_ = rc.Close()
			if readErr != nil {
				return "", fmt.Errorf("read entry %q: %w", candidate, readErr)
			}
			return sha256Hex(data), nil
		}
	}
	return "", fmt.Errorf("entry %q not found in zip", mainPath)
}

// ComputeCanonicalZipHash is independent of ZIP ordering and metadata. It
// hashes sorted path/content pairs and excludes plugin.json to avoid a cycle.
func ComputeCanonicalZipHash(zipData []byte) (string, error) {
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return "", fmt.Errorf("open zip: %w", err)
	}
	type item struct {
		name string
		hash string
	}
	items := make([]item, 0, len(reader.File))
	for _, file := range reader.File {
		if file.FileInfo().IsDir() || file.Name == "plugin.json" {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			return "", fmt.Errorf("open %q: %w", file.Name, err)
		}
		data, readErr := io.ReadAll(rc)
		_ = rc.Close()
		if readErr != nil {
			return "", fmt.Errorf("read %q: %w", file.Name, readErr)
		}
		items = append(items, item{name: file.Name, hash: sha256Hex(data)})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].name < items[j].name })
	hasher := sha256.New()
	for _, entry := range items {
		fmt.Fprintf(hasher, "%s\n%s\n", entry.name, entry.hash)
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}
