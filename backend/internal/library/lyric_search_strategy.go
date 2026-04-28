package library

import (
	"regexp"
	"strings"
	"sync"

	"github.com/longbridgeapp/opencc"
)

var lyricLeadingTrackNumberPattern = regexp.MustCompile(`^\s*\d{1,3}\s*(?:[.)）\]】、._\-–—．]|[ \t]+)\s*`)

func lyricTitleQueryVariants(title string) []string {
	title = cleanLyricQuery(title)
	if title == "" {
		return nil
	}
	var variants []string
	addVariant := func(value string) {
		value = cleanLyricQuery(value)
		if value == "" {
			return
		}
		for _, existing := range variants {
			if existing == value {
				return
			}
		}
		variants = append(variants, value)
	}
	addVariant(title)
	if stripped := stripLeadingTrackNumberForLyricQuery(title); stripped != "" && stripped != title {
		addVariant(stripped)
	}
	for _, variant := range append([]string(nil), variants...) {
		addVariant(traditionalToSimplifiedLyricQuery(variant))
	}
	return variants
}

func stripLeadingTrackNumberForLyricQuery(title string) string {
	stripped := lyricLeadingTrackNumberPattern.ReplaceAllString(title, "")
	stripped = strings.Trim(stripped, " \t\r\n.．。·、_-–—")
	return cleanLyricQuery(stripped)
}

var lyricT2SConverter struct {
	once sync.Once
	cc   *opencc.OpenCC
	err  error
}

func traditionalToSimplifiedLyricQuery(value string) string {
	if value == "" {
		return ""
	}
	lyricT2SConverter.once.Do(func() {
		lyricT2SConverter.cc, lyricT2SConverter.err = opencc.New("t2s")
	})
	if lyricT2SConverter.err != nil || lyricT2SConverter.cc == nil {
		return value
	}
	out, err := lyricT2SConverter.cc.Convert(value)
	if err != nil || out == "" {
		return value
	}
	return out
}
