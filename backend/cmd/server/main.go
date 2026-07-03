package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/migrate"
	"lark/backend/ent/song"
	"lark/backend/internal/api"
	"lark/backend/internal/config"
	"lark/backend/internal/dlna"
	"lark/backend/internal/kv"
	"lark/backend/internal/library"
	"lark/backend/internal/netease"
	"lark/backend/internal/qqmusic"

	entsql "entgo.io/ent/dialect/sql"
	_ "github.com/go-sql-driver/mysql"
	_ "github.com/lib-x/entsqlite"
	_ "github.com/lib/pq"
)

const (
	// SQLite connection-pool defaults. modernc.org/sqlite serializes writes
	// regardless of pool size, while WAL mode permits N concurrent readers +
	// 1 writer across separate connections. A small bounded pool keeps readers
	// warm and makes contention fail fast (busy_timeout) instead of piling up
	// unbounded connections. Override via LARK_SQLITE_MAX_OPEN_CONNS /
	// LARK_SQLITE_MAX_IDLE_CONNS for low-memory devices (e.g. set to 2).
	sqliteConnMaxIdleTime = 5 * time.Minute
	sqliteConnMaxLifetime = 0 // SQLite connections are local & cheap; no recycling needed
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if err := config.EnsureRuntimeDirs(cfg); err != nil {
		log.Fatal(err)
	}
	if cfg.DatabaseDSN == "" {
		log.Fatalf("database DSN is required for LARK_DB_TYPE=%s", cfg.DatabaseType)
	}
	client, db, err := openEntClient(cfg)
	if err != nil {
		log.Fatalf("open %s database: %v", cfg.DatabaseType, err)
	}
	defer client.Close()
	if err := client.Schema.Create(context.Background(), migrate.WithForeignKeys(true)); err != nil {
		log.Fatal(err)
	}
	if err := backfillHasLyrics(context.Background(), client); err != nil {
		log.Printf("has_lyrics backfill skipped: %v", err)
	}
	cacheStore, err := openCacheStore(cfg, client)
	if err != nil {
		log.Fatal(err)
	}
	defer cacheStore.Close()
	if err := cleanupLegacyCache(context.Background(), cacheStore); err != nil {
		log.Printf("cache cleanup skipped: %v", err)
	}
	lib := library.New(client, cfg.DataDir, cfg.LibraryDir, cfg.FFprobeBin, cfg.FFmpegBin, netease.New(), qqmusic.New(), library.WithCache(cacheStore, time.Duration(cfg.CacheTTL)*time.Second), library.WithSQLDB(db, cfg.DatabaseType))
	if err := lib.NormalizeArtists(context.Background()); err != nil {
		log.Printf("artist normalization skipped: %v", err)
	}
	if err := ensureInitialAdminFromEnv(context.Background(), lib, cfg); err != nil {
		log.Fatal(err)
	}
	initialSettings, err := lib.GetSettings(context.Background())
	if err != nil {
		log.Fatalf("load dlna settings: %v", err)
	}
	if cfg.NoDLNAOption {
		initialSettings.DLNACastEnabled = false
		initialSettings.DLNALibraryEnabled = false
		initialSettings.NoDLNAOption = true
	}
	dlnaService := dlna.NewService(lib, dlna.OptionsFromSettings(initialSettings), dlna.WithTokenSecret([]byte(cfg.DatabaseDSN)))
	server := api.New(
		client,
		lib,
		cfg.FrontendOrigin,
		api.WithTranscodeWarmTTL(time.Duration(cfg.TranscodeWarmTTL)*time.Second),
		api.WithTranscodeWarmLimit(cfg.TranscodeWarmLimit),
		api.WithNoDLNAOption(cfg.NoDLNAOption),
		api.WithDLNA(dlnaService),
	)
	serverErr := make(chan error, 1)
	go func() {
		serverErr <- server.Start(":" + cfg.Port)
	}()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	select {
	case sig := <-quit:
		log.Printf("received %s, shutting down", sig)
	case err := <-serverErr:
		if err != nil {
			log.Fatalf("server stopped: %v", err)
		}
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
	select {
	case err := <-serverErr:
		if err != nil {
			log.Printf("server stopped: %v", err)
		}
	case <-ctx.Done():
		log.Printf("server did not stop before shutdown deadline: %v", ctx.Err())
	}
}

func openEntClient(cfg config.Config) (*ent.Client, *sql.DB, error) {
	db, err := sql.Open(cfg.DatabaseDriver, cfg.DatabaseDSN)
	if err != nil {
		return nil, nil, err
	}
	if cfg.DatabaseType == "sqlite" {
		db.SetMaxOpenConns(cfg.SQLiteMaxOpenConns)
		db.SetMaxIdleConns(cfg.SQLiteMaxIdleConns)
		db.SetConnMaxIdleTime(sqliteConnMaxIdleTime)
		db.SetConnMaxLifetime(sqliteConnMaxLifetime)
	}
	drv := entsql.OpenDB(cfg.DatabaseDriver, db)
	return ent.NewClient(ent.Driver(drv)), db, nil
}

// backfillHasLyrics is a one-shot, idempotent bulk UPDATE that sets has_lyrics=true
// for legacy rows that have a lyrics source or a cached lyrics blob but were created
// before the has_lyrics column existed. Re-running it matches nothing once backfilled.
func backfillHasLyrics(ctx context.Context, client *ent.Client) error {
	if client == nil {
		return nil
	}
	updateCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	return client.Song.Update().
		Where(
			song.HasLyrics(false),
			song.Or(song.LyricsSourceNEQ(""), song.LyricsEmbeddedNEQ("")),
		).
		SetHasLyrics(true).
		Exec(updateCtx)
}

func cleanupLegacyCache(ctx context.Context, store kv.Store) error {
	if store == nil {
		return nil
	}
	cleanupCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	for _, key := range []string{
		"library:v1:catalog:v2:songs",
		"library:v1:catalog:v2:artists",
	} {
		if err := store.Delete(cleanupCtx, key); err != nil {
			return err
		}
	}
	return store.RunValueLogGC(cleanupCtx)
}

func ensureInitialAdminFromEnv(ctx context.Context, lib *library.Service, cfg config.Config) error {
	if cfg.AdminUsername == "" && cfg.AdminPassword == "" {
		return nil
	}
	if cfg.AdminUsername == "" || cfg.AdminPassword == "" {
		return errors.New("LARK_ADMIN_USERNAME and LARK_ADMIN_PASSWORD must be set together")
	}
	user, created, err := lib.EnsureInitialAdmin(ctx, cfg.AdminUsername, cfg.AdminPassword, cfg.AdminNickname)
	if err != nil {
		return err
	}
	if created {
		log.Printf("created initial admin from environment: %s", user.Username)
	}
	return nil
}

func openCacheStore(cfg config.Config, client *ent.Client) (kv.Store, error) {
	switch cfg.CacheBackend {
	case "", "badger":
		return kv.OpenBadger(cfg.CacheDir, kv.BadgerOpenOptions{EstimatedItems: estimateCacheItemCount(context.Background(), cfg, client)})
	case "redis":
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return kv.OpenRedis(ctx, kv.RedisOptions{URL: cfg.RedisURL, Addr: cfg.RedisAddr, Password: cfg.RedisPassword, DB: cfg.RedisDB, KeyPrefix: cfg.RedisKeyPrefix})
	case "memory":
		return kv.NewMemoryStore(), nil
	case "none", "noop", "off", "disabled":
		return kv.NoopStore{}, nil
	default:
		return nil, errors.New("unsupported LARK_CACHE_BACKEND: " + cfg.CacheBackend)
	}
}

func estimateCacheItemCount(ctx context.Context, cfg config.Config, client *ent.Client) int {
	if client != nil {
		countCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		if count, err := client.Song.Query().Count(countCtx); err == nil && count > 0 {
			return count
		}
	}
	return estimateSupportedFiles(cfg.LibraryDir, 20000)
}

func estimateSupportedFiles(root string, capCount int) int {
	if capCount <= 0 {
		return 0
	}
	root = filepath.Clean(root)
	count := 0
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if path != root && d.Name() == ".shared-center" {
				return filepath.SkipDir
			}
			return nil
		}
		if library.IsSupported(path) {
			count++
			if count >= capCount {
				return filepath.SkipAll
			}
		}
		return nil
	})
	if err != nil && !errors.Is(err, filepath.SkipAll) {
		return count
	}
	return count
}
