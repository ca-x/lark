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

type BadgerOpenOptions struct {
	EstimatedItems int
}

type badgerMemoryProfile struct {
	numGoroutines  int
	numCompactors  int
	numMemtables   int
	memTableSize   int64
	blockCache     int64
	indexCache     int64
	valueThreshold int64
	valueLogFile   int64
}

func OpenBadger(path string, openOptions ...BadgerOpenOptions) (*BadgerStore, error) {
	if err := os.MkdirAll(path, 0o755); err != nil {
		return nil, fmt.Errorf("create badger cache dir %s: %w", path, err)
	}
	estimatedItems := 0
	if len(openOptions) > 0 {
		estimatedItems = openOptions[0].EstimatedItems
	}
	profile := badgerProfileForItems(estimatedItems)
	options := badger.DefaultOptions(path).
		WithLogger(nil).
		WithMetricsEnabled(false).
		WithNumGoroutines(profile.numGoroutines).
		WithNumCompactors(profile.numCompactors).
		WithNumMemtables(profile.numMemtables).
		WithMemTableSize(profile.memTableSize).
		WithBlockCacheSize(profile.blockCache).
		WithIndexCacheSize(profile.indexCache).
		WithValueThreshold(profile.valueThreshold).
		WithValueLogFileSize(profile.valueLogFile)
	db, err := badger.Open(options)
	if err != nil {
		return nil, fmt.Errorf("open badger cache %s: %w", path, err)
	}
	return &BadgerStore{db: db}, nil
}

func badgerProfileForItems(estimatedItems int) badgerMemoryProfile {
	switch {
	case estimatedItems >= 50000:
		return badgerMemoryProfile{
			numGoroutines:  2,
			numCompactors:  2,
			numMemtables:   2,
			memTableSize:   16 << 20,
			blockCache:     32 << 20,
			indexCache:     16 << 20,
			valueThreshold: 1 << 20,
			valueLogFile:   64 << 20,
		}
	case estimatedItems >= 5000:
		return badgerMemoryProfile{
			numGoroutines:  2,
			numCompactors:  2,
			numMemtables:   2,
			memTableSize:   8 << 20,
			blockCache:     16 << 20,
			indexCache:     8 << 20,
			valueThreshold: 1 << 20,
			valueLogFile:   32 << 20,
		}
	default:
		return badgerMemoryProfile{
			numGoroutines:  1,
			numCompactors:  2,
			numMemtables:   1,
			memTableSize:   4 << 20,
			blockCache:     8 << 20,
			indexCache:     4 << 20,
			valueThreshold: 512 << 10,
			valueLogFile:   16 << 20,
		}
	}
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

func (s *BadgerStore) SetNX(ctx context.Context, key string, value []byte, ttl time.Duration) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	entry := badger.NewEntry([]byte(key), value)
	if ttl > 0 {
		entry = entry.WithTTL(ttl)
	}
	inserted := false
	err := s.db.Update(func(txn *badger.Txn) error {
		_, err := txn.Get([]byte(key))
		if err == nil {
			return nil
		}
		if !errors.Is(err, badger.ErrKeyNotFound) {
			return err
		}
		inserted = true
		return txn.SetEntry(entry)
	})
	if err != nil {
		return false, err
	}
	return inserted, nil
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
