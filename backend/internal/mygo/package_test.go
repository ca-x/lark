package mygo

import (
	"archive/zip"
	"bytes"
	"testing"
)

func TestPackageSelectsCanonicalManifest(t *testing.T) {
	manifest := `{"id":"canonical","name":"Canonical","main":"dist/index.js"}`
	for _, prefix := range []string{"", "repository-revision/"} {
		t.Run(prefix, func(t *testing.T) {
			var buffer bytes.Buffer
			writer := zip.NewWriter(&buffer)
			for _, entry := range []struct{ name, contents string }{
				{prefix + "dist/plugin.json", `{"id":"nested","name":"Nested"}`},
				{prefix + "test/fixtures/plugin.json", `{}`},
				{prefix + "plugin.json", manifest},
				{prefix + "dist/index.js", `export function home(){return {title:"Canonical"}}`},
			} {
				file, err := writer.Create(entry.name)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := file.Write([]byte(entry.contents)); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			pkg, err := ReadPackage(buffer.Bytes())
			if err != nil {
				t.Fatal(err)
			}
			if pkg.Manifest.ID != "canonical" || len(pkg.Files[pkg.Manifest.Main]) == 0 {
				t.Fatalf("wrong package selected: %+v", pkg.Manifest)
			}
		})
	}
}

func TestPackageRejectsAmbiguousOrDuplicateEntries(t *testing.T) {
	for _, fixture := range []struct {
		name    string
		entries []string
	}{
		{"peer manifests", []string{"first/plugin.json", "second/plugin.json"}},
		{"duplicate manifest", []string{"plugin.json", "plugin.json"}},
		{"duplicate file", []string{"plugin.json", "index.js", "index.js"}},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			var buffer bytes.Buffer
			writer := zip.NewWriter(&buffer)
			for _, name := range fixture.entries {
				file, err := writer.Create(name)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := file.Write([]byte(`{"id":"demo","name":"Demo"}`)); err != nil {
					t.Fatal(err)
				}
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err := ReadPackage(buffer.Bytes()); err == nil {
				t.Fatal("ambiguous or duplicate entries accepted")
			}
		})
	}
}
