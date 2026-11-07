package pluginapp

import (
	"context"
	"sync"

	"lark/backend/ent"
	"lark/backend/ent/appsetting"
)

type EntStore struct {
	client *ent.Client
	mu     sync.Mutex
}

func NewEntStore(client *ent.Client) *EntStore { return &EntStore{client: client} }

func (s *EntStore) Get(ctx context.Context, key string) ([]byte, error) {
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(key)).Only(ctx)
	if ent.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return []byte(item.Value), nil
}

func (s *EntStore) Put(ctx context.Context, key string, value []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(key)).Only(ctx)
	if ent.IsNotFound(err) {
		return s.client.AppSetting.Create().SetKey(key).SetValue(string(value)).Exec(ctx)
	}
	if err != nil {
		return err
	}
	return item.Update().SetValue(string(value)).Exec(ctx)
}
