package version

import "fmt"

var (
	// Version is injected at build time via -ldflags.
	Version = "dev"
	// GitCommit is injected at build time via -ldflags.
	GitCommit = "unknown"
	// BuildTime is injected at build time via -ldflags.
	BuildTime = "unknown"
)

const appName = "lark"

func GetVersion() string { return Version }

func GetFullVersion() string {
	if Version == "dev" {
		return fmt.Sprintf("%s/%s (commit: %s, built: %s)", appName, Version, GitCommit, BuildTime)
	}
	return fmt.Sprintf("%s/%s", appName, Version)
}
