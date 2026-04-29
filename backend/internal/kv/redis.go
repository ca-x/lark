package kv

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	redis "github.com/redis/go-redis/v9"
)

type RedisOptions struct {
	URL       string
	Addr      string
	Password  string
	DB        int
	KeyPrefix string
}

type RedisStore struct {
	client *redis.Client
	prefix string
}

func OpenRedis(ctx context.Context, options RedisOptions) (*RedisStore, error) {
	clientOptions, err := redisClientOptions(options)
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(clientOptions)
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("connect redis cache %s: %w", clientOptions.Addr, err)
	}
	return &RedisStore{client: client, prefix: normalizeRedisPrefix(options.KeyPrefix)}, nil
}

func redisClientOptions(options RedisOptions) (*redis.Options, error) {
	if strings.TrimSpace(options.URL) != "" {
		parsed, err := redis.ParseURL(strings.TrimSpace(options.URL))
		if err != nil {
			return nil, fmt.Errorf("parse redis url: %w", err)
		}
		return parsed, nil
	}
	addr := strings.TrimSpace(options.Addr)
	if addr == "" {
		addr = "localhost:6379"
	}
	return &redis.Options{Addr: addr, Password: options.Password, DB: options.DB}, nil
}

func normalizeRedisPrefix(prefix string) string {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return "lark:cache:"
	}
	return prefix
}

func (s *RedisStore) redisKey(key string) string { return s.prefix + key }

func (s *RedisStore) Get(ctx context.Context, key string) ([]byte, bool, error) {
	value, err := s.client.Get(ctx, s.redisKey(key)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return value, true, nil
}

func (s *RedisStore) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	return s.client.Set(ctx, s.redisKey(key), value, ttl).Err()
}

func (s *RedisStore) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	return s.client.SetNX(ctx, s.redisKey(key), value, ttl).Result()
}

func (s *RedisStore) Delete(ctx context.Context, key string) error {
	return s.client.Del(ctx, s.redisKey(key)).Err()
}

func (s *RedisStore) DeletePrefix(ctx context.Context, prefix string) error {
	match := s.redisKey(prefix) + "*"
	iter := s.client.Scan(ctx, 0, match, 100).Iterator()
	keys := make([]string, 0, 100)
	flush := func() error {
		if len(keys) == 0 {
			return nil
		}
		err := s.client.Del(ctx, keys...).Err()
		keys = keys[:0]
		return err
	}
	for iter.Next(ctx) {
		keys = append(keys, iter.Val())
		if len(keys) >= 100 {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := iter.Err(); err != nil {
		return err
	}
	return flush()
}

func (s *RedisStore) Close() error {
	if s == nil || s.client == nil {
		return nil
	}
	return s.client.Close()
}
