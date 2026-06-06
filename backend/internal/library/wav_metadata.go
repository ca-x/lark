package library

import (
	"bytes"
	"encoding/binary"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"
)

func probeWAVMetadata(path string) fileMetadata {
	if strings.ToLower(strings.TrimPrefix(filepathExt(path), ".")) != "wav" {
		return fileMetadata{}
	}
	f, err := os.Open(path)
	if err != nil {
		return fileMetadata{}
	}
	defer f.Close()

	var header [12]byte
	if _, err := io.ReadFull(f, header[:]); err != nil || string(header[0:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
		return fileMetadata{}
	}

	var meta fileMetadata
	var byteRate int
	var dataBytes uint32
chunks:
	for {
		var chunkHeader [8]byte
		if _, err := io.ReadFull(f, chunkHeader[:]); err != nil {
			break
		}
		chunkID := string(chunkHeader[0:4])
		chunkSize := binary.LittleEndian.Uint32(chunkHeader[4:8])
		switch chunkID {
		case "fmt ":
			chunkData, err := readChunkData(f, chunkSize)
			if err != nil {
				break chunks
			}
			if len(chunkData) >= 16 {
				meta.SampleRate = int(binary.LittleEndian.Uint32(chunkData[4:8]))
				byteRate = int(binary.LittleEndian.Uint32(chunkData[8:12]))
				meta.BitDepth = int(binary.LittleEndian.Uint16(chunkData[14:16]))
			}
		case "data":
			dataBytes = chunkSize
			if err := skipChunkData(f, chunkSize); err != nil {
				break chunks
			}
		case "LIST":
			chunkData, err := readChunkData(f, chunkSize)
			if err != nil {
				break chunks
			}
			mergeFileMetadata(&meta, parseWAVInfoList(chunkData))
		case "id3 ", "ID3 ":
			chunkData, err := readChunkData(f, chunkSize)
			if err != nil {
				break chunks
			}
			mergeFileMetadata(&meta, parseID3Metadata(chunkData))
		default:
			if err := skipChunkData(f, chunkSize); err != nil {
				break chunks
			}
		}
		if chunkSize%2 == 1 {
			_, _ = f.Seek(1, io.SeekCurrent)
		}
	}
	if meta.Duration == 0 && byteRate > 0 && dataBytes > 0 {
		meta.Duration = float64(dataBytes) / float64(byteRate)
	}
	if meta.BitRate == 0 && byteRate > 0 {
		meta.BitRate = byteRate * 8
	}
	return meta
}

func skipChunkData(f *os.File, size uint32) error {
	_, err := f.Seek(int64(size), io.SeekCurrent)
	return err
}

func filepathExt(path string) string {
	idx := strings.LastIndex(path, ".")
	if idx < 0 {
		return ""
	}
	return path[idx:]
}

func readChunkData(r io.Reader, size uint32) ([]byte, error) {
	if size > 16*1024*1024 {
		_, err := io.CopyN(io.Discard, r, int64(size))
		return nil, err
	}
	data := make([]byte, size)
	_, err := io.ReadFull(r, data)
	return data, err
}

func parseWAVInfoList(data []byte) fileMetadata {
	if len(data) < 4 || string(data[:4]) != "INFO" {
		return fileMetadata{}
	}
	var meta fileMetadata
	for pos := 4; pos+8 <= len(data); {
		id := string(data[pos : pos+4])
		size := int(binary.LittleEndian.Uint32(data[pos+4 : pos+8]))
		pos += 8
		if size < 0 || pos+size > len(data) {
			break
		}
		value := decodeWAVInfoText(data[pos : pos+size])
		switch id {
		case "INAM", "TITL":
			meta.Title = value
		case "IART":
			meta.Artist = value
		case "IPRD", "IALB":
			meta.Album = value
		case "ICRD", "YEAR":
			meta.Year = parseYear(value)
		}
		pos += size
		if size%2 == 1 {
			pos++
		}
	}
	return meta
}

func decodeWAVInfoText(raw []byte) string {
	raw = trimRIFFString(raw)
	if len(raw) == 0 {
		return ""
	}
	if decoded, ok := tryDecodeUTF16(raw); ok {
		return cleanDecodedMetadata(decoded)
	}
	if decoded, ok := tryDecodeUTF16WithoutBOM(raw); ok {
		return cleanDecodedMetadata(decoded)
	}
	if utf8.Valid(raw) {
		return cleanDecodedMetadata(string(raw))
	}
	if decoded, ok := bestSimplifiedChineseDecode(raw); ok {
		return decoded
	}
	text := cleanMetadataText(string(raw))
	if metadataNeedsFilenameFallback(text) {
		return ""
	}
	return text
}

func trimRIFFString(raw []byte) []byte {
	for len(raw) > 0 && raw[len(raw)-1] == 0 {
		raw = raw[:len(raw)-1]
	}
	return raw
}

func parseID3Metadata(data []byte) fileMetadata {
	if len(data) < 10 || string(data[:3]) != "ID3" {
		return fileMetadata{}
	}
	version := data[3]
	tagSize := syncsafeInt(data[6:10])
	if tagSize <= 0 || tagSize+10 > len(data) {
		tagSize = len(data) - 10
	}
	end := 10 + tagSize
	if end > len(data) {
		end = len(data)
	}
	var meta fileMetadata
	for pos := 10; pos+10 <= end; {
		frameID := string(data[pos : pos+4])
		if strings.Trim(frameID, "\x00") == "" {
			break
		}
		var frameSize int
		if version == 4 {
			frameSize = syncsafeInt(data[pos+4 : pos+8])
		} else {
			frameSize = int(binary.BigEndian.Uint32(data[pos+4 : pos+8]))
		}
		pos += 10
		if frameSize <= 0 || pos+frameSize > end {
			break
		}
		payload := data[pos : pos+frameSize]
		switch frameID {
		case "TIT2":
			meta.Title = decodeID3TextFrame(payload)
		case "TPE1":
			meta.Artist = decodeID3TextFrame(payload)
		case "TALB":
			meta.Album = decodeID3TextFrame(payload)
		case "TPE2":
			meta.AlbumArtist = decodeID3TextFrame(payload)
		case "TYER", "TDRC":
			meta.Year = parseYear(decodeID3TextFrame(payload))
		case "USLT", "SYLT":
			meta.Lyrics = decodeID3LyricsFrame(payload)
		}
		pos += frameSize
	}
	return meta
}

func syncsafeInt(data []byte) int {
	if len(data) < 4 {
		return 0
	}
	return int(data[0]&0x7f)<<21 | int(data[1]&0x7f)<<14 | int(data[2]&0x7f)<<7 | int(data[3]&0x7f)
}

func decodeID3TextFrame(payload []byte) string {
	if len(payload) == 0 {
		return ""
	}
	return cleanMetadataText(decodeID3EncodedText(payload[0], payload[1:]))
}

func decodeID3LyricsFrame(payload []byte) string {
	if len(payload) < 4 {
		return ""
	}
	encoding := payload[0]
	body := payload[4:]
	body = stripID3LyricsDescriptor(encoding, body)
	return cleanMetadataText(decodeID3EncodedText(encoding, body))
}

func stripID3LyricsDescriptor(encoding byte, body []byte) []byte {
	switch encoding {
	case 1:
		start := 0
		if len(body) >= 2 && ((body[0] == 0xff && body[1] == 0xfe) || (body[0] == 0xfe && body[1] == 0xff)) {
			start = 2
		}
		if idx := utf16TerminatorIndex(body[start:]); idx >= 0 {
			return body[start+idx+2:]
		}
	case 2:
		if idx := utf16TerminatorIndex(body); idx >= 0 {
			return body[idx+2:]
		}
	default:
		if idx := strings.IndexByte(string(body), 0); idx >= 0 {
			return body[idx+1:]
		}
	}
	return body
}

func decodeID3EncodedText(encoding byte, data []byte) string {
	switch encoding {
	case 1:
		if decoded, ok := tryDecodeUTF16(data); ok {
			return decoded
		}
		if decoded, ok := tryDecodeUTF16WithoutBOM(data); ok {
			return decoded
		}
		if decoded, ok := bestUTF16DecodeWithoutBOM(data); ok {
			return decoded
		}
	case 2:
		be := append([]byte{0xfe, 0xff}, data...)
		if decoded, ok := tryDecodeUTF16(be); ok {
			return decoded
		}
	case 3:
		return string(data)
	}
	return string(data)
}

func utf16TerminatorIndex(data []byte) int {
	for i := 0; i+1 < len(data); i += 2 {
		if data[i] == 0 && data[i+1] == 0 {
			return i
		}
	}
	return -1
}

func mergeFileMetadata(dst *fileMetadata, src fileMetadata) {
	dst.Title = preferredMetadataField(dst.Title, src.Title)
	dst.Artist = preferredMetadataField(dst.Artist, src.Artist)
	dst.Album = preferredMetadataField(dst.Album, src.Album)
	dst.AlbumArtist = preferredMetadataField(dst.AlbumArtist, src.AlbumArtist)
	dst.Lyrics = preferredMetadataField(dst.Lyrics, src.Lyrics)
	if dst.Year == 0 {
		dst.Year = src.Year
	}
	if dst.Duration == 0 {
		dst.Duration = src.Duration
	}
	if dst.SampleRate == 0 {
		dst.SampleRate = src.SampleRate
	}
	if dst.BitRate == 0 {
		dst.BitRate = src.BitRate
	}
	if dst.BitDepth == 0 {
		dst.BitDepth = src.BitDepth
	}
}

func preferredMetadataField(existing, candidate string) string {
	existing = strings.TrimSpace(existing)
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return existing
	}
	if existing == "" {
		return candidate
	}
	if metadataTextScore(candidate) > metadataTextScore(existing) {
		return candidate
	}
	return existing
}

func writeBackCorrectedMetadata(path string, original, corrected fileMetadata) (bool, error) {
	if strings.ToLower(strings.TrimPrefix(filepathExt(path), ".")) != "wav" {
		return false, nil
	}
	meta := fileMetadata{
		Title:  strings.TrimSpace(corrected.Title),
		Artist: strings.TrimSpace(corrected.Artist),
		Album:  strings.TrimSpace(corrected.Album),
		Year:   corrected.Year,
	}
	if !metadataFieldNeedsWrite(original.Title, meta.Title) &&
		!metadataFieldNeedsWrite(original.Artist, meta.Artist) &&
		!metadataFieldNeedsWrite(original.Album, meta.Album) &&
		(original.Year == meta.Year || meta.Year <= 0) {
		return false, nil
	}
	return writeWAVInfoMetadata(path, meta)
}

func metadataFieldNeedsWrite(original, corrected string) bool {
	original = strings.TrimSpace(original)
	corrected = strings.TrimSpace(corrected)
	if corrected == "" || original == corrected {
		return false
	}
	return original == "" || metadataTextScore(corrected) > metadataTextScore(original)
}

func writeWAVInfoMetadata(path string, meta fileMetadata) (bool, error) {
	listChunk := buildWAVInfoListChunk(meta)
	if len(listChunk) == 0 {
		return false, nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return false, err
	}
	src, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer src.Close()
	var header [12]byte
	if _, err := io.ReadFull(src, header[:]); err != nil || string(header[0:4]) != "RIFF" || string(header[8:12]) != "WAVE" {
		return false, nil
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return false, err
	}
	tmpPath := tmp.Name()
	cleanup := func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
	}
	written, writeErr := rewriteWAVInfoChunks(src, tmp, header, listChunk)
	if writeErr != nil {
		cleanup()
		return false, writeErr
	}
	if written <= 8 || written-8 > int64(^uint32(0)) {
		cleanup()
		return false, nil
	}
	var riffSize [4]byte
	binary.LittleEndian.PutUint32(riffSize[:], uint32(written-8))
	if _, err := tmp.Seek(4, io.SeekStart); err != nil {
		cleanup()
		return false, err
	}
	if _, err := writeAll(tmp, riffSize[:]); err != nil {
		cleanup()
		return false, err
	}
	if err := os.Chmod(tmpPath, info.Mode()); err != nil {
		cleanup()
		return false, err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return false, err
	}
	same, err := sameFileContent(path, tmpPath)
	if err != nil {
		_ = os.Remove(tmpPath)
		return false, err
	}
	if same {
		_ = os.Remove(tmpPath)
		return false, nil
	}
	if err := os.Rename(tmpPath, path); err != nil {
		_ = os.Remove(tmpPath)
		return false, err
	}
	return true, nil
}

func rewriteWAVInfoChunks(src *os.File, dst *os.File, header [12]byte, listChunk []byte) (int64, error) {
	written, err := writeAll(dst, header[:])
	if err != nil {
		return written, err
	}
	replaced := false
	for {
		var chunkHeader [8]byte
		if _, err := io.ReadFull(src, chunkHeader[:]); err != nil {
			if err == io.EOF {
				break
			}
			return 0, err
		}
		chunkID := string(chunkHeader[0:4])
		chunkSize := binary.LittleEndian.Uint32(chunkHeader[4:8])
		if chunkID == "LIST" && chunkSize >= 4 {
			var listType [4]byte
			if _, err := io.ReadFull(src, listType[:]); err != nil {
				return 0, err
			}
			remaining := int64(chunkSize) - int64(len(listType))
			if string(listType[:]) == "INFO" {
				if !replaced {
					n, err := writeAll(dst, listChunk)
					written += n
					if err != nil {
						return 0, err
					}
					replaced = true
				}
				if err := discardExactly(src, remaining); err != nil {
					return 0, err
				}
				if chunkSize%2 == 1 {
					if err := discardExactly(src, 1); err != nil {
						return 0, err
					}
				}
				continue
			}
			n, err := writeAll(dst, chunkHeader[:])
			written += n
			if err != nil {
				return 0, err
			}
			n, err = writeAll(dst, listType[:])
			written += n
			if err != nil {
				return 0, err
			}
			n, err = copyExactly(dst, src, remaining)
			written += n
			if err != nil {
				return 0, err
			}
		} else {
			n, err := writeAll(dst, chunkHeader[:])
			written += n
			if err != nil {
				return 0, err
			}
			n, err = copyExactly(dst, src, int64(chunkSize))
			written += n
			if err != nil {
				return 0, err
			}
		}
		if chunkSize%2 == 1 {
			n, err := copyExactly(dst, src, 1)
			written += n
			if err != nil {
				return 0, err
			}
		}
	}
	if !replaced {
		n, err := writeAll(dst, listChunk)
		written += n
		if err != nil {
			return 0, err
		}
	}
	return written, nil
}

func writeAll(w io.Writer, data []byte) (int64, error) {
	written := 0
	for written < len(data) {
		n, err := w.Write(data[written:])
		written += n
		if err != nil {
			return int64(written), err
		}
		if n == 0 {
			return int64(written), io.ErrShortWrite
		}
	}
	return int64(written), nil
}

func copyExactly(dst io.Writer, src io.Reader, n int64) (int64, error) {
	if n <= 0 {
		return 0, nil
	}
	return io.CopyN(dst, src, n)
}

func discardExactly(r io.Reader, n int64) error {
	if n <= 0 {
		return nil
	}
	_, err := io.CopyN(io.Discard, r, n)
	return err
}

func sameFileContent(a, b string) (bool, error) {
	aInfo, err := os.Stat(a)
	if err != nil {
		return false, err
	}
	bInfo, err := os.Stat(b)
	if err != nil {
		return false, err
	}
	if aInfo.Size() != bInfo.Size() {
		return false, nil
	}
	left, err := os.Open(a)
	if err != nil {
		return false, err
	}
	defer left.Close()
	right, err := os.Open(b)
	if err != nil {
		return false, err
	}
	defer right.Close()
	leftBuf := make([]byte, 64*1024)
	rightBuf := make([]byte, 64*1024)
	for {
		leftN, leftErr := left.Read(leftBuf)
		rightN, rightErr := right.Read(rightBuf)
		if leftN != rightN || !bytes.Equal(leftBuf[:leftN], rightBuf[:rightN]) {
			return false, nil
		}
		if leftErr == io.EOF && rightErr == io.EOF {
			return true, nil
		}
		if leftErr != nil && leftErr != io.EOF {
			return false, leftErr
		}
		if rightErr != nil && rightErr != io.EOF {
			return false, rightErr
		}
	}
}

func buildWAVInfoListChunk(meta fileMetadata) []byte {
	body := []byte("INFO")
	body = append(body, wavInfoTextChunk("INAM", meta.Title)...)
	body = append(body, wavInfoTextChunk("IART", meta.Artist)...)
	body = append(body, wavInfoTextChunk("IPRD", meta.Album)...)
	if meta.Year > 0 {
		body = append(body, wavInfoTextChunk("ICRD", strconv.Itoa(meta.Year))...)
	}
	if len(body) == 4 {
		return nil
	}
	out := []byte("LIST")
	var size [4]byte
	binary.LittleEndian.PutUint32(size[:], uint32(len(body)))
	out = append(out, size[:]...)
	out = append(out, body...)
	if len(body)%2 == 1 {
		out = append(out, 0)
	}
	return out
}

func wavInfoTextChunk(id, value string) []byte {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	payload := append([]byte(value), 0)
	out := []byte(id)
	var size [4]byte
	binary.LittleEndian.PutUint32(size[:], uint32(len(payload)))
	out = append(out, size[:]...)
	out = append(out, payload...)
	if len(payload)%2 == 1 {
		out = append(out, 0)
	}
	return out
}
