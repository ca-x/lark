package library

import (
	"bytes"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	textunicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

func cleanMetadataText(value string) string {
	return decodeRIFFInfoString(value)
}

func decodeRIFFInfoString(raw string) string {
	data := bytes.TrimRight([]byte(raw), "\x00")
	if len(data) == 0 {
		return ""
	}
	if decoded, ok := tryDecodeUTF16(data); ok {
		return cleanDecodedMetadata(decoded)
	}
	if decoded, ok := tryDecodeUTF16WithoutBOM(data); ok {
		return cleanDecodedMetadata(decoded)
	}

	best := cleanDecodedMetadata(string(data))
	bestScore := metadataTextScore(best)
	for _, candidate := range legacyMetadataCandidates(data, best) {
		candidate = cleanDecodedMetadata(candidate)
		if candidate == "" || candidate == best {
			continue
		}
		score := metadataTextScore(candidate)
		if score > bestScore && containsCJK(candidate) && !containsReplacement(candidate) {
			best = candidate
			bestScore = score
		}
	}
	if !utf8.ValidString(best) {
		best = strings.ToValidUTF8(best, "?")
	}
	return best
}

func tryDecodeUTF16(data []byte) (string, bool) {
	if len(data) < 2 {
		return "", false
	}
	var decoder transform.Transformer
	switch {
	case data[0] == 0xff && data[1] == 0xfe:
		decoder = textunicode.UTF16(textunicode.LittleEndian, textunicode.UseBOM).NewDecoder()
	case data[0] == 0xfe && data[1] == 0xff:
		decoder = textunicode.UTF16(textunicode.BigEndian, textunicode.UseBOM).NewDecoder()
	default:
		return "", false
	}
	decoded, _, err := transform.Bytes(decoder, data)
	if err != nil {
		return "", false
	}
	return string(decoded), true
}

func tryDecodeUTF16WithoutBOM(data []byte) (string, bool) {
	if len(data) < 4 || len(data)%2 != 0 {
		return "", false
	}
	oddZeros, evenZeros := 0, 0
	pairs := len(data) / 2
	for i := 0; i+1 < len(data); i += 2 {
		if data[i] == 0 {
			evenZeros++
		}
		if data[i+1] == 0 {
			oddZeros++
		}
	}
	var endian textunicode.Endianness
	switch {
	case oddZeros >= pairs/2 && evenZeros == 0:
		endian = textunicode.LittleEndian
	case evenZeros >= pairs/2 && oddZeros == 0:
		endian = textunicode.BigEndian
	default:
		return "", false
	}
	decoded, _, err := transform.Bytes(textunicode.UTF16(endian, textunicode.IgnoreBOM).NewDecoder(), data)
	if err != nil {
		return "", false
	}
	text := cleanDecodedMetadata(string(decoded))
	if text == "" || containsReplacement(text) {
		return "", false
	}
	return text, true
}

func legacyMetadataCandidates(raw []byte, current string) []string {
	candidates := []string{}
	if !utf8.Valid(raw) {
		if decoded, err := decodeGB18030(raw); err == nil {
			candidates = append(candidates, decoded)
		}
	}
	latin1 := make([]byte, 0, len(current))
	latin1OK := true
	for _, r := range current {
		if r > 0xff {
			latin1OK = false
			break
		}
		latin1 = append(latin1, byte(r))
	}
	if latin1OK && len(latin1) > 0 {
		if decoded, err := decodeGB18030(latin1); err == nil {
			candidates = append(candidates, decoded)
		}
	}
	return candidates
}

func decodeGB18030(data []byte) (string, error) {
	decoded, _, err := transform.Bytes(simplifiedchinese.GB18030.NewDecoder(), data)
	if err != nil {
		return "", err
	}
	return string(decoded), nil
}

func cleanDecodedMetadata(value string) string {
	value = strings.Map(func(r rune) rune {
		if r < 0x20 && r != '\t' && r != '\n' && r != '\r' {
			return -1
		}
		return r
	}, value)
	return strings.TrimSpace(value)
}

func metadataTextScore(value string) int {
	score := 0
	for _, r := range value {
		switch {
		case r == '\ufffd':
			score -= 20
		case isCJK(r):
			score += 8
		case r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			score += 1
		case r == ' ' || r == '-' || r == '_' || r == '.' || r == ',' || r == '&' || r == '\'' || r == '·' || r == '–':
			score += 1
		case r < 0x20 && r != '\t' && r != '\n' && r != '\r':
			score -= 10
		case r >= 0x80 && r <= 0xff:
			score -= 2
		}
	}
	return score
}

func containsCJK(value string) bool {
	for _, r := range value {
		if isCJK(r) {
			return true
		}
	}
	return false
}

func containsReplacement(value string) bool {
	return strings.ContainsRune(value, '\ufffd')
}

func isCJK(r rune) bool {
	return (r >= 0x3400 && r <= 0x4dbf) ||
		(r >= 0x4e00 && r <= 0x9fff) ||
		(r >= 0xf900 && r <= 0xfaff) ||
		(r >= 0x20000 && r <= 0x2a6df) ||
		(r >= 0x2a700 && r <= 0x2b73f) ||
		(r >= 0x2b740 && r <= 0x2b81f) ||
		(r >= 0x2b820 && r <= 0x2ceaf)
}
