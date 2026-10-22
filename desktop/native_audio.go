package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
	"time"

	desktopv1 "github.com/ca-x/lark/protocol/gen/go/lark/desktop/v1"
	"github.com/egoist/mygo/audio"
	_ "github.com/egoist/mygo/audio/mp3"
	_ "github.com/egoist/mygo/audio/vorbis"
	"google.golang.org/grpc"
)

type NativePlayback struct {
	SongID          int64   `json:"song_id"`
	Playing         bool    `json:"playing"`
	PositionSeconds float64 `json:"position_seconds"`
	DurationSeconds float64 `json:"duration_seconds"`
}

type grpcRangeReader struct {
	mu       sync.Mutex
	cancelMu sync.Mutex
	cancel   context.CancelFunc
	client   desktopv1.DesktopServiceClient
	token    string
	id       int64
	stream   grpc.ServerStreamingClient[desktopv1.StreamMediaResponse]
	buffer   []byte
	position int64
	size     int64
	closed   bool
}

func newGRPCRangeReader(client desktopv1.DesktopServiceClient, token string, id int64) (*grpcRangeReader, error) {
	r := &grpcRangeReader{client: client, token: token, id: id}
	if err := r.openAt(0); err != nil {
		r.Close()
		return nil, err
	}
	return r, nil
}

func (r *grpcRangeReader) openAt(offset int64) error {
	ctx, cancel := context.WithCancel(context.Background())
	stream, err := r.client.StreamMedia(withToken(ctx, r.token), &desktopv1.StreamMediaRequest{
		Kind: desktopv1.MediaKind_MEDIA_KIND_SONG_AUDIO, Id: r.id,
		Range: fmt.Sprintf("bytes=%d-", offset), Mode: "raw",
	})
	if err != nil {
		cancel()
		return err
	}
	first, err := stream.Recv()
	if err != nil {
		cancel()
		return err
	}
	header := first.GetHeader()
	if header == nil || header.GetStatus() != 206 || !strings.HasPrefix(header.GetContentRange(), "bytes ") {
		cancel()
		return errors.New("native audio needs a seekable original stream")
	}
	_, rawSize, ok := strings.Cut(header.GetContentRange(), "/")
	size, err := strconv.ParseInt(rawSize, 10, 64)
	if !ok || err != nil || size <= 0 {
		cancel()
		return errors.New("native audio length is unavailable")
	}
	r.cancelMu.Lock()
	r.cancel = cancel
	r.cancelMu.Unlock()
	r.stream, r.size = stream, size
	return nil
}

func (r *grpcRangeReader) Read(p []byte) (int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return 0, io.ErrClosedPipe
	}
	if len(p) == 0 {
		return 0, nil
	}
	if r.position >= r.size {
		return 0, io.EOF
	}
	if r.stream == nil {
		if err := r.openAt(r.position); err != nil {
			return 0, err
		}
	}
	for len(r.buffer) == 0 {
		part, err := r.stream.Recv()
		if err != nil {
			return 0, err
		}
		r.buffer = part.GetData()
	}
	n := copy(p, r.buffer)
	r.buffer = r.buffer[n:]
	r.position += int64(n)
	return n, nil
}

func (r *grpcRangeReader) Seek(offset int64, whence int) (int64, error) {
	r.cancelStream()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return 0, io.ErrClosedPipe
	}
	var next int64
	switch whence {
	case io.SeekStart:
		next = offset
	case io.SeekCurrent:
		next = r.position + offset
	case io.SeekEnd:
		next = r.size + offset
	default:
		return r.position, errors.New("invalid seek origin")
	}
	if next < 0 {
		return r.position, errors.New("negative seek position")
	}
	r.position, r.stream, r.buffer = next, nil, nil
	return next, nil
}

func (r *grpcRangeReader) cancelStream() {
	r.cancelMu.Lock()
	if r.cancel != nil {
		r.cancel()
		r.cancel = nil
	}
	r.cancelMu.Unlock()
}

func (r *grpcRangeReader) Close() error {
	r.cancelStream()
	r.mu.Lock()
	r.closed, r.stream, r.buffer = true, nil, nil
	r.mu.Unlock()
	return nil
}

func (d *Desktop) StartNative(ctx context.Context, songID int64, volume float64) (NativePlayback, error) {
	d.nativeMu.Lock()
	d.nativeGeneration++
	generation := d.nativeGeneration
	d.nativeMu.Unlock()
	client, token, err := d.rpc(ctx)
	if err != nil {
		return NativePlayback{}, err
	}
	item, err := client.GetSong(withToken(ctx, token), &desktopv1.GetSongRequest{Id: songID})
	if err != nil {
		return NativePlayback{}, err
	}
	switch strings.ToLower(item.GetSong().GetFormat()) {
	case "mp3", "wav", "wave", "ogg", "oga", "vorbis":
	default:
		return NativePlayback{}, errors.New("native audio does not decode this format")
	}
	reader, err := newGRPCRangeReader(client, token, songID)
	if err != nil {
		return NativePlayback{}, err
	}
	player, err := audio.OpenStream(reader)
	if err != nil {
		_ = reader.Close()
		return NativePlayback{}, err
	}
	player.SetVolume(max(0, min(volume, 1))).Play()
	if err := audio.Err(); err != nil {
		player.Close()
		return NativePlayback{}, err
	}
	d.nativeMu.Lock()
	if generation != d.nativeGeneration {
		d.nativeMu.Unlock()
		player.Close()
		return NativePlayback{}, context.Canceled
	}
	previous := d.nativePlayer
	d.nativePlayer, d.nativeSongID = player, songID
	d.nativeMu.Unlock()
	if previous != nil {
		previous.Close()
	}
	return d.NativeStatus(), nil
}

func (d *Desktop) NativeStatus() NativePlayback {
	d.nativeMu.Lock()
	defer d.nativeMu.Unlock()
	if d.nativePlayer == nil {
		return NativePlayback{}
	}
	return NativePlayback{SongID: d.nativeSongID, Playing: d.nativePlayer.Playing(), PositionSeconds: d.nativePlayer.Position().Seconds(), DurationSeconds: d.nativePlayer.Duration().Seconds()}
}

func (d *Desktop) NativePlay() {
	d.nativeMu.Lock()
	defer d.nativeMu.Unlock()
	if d.nativePlayer != nil {
		d.nativePlayer.Play()
	}
}

func (d *Desktop) NativePause() {
	d.nativeMu.Lock()
	defer d.nativeMu.Unlock()
	if d.nativePlayer != nil {
		d.nativePlayer.Pause()
	}
}

func (d *Desktop) NativeSeek(seconds float64) {
	d.nativeMu.Lock()
	defer d.nativeMu.Unlock()
	if d.nativePlayer != nil {
		d.nativePlayer.Seek(time.Duration(max(0, seconds) * float64(time.Second)))
	}
}

func (d *Desktop) NativeVolume(volume float64) {
	d.nativeMu.Lock()
	defer d.nativeMu.Unlock()
	if d.nativePlayer != nil {
		d.nativePlayer.SetVolume(max(0, min(volume, 1)))
	}
}

func (d *Desktop) NativeStop() {
	d.nativeMu.Lock()
	d.nativeGeneration++
	previous := d.nativePlayer
	d.nativePlayer, d.nativeSongID = nil, 0
	d.nativeMu.Unlock()
	if previous != nil {
		previous.Close()
	}
}
