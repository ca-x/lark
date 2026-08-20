package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDefaultsToBadgerWithoutRedisEnv(t *testing.T) {
	t.Setenv("LARK_CACHE_BACKEND", "")
	t.Setenv("LARK_REDIS_URL", "")
	t.Setenv("LARK_REDIS_ADDR", "")
	t.Setenv("LARK_REDIS_PASSWORD", "")
	t.Setenv("LARK_REDIS_DB", "")
	t.Setenv("LARK_REDIS_KEY_PREFIX", "")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.CacheBackend != "badger" {
		t.Fatalf("CacheBackend = %q, want badger", cfg.CacheBackend)
	}
}

func TestLoadPluginDirectoriesAndEnsureRuntimeDirs(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv("LARK_DATA_DIR", dataDir)
	t.Setenv("LARK_PLUGINS_DIR", "")
	t.Setenv("LARK_PLUGINS_DATA_DIR", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PluginsDir != filepath.Join(dataDir, "jsplugins") || cfg.PluginsDataDir != filepath.Join(dataDir, "jsplugins_data") {
		t.Fatalf("plugin dirs = %q, %q", cfg.PluginsDir, cfg.PluginsDataDir)
	}
	if err := EnsureRuntimeDirs(cfg); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{cfg.PluginsDir, cfg.PluginsDataDir} {
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			t.Fatalf("runtime dir %q: info=%v err=%v", dir, info, err)
		}
	}
}

func TestLoadUsesRedisWhenRedisEnvConfigured(t *testing.T) {
	t.Setenv("LARK_CACHE_BACKEND", "")
	t.Setenv("LARK_REDIS_ADDR", "redis:6379")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.CacheBackend != "redis" {
		t.Fatalf("CacheBackend = %q, want redis", cfg.CacheBackend)
	}
}

func TestLoadNoDLNAOption(t *testing.T) {
	t.Setenv("NO_DLNA_OPTION", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.NoDLNAOption {
		t.Fatal("expected NO_DLNA_OPTION=true to enable NoDLNAOption")
	}
}

func TestLoadDatabaseDefaultsToSQLiteDSN(t *testing.T) {
	t.Setenv("LARK_DB_TYPE", "")
	t.Setenv("LARK_DB_DSN", "")
	t.Setenv("LARK_DB_PATH", "")
	t.Setenv("LARK_DATA_DIR", "/tmp/lark-data")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseType != "sqlite" {
		t.Fatalf("DatabaseType = %q, want sqlite", cfg.DatabaseType)
	}
	if cfg.DatabaseDriver != "sqlite3" {
		t.Fatalf("DatabaseDriver = %q, want sqlite3", cfg.DatabaseDriver)
	}
	if want := sqliteDSN("/tmp/lark-data/lark.db"); cfg.DatabaseDSN != want {
		t.Fatalf("DatabaseDSN = %q, want %q", cfg.DatabaseDSN, want)
	}
}

func TestLoadSQLiteDSNCanBePlainPath(t *testing.T) {
	t.Setenv("LARK_DB_TYPE", "sqlite")
	t.Setenv("LARK_DB_DSN", "/tmp/lark-direct.db")
	t.Setenv("LARK_DB_PATH", "/tmp/lark-legacy.db")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if want := sqliteDSN("/tmp/lark-direct.db"); cfg.DatabaseDSN != want {
		t.Fatalf("DatabaseDSN = %q, want %q", cfg.DatabaseDSN, want)
	}
}

func TestLoadSQLiteDSNPreservesExplicitFileDSN(t *testing.T) {
	t.Setenv("LARK_DB_TYPE", "sqlite")
	t.Setenv("LARK_DB_DSN", "file:/tmp/lark-direct.db?cache=shared")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseDSN != "file:/tmp/lark-direct.db?cache=shared" {
		t.Fatalf("DatabaseDSN = %q", cfg.DatabaseDSN)
	}
}

func TestLoadSQLiteFallsBackToLegacyDBPath(t *testing.T) {
	t.Setenv("LARK_DB_TYPE", "")
	t.Setenv("LARK_DB_DSN", "")
	t.Setenv("LARK_DB_PATH", "/tmp/lark-legacy.db")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if want := sqliteDSN("/tmp/lark-legacy.db"); cfg.DatabaseDSN != want {
		t.Fatalf("DatabaseDSN = %q, want %q", cfg.DatabaseDSN, want)
	}
}

func TestLoadDatabaseTypeAndDSN(t *testing.T) {
	t.Setenv("LARK_DB_TYPE", "postgresql")
	t.Setenv("LARK_DB_DSN", "postgres://lark:secret@db:5432/lark?sslmode=disable")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseType != "postgres" {
		t.Fatalf("DatabaseType = %q, want postgres", cfg.DatabaseType)
	}
	if cfg.DatabaseDriver != "postgres" {
		t.Fatalf("DatabaseDriver = %q, want postgres", cfg.DatabaseDriver)
	}
	if cfg.DatabaseDSN != "postgres://lark:secret@db:5432/lark?sslmode=disable" {
		t.Fatalf("DatabaseDSN = %q", cfg.DatabaseDSN)
	}
}

func TestSQLiteDSNBoundsMemoryOrientedPragmas(t *testing.T) {
	dsn := sqliteDSN("/tmp/lark.db")
	for _, want := range []string{
		"_pragma=journal_mode(WAL)",
		"_pragma=synchronous(NORMAL)",
		"_pragma=busy_timeout(5000)",
		"_pragma=cache_size(-20000)",
		"_pragma=temp_store(MEMORY)",
		"_pragma=mmap_size(268435456)",
	} {
		if !strings.Contains(dsn, want) {
			t.Fatalf("sqliteDSN missing %q in %q", want, dsn)
		}
	}
	// cache=shared serializes WAL readers behind a single page-cache mutex; with a
	// bounded connection pool we intentionally use private per-connection caches so
	// WAL can run concurrent readers. Guard against a regression that re-adds it.
	if strings.Contains(dsn, "cache=shared") {
		t.Fatalf("sqliteDSN must not set cache=shared (serializes WAL readers): %q", dsn)
	}
}
