package plugin

import "testing"

func TestFilePermissionMatchesSongLoftNamespaces(t *testing.T) {
	t.Parallel()

	external := t.TempDir()
	tests := []struct {
		name string
		path string
		want string
	}{
		{name: "plugin data", path: "cache/value.json", want: PermFS},
		{name: "music", path: "music://Artist/Song.flac", want: PermFSMusic},
		{name: "external", path: external + "/device.json", want: PermFSExternal},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got, err := filePermission(test.path, []string{external})
			if err != nil || got != test.want {
				t.Fatalf("filePermission(%q) = %q, %v; want %q", test.path, got, err, test.want)
			}
		})
	}
	if _, err := filePermission("/not/allowlisted", []string{external}); err == nil {
		t.Fatal("absolute path outside externalPaths was accepted")
	}
}

func TestFSActionsUsePathSpecificPermission(t *testing.T) {
	t.Parallel()

	if got := permissionForAction("fs.readFile"); got != "" {
		t.Fatalf("fs.readFile has blanket permission %q; path-specific check would be bypassed", got)
	}
}
