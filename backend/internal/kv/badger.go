package kv

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	badger "github.com/dgraph-io/badger/v4"
)

type BadgerStore struct {
	db *badger.DB
}

func OpenBadger(path string) (*BadgerStore, error) {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return nil, fmt.Errorf("create badger cache dir %s: %w", path, err)
	}
	options := badger.DefaultOptions(path).
		WithLogger(nil).
		WithMetricsEnabled(false).
		WithNumGoroutines(2).
		WithNumCompactors(2).
		WithNumMemtables(2).
		WithMemTableSize(16 << 20).
		WithBlockCacheSize(32 << 20).
		WithIndexCacheSize(16 << 20).
		WithValueLogFileSize(64 << 20)
	db, err := badger.Open(options)
	if err != nil {
		return nil, fmt.Errorf("open badger cache %s: %w", path, err)
	}
	return &BadgerStore{db: db}, nil
}

func (s *BadgerStore) Get(ctx context.Context, key string) ([]byte, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	var value []byte
	err := s.db.View(func(txn *badger.Txn) error {
		item, err := txn.Get([]byte(key))
		if errors.Is(err, badger.ErrKeyNotFound) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		return item.Value(func(v []byte) error {
			value = append([]byte(nil), v...)
			return nil
		})
	})
	if errors.Is(err, ErrNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return value, true, nil
}

func (s *BadgerStore) Set(ctx context.Context, key string, value []byte, ttl time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	entry := badger.NewEntry([]byte(key), value)
	if ttl > 0 {
		entry = entry.WithTTL(ttl)
	}
	return s.db.Update(func(txn *badger.Txn) error {
		return txn.SetEntry(entry)
	})
}

func (s *BadgerStore) Delete(ctx context.Context, key string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	return s.db.Update(func(txn *badger.Txn) error {
		err := txn.Delete([]byte(key))
		if errors.Is(err, badger.ErrKeyNotFound) {
			return nil
		}
		return err
	})
}

func (s *BadgerStore) DeletePrefix(ctx context.Context, prefix string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	keys := make([][]byte, 0)
	prefixBytes := []byte(prefix)
	if err := s.db.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.IteratorOptions{PrefetchValues: false, Prefix: prefixBytes})
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			if err := ctx.Err(); err != nil {
				return err
			}
			keys = append(keys, append([]byte(nil), it.Item().Key()...))
		}
		return nil
	}); err != nil {
		return err
	}
	return s.db.Update(func(txn *badger.Txn) error {
		for _, key := range keys {
			if err := txn.Delete(key); err != nil && !errors.Is(err, badger.ErrKeyNotFound) {
				return err
			}
		}
		return nil
	})
}

func (s *BadgerStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}
