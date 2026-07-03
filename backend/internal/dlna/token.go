package dlna

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

type TokenClaims struct {
	SongID    int          `json:"song_id"`
	UserID    int          `json:"user_id"`
	Purpose   MediaPurpose `json:"purpose"`
	ExpiresAt int64        `json:"expires_at"`
	Nonce     string       `json:"nonce,omitempty"`
}

type TokenManager struct {
	secret []byte
	now    func() time.Time
}

func NewTokenManager(secret []byte, now func() time.Time) *TokenManager {
	if len(secret) == 0 {
		secret = randomSecret()
	}
	if now == nil {
		now = time.Now
	}
	return &TokenManager{secret: append([]byte(nil), secret...), now: now}
}

func (m *TokenManager) Issue(songID, userID int, purpose MediaPurpose, ttl time.Duration) (string, error) {
	if m == nil {
		return "", errors.New("token manager is nil")
	}
	if songID <= 0 {
		return "", errors.New("song id is required")
	}
	if ttl <= 0 {
		return "", errors.New("token ttl must be positive")
	}
	claims := TokenClaims{
		SongID:    songID,
		UserID:    userID,
		Purpose:   purpose,
		ExpiresAt: m.now().Add(ttl).Unix(),
		Nonce:     strconv.FormatInt(m.now().UnixNano(), 36),
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		return "", err
	}
	payloadText := base64.RawURLEncoding.EncodeToString(payload)
	signature := m.sign([]byte(payloadText))
	return payloadText + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func (m *TokenManager) Validate(raw string, songID int, purpose MediaPurpose) (TokenClaims, error) {
	if m == nil {
		return TokenClaims{}, ErrInvalidToken
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return TokenClaims{}, ErrInvalidToken
	}
	expected := m.sign([]byte(parts[0]))
	actual, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(expected, actual) {
		return TokenClaims{}, ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return TokenClaims{}, ErrInvalidToken
	}
	var claims TokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return TokenClaims{}, ErrInvalidToken
	}
	if claims.SongID != songID || claims.Purpose != purpose {
		return TokenClaims{}, ErrInvalidToken
	}
	if m.now().Unix() > claims.ExpiresAt {
		return TokenClaims{}, fmt.Errorf("%w: expired", ErrInvalidToken)
	}
	return claims, nil
}

func (m *TokenManager) sign(payload []byte) []byte {
	mac := hmac.New(sha256.New, m.secret)
	_, _ = mac.Write(payload)
	return mac.Sum(nil)
}

func randomSecret() []byte {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return []byte("lark-dlna-runtime-secret")
	}
	return secret
}
