package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Port               string
	DataDir            string
	LibraryDir         string
	DatabaseType       string
	DatabaseDriver     string
	DatabaseDSN        string
	FrontendOrigin     string
	FFmpegBin          string
	FFprobeBin         string
	CacheBackend       string
	CacheDir           string
	CacheTTL           int
	RedisURL           string
	RedisAddr          string
	RedisPassword      string
	RedisDB            int
	RedisKeyPrefix     string
	TranscodeWarmTTL   int
	TranscodeWarmLimit int
	AdminUsername      string
	AdminPassword      string
	AdminNickname      string
}

func Load() (Config, error) {
	dataDir := getEnv("LARK_DATA_DIR", "./data")
	libraryDir := getEnv("LARK_LIBRARY_DIR", filepath.Join(dataDir, "music"))
	sqlitePath := legacySQLitePath(dataDir)
	databaseType := normalizeDatabaseType(getEnv("LARK_DB_TYPE", "sqlite"))
	databaseDSN := normalizeDatabaseDSN(databaseType, strings.TrimSpace(os.Getenv("LARK_DB_DSN")), sqlitePath)
	cacheDir := getEnv("LARK_CACHE_DIR", filepath.Join(dataDir, "cache", "badger"))
	cacheBackend := strings.ToLower(strings.TrimSpace(os.Getenv("LARK_CACHE_BACKEND")))
	if cacheBackend == "" && redisCacheConfigured() {
		cacheBackend = "redis"
	}
	if cacheBackend == "" {
		cacheBackend = "badger"
	}
	cfg := Config{
		Port:               getEnv("LARK_PORT", "8080"),
		DataDir:            dataDir,
		LibraryDir:         libraryDir,
		DatabaseType:       databaseType,
		DatabaseDriver:     entDriverName(databaseType),
		DatabaseDSN:        databaseDSN,
		FrontendOrigin:     getEnv("LARK_FRONTEND_ORIGIN", "*"),
		FFmpegBin:          strings.TrimSpace(getEnv("FFMPEG_BIN", "ffmpeg")),
		FFprobeBin:         strings.TrimSpace(getEnv("FFPROBE_BIN", "ffprobe")),
		CacheBackend:       cacheBackend,
		CacheDir:           cacheDir,
		CacheTTL:           GetEnvInt("LARK_CACHE_TTL_SECONDS", 120),
		RedisURL:           strings.TrimSpace(os.Getenv("LARK_REDIS_URL")),
		RedisAddr:          strings.TrimSpace(getEnv("LARK_REDIS_ADDR", "localhost:6379")),
		RedisPassword:      os.Getenv("LARK_REDIS_PASSWORD"),
		RedisDB:            GetEnvInt("LARK_REDIS_DB", 0),
		RedisKeyPrefix:     strings.TrimSpace(getEnv("LARK_REDIS_KEY_PREFIX", "lark:cache:")),
		TranscodeWarmTTL:   GetEnvInt("LARK_TRANSCODE_WARM_TTL_SECONDS", 120),
		TranscodeWarmLimit: GetEnvInt("LARK_TRANSCODE_WARM_MAX_CONCURRENCY", 2),
		AdminUsername:      strings.TrimSpace(os.Getenv("LARK_ADMIN_USERNAME")),
		AdminPassword:      os.Getenv("LARK_ADMIN_PASSWORD"),
		AdminNickname:      strings.TrimSpace(os.Getenv("LARK_ADMIN_NICKNAME")),
	}
	return cfg, nil
}

func EnsureRuntimeDirs(cfg Config) error {
	for _, dir := range []string{cfg.DataDir, cfg.LibraryDir, sqliteRuntimeDir(cfg), cacheRuntimeDir(cfg)} {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create runtime dir %s: %w", dir, err)
		}
	}
	return nil
}

func legacySQLitePath(dataDir string) string {
	return getEnv("LARK_DB_PATH", filepath.Join(dataDir, "lark.db"))
}

func sqliteDSN(path string) string {
	return fmt.Sprintf("file:%s?cache=shared&_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(10000)&_pragma=cache_size(-10000)&_pragma=temp_store(FILE)&_pragma=mmap_size(0)", path)
}

func normalizeDatabaseType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "sqlite", "sqlite3":
		return "sqlite"
	case "postgres", "postgresql", "pg":
		return "postgres"
	case "mysql", "mariadb":
		return "mysql"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func entDriverName(databaseType string) string {
	switch normalizeDatabaseType(databaseType) {
	case "sqlite":
		return "sqlite3"
	case "postgres":
		return "postgres"
	case "mysql":
		return "mysql"
	default:
		return normalizeDatabaseType(databaseType)
	}
}

func normalizeDatabaseDSN(databaseType, dsn, sqlitePath string) string {
	if normalizeDatabaseType(databaseType) != "sqlite" {
		return dsn
	}
	if dsn == "" {
		return sqliteDSN(sqlitePath)
	}
	if strings.HasPrefix(dsn, "file:") || strings.Contains(dsn, "://") || strings.Contains(dsn, "?") {
		return dsn
	}
	return sqliteDSN(dsn)
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

func cacheRuntimeDir(cfg Config) string {
	if strings.EqualFold(cfg.CacheBackend, "badger") {
		return cfg.CacheDir
	}
	return ""
}

func sqliteRuntimeDir(cfg Config) string {
	if cfg.DatabaseType != "sqlite" {
		return ""
	}
	return filepath.Dir(sqlitePathFromDSN(cfg.DatabaseDSN))
}

func sqlitePathFromDSN(dsn string) string {
	if strings.HasPrefix(dsn, "file:") {
		path := strings.TrimPrefix(dsn, "file:")
		if idx := strings.Index(path, "?"); idx >= 0 {
			path = path[:idx]
		}
		return path
	}
	return dsn
}

func redisCacheConfigured() bool {
	for _, key := range []string{"LARK_REDIS_URL", "LARK_REDIS_ADDR", "LARK_REDIS_PASSWORD", "LARK_REDIS_DB", "LARK_REDIS_KEY_PREFIX"} {
		if strings.TrimSpace(os.Getenv(key)) != "" {
			return true
		}
	}
	return false
}
