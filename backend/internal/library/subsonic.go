package library

import (
	"context"
	"crypto/md5"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"lark/backend/ent"
	"lark/backend/ent/appsetting"
	"lark/backend/internal/models"
)

const subsonicCredentialPrefix = "subsonic_credential:"

type storedSubsonicCredential struct {
	UserID       int       `json:"user_id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"password_hash"`
	Password     string    `json:"password,omitempty"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (s *Service) GetSubsonicCredentialStatus(ctx context.Context, userID int, endpoint string) (models.SubsonicCredentialStatus, error) {
	if userID == 0 {
		return models.SubsonicCredentialStatus{}, ErrUnauthenticated
	}
	cred, err := s.loadSubsonicCredential(ctx, userID)
	if ent.IsNotFound(err) {
		return models.SubsonicCredentialStatus{Endpoint: endpoint}, nil
	}
	if err != nil {
		return models.SubsonicCredentialStatus{}, err
	}
	return models.SubsonicCredentialStatus{
		Configured: true,
		Username:   cred.Username,
		Hint:       credentialHint(cred.Username),
		Endpoint:   endpoint,
	}, nil
}

func (s *Service) SaveSubsonicCredential(ctx context.Context, userID int, username, password, endpoint string) (models.SubsonicCredentialStatus, error) {
	if userID == 0 {
		return models.SubsonicCredentialStatus{}, ErrUnauthenticated
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return models.SubsonicCredentialStatus{}, fmt.Errorf("subsonic username is required")
	}
	if len(password) < 6 {
		return models.SubsonicCredentialStatus{}, fmt.Errorf("subsonic password must be at least 6 characters")
	}
	if err := s.ensureSubsonicUsernameAvailable(ctx, userID, username); err != nil {
		return models.SubsonicCredentialStatus{}, err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return models.SubsonicCredentialStatus{}, err
	}
	cred := storedSubsonicCredential{UserID: userID, Username: username, PasswordHash: hash, Password: password, UpdatedAt: time.Now().UTC()}
	data, err := json.Marshal(cred)
	if err != nil {
		return models.SubsonicCredentialStatus{}, err
	}
	if err := s.setSetting(ctx, subsonicCredentialPrefix+fmt.Sprint(userID), string(data)); err != nil {
		return models.SubsonicCredentialStatus{}, err
	}
	return models.SubsonicCredentialStatus{Configured: true, Username: username, Hint: credentialHint(username), Endpoint: endpoint}, nil
}

func (s *Service) DeleteSubsonicCredential(ctx context.Context, userID int, endpoint string) (models.SubsonicCredentialStatus, error) {
	if userID == 0 {
		return models.SubsonicCredentialStatus{}, ErrUnauthenticated
	}
	_, err := s.client.AppSetting.Delete().Where(appsetting.Key(subsonicCredentialPrefix + fmt.Sprint(userID))).Exec(ctx)
	if err != nil {
		return models.SubsonicCredentialStatus{}, err
	}
	return models.SubsonicCredentialStatus{Endpoint: endpoint}, nil
}

func (s *Service) AuthenticateSubsonic(ctx context.Context, username, password, token, salt string) (*ent.User, error) {
	username = strings.TrimSpace(username)
	if username == "" || (password == "" && token == "") {
		return nil, ErrUnauthenticated
	}
	items, err := s.client.AppSetting.Query().Where(appsetting.KeyHasPrefix(subsonicCredentialPrefix)).All(ctx)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		var cred storedSubsonicCredential
		if err := json.Unmarshal([]byte(item.Value), &cred); err != nil {
			continue
		}
		if !strings.EqualFold(cred.Username, username) || !validSubsonicCredential(cred, password, token, salt) {
			continue
		}
		u, err := s.client.User.Get(ctx, cred.UserID)
		if err != nil {
			return nil, ErrUnauthenticated
		}
		return u, nil
	}
	return nil, ErrForbidden
}

func validSubsonicCredential(cred storedSubsonicCredential, password, token, salt string) bool {
	if password != "" {
		return verifyPassword(password, cred.PasswordHash)
	}
	if token == "" || salt == "" || cred.Password == "" {
		return false
	}
	sum := md5.Sum([]byte(cred.Password + salt))
	want := fmt.Sprintf("%x", sum)
	return strings.EqualFold(want, strings.TrimSpace(token))
}

func (s *Service) loadSubsonicCredential(ctx context.Context, userID int) (storedSubsonicCredential, error) {
	item, err := s.client.AppSetting.Query().Where(appsetting.Key(subsonicCredentialPrefix + fmt.Sprint(userID))).Only(ctx)
	if err != nil {
		return storedSubsonicCredential{}, err
	}
	var cred storedSubsonicCredential
	if err := json.Unmarshal([]byte(item.Value), &cred); err != nil {
		return storedSubsonicCredential{}, err
	}
	return cred, nil
}

func (s *Service) ensureSubsonicUsernameAvailable(ctx context.Context, userID int, username string) error {
	items, err := s.client.AppSetting.Query().Where(appsetting.KeyHasPrefix(subsonicCredentialPrefix)).All(ctx)
	if err != nil {
		return err
	}
	for _, item := range items {
		var cred storedSubsonicCredential
		if err := json.Unmarshal([]byte(item.Value), &cred); err != nil {
			continue
		}
		if cred.UserID != userID && strings.EqualFold(cred.Username, username) {
			return fmt.Errorf("subsonic username is already in use")
		}
	}
	return nil
}

func credentialHint(username string) string {
	username = strings.TrimSpace(username)
	if username == "" {
		return ""
	}
	runes := []rune(username)
	if len(runes) <= 2 {
		return string(runes[0]) + "…"
	}
	return string(runes[0]) + "…" + string(runes[len(runes)-1])
}
