package plugin

import "testing"

func TestRegistryIdentityNormalizesAuthorsAndRepositories(t *testing.T) {
	for _, author := range []string{" Alice <alice@example.com> (maintainer)", "ALICE", " Alice（开发者） "} {
		if PluginIdentity(author, "") != "alice" {
			t.Fatal("author not normalized", author)
		}
	}
	if PluginIdentity("", "https://raw.githubusercontent.com/Owner/Repo/main/plugin.json") != "repo:owner/repo" {
		t.Fatal("repository identity not normalized")
	}
	if PluginIdentity("", "https://arbitrary.example/a/b") != "" {
		t.Fatal("guessed arbitrary repository identity")
	}
}

func TestLynxRequiresRealWebFallback(t *testing.T) {
	manifest := validManifest("lynx-fixture")
	manifest.RenderEngine = RenderEngineLynx
	for _, fallback := range []bool{false, true} {
		entries := []zipEntry{{name: "main.js", data: []byte(`globalThis.onInit = function() {}`)}}
		if fallback {
			entries = append(entries, zipEntry{name: "static/index.html", data: []byte(`<script src="view.web.bundle"></script>`)}, zipEntry{name: "static/view.web.bundle", data: []byte(`document.body.textContent="Web fallback"`)})
		}
		_, err := NewPackageInstaller(t.TempDir()).InstallPackage(t.Context(), buildPluginZip(t, manifest, entries))
		if (err == nil) != fallback {
			t.Fatalf("fallback=%v err=%v", fallback, err)
		}
	}
}
