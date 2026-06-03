package library

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

const cueVirtualMarker = "#lark-cue="

var errCueNoAudioTracks = errors.New("cue sheet has no audio tracks")

type AudioSegment struct {
	Path         string
	StartSeconds float64
	EndSeconds   float64
	IsCUETrack   bool
}

type cueSheet struct {
	Path      string
	Title     string
	Performer string
	Files     []cueFile
	Tracks    []cueTrack
}

type cueFile struct {
	Name string
	Path string
}

type cueTrack struct {
	Number       int
	File         string
	Title        string
	Performer    string
	StartSeconds float64
	EndSeconds   float64
}

type cueImportResult struct {
	Scanned    int
	Added      int
	Updated    int
	AudioPaths []string
}

func isCUEFile(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".cue")
}

func cueVirtualSongPath(audioPath, cuePath string, trackNumber int, startSeconds, endSeconds float64) string {
	values := url.Values{}
	values.Set("cue", cuePath)
	values.Set("track", fmt.Sprintf("%02d", trackNumber))
	values.Set("start", fmt.Sprintf("%.3f", startSeconds))
	if endSeconds > startSeconds {
		values.Set("end", fmt.Sprintf("%.3f", endSeconds))
	}
	return audioPath + cueVirtualMarker + values.Encode()
}

func ResolveAudioSegment(path string) AudioSegment {
	ref, ok := parseCueVirtualSongPath(path)
	if !ok {
		return AudioSegment{Path: path}
	}
	return AudioSegment{
		Path:         ref.AudioPath,
		StartSeconds: ref.StartSeconds,
		EndSeconds:   ref.EndSeconds,
		IsCUETrack:   true,
	}
}

func ActualAudioPath(path string) string {
	return ResolveAudioSegment(path).Path
}

type cueVirtualRef struct {
	AudioPath    string
	CuePath      string
	TrackNumber  int
	StartSeconds float64
	EndSeconds   float64
}

func parseCueVirtualSongPath(path string) (cueVirtualRef, bool) {
	marker := strings.Index(path, cueVirtualMarker)
	if marker < 0 {
		return cueVirtualRef{}, false
	}
	audioPath := strings.TrimSpace(path[:marker])
	if audioPath == "" {
		return cueVirtualRef{}, false
	}
	values, err := url.ParseQuery(path[marker+len(cueVirtualMarker):])
	if err != nil {
		return cueVirtualRef{}, false
	}
	cuePath := strings.TrimSpace(values.Get("cue"))
	trackNumber, _ := strconv.Atoi(values.Get("track"))
	startSeconds, _ := strconv.ParseFloat(values.Get("start"), 64)
	endSeconds, _ := strconv.ParseFloat(values.Get("end"), 64)
	if cuePath == "" || trackNumber <= 0 || startSeconds < 0 {
		return cueVirtualRef{}, false
	}
	return cueVirtualRef{
		AudioPath:    audioPath,
		CuePath:      cuePath,
		TrackNumber:  trackNumber,
		StartSeconds: startSeconds,
		EndSeconds:   endSeconds,
	}, true
}

func (s *Service) parseCueSheet(ctx context.Context, cuePath string) (cueSheet, error) {
	abs, err := filepath.Abs(cuePath)
	if err != nil {
		return cueSheet{}, err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return cueSheet{}, err
	}
	sheet := parseCueText(abs, decodeCueSheetText(data))
	if len(sheet.Tracks) == 0 {
		return cueSheet{}, errCueNoAudioTracks
	}
	if err := resolveCueSheetFiles(&sheet); err != nil {
		return cueSheet{}, err
	}
	s.applyCueTrackDurations(ctx, &sheet)
	return sheet, nil
}

func cueSheetAudioPaths(cuePath string) ([]string, error) {
	abs, err := filepath.Abs(cuePath)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return nil, err
	}
	sheet := parseCueText(abs, decodeCueSheetText(data))
	if len(sheet.Tracks) == 0 {
		return nil, errCueNoAudioTracks
	}
	if err := resolveCueSheetFiles(&sheet); err != nil {
		return nil, err
	}
	return uniqueCueAudioPaths(sheet), nil
}

func parseCueText(cuePath, text string) cueSheet {
	sheet := cueSheet{Path: cuePath}
	currentFile := ""
	var currentTrack *cueTrack
	scanner := bufio.NewScanner(strings.NewReader(text))
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)
	for scanner.Scan() {
		fields := cueFields(scanner.Text())
		if len(fields) == 0 {
			continue
		}
		command := strings.ToUpper(fields[0])
		switch command {
		case "FILE":
			if len(fields) >= 2 {
				currentFile = strings.TrimSpace(fields[1])
				if currentFile != "" {
					sheet.Files = append(sheet.Files, cueFile{Name: currentFile})
				}
			}
		case "TRACK":
			if len(fields) >= 3 && strings.EqualFold(fields[2], "AUDIO") {
				number, _ := strconv.Atoi(fields[1])
				sheet.Tracks = append(sheet.Tracks, cueTrack{Number: number, File: currentFile, StartSeconds: -1})
				currentTrack = &sheet.Tracks[len(sheet.Tracks)-1]
			} else {
				currentTrack = nil
			}
		case "TITLE":
			if len(fields) < 2 {
				continue
			}
			if currentTrack != nil {
				currentTrack.Title = cleanMetadataText(fields[1])
			} else {
				sheet.Title = cleanMetadataText(fields[1])
			}
		case "PERFORMER":
			if len(fields) < 2 {
				continue
			}
			if currentTrack != nil {
				currentTrack.Performer = cleanMetadataText(fields[1])
			} else {
				sheet.Performer = cleanMetadataText(fields[1])
			}
		case "INDEX":
			if currentTrack == nil || len(fields) < 3 || fields[1] != "01" {
				continue
			}
			if seconds, ok := parseCueTime(fields[2]); ok {
				currentTrack.StartSeconds = seconds
			}
		}
	}
	return sheet
}

func cueFields(line string) []string {
	line = strings.TrimSpace(line)
	if line == "" {
		return nil
	}
	fields := []string{}
	for len(line) > 0 {
		line = strings.TrimLeftFunc(line, unicode.IsSpace)
		if line == "" {
			break
		}
		if line[0] == '"' {
			line = line[1:]
			end := strings.IndexByte(line, '"')
			if end < 0 {
				fields = append(fields, line)
				break
			}
			fields = append(fields, line[:end])
			line = line[end+1:]
			continue
		}
		end := strings.IndexFunc(line, unicode.IsSpace)
		if end < 0 {
			fields = append(fields, line)
			break
		}
		fields = append(fields, line[:end])
		line = line[end:]
	}
	return fields
}

func parseCueTime(value string) (float64, bool) {
	parts := strings.Split(value, ":")
	if len(parts) != 3 {
		return 0, false
	}
	minutes, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, false
	}
	seconds, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, false
	}
	frames, err := strconv.Atoi(parts[2])
	if err != nil {
		return 0, false
	}
	if minutes < 0 || seconds < 0 || seconds >= 60 || frames < 0 || frames >= 75 {
		return 0, false
	}
	return float64(minutes*60+seconds) + float64(frames)/75, true
}

func decodeCueSheetText(data []byte) string {
	data = bytes.TrimSpace(data)
	if len(data) == 0 {
		return ""
	}
	if decoded, ok := tryDecodeUTF16(data); ok {
		return cleanDecodedMetadata(decoded)
	}
	if decoded, ok := tryDecodeUTF16WithoutBOM(data); ok {
		return cleanDecodedMetadata(decoded)
	}
	data = bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	if utf8.Valid(data) {
		return cleanDecodedMetadata(string(data))
	}
	if decoded, ok := bestSimplifiedChineseDecode(data); ok {
		return decoded
	}
	return cleanDecodedMetadata(strings.ToValidUTF8(string(data), "?"))
}

func resolveCueSheetFiles(sheet *cueSheet) error {
	baseDir := filepath.Dir(sheet.Path)
	resolved := map[string]string{}
	for i := range sheet.Files {
		resolvedPath, err := resolveCueAudioPath(baseDir, sheet.Files[i].Name)
		if err != nil {
			return err
		}
		sheet.Files[i].Path = resolvedPath
		resolved[sheet.Files[i].Name] = resolvedPath
	}
	for i := range sheet.Tracks {
		audioPath := resolved[sheet.Tracks[i].File]
		if audioPath == "" {
			return fmt.Errorf("cue track %02d has no audio file", sheet.Tracks[i].Number)
		}
		sheet.Tracks[i].File = audioPath
	}
	return nil
}

func resolveCueAudioPath(baseDir, rawName string) (string, error) {
	name := strings.TrimSpace(rawName)
	if name == "" {
		return "", fmt.Errorf("cue audio file name is empty")
	}
	name = filepath.FromSlash(strings.ReplaceAll(name, "\\", "/"))
	candidate := name
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(baseDir, candidate)
	}
	abs, err := filepath.Abs(candidate)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(abs); err == nil {
		return abs, nil
	}
	parent := filepath.Dir(abs)
	entries, err := os.ReadDir(parent)
	if err != nil {
		return "", err
	}
	target := strings.ToLower(filepath.Base(abs))
	for _, entry := range entries {
		if strings.ToLower(entry.Name()) != target {
			continue
		}
		matched := filepath.Join(parent, entry.Name())
		if _, err := os.Stat(matched); err == nil {
			return matched, nil
		}
	}
	return "", fmt.Errorf("cue audio file not found: %s", rawName)
}

func (s *Service) applyCueTrackDurations(ctx context.Context, sheet *cueSheet) {
	durations := map[string]float64{}
	for _, file := range sheet.Files {
		if !IsAudioSupported(file.Path) {
			continue
		}
		meta := s.probe(ctx, file.Path, probeOptions{})
		if meta.Duration > 0 {
			durations[file.Path] = meta.Duration
		}
	}
	for i := range sheet.Tracks {
		if sheet.Tracks[i].StartSeconds < 0 {
			sheet.Tracks[i].StartSeconds = 0
		}
		end := durations[sheet.Tracks[i].File]
		for j := i + 1; j < len(sheet.Tracks); j++ {
			if sheet.Tracks[j].File == sheet.Tracks[i].File && sheet.Tracks[j].StartSeconds > sheet.Tracks[i].StartSeconds {
				end = sheet.Tracks[j].StartSeconds
				break
			}
			if sheet.Tracks[j].File != sheet.Tracks[i].File {
				break
			}
		}
		if end > sheet.Tracks[i].StartSeconds {
			sheet.Tracks[i].EndSeconds = end
		}
	}
}

func uniqueCueAudioPaths(sheet cueSheet) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, file := range sheet.Files {
		if file.Path == "" || seen[file.Path] {
			continue
		}
		seen[file.Path] = true
		out = append(out, file.Path)
	}
	return out
}
