package dlna

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v5"

	"lark/backend/internal/library"
)

const (
	castMediaTokenTTL    = 15 * time.Minute
	libraryMediaTokenTTL = 2 * time.Hour
)

func (s *Service) RegisterPublicRoutes(mux interface {
	GET(string, echo.HandlerFunc, ...echo.MiddlewareFunc) *echo.Route
}) {
	if s == nil {
		return
	}
	mux.GET("/dlna/audio/:token/:songID", echo.WrapHandler(http.HandlerFunc(s.handleAudio)))
	mux.GET("/dlna/cover/:token/:songID", echo.WrapHandler(http.HandlerFunc(s.handleCover)))
	mux.GET("/dlna/transcode/:token/:songID", echo.WrapHandler(http.HandlerFunc(s.handleTranscode)))
}

func (s *Service) AudioURL(base string, userID, songID int, ttl time.Duration) (string, error) {
	return s.mediaURL(base, userID, songID, PurposeAudio, ttl)
}

func (s *Service) CoverURL(base string, userID, songID int, ttl time.Duration) (string, error) {
	return s.mediaURL(base, userID, songID, PurposeCover, ttl)
}

func (s *Service) TranscodeURL(base string, userID, songID int, ttl time.Duration) (string, error) {
	return s.mediaURL(base, userID, songID, PurposeTranscode, ttl)
}

func (s *Service) mediaURL(base string, userID, songID int, purpose MediaPurpose, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = castMediaTokenTTL
	}
	token, err := s.tokens.Issue(songID, userID, purpose, ttl)
	if err != nil {
		return "", err
	}
	base = strings.TrimRight(strings.TrimSpace(firstNonEmpty(s.options.MediaBaseURL, base)), "/")
	if base == "" {
		return "", fmt.Errorf("dlna media base url is required")
	}
	return fmt.Sprintf("%s/dlna/%s/%s/%d", base, purpose, url.PathEscape(token), songID), nil
}

func (s *Service) handleAudio(w http.ResponseWriter, r *http.Request) {
	_, songID, ok := s.validateMediaRequest(w, r, PurposeAudio)
	if !ok {
		return
	}
	item, err := s.lib.RawSong(r.Context(), songID)
	if err != nil {
		http.Error(w, "audio not found", http.StatusNotFound)
		return
	}
	source := library.ResolveAudioSegment(item.Path)
	file, err := os.Open(source.Path)
	if err != nil {
		http.Error(w, "audio not found", http.StatusNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.Error(w, "audio not found", http.StatusNotFound)
		return
	}
	setDLNAMediaHeaders(w.Header())
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Header().Set("Content-Type", firstNonEmpty(item.Mime, mimeFromFormat(item.Format), "application/octet-stream"))
	http.ServeContent(w, r, filepath.Base(source.Path), info.ModTime(), file)
}

func (s *Service) handleCover(w http.ResponseWriter, r *http.Request) {
	_, songID, ok := s.validateMediaRequest(w, r, PurposeCover)
	if !ok {
		return
	}
	data, mimeType, err := s.lib.SongCover(r.Context(), songID)
	if err != nil {
		http.Error(w, "cover not found", http.StatusNotFound)
		return
	}
	if len(data) == 0 {
		http.Error(w, "cover not found", http.StatusNotFound)
		return
	}
	if strings.TrimSpace(mimeType) == "" {
		mimeType = http.DetectContentType(data)
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	w.Header().Set("Content-Type", mimeType)
	_, _ = w.Write(data)
}

func (s *Service) handleTranscode(w http.ResponseWriter, r *http.Request) {
	_, songID, ok := s.validateMediaRequest(w, r, PurposeTranscode)
	if !ok {
		return
	}
	ffmpeg := strings.TrimSpace(s.lib.FFmpegBin())
	if ffmpeg == "" {
		http.Error(w, "ffmpeg is not configured", http.StatusUnsupportedMediaType)
		return
	}
	item, err := s.lib.RawSong(r.Context(), songID)
	if err != nil {
		http.Error(w, "audio not found", http.StatusNotFound)
		return
	}
	source := library.ResolveAudioSegment(item.Path)
	if err := s.pipeTranscode(r.Context(), w, ffmpeg, source, 192); err != nil {
		http.Error(w, err.Error(), http.StatusUnsupportedMediaType)
	}
}

func (s *Service) validateMediaRequest(w http.ResponseWriter, r *http.Request, purpose MediaPurpose) (TokenClaims, int, bool) {
	token, songID, err := mediaPathParts(r.URL.Path, purpose)
	if err != nil {
		http.Error(w, "invalid media request", http.StatusBadRequest)
		return TokenClaims{}, 0, false
	}
	if !s.options.AllowsIP(r.RemoteAddr) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return TokenClaims{}, 0, false
	}
	claims, err := s.tokens.Validate(token, songID, purpose)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return TokenClaims{}, 0, false
	}
	return claims, songID, true
}

func mediaPathParts(path string, purpose MediaPurpose) (string, int, error) {
	prefix := "/dlna/" + string(purpose) + "/"
	rest := strings.TrimPrefix(path, prefix)
	if rest == path {
		return "", 0, fmt.Errorf("invalid purpose")
	}
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", 0, fmt.Errorf("invalid path")
	}
	token, err := url.PathUnescape(parts[0])
	if err != nil {
		return "", 0, err
	}
	songID, err := strconv.Atoi(parts[1])
	if err != nil || songID <= 0 {
		return "", 0, fmt.Errorf("invalid song id")
	}
	return token, songID, nil
}

func setDLNAMediaHeaders(header http.Header) {
	header.Set("Accept-Ranges", "bytes")
	header.Set("transferMode.dlna.org", "Streaming")
	header.Set("contentFeatures.dlna.org", "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01500000000000000000000000000000")
}

func (s *Service) pipeTranscode(ctx context.Context, w http.ResponseWriter, ffmpeg string, source library.AudioSegment, quality int) error {
	args := []string{"-hide_banner", "-loglevel", "error"}
	if source.StartSeconds > 0 {
		args = append(args, "-ss", fmt.Sprintf("%.3f", source.StartSeconds))
	}
	args = append(args, "-i", source.Path, "-vn", "-map", "0:a:0")
	if source.EndSeconds > source.StartSeconds {
		args = append(args, "-t", fmt.Sprintf("%.3f", source.EndSeconds-source.StartSeconds))
	}
	args = append(args,
		"-acodec", "libmp3lame",
		"-b:a", fmt.Sprintf("%dk", quality),
		"-flush_packets", "1",
		"-f", "mp3",
		"pipe:1",
	)
	cmd := exec.CommandContext(ctx, ffmpeg, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	defer func() {
		_ = stdout.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
	}()
	setDLNAMediaHeaders(w.Header())
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "audio/mpeg")
	w.WriteHeader(http.StatusOK)
	_, err = io.Copy(w, stdout)
	return err
}
