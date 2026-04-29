package kv

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
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
	memBytes := detectSystemMemoryBytes()
	memMB := int(memBytes / (1 << 20))
	p := badgerMemoryProfile{
		numGoroutines:  2,
		numCompactors:  2,
		numMemtables:   2,
		valueThreshold: 128 << 10,
	}
	switch {
	case memMB <= 512:
		limit := int64(2 << 20)
		p.memTableSize = limit
		p.blockCache = limit
		p.indexCache = limit / 2
		p.valueLogFile = 8 << 20
	case memMB <= 1024:
		p.memTableSize = 4 << 20
		p.blockCache = 8 << 20
		p.indexCache = 4 << 20
		p.valueLogFile = 16 << 20
	case memMB <= 2048:
		p.memTableSize = 6 << 20
		p.blockCache = 12 << 20
		p.indexCache = 6 << 20
		p.valueLogFile = 24 << 20
	default:
		cacheBudget := clampInt64(memBytes/128, 32<<20, 256<<20)
		p.memTableSize = cacheBudget / 4
		p.blockCache = cacheBudget / 2
		p.indexCache = cacheBudget / 4
		p.valueLogFile = clampInt64(cacheBudget, 32<<20, 128<<20)
	}
	if overrideMB, ok := badgerCacheOverrideMB(); ok {
		cacheBudget := int64(overrideMB) << 20
		p.memTableSize = cacheBudget / 4
		p.blockCache = cacheBudget / 2
		p.indexCache = cacheBudget / 4
		p.valueLogFile = clampInt64(cacheBudget, 8<<20, 256<<20)
	}
	if estimatedItems < 5000 {
		p.numGoroutines = 1
		p.numMemtables = 1
		p.memTableSize /= 2
		p.blockCache /= 2
		p.indexCache /= 2
		p.valueLogFile /= 2
	} else if estimatedItems >= 50000 {
		p.blockCache += p.blockCache / 2
		p.indexCache += p.indexCache / 2
		p.valueLogFile *= 2
	}
	if p.memTableSize < 1<<20 {
		p.memTableSize = 1 << 20
	}
	if p.blockCache < 1<<20 {
		p.blockCache = 1 << 20
	}
	if p.indexCache < 512<<10 {
		p.indexCache = 512 << 10
	}
	if p.valueLogFile < 8<<20 {
		p.valueLogFile = 8 << 20
	}
	return p
}

func badgerCacheOverrideMB() (int, bool) {
	raw := strings.TrimSpace(os.Getenv("LARK_BADGER_CACHE_MB"))
	if raw == "" {
		return 0, false
	}
	mb, err := strconv.Atoi(raw)
	if err != nil || mb <= 0 {
		return 0, false
	}
	if mb < 8 {
		mb = 8
	}
	if mb > 512 {
		mb = 512
	}
	return mb, true
}

func clampInt64(v, min, max int64) int64 {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func detectSystemMemoryBytes() int64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 2 << 30
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "MemTotal:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		if kb, err := parseInt64(fields[1]); err == nil {
			return kb * 1024
		}
		break
	}
	return 2 << 30
}

func parseInt64(s string) (int64, error) {
	var n int64
	for _, c := range s {
		if c < '0' || c > '9' {
			break
		}
		n = n*10 + int64(c-'0')
	}
	return n, nil
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
	prefixBytes := []byte(prefix)
	const batchSize = 500
	for {
		keys := make([][]byte, 0, batchSize)
		if err := s.db.View(func(txn *badger.Txn) error {
			it := txn.NewIterator(badger.IteratorOptions{PrefetchValues: false, Prefix: prefixBytes})
			defer it.Close()
			for it.Rewind(); it.Valid(); it.Next() {
				if err := ctx.Err(); err != nil {
					return err
				}
				keys = append(keys, append([]byte(nil), it.Item().Key()...))
				if len(keys) >= batchSize {
					break
				}
			}
			return nil
		}); err != nil {
			return err
		}
		if len(keys) == 0 {
			return nil
		}
		if err := s.db.Update(func(txn *badger.Txn) error {
			for _, key := range keys {
				if err := txn.Delete(key); err != nil && !errors.Is(err, badger.ErrKeyNotFound) {
					return err
				}
			}
			return nil
		}); err != nil {
			return err
		}
		if len(keys) < batchSize {
			if err := ctx.Err(); err != nil {
				return err
			}
			return nil
		}
	}
}

func (s *BadgerStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}
