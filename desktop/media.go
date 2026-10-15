package main

import (
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
)

func (d *Desktop) serveMedia(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}
	id, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || id <= 0 {
		http.NotFound(w, r)
		return
	}
	var kind desktopv1.MediaKind
	switch parts[0] {
	case "song":
		kind = desktopv1.MediaKind_MEDIA_KIND_SONG_AUDIO
	case "song-cover":
		kind = desktopv1.MediaKind_MEDIA_KIND_SONG_COVER
	case "album-cover":
		kind = desktopv1.MediaKind_MEDIA_KIND_ALBUM_COVER
	case "artist-cover":
		kind = desktopv1.MediaKind_MEDIA_KIND_ARTIST_COVER
	default:
		http.NotFound(w, r)
		return
	}
	client, token, err := d.rpc()
	if err != nil {
		http.Error(w, "not connected", http.StatusUnauthorized)
		return
	}
	stream, err := client.StreamMedia(withToken(r.Context(), token), &desktopv1.StreamMediaRequest{Kind: kind, Id: id, Range: r.Header.Get("Range"), Mode: "auto"})
	if err != nil {
		http.Error(w, "media unavailable", http.StatusBadGateway)
		return
	}
	first, err := stream.Recv()
	if err != nil || first.GetHeader() == nil {
		http.Error(w, "media unavailable", http.StatusBadGateway)
		return
	}
	header := first.GetHeader()
	if header.GetContentType() != "" {
		w.Header().Set("Content-Type", header.GetContentType())
	}
	if header.GetContentRange() != "" {
		w.Header().Set("Content-Range", header.GetContentRange())
	}
	if header.GetAcceptRanges() != "" {
		w.Header().Set("Accept-Ranges", header.GetAcceptRanges())
	}
	if header.GetContentLength() > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(header.GetContentLength(), 10))
	}
	if kind != desktopv1.MediaKind_MEDIA_KIND_SONG_AUDIO {
		w.Header().Set("Cache-Control", "private, max-age=3600")
	}
	code := int(header.GetStatus())
	if code < 100 || code > 599 {
		code = http.StatusBadGateway
	}
	w.WriteHeader(code)
	if r.Method == http.MethodHead {
		return
	}
	for {
		part, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return
		}
		if err != nil {
			log.Printf("desktop media stream ended: %v", err)
			return
		}
		if len(part.GetData()) > 0 {
			if _, err := w.Write(part.GetData()); err != nil {
				return
			}
		}
	}
}
