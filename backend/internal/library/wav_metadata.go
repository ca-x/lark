package library

import (
	"encoding/binary"
	"io"
	"os"
	"strings"
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
	for {
		var chunkHeader [8]byte
		if _, err := io.ReadFull(f, chunkHeader[:]); err != nil {
			break
		}
		chunkID := string(chunkHeader[0:4])
		chunkSize := binary.LittleEndian.Uint32(chunkHeader[4:8])
		chunkData, err := readChunkData(f, chunkSize)
		if err != nil {
			break
		}
		switch chunkID {
		case "fmt ":
			if len(chunkData) >= 16 {
				meta.SampleRate = int(binary.LittleEndian.Uint32(chunkData[4:8]))
				byteRate = int(binary.LittleEndian.Uint32(chunkData[8:12]))
				meta.BitDepth = int(binary.LittleEndian.Uint16(chunkData[14:16]))
			}
		case "data":
			dataBytes = chunkSize
		case "LIST":
			mergeFileMetadata(&meta, parseWAVInfoList(chunkData))
		case "id3 ", "ID3 ":
			mergeFileMetadata(&meta, parseID3Metadata(chunkData))
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
	if decoded, err := decodeGB18030(raw); err == nil {
		if cleaned := cleanDecodedMetadata(decoded); cleaned != "" {
			return cleaned
		}
	}
	return cleanMetadataText(string(raw))
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
	if len(body) >= 2 && body[0] == 0xff && body[1] == 0xfe {
		if idx := utf16TerminatorIndex(body[2:]); idx >= 0 {
			body = body[2+idx+2:]
		}
	} else if idx := strings.IndexByte(string(body), 0); idx >= 0 {
		body = body[idx+1:]
	}
	return cleanMetadataText(decodeID3EncodedText(encoding, body))
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
