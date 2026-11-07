package mygo

import (
	"context"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

var repositoryName = regexp.MustCompile(`^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$`)

type CatalogEntry struct {
	Repository  string `json:"repository"`
	Name        string `json:"name"`
	Description string `json:"description"`
	URL         string `json:"url"`
	Stars       int    `json:"stars"`
}

type Catalog struct {
	client    *http.Client
	baseURL   string
	mu        sync.Mutex
	entries   []CatalogEntry
	expires   time.Time
	updated   time.Time
	truncated bool
}

type CatalogStatus struct {
	UpdatedAt time.Time `json:"updated_at"`
	Stale     bool      `json:"stale"`
	Truncated bool      `json:"truncated"`
}

func (c *Catalog) Status() CatalogStatus {
	c.mu.Lock()
	defer c.mu.Unlock()
	return CatalogStatus{UpdatedAt: c.updated, Stale: !time.Now().Before(c.expires), Truncated: c.truncated}
}

func NewCatalog(client *http.Client) *Catalog {
	return &Catalog{client: client, baseURL: "https://api.github.com"}
}

func (c *Catalog) get(ctx context.Context, address string, limit int64) ([]byte, int, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
	if err != nil {
		return nil, 0, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "Lark-MyGo-Plugins")
	response, err := c.client.Do(request)
	if err != nil {
		return nil, 0, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, response.StatusCode, fmt.Errorf("GitHub returned HTTP %d (rate limit or repository unavailable)", response.StatusCode)
	}
	contents, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, response.StatusCode, err
	}
	if int64(len(contents)) > limit {
		return nil, response.StatusCode, errors.New("GitHub response exceeds limit")
	}
	return contents, response.StatusCode, nil
}

func (c *Catalog) Search(ctx context.Context) ([]CatalogEntry, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if time.Now().Before(c.expires) {
		return slices.Clone(c.entries), nil
	}
	entries := []CatalogEntry{}
	truncated := false
	for page := 1; page <= 10; page++ {
		contents, _, err := c.get(ctx, c.baseURL+"/search/repositories?q="+url.QueryEscape("topic:mygo-music-plugin archived:false")+fmt.Sprintf("&sort=stars&per_page=100&page=%d", page), 2<<20)
		if err != nil {
			return nil, err
		}
		var result struct {
			Total      int  `json:"total_count"`
			Incomplete bool `json:"incomplete_results"`
			Items      []struct {
				FullName    string `json:"full_name"`
				Name        string `json:"name"`
				Description string `json:"description"`
				URL         string `json:"html_url"`
				Stars       int    `json:"stargazers_count"`
			} `json:"items"`
		}
		if err := json.Unmarshal(contents, &result); err != nil {
			return nil, err
		}
		for _, item := range result.Items {
			entries = append(entries, CatalogEntry{Repository: item.FullName, Name: item.Name, Description: item.Description, URL: item.URL, Stars: item.Stars})
		}
		truncated = truncated || result.Incomplete || result.Total > 1000
		if len(result.Items) < 100 || len(entries) >= result.Total {
			break
		}
	}
	c.entries = entries
	c.updated = time.Now()
	c.expires = c.updated.Add(10 * time.Minute)
	c.truncated = truncated
	return slices.Clone(entries), nil
}

func normalizeRepository(repository string) (string, error) {
	repository = strings.TrimSuffix(strings.TrimSpace(repository), "/")
	if strings.HasPrefix(repository, "https://github.com/") {
		repository = strings.TrimPrefix(repository, "https://github.com/")
	}
	repository = strings.TrimSuffix(repository, ".git")
	if !repositoryName.MatchString(repository) || strings.Contains(repository, "..") || len(repository) > 200 {
		return "", errors.New("expected owner/repo or a GitHub repository URL")
	}
	return repository, nil
}

func (c *Catalog) Download(ctx context.Context, repository string) ([]byte, string, error) {
	repository, err := normalizeRepository(repository)
	if err != nil {
		return nil, "", err
	}
	contents, status, err := c.get(ctx, c.baseURL+"/repos/"+repository+"/releases/latest", 2<<20)
	if err == nil {
		var release struct {
			Tag    string `json:"tag_name"`
			Assets []struct {
				Name string `json:"name"`
				URL  string `json:"browser_download_url"`
			} `json:"assets"`
		}
		if err := json.Unmarshal(contents, &release); err != nil {
			return nil, "", err
		}
		for _, asset := range release.Assets {
			if strings.HasSuffix(strings.ToLower(asset.Name), ".zip") {
				address, err := url.Parse(asset.URL)
				if err != nil || address.Scheme != "https" || address.Host != "github.com" || !strings.HasPrefix(address.Path, "/"+repository+"/releases/download/") {
					return nil, "", errors.New("unexpected release asset URL")
				}
				archive, _, err := c.get(ctx, asset.URL, maxArchive)
				return archive, "https://github.com/" + repository + "@" + release.Tag, err
			}
		}
	} else if status != http.StatusNotFound {
		return nil, "", err
	}
	contents, _, err = c.get(ctx, c.baseURL+"/repos/"+repository+"/commits?per_page=1", 2<<20)
	if err != nil {
		return nil, "", err
	}
	var commits []struct {
		SHA string `json:"sha"`
	}
	if err := json.Unmarshal(contents, &commits); err != nil {
		return nil, "", err
	}
	if len(commits) == 0 || !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(commits[0].SHA) {
		return nil, "", errors.New("repository has no immutable revision")
	}
	address := "https://codeload.github.com/" + repository + "/zip/" + commits[0].SHA
	archive, _, err := c.get(ctx, address, maxArchive)
	return archive, "https://github.com/" + repository + "@" + commits[0].SHA, err
}
