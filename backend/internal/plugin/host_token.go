package plugin

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

const hostTokenPrefix = "lark-plugin-v1."

var ErrInvalidHostToken = errors.New("invalid plugin host token")
var ErrHostTokenPermissionDenied = errors.New("plugin host token permission denied")

func newHostTokenSecret() []byte {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		panic("generate plugin host token secret: " + err.Error())
	}
	return secret
}

// HostToken returns an opaque, process-scoped credential for SongLoft's
// plugin.getToken contract. Plugin status and permissions are intentionally
// not embedded: AuthenticateHostToken reloads them for every request so a
// disable, delete, or permission change takes effect immediately.
func (m *Manager) HostToken(entryPath string) string {
	encodedEntry := base64.RawURLEncoding.EncodeToString([]byte(entryPath))
	signature := m.signHostToken(encodedEntry)
	return hostTokenPrefix + encodedEntry + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func (m *Manager) AuthenticateHostToken(ctx context.Context, token, permission string) (Plugin, error) {
	payload, found := strings.CutPrefix(strings.TrimSpace(token), hostTokenPrefix)
	if !found {
		return Plugin{}, ErrInvalidHostToken
	}
	encodedEntry, encodedSignature, found := strings.Cut(payload, ".")
	if !found || encodedEntry == "" || encodedSignature == "" || strings.Contains(encodedSignature, ".") {
		return Plugin{}, ErrInvalidHostToken
	}
	providedSignature, err := base64.RawURLEncoding.DecodeString(encodedSignature)
	if err != nil || !hmac.Equal(providedSignature, m.signHostToken(encodedEntry)) {
		return Plugin{}, ErrInvalidHostToken
	}
	entryPath, err := base64.RawURLEncoding.DecodeString(encodedEntry)
	if err != nil || len(entryPath) == 0 {
		return Plugin{}, ErrInvalidHostToken
	}
	item, err := m.repo.GetByEntryPath(ctx, string(entryPath))
	if err != nil || item.Status != StatusActive {
		return Plugin{}, ErrInvalidHostToken
	}
	if permission != "" && !CheckPermission(item.Permissions, permission) {
		return Plugin{}, ErrHostTokenPermissionDenied
	}
	return item, nil
}

func (m *Manager) signHostToken(encodedEntry string) []byte {
	mac := hmac.New(sha256.New, m.hostTokenSecret)
	_, _ = mac.Write([]byte(encodedEntry))
	return mac.Sum(nil)
}
