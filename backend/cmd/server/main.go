package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/migrate"
	"lark/backend/internal/api"
	"lark/backend/internal/config"
	"lark/backend/internal/kv"
	"lark/backend/internal/library"
	"lark/backend/internal/netease"
	"lark/backend/internal/qqmusic"

	_ "github.com/lib-x/entsqlite"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	if err := config.EnsureRuntimeDirs(cfg); err != nil {
		log.Fatal(err)
	}
	client, err := ent.Open(cfg.DatabaseDriver, cfg.DatabaseDSN)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer client.Close()
	if err := client.Schema.Create(context.Background(), migrate.WithForeignKeys(true)); err != nil {
		log.Fatal(err)
	}
	cacheStore, err := openCacheStore(cfg, client)
	if err != nil {
		log.Fatal(err)
	}
	defer cacheStore.Close()
	lib := library.New(client, cfg.DataDir, cfg.LibraryDir, cfg.FFprobeBin, cfg.FFmpegBin, netease.New(), qqmusic.New(), library.WithCache(cacheStore, time.Duration(cfg.CacheTTL)*time.Second))
	if err := ensureInitialAdminFromEnv(context.Background(), lib, cfg); err != nil {
		log.Fatal(err)
	}
	server := api.New(
		client,
		lib,
		cfg.FrontendOrigin,
		api.WithTranscodeWarmTTL(time.Duration(cfg.TranscodeWarmTTL)*time.Second),
		api.WithTranscodeWarmLimit(cfg.TranscodeWarmLimit),
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
	return estimateSupportedFiles(cfg.LibraryDir, 50000)
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
