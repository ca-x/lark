package mygo

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"path"
	"strings"
)

const maxArchive = 50 << 20
const maxExpanded = 100 << 20
const maxSource = 2 << 20

type Package struct {
	Manifest Manifest          `json:"manifest"`
	Digest   string            `json:"digest"`
	Files    map[string][]byte `json:"-"`
}

func ReadPackage(data []byte) (Package, error) {
	var result Package
	if len(data) > maxArchive {
		return result, errors.New("plugin archive exceeds 50 MiB")
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return result, err
	}
	if len(archive.File) > 2000 {
		return result, errors.New("too many package files")
	}
	root := ""
	manifestDepth := -1
	manifests := 0
	for _, file := range archive.File {
		if path.Base(file.Name) != "plugin.json" || file.FileInfo().IsDir() {
			continue
		}
		depth := strings.Count(file.Name, "/")
		if manifestDepth < 0 || depth < manifestDepth {
			manifestDepth = depth
			manifests = 1
			root = strings.TrimSuffix(file.Name, "plugin.json")
		} else if depth == manifestDepth {
			manifests++
		}
	}
	if manifests == 0 {
		return result, errors.New("mygo plugin.json not found")
	}
	if manifests > 1 {
		return result, errors.New("ambiguous plugin.json")
	}
	result.Files = map[string][]byte{}
	total := int64(0)
	for _, file := range archive.File {
		name := strings.TrimSuffix(file.Name, "/")
		if !safeName(name) || (!file.FileInfo().IsDir() && !file.Mode().IsRegular()) {
			return result, errors.New("unsafe package entry")
		}
		if file.FileInfo().IsDir() {
			continue
		}
		if !strings.HasPrefix(file.Name, root) {
			continue
		}
		name = strings.TrimPrefix(file.Name, root)
		if !safeName(name) {
			return result, errors.New("unsafe package path")
		}
		if _, exists := result.Files[name]; exists {
			return result, errors.New("duplicate package path")
		}
		if file.UncompressedSize64 > maxExpanded || total+int64(file.UncompressedSize64) > maxExpanded {
			return result, errors.New("expanded package exceeds 100 MiB")
		}
		reader, err := file.Open()
		if err != nil {
			return result, err
		}
		contents, readErr := io.ReadAll(io.LimitReader(reader, maxExpanded-total+1))
		closeErr := reader.Close()
		if err := errors.Join(readErr, closeErr); err != nil {
			return result, err
		}
		total += int64(len(contents))
		if total > maxExpanded {
			return result, errors.New("expanded package exceeds 100 MiB")
		}
		result.Files[name] = contents
	}
	result.Manifest, err = parseManifest(result.Files["plugin.json"])
	if err != nil {
		return result, err
	}
	if source := result.Files[result.Manifest.Main]; len(source) == 0 || len(source) > maxSource {
		return result, errors.New("missing or oversized main module")
	}
	digest := sha256.Sum256(data)
	result.Digest = hex.EncodeToString(digest[:])
	return result, nil
}
