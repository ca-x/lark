package main

import (
	"context"
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
