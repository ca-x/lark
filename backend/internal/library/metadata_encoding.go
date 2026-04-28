package library

import (
	"bytes"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/encoding"
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
		candidates = append(candidates, decodeSimplifiedChineseCandidates(raw)...)
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
		candidates = append(candidates, decodeUTF8FromLatin1Mojibake(latin1)...)
		candidates = append(candidates, decodeSimplifiedChineseCandidates(latin1)...)
	}
	return candidates
}

func decodeUTF8FromLatin1Mojibake(data []byte) []string {
	if !utf8.Valid(data) {
		return nil
	}
	text := cleanDecodedMetadata(string(data))
	if text == "" {
		return nil
	}
	return []string{text}
}

func decodeGB18030(data []byte) (string, error) {
	decoded, _, err := transform.Bytes(simplifiedchinese.GB18030.NewDecoder(), data)
	if err != nil {
		return "", err
	}
	return string(decoded), nil
}

func decodeSimplifiedChineseCandidates(data []byte) []string {
	encodings := []struct {
		name string
		enc  encoding.Encoding
	}{
		{name: "gb18030", enc: simplifiedchinese.GB18030},
		{name: "gbk", enc: simplifiedchinese.GBK},
		// HZ-GB-2312 is the GB2312 variant exposed by x/text. Raw GB2312
		// bytes are covered by GBK/GB18030 because they are supersets.
		{name: "hz-gb2312", enc: simplifiedchinese.HZGB2312},
	}
	seen := map[string]bool{}
	candidates := make([]string, 0, len(encodings))
	for _, item := range encodings {
		decoded, _, err := transform.Bytes(item.enc.NewDecoder(), data)
		if err != nil {
			continue
		}
		text := cleanDecodedMetadata(string(decoded))
		if text == "" || seen[text] {
			continue
		}
		seen[text] = true
		candidates = append(candidates, text)
	}
	return candidates
}

func bestSimplifiedChineseDecode(data []byte) (string, bool) {
	best := ""
	bestScore := -1 << 30
	for _, candidate := range decodeSimplifiedChineseCandidates(data) {
		score := metadataTextScore(candidate)
		if containsReplacement(candidate) {
			score -= 1000
		}
		if containsCJK(candidate) {
			score += 20
		}
		if score > bestScore {
			best = candidate
			bestScore = score
		}
	}
	return best, best != ""
}

func bestUTF16DecodeWithoutBOM(data []byte) (string, bool) {
	if len(data) < 2 || len(data)%2 != 0 {
		return "", false
	}
	type candidate struct {
		text string
	}
	candidates := []candidate{}
	for _, endian := range []textunicode.Endianness{textunicode.LittleEndian, textunicode.BigEndian} {
		decoded, _, err := transform.Bytes(textunicode.UTF16(endian, textunicode.IgnoreBOM).NewDecoder(), data)
		if err != nil {
			continue
		}
		text := cleanDecodedMetadata(string(decoded))
		if text == "" || containsReplacement(text) {
			continue
		}
		candidates = append(candidates, candidate{text: text})
	}
	best := ""
	bestScore := -1 << 30
	for _, item := range candidates {
		score := metadataTextScore(item.text)
		if containsCJK(item.text) {
			score += 20
		}
		if score > bestScore {
			best = item.text
			bestScore = score
		}
	}
	return best, best != ""
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
