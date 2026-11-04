package library

import "testing"

func TestRewindThemePreferences(t *testing.T) {
	for _, theme := range []string{"rewind-classic", "rewind-studio", "rewind-crystal"} {
		t.Run(theme, func(t *testing.T) {
			for _, normalize := range []func(string) string{normalizeUserHomePlayerStyle, normalizeUserMobileHomePlayerStyle} {
				if got := normalize(" " + theme + " "); got != theme {
					t.Fatalf("normalize theme = %q, want %q", got, theme)
				}
			}
		})
	}
	if got := normalizeUserHomePlayerStyle("rewind-unknown"); got != "vinyl" {
		t.Fatalf("unknown desktop theme = %q", got)
	}
	if got := normalizeUserMobileHomePlayerStyle("rewind-unknown"); got != "neon-console" {
		t.Fatalf("unknown mobile theme = %q", got)
	}
}
