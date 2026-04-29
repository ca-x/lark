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

func TestSQLiteDSNBoundsMemoryOrientedPragmas(t *testing.T) {
	dsn := sqliteDSN("/tmp/lark.db")
	for _, want := range []string{
		"_pragma=journal_mode(WAL)",
		"_pragma=synchronous(NORMAL)",
		"_pragma=busy_timeout(10000)",
		"_pragma=temp_store(FILE)",
		"_pragma=mmap_size(0)",
	} {
		if !strings.Contains(dsn, want) {
			t.Fatalf("sqliteDSN missing %q in %q", want, dsn)
		}
	}
}
