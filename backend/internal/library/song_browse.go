package library

import (
	"context"
	"strings"

	entsql "entgo.io/ent/dialect/sql"

	"lark/backend/ent"
	"lark/backend/ent/album"
	"lark/backend/ent/artist"
	"lark/backend/ent/predicate"
	"lark/backend/ent/song"
	"lark/backend/internal/models"
)

type SongSort string

const (
	SongSortAddedDesc    SongSort = "added_desc"
	SongSortAddedAsc     SongSort = "added_asc"
	SongSortFilenameAsc  SongSort = "filename_asc"
	SongSortFilenameDesc SongSort = "filename_desc"
)

type SongReview string

const SongReviewIncomplete SongReview = "incomplete"

const (
	MetadataIssueMissingTitle  = "missing_title"
	MetadataIssueMissingArtist = "missing_artist"
	MetadataIssueMissingAlbum  = "missing_album"
)

type SongBrowseOptions struct {
	Sort   SongSort
	Review SongReview
}

func ParseSongSort(value string) SongSort {
	switch SongSort(strings.ToLower(strings.TrimSpace(value))) {
	case SongSortAddedAsc:
		return SongSortAddedAsc
	case SongSortFilenameAsc:
		return SongSortFilenameAsc
	case SongSortFilenameDesc:
		return SongSortFilenameDesc
	default:
		return SongSortAddedDesc
	}
}

func ParseSongReview(value string) SongReview {
	if strings.EqualFold(strings.TrimSpace(value), string(SongReviewIncomplete)) {
		return SongReviewIncomplete
	}
	return ""
}

func normalizeSongBrowseOptions(options SongBrowseOptions) SongBrowseOptions {
	options.Sort = ParseSongSort(string(options.Sort))
	options.Review = ParseSongReview(string(options.Review))
	return options
}

func filenameOrder(desc bool) song.OrderOption {
	return func(selector *entsql.Selector) {
		selector.OrderExprFunc(func(builder *entsql.Builder) {
			builder.WriteString("LOWER(").Ident(selector.C(song.FieldFileName)).WriteByte(')')
			if desc {
				builder.WriteString(" DESC")
			} else {
				builder.WriteString(" ASC")
			}
		})
	}
}

func songBrowseOrder(sortValue SongSort) []song.OrderOption {
	switch ParseSongSort(string(sortValue)) {
	case SongSortAddedAsc:
		return []song.OrderOption{ent.Asc(song.FieldCreatedAt), ent.Asc(song.FieldID)}
	case SongSortFilenameAsc:
		return []song.OrderOption{filenameOrder(false), ent.Asc(song.FieldID)}
	case SongSortFilenameDesc:
		return []song.OrderOption{filenameOrder(true), ent.Desc(song.FieldID)}
	default:
		return []song.OrderOption{ent.Desc(song.FieldCreatedAt), ent.Desc(song.FieldID)}
	}
}

func incompleteSongPredicate() predicate.Song {
	return song.Or(
		song.Not(song.HasArtist()),
		song.Not(song.HasAlbum()),
		song.TitleEQ(""),
		song.TitleEqualFold("Unknown Title"),
		song.TitleEqualFold("未知标题"),
		song.HasArtistWith(artist.Or(artist.NameEqualFold("Unknown Artist"), artist.NameEqualFold("未知艺术家"))),
		song.HasAlbumWith(album.Or(album.TitleEqualFold("Unknown Album"), album.TitleEqualFold("未知专辑"))),
	)
}

func metadataIssuesForSong(item models.Song) []string {
	issues := make([]string, 0, 3)
	title := strings.TrimSpace(item.Title)
	if title == "" || strings.EqualFold(title, "Unknown Title") || title == "未知标题" {
		issues = append(issues, MetadataIssueMissingTitle)
	}
	artistName := strings.TrimSpace(item.Artist)
	if item.ArtistID == 0 || strings.EqualFold(artistName, "Unknown Artist") || artistName == "未知艺术家" {
		issues = append(issues, MetadataIssueMissingArtist)
	}
	albumTitle := strings.TrimSpace(item.Album)
	if item.AlbumID == 0 || strings.EqualFold(albumTitle, "Unknown Album") || albumTitle == "未知专辑" {
		issues = append(issues, MetadataIssueMissingAlbum)
	}
	return issues
}

func addMetadataIssues(items []models.Song) []models.Song {
	for i := range items {
		items[i].MetadataIssues = metadataIssuesForSong(items[i])
	}
	return items
}

func (s *Service) ReviewSummary(ctx context.Context, _ int) (models.LibraryReviewSummary, error) {
	count, err := s.client.Song.Query().Where(incompleteSongPredicate()).Count(ctx)
	if err != nil {
		return models.LibraryReviewSummary{}, err
	}
	return models.LibraryReviewSummary{IncompleteSongs: count}, nil
}
