package main

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
)

type DeepLink struct {
	Kind   string `json:"kind"`
	ID     int64  `json:"id"`
	Server string `json:"server,omitempty"`
}

func parseDeepLink(raw string) (DeepLink, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "lark" || (u.Host != "song" && u.Host != "album") || u.User != nil {
		return DeepLink{}, errors.New("invalid lark link")
	}
	path := strings.Trim(u.Path, "/")
	if path == "" || strings.Contains(path, "/") {
		return DeepLink{}, errors.New("invalid item id")
	}
	id, err := strconv.ParseInt(path, 10, 64)
	if err != nil || id <= 0 {
		return DeepLink{}, errors.New("invalid item id")
	}
	server := u.Query().Get("server")
	if server != "" {
		parsed, err := url.Parse(server)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
			return DeepLink{}, errors.New("invalid server address")
		}
	}
	return DeepLink{Kind: u.Host, ID: id, Server: server}, nil
}

func (d *Desktop) queueLink(link DeepLink) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.pendingLink = &link
}

func (d *Desktop) PendingLink() *DeepLink {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.pendingLink == nil {
		return nil
	}
	link := *d.pendingLink
	d.pendingLink = nil
	return &link
}
