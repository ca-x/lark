package main

import (
	"context"
	"errors"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/migrate"
	"lark/backend/internal/api"
	"lark/backend/internal/config"
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
	lib := library.New(client, cfg.LibraryDir, cfg.FFprobeBin, cfg.FFmpegBin, netease.New(), qqmusic.New())
	if err := ensureInitialAdminFromEnv(context.Background(), lib, cfg); err != nil {
		log.Fatal(err)
	}
	server := api.New(client, lib, cfg.FrontendOrigin)
	go func() {
		if err := server.Start(":" + cfg.Port); err != nil {
			log.Printf("server stopped: %v", err)
		}
	}()
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)
	<-quit
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
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
