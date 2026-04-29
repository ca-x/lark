package config

import (
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

func TestLoadDatabaseDefaultsToSQLiteDSN(t *testing.T) {
	t.Setenv("LARK_DB_TYPE", "")
	t.Setenv("LARK_DB_DSN", "")
	dbPath := "/tmp/lark-default.db"
	t.Setenv("LARK_DB_PATH", dbPath)

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
	if want := sqliteDSN(dbPath); cfg.DatabaseDSN != want {
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
		"_pragma=busy_timeout(10000)",
		"_pragma=cache_size(-10000)",
		"_pragma=temp_store(FILE)",
		"_pragma=mmap_size(0)",
	} {
		if !strings.Contains(dsn, want) {
			t.Fatalf("sqliteDSN missing %q in %q", want, dsn)
		}
	}
}
