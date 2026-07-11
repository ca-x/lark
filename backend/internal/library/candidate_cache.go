package library

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/candidatecache"
)

const (
	candidateQueryKindMetadataOnline = "metadata_online"
	candidateQueryKindLyrics         = "lyrics"
)

type CandidateCacheRequest struct {
	UserID     int
	TargetType string
	TargetID   int
	Kind       string
	Snapshot   string
	TTL        time.Duration
	Refresh    bool
}

func candidateSnapshotHash(snapshot string) string {
	sum := sha256.Sum256([]byte(snapshot))
	return hex.EncodeToString(sum[:])
}

func (s *Service) candidateCacheNow() time.Time {
	if s.candidateNow != nil {
		return s.candidateNow().UTC()
	}
	return time.Now().UTC()
}

func (request CandidateCacheRequest) normalized() CandidateCacheRequest {
	request.TargetType = strings.TrimSpace(request.TargetType)
	request.Kind = strings.TrimSpace(request.Kind)
	if request.TTL <= 0 {
		request.TTL = time.Hour
	}
	return request
}

func (request CandidateCacheRequest) key() string {
	return strings.Join([]string{
		"candidate", candidateSnapshotHash(request.Snapshot), request.TargetType,
		request.Kind, intString(request.UserID), intString(request.TargetID),
	}, ":")
}

func intString(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	buf := [20]byte{}
	index := len(buf)
	for value > 0 {
		index--
		buf[index] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		index--
		buf[index] = '-'
	}
	return string(buf[index:])
}

func (s *Service) loadCandidateJSON(ctx context.Context, request CandidateCacheRequest, loader func(context.Context) ([]byte, error)) ([]byte, error) {
	request = request.normalized()
	hash := candidateSnapshotHash(request.Snapshot)
	now := s.candidateCacheNow()
	if !request.Refresh {
		item, err := s.client.CandidateCache.Query().Where(
			candidatecache.UserID(request.UserID),
			candidatecache.TargetType(request.TargetType),
			candidatecache.TargetID(request.TargetID),
			candidatecache.QueryKind(request.Kind),
			candidatecache.SnapshotHash(hash),
			candidatecache.ExpiresAtGT(now),
		).Only(ctx)
		if err == nil {
			return []byte(item.Payload), nil
		}
		if !ent.IsNotFound(err) {
			log.Printf("candidate cache read failed: %v", err)
		}
	}

	value, err, _ := s.candidateSF.Do(request.key(), func() (any, error) {
		if !request.Refresh {
			item, lookupErr := s.client.CandidateCache.Query().Where(
				candidatecache.UserID(request.UserID), candidatecache.TargetType(request.TargetType),
				candidatecache.TargetID(request.TargetID), candidatecache.QueryKind(request.Kind),
				candidatecache.SnapshotHash(hash), candidatecache.ExpiresAtGT(s.candidateCacheNow()),
			).Only(context.Background())
			if lookupErr == nil {
				return []byte(item.Payload), nil
			}
		}
		payload, loadErr := loader(ctx)
		if loadErr != nil {
			return nil, loadErr
		}
		expiresAt := s.candidateCacheNow().Add(request.TTL)
		item, lookupErr := s.client.CandidateCache.Query().Where(
			candidatecache.UserID(request.UserID), candidatecache.TargetType(request.TargetType),
			candidatecache.TargetID(request.TargetID), candidatecache.QueryKind(request.Kind),
			candidatecache.SnapshotHash(hash),
		).Only(ctx)
		if lookupErr == nil {
			_, lookupErr = item.Update().SetPayload(string(payload)).SetExpiresAt(expiresAt).Save(ctx)
		} else if ent.IsNotFound(lookupErr) {
			_, lookupErr = s.client.CandidateCache.Create().SetUserID(request.UserID).SetTargetType(request.TargetType).
				SetTargetID(request.TargetID).SetQueryKind(request.Kind).SetSnapshotHash(hash).
				SetPayload(string(payload)).SetExpiresAt(expiresAt).Save(ctx)
		}
		if lookupErr != nil {
			log.Printf("candidate cache write failed: %v", lookupErr)
		}
		s.cleanupExpiredCandidateCache(ctx, s.candidateCacheNow())
		return payload, nil
	})
	if err != nil {
		return nil, err
	}
	return value.([]byte), nil
}

func (s *Service) cleanupExpiredCandidateCache(ctx context.Context, now time.Time) {
	ids, err := s.client.CandidateCache.Query().Where(candidatecache.ExpiresAtLTE(now)).Limit(100).IDs(ctx)
	if err != nil || len(ids) == 0 {
		return
	}
	if _, err := s.client.CandidateCache.Delete().Where(candidatecache.IDIn(ids...)).Exec(ctx); err != nil {
		log.Printf("candidate cache cleanup failed: %v", err)
	}
}

func (s *Service) invalidateCandidateCache(ctx context.Context, userID int, targetType string, targetID int, kinds ...string) error {
	query := s.client.CandidateCache.Delete().Where(
		candidatecache.UserID(userID), candidatecache.TargetType(targetType), candidatecache.TargetID(targetID),
	)
	if len(kinds) > 0 {
		query = query.Where(candidatecache.QueryKindIn(kinds...))
	}
	_, err := query.Exec(ctx)
	return err
}
