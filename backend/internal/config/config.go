package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Port           string
	DataDir        string
	LibraryDir     string
	DatabasePath   string
	DatabaseDriver string
	DatabaseDSN    string
	FrontendOrigin string
	FFmpegBin      string
	FFprobeBin     string
}

func Load() (Config, error) {
	dataDir := getEnv("LARK_DATA_DIR", "./data")
	libraryDir := getEnv("LARK_LIBRARY_DIR", filepath.Join(dataDir, "music"))
	databasePath := getEnv("LARK_DB_PATH", filepath.Join(dataDir, "lark.db"))
	cfg := Config{
		Port:           getEnv("LARK_PORT", "8080"),
		DataDir:        dataDir,
		LibraryDir:     libraryDir,
		DatabasePath:   databasePath,
		DatabaseDriver: "sqlite3",
		DatabaseDSN:    getEnv("LARK_DB_DSN", sqliteDSN(databasePath)),
		FrontendOrigin: getEnv("LARK_FRONTEND_ORIGIN", "*"),
		FFmpegBin:      strings.TrimSpace(getEnv("FFMPEG_BIN", "ffmpeg")),
		FFprobeBin:     strings.TrimSpace(getEnv("FFPROBE_BIN", "ffprobe")),
	}
	return cfg, nil
}

func EnsureRuntimeDirs(cfg Config) error {
	for _, dir := range []string{cfg.DataDir, cfg.LibraryDir, filepath.Dir(cfg.DatabasePath)} {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create runtime dir %s: %w", dir, err)
		}
	}
	return nil
}

func sqliteDSN(path string) string {
	return fmt.Sprintf("file:%s?cache=shared&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(10000)", path)
}

func getEnv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func GetEnvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
