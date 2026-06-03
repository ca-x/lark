package library

import (
	"context"
	"regexp"
	"sort"
	"strings"
	"unicode"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/artist"
	"lark/backend/ent/song"
	"lark/backend/ent/userartistfavorite"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
)

const unknownArtistName = "Unknown Artist"

var artistLeadingNumberPattern = regexp.MustCompile(`^\s*\d{1,3}\s*(?:[.)）\]】、._\-–—．])\s*`)

func normalizeArtistName(value string) string {
	candidates := artistNameCandidates(value)
	if len(candidates) == 0 {
		return unknownArtistName
	}
	return candidates[0]
}

func artistNameCandidates(value string) []string {
	value = cleanArtistToken(value)
	if value == "" {
		return nil
	}
	parts := splitArtistTokens(value)
	out := make([]string, 0, len(parts))
	seen := map[string]bool{}
	for _, part := range parts {
		part = cleanArtistToken(part)
		if part == "" {
			continue
		}
		key := strings.ToLower(part)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, part)
	}
	return out
}

func cleanArtistToken(value string) string {
	value = strings.TrimSpace(cleanMetadataText(value))
	value = artistLeadingNumberPattern.ReplaceAllString(value, "")
	value = strings.Join(strings.Fields(value), " ")
	value = strings.TrimFunc(value, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r)
	})
	value = strings.TrimSpace(value)
	for {
		next := artistLeadingNumberPattern.ReplaceAllString(value, "")
		next = strings.TrimFunc(next, func(r rune) bool {
			return unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r)
		})
		next = strings.TrimSpace(next)
		if next == value {
			return value
		}
		value = next
	}
}

func splitArtistTokens(value string) []string {
	replacer := strings.NewReplacer(
		"＿", "_",
		"、", "_",
		"，", "_",
		",", "_",
		"；", "_",
		";", "_",
		" feat. ", "_",
		" ft. ", "_",
		" Feat. ", "_",
		" FT. ", "_",
		" with ", "_",
		" With ", "_",
	)
	value = replacer.Replace(value)
	if containsCJK(value) {
		value = strings.NewReplacer(" / ", "_", "/", "_", "／", "_").Replace(value)
	}
	parts := strings.Split(value, "_")
	if len(parts) == 0 {
		return []string{value}
	}
	return parts
}

func artistInitial(value string) string {
	value = normalizeArtistName(value)
	for _, r := range value {
		switch {
		case r >= 'A' && r <= 'Z':
			return string(r)
		case r >= 'a' && r <= 'z':
			return strings.ToUpper(string(r))
		case r >= '0' && r <= '9':
			return "#"
		case unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r):
			continue
		}
		if initial := chinesePinyinInitial(r); initial != "" {
			return initial
		}
		return "#"
	}
	return "#"
}

func normalizeArtistInitial(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if value == "#" {
		return "#"
	}
	r := []rune(value)
	if len(r) == 0 {
		return ""
	}
	if r[0] >= 'A' && r[0] <= 'Z' {
		return string(r[0])
	}
	if r[0] >= 'a' && r[0] <= 'z' {
		return strings.ToUpper(string(r[0]))
	}
	return ""
}

func chinesePinyinInitial(r rune) string {
	encoded, _, err := transform.String(simplifiedchinese.GB18030.NewEncoder(), string(r))
	if err != nil || len(encoded) < 2 {
		return ""
	}
	code := int(encoded[0])*256 + int(encoded[1]) - 65536
	for i := len(gb2312InitialRanges) - 1; i >= 0; i-- {
		if code >= gb2312InitialRanges[i].boundary {
			return gb2312InitialRanges[i].initial
		}
	}
	return ""
}

var gb2312InitialRanges = []struct {
	boundary int
	initial  string
}{
	{-20319, "A"},
	{-20283, "B"},
	{-19775, "C"},
	{-19218, "D"},
	{-18710, "E"},
	{-18526, "F"},
	{-18239, "G"},
	{-17922, "H"},
	{-17417, "J"},
	{-16474, "K"},
	{-16212, "L"},
	{-15640, "M"},
	{-15165, "N"},
	{-14922, "O"},
	{-14914, "P"},
	{-14630, "Q"},
	{-14149, "R"},
	{-14090, "S"},
	{-13318, "T"},
	{-12838, "W"},
	{-12556, "X"},
	{-11847, "Y"},
	{-11055, "Z"},
}

func (s *Service) refreshArtistInitial(ctx context.Context, item *ent.Artist) {
	if item == nil || s.db == nil {
		return
	}
	initial := artistInitial(item.Name)
	if item.Initial == initial {
		return
	}
	switch s.dbDialect {
	case "postgres", "postgresql":
		_, _ = s.db.ExecContext(ctx, "UPDATE artists SET initial = $1 WHERE id = $2", initial, item.ID)
	default:
		_, _ = s.db.ExecContext(ctx, "UPDATE artists SET initial = ? WHERE id = ?", initial, item.ID)
	}
	item.Initial = initial
}

func (s *Service) BackfillArtistInitials(ctx context.Context) error {
	if s.client == nil || s.db == nil {
		return nil
	}
	items, err := s.client.Artist.Query().All(ctx)
	if err != nil {
		return err
	}
	for _, item := range items {
		s.refreshArtistInitial(ctx, item)
	}
	return nil
}

func (s *Service) NormalizeArtists(ctx context.Context) error {
	if s.client == nil {
		return nil
	}
	items, err := s.client.Artist.Query().Order(artist.ByID()).All(ctx)
	if err != nil {
		return err
	}
	canonicalByName := map[string]*ent.Artist{}
	changed := false
	for _, item := range items {
		if item == nil {
			continue
		}
		canonicalName := normalizeArtistName(item.Name)
		canonical, ok := canonicalByName[canonicalName]
		if !ok {
			if item.Name == canonicalName {
				canonical = item
			} else {
				canonical, err = s.ensureArtist(ctx, canonicalName)
				if err != nil {
					return err
				}
			}
			canonicalByName[canonicalName] = canonical
		}
		s.refreshArtistInitial(ctx, canonical)
		if item.ID == canonical.ID {
			continue
		}
		if err := s.reassignArtist(ctx, item.ID, canonical.ID); err != nil {
			return err
		}
		changed = true
	}
	if err := s.BackfillArtistInitials(ctx); err != nil {
		return err
	}
	if changed {
		s.invalidateLibraryCache(ctx)
		s.invalidateSearchCatalogs(ctx)
	}
	return nil
}

func (s *Service) reassignArtist(ctx context.Context, fromID, toID int) error {
	if fromID <= 0 || toID <= 0 || fromID == toID {
		return nil
	}
	if s.db != nil {
		if err := s.copyArtistFavorites(ctx, fromID, toID); err != nil {
			return err
		}
	}
	if err := s.client.Song.Update().Where(song.HasArtistWith(artist.ID(fromID))).SetArtistID(toID).Exec(ctx); err != nil {
		return err
	}
	if err := s.client.Album.Update().Where(album.HasArtistWith(artist.ID(fromID))).SetArtistID(toID).Exec(ctx); err != nil {
		return err
	}
	if _, err := s.client.UserArtistFavorite.Delete().Where(userartistfavorite.HasArtistWith(artist.ID(fromID))).Exec(ctx); err != nil {
		return err
	}
	_, err := s.client.Artist.Delete().Where(artist.ID(fromID)).Exec(ctx)
	return err
}

func (s *Service) copyArtistFavorites(ctx context.Context, fromID, toID int) error {
	switch s.dbDialect {
	case "postgres", "postgresql":
		_, err := s.db.ExecContext(ctx, `
			INSERT INTO user_artist_favorites (created_at, user_artist_favorites, artist_user_favorites)
			SELECT created_at, user_artist_favorites, $1 FROM user_artist_favorites
			WHERE artist_user_favorites = $2
			ON CONFLICT DO NOTHING
		`, toID, fromID)
		return err
	case "mysql", "mariadb":
		_, err := s.db.ExecContext(ctx, `
			INSERT IGNORE INTO user_artist_favorites (created_at, user_artist_favorites, artist_user_favorites)
			SELECT created_at, user_artist_favorites, ? FROM user_artist_favorites
			WHERE artist_user_favorites = ?
		`, toID, fromID)
		return err
	default:
		_, err := s.db.ExecContext(ctx, `
			INSERT OR IGNORE INTO user_artist_favorites (created_at, user_artist_favorites, artist_user_favorites)
			SELECT created_at, user_artist_favorites, ? FROM user_artist_favorites
			WHERE artist_user_favorites = ?
		`, toID, fromID)
		return err
	}
}

func artistPageInitials(items []*ent.Artist) []string {
	set := map[string]bool{}
	for _, item := range items {
		if item == nil {
			continue
		}
		initial := normalizeArtistInitial(item.Initial)
		if initial == "" {
			initial = artistInitial(item.Name)
		}
		set[initial] = true
	}
	out := make([]string, 0, len(set))
	for initial := range set {
		out = append(out, initial)
	}
	sort.Strings(out)
	return out
}
