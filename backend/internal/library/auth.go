package library

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/appsetting"
	"lark/backend/ent/session"
	"lark/backend/ent/user"
	"lark/backend/internal/models"
)

const (
	passwordIterations         = 120000
	sessionTTL                 = 30 * 24 * time.Hour
	settingRegistrationEnabled = "registration_enabled"
)

var (
	ErrForbidden       = errors.New("forbidden")
	ErrUnauthenticated = errors.New("unauthenticated")
)

func (s *Service) AuthStatus(ctx context.Context, token string) (models.AuthStatus, error) {
	count, err := s.client.User.Query().Count(ctx)
	if err != nil {
		return models.AuthStatus{}, err
	}
	registrationEnabled, err := s.registrationEnabled(ctx)
	if err != nil {
		return models.AuthStatus{}, err
	}
	status := models.AuthStatus{Initialized: count > 0, RegistrationEnabled: registrationEnabled}
	if strings.TrimSpace(token) != "" {
		if u, err := s.UserBySession(ctx, token); err == nil {
			mapped := mapUser(u)
			status.User = &mapped
		} else if !ent.IsNotFound(err) && !errors.Is(err, ErrUnauthenticated) {
			return models.AuthStatus{}, err
		}
	}
	return status, nil
}

func (s *Service) SetupAdmin(ctx context.Context, username, password string) (models.User, string, error) {
	count, err := s.client.User.Query().Count(ctx)
	if err != nil {
		return models.User{}, "", err
	}
	if count > 0 {
		return models.User{}, "", ErrForbidden
	}
	return s.createUserWithSession(ctx, username, password, "admin")
}

func (s *Service) EnsureInitialAdmin(ctx context.Context, username, password, nickname string) (models.User, bool, error) {
	count, err := s.client.User.Query().Count(ctx)
	if err != nil {
		return models.User{}, false, err
	}
	if count > 0 {
		return models.User{}, false, nil
	}
	u, err := s.createUser(ctx, username, password, "admin")
	if err != nil {
		return models.User{}, false, err
	}
	nickname = strings.TrimSpace(nickname)
	if nickname != "" {
		updated, err := s.client.User.UpdateOneID(u.ID).SetNickname(nickname).Save(ctx)
		if err != nil {
			return models.User{}, false, err
		}
		u = updated
	}
	return mapUser(u), true, nil
}

func (s *Service) Register(ctx context.Context, username, password string) (models.User, string, error) {
	count, err := s.client.User.Query().Count(ctx)
	if err != nil {
		return models.User{}, "", err
	}
	if count == 0 {
		return models.User{}, "", ErrForbidden
	}
	enabled, err := s.registrationEnabled(ctx)
	if err != nil {
		return models.User{}, "", err
	}
	if !enabled {
		return models.User{}, "", ErrForbidden
	}
	return s.createUserWithSession(ctx, username, password, "user")
}

func (s *Service) Login(ctx context.Context, username, password string) (models.User, string, error) {
	username = strings.TrimSpace(username)
	u, err := s.client.User.Query().Where(user.Username(username)).Only(ctx)
	if err != nil {
		return models.User{}, "", err
	}
	if !verifyPassword(password, u.PasswordHash) {
		return models.User{}, "", ErrForbidden
	}
	token, err := s.createSession(ctx, u.ID)
	if err != nil {
		return models.User{}, "", err
	}
	return mapUser(u), token, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	hash := hashToken(token)
	if hash == "" {
		return nil
	}
	_, err := s.client.Session.Delete().Where(session.TokenHash(hash)).Exec(ctx)
	return err
}

func (s *Service) UserBySession(ctx context.Context, token string) (*ent.User, error) {
	hash := hashToken(token)
	if hash == "" {
		return nil, ErrUnauthenticated
	}
	item, err := s.client.Session.Query().Where(session.TokenHash(hash), session.ExpiresAtGT(time.Now())).WithUser().Only(ctx)
	if err != nil {
		return nil, err
	}
	if item.Edges.User == nil {
		return nil, ErrUnauthenticated
	}
	return item.Edges.User, nil
}

func (s *Service) IsAdmin(ctx context.Context, userID int) (bool, error) {
	u, err := s.client.User.Get(ctx, userID)
	if err != nil {
		return false, err
	}
	return u.Role == "admin", nil
}

func (s *Service) UpdateProfile(ctx context.Context, userID int, nickname, avatarDataURL string) (models.User, error) {
	nickname = strings.TrimSpace(nickname)
	avatarDataURL = strings.TrimSpace(avatarDataURL)
	if len(nickname) > 48 {
		return models.User{}, fmt.Errorf("nickname must be at most 48 characters")
	}
	if len(avatarDataURL) > 512*1024 {
		return models.User{}, fmt.Errorf("avatar is too large")
	}
	if avatarDataURL != "" && !strings.HasPrefix(avatarDataURL, "data:image/") {
		return models.User{}, fmt.Errorf("avatar must be an image data URL")
	}
	u, err := s.client.User.UpdateOneID(userID).SetNickname(nickname).SetAvatarDataURL(avatarDataURL).Save(ctx)
	if err != nil {
		return models.User{}, err
	}
	return mapUser(u), nil
}

func (s *Service) Users(ctx context.Context) ([]models.User, error) {
	items, err := s.client.User.Query().Order(ent.Asc(user.FieldCreatedAt), ent.Asc(user.FieldID)).All(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]models.User, 0, len(items))
	for _, item := range items {
		out = append(out, mapUser(item))
	}
	return out, nil
}

func (s *Service) createUserWithSession(ctx context.Context, username, password, role string) (models.User, string, error) {
	u, err := s.createUser(ctx, username, password, role)
	if err != nil {
		return models.User{}, "", err
	}
	token, err := s.createSession(ctx, u.ID)
	if err != nil {
		return models.User{}, "", err
	}
	return mapUser(u), token, nil
}

func (s *Service) createUser(ctx context.Context, username, password, role string) (*ent.User, error) {
	username = strings.TrimSpace(username)
	if len(username) < 2 {
		return nil, fmt.Errorf("username must be at least 2 characters")
	}
	if len(password) < 6 {
		return nil, fmt.Errorf("password must be at least 6 characters")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return nil, err
	}
	u, err := s.client.User.Create().SetUsername(username).SetPasswordHash(hash).SetRole(role).Save(ctx)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (s *Service) createSession(ctx context.Context, userID int) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	_, err := s.client.Session.Create().SetUserID(userID).SetTokenHash(hashToken(token)).SetExpiresAt(time.Now().Add(sessionTTL)).Save(ctx)
	return token, err
}

func (s *Service) registrationEnabled(ctx context.Context) (bool, error) {
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(settingRegistrationEnabled)).Only(ctx)
	if ent.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return item.Value == "true", nil
}

func hashToken(token string) string {
	token = strings.TrimSpace(token)
	if token == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := pbkdf2Key([]byte(password), salt, passwordIterations, 32)
	return fmt.Sprintf("pbkdf2$%d$%s$%s", passwordIterations, base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

func verifyPassword(password, encoded string) bool {
	parts := strings.SplitN(encoded, "$", 4)
	if len(parts) != 4 || parts[0] != "pbkdf2" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil || iter <= 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil {
		return false
	}
	got := pbkdf2Key([]byte(password), salt, iter, len(want))
	return subtle.ConstantTimeCompare(got, want) == 1
}

func pbkdf2Key(password, salt []byte, iter, keyLen int) []byte {
	hLen := 32
	numBlocks := (keyLen + hLen - 1) / hLen
	var out []byte
	for block := 1; block <= numBlocks; block++ {
		mac := hmac.New(sha256.New, password)
		mac.Write(salt)
		mac.Write([]byte{byte(block >> 24), byte(block >> 16), byte(block >> 8), byte(block)})
		u := mac.Sum(nil)
		t := append([]byte(nil), u...)
		for i := 1; i < iter; i++ {
			mac = hmac.New(sha256.New, password)
			mac.Write(u)
			u = mac.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

func mapUser(u *ent.User) models.User {
	return models.User{ID: u.ID, Username: u.Username, Nickname: u.Nickname, AvatarDataURL: u.AvatarDataURL, Role: u.Role, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt}
}
