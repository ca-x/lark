package mygo

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"net/url"
	"regexp"
	"strconv"

	"lark/backend/internal/pluginruntime"
)

var artworkSize = regexp.MustCompile(`(?i)\{size\}|%7bsize%7d`)

func (s *Service) artworkProof(user int, item Installed, address string) []byte {
	mac := hmac.New(sha256.New, s.artworkKey)
	for _, part := range []string{strconv.Itoa(user), item.Manifest.ID, item.Identity, item.Digest, address} {
		mac.Write([]byte(part))
		mac.Write([]byte{0})
	}
	return mac.Sum(nil)
}

func (s *Service) validArtworkProof(user int, item Installed, address, proof string) bool {
	decoded, err := hex.DecodeString(proof)
	return err == nil && hmac.Equal(decoded, s.artworkProof(user, item, address))
}

func (s *Service) NewImageFrom(ctx context.Context, user int, id, identity, address, proof string) (string, error) {
	return s.newMedia(ctx, user, id, identity, address, "image", nil, proof)
}

func (s *Service) artworkReferences(user int, item Installed, value jsontext.Value) (jsontext.Value, error) {
	switch value.Kind() {
	case '{':
		var object map[string]jsontext.Value
		if err := json.Unmarshal(value, &object); err != nil {
			return nil, err
		}
		for key, child := range object {
			if key == "imageUrl" && child.Kind() == '"' {
				var address string
				if err := json.Unmarshal(child, &address); err != nil {
					return nil, err
				}
				address = artworkSize.ReplaceAllString(address, "600")
				parsed, err := url.Parse(address)
				if err == nil && pluginruntime.ValidateURL(parsed) == nil {
					query := url.Values{"url": {address}, "identity": {item.Identity}, "proof": {hex.EncodeToString(s.artworkProof(user, item, address))}}
					object[key], err = json.Marshal("/api/mygo/plugins/" + url.PathEscape(item.Manifest.ID) + "/image?" + query.Encode())
					if err != nil {
						return nil, err
					}
				}
			} else {
				rewritten, err := s.artworkReferences(user, item, child)
				if err != nil {
					return nil, err
				}
				object[key] = rewritten
			}
		}
		return json.Marshal(object)
	case '[':
		var items []jsontext.Value
		if err := json.Unmarshal(value, &items); err != nil {
			return nil, err
		}
		for index, child := range items {
			rewritten, err := s.artworkReferences(user, item, child)
			if err != nil {
				return nil, err
			}
			items[index] = rewritten
		}
		return json.Marshal(items)
	}
	return value, nil
}
