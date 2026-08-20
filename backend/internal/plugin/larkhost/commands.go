package larkhost

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	pluginhost "lark/backend/internal/plugin/host"
)

const (
	defaultCommandTimeout  = 60 * time.Second
	maxCommandTimeout      = 300 * time.Second
	maxCommandOutputBytes  = 10 << 20
	maxCommandDownload     = 500 << 20
	maxCommandArchiveFiles = 4_096
)

var commandBinNamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*$`)

type commandHost Host

type managedProcess struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func (h *commandHost) Exec(ctx context.Context, info pluginhost.PluginInfo, program string, args []string, options pluginhost.CommandOptions) (pluginhost.CommandResult, error) {
	resolved, err := resolveCommandProgram(info, program)
	if err != nil {
		return pluginhost.CommandResult{}, err
	}
	if err := validateCommandEnv(options.Env); err != nil {
		return pluginhost.CommandResult{}, err
	}
	if err := ensurePluginDataDir(info); err != nil {
		return pluginhost.CommandResult{}, err
	}
	timeout := defaultCommandTimeout
	if options.Timeout > 0 {
		timeout = min(time.Duration(options.Timeout)*time.Millisecond, maxCommandTimeout)
	}
	commandCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(commandCtx, resolved, args...)
	command.Dir = info.DataDir
	command.Env = commandEnvironment(options.Env)
	if options.Stdin != "" {
		command.Stdin = strings.NewReader(options.Stdin)
	}
	stdout := &limitedCommandBuffer{max: maxCommandOutputBytes}
	stderr := &limitedCommandBuffer{max: maxCommandOutputBytes}
	command.Stdout = stdout
	command.Stderr = stderr

	runErr := command.Run()
	exitCode := 0
	if runErr != nil {
		if exitErr, ok := errors.AsType[*exec.ExitError](runErr); ok {
			exitCode = exitErr.ExitCode()
		} else {
			return pluginhost.CommandResult{}, fmt.Errorf("run command: %w", runErr)
		}
	}
	return pluginhost.CommandResult{ExitCode: exitCode, Stdout: stdout.String(), Stderr: stderr.String()}, nil
}

func (h *commandHost) Start(_ context.Context, info pluginhost.PluginInfo, name, program string, args []string, options pluginhost.CommandOptions) (pluginhost.CommandStartResult, error) {
	if strings.TrimSpace(name) == "" || len(name) > 256 || strings.IndexByte(name, 0) >= 0 {
		return pluginhost.CommandStartResult{}, fmt.Errorf("process name is invalid")
	}
	resolved, err := resolveCommandProgram(info, program)
	if err != nil {
		return pluginhost.CommandStartResult{}, err
	}
	if err := validateCommandEnv(options.Env); err != nil {
		return pluginhost.CommandStartResult{}, err
	}
	if err := ensurePluginDataDir(info); err != nil {
		return pluginhost.CommandStartResult{}, err
	}

	owner := (*Host)(h)
	key := commandProcessKey(info, name)
	owner.commandMu.Lock()
	defer owner.commandMu.Unlock()
	if _, exists := owner.processes[key]; exists {
		return pluginhost.CommandStartResult{}, fmt.Errorf("process %q is already running", name)
	}
	processCtx, cancel := context.WithCancel(context.Background())
	command := exec.CommandContext(processCtx, resolved, args...)
	command.Dir = info.DataDir
	command.Env = commandEnvironment(options.Env)
	if err := command.Start(); err != nil {
		cancel()
		return pluginhost.CommandStartResult{}, fmt.Errorf("start command: %w", err)
	}
	process := &managedProcess{cancel: cancel, done: make(chan struct{})}
	owner.processes[key] = process
	go func() {
		_ = command.Wait()
		owner.commandMu.Lock()
		if owner.processes[key] == process {
			delete(owner.processes, key)
		}
		owner.commandMu.Unlock()
		close(process.done)
	}()
	return pluginhost.CommandStartResult{PID: command.Process.Pid}, nil
}

func (h *commandHost) Stop(ctx context.Context, info pluginhost.PluginInfo, name string) error {
	owner := (*Host)(h)
	key := commandProcessKey(info, name)
	owner.commandMu.Lock()
	process := owner.processes[key]
	owner.commandMu.Unlock()
	if process == nil {
		return fmt.Errorf("process %q not found", name)
	}
	process.cancel()
	select {
	case <-process.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *commandHost) IsRunning(_ context.Context, info pluginhost.PluginInfo, name string) (bool, error) {
	owner := (*Host)(h)
	owner.commandMu.Lock()
	_, exists := owner.processes[commandProcessKey(info, name)]
	owner.commandMu.Unlock()
	return exists, nil
}

func (h *commandHost) Cleanup(ctx context.Context, info pluginhost.PluginInfo) error {
	owner := (*Host)(h)
	prefix := info.EntryPath + "\x00"
	owner.commandMu.Lock()
	processes := make([]*managedProcess, 0)
	for key, process := range owner.processes {
		if strings.HasPrefix(key, prefix) {
			processes = append(processes, process)
		}
	}
	owner.commandMu.Unlock()
	for _, process := range processes {
		process.cancel()
	}
	for _, process := range processes {
		select {
		case <-process.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func (h *commandHost) Download(ctx context.Context, info pluginhost.PluginInfo, rawURL, filename string, options pluginhost.CommandDownloadOptions) error {
	if err := validateCommandBinName(filename); err != nil {
		return err
	}
	if options.ExtractTarget != "" {
		if err := validateCommandBinName(options.ExtractTarget); err != nil {
			return fmt.Errorf("invalid extract target: %w", err)
		}
	}
	if options.Extract != "" && options.Extract != "tgz" {
		return fmt.Errorf("unsupported archive format %q", options.Extract)
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("download URL must be an absolute HTTP or HTTPS URL")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return err
	}
	client := &http.Client{
		Timeout: 120 * time.Second,
		CheckRedirect: func(request *http.Request, _ []*http.Request) error {
			if request.URL.Scheme != "http" && request.URL.Scheme != "https" {
				return fmt.Errorf("redirected to unsupported URL scheme %q", request.URL.Scheme)
			}
			return nil
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("download command binary: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("download command binary: HTTP %d", response.StatusCode)
	}
	if response.ContentLength > maxCommandDownload {
		return fmt.Errorf("download exceeds %dMB limit", maxCommandDownload>>20)
	}
	binDir, err := commandBinDir(info)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(binDir, ".download-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o755); err != nil {
		temporary.Close()
		return err
	}
	written, copyErr := io.Copy(temporary, io.LimitReader(response.Body, maxCommandDownload+1))
	closeErr := temporary.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written > maxCommandDownload {
		return fmt.Errorf("download exceeds %dMB limit", maxCommandDownload>>20)
	}
	if options.Extract == "tgz" {
		return extractCommandTGZ(temporaryPath, binDir, options.ExtractTarget)
	}
	return os.Rename(temporaryPath, filepath.Join(binDir, filename))
}

func (h *commandHost) DeleteBin(_ context.Context, info pluginhost.PluginInfo, filename string) error {
	path, err := commandBinPath(info, filename)
	if err != nil {
		return err
	}
	err = os.Remove(path)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (h *commandHost) ListBin(_ context.Context, info pluginhost.PluginInfo) ([]string, error) {
	dir, err := commandBinDir(info)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && !strings.HasPrefix(entry.Name(), ".download-") && !strings.HasPrefix(entry.Name(), ".extract-") {
			result = append(result, entry.Name())
		}
	}
	slices.Sort(result)
	return result, nil
}

func (h *commandHost) BinExists(_ context.Context, info pluginhost.PluginInfo, filename string) (bool, error) {
	path, err := commandBinPath(info, filename)
	if err != nil {
		return false, err
	}
	stat, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	return err == nil && !stat.IsDir(), err
}

func extractCommandTGZ(archivePath, destination, target string) error {
	archive, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer archive.Close()
	gzipReader, err := gzip.NewReader(archive)
	if err != nil {
		return err
	}
	defer gzipReader.Close()
	temporaryDir, err := os.MkdirTemp(destination, ".extract-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporaryDir)

	reader := tar.NewReader(gzipReader)
	extracted := make(map[string]bool)
	var total int64
	for entries := 0; ; {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		entries++
		if entries > maxCommandArchiveFiles {
			return fmt.Errorf("archive exceeds %d entries", maxCommandArchiveFiles)
		}
		archiveName := strings.ReplaceAll(header.Name, "\\", "/")
		if archiveName == "" || filepath.IsAbs(archiveName) || hasParentTraversal(archiveName) {
			return fmt.Errorf("unsafe archive path %q", header.Name)
		}
		if header.Typeflag == tar.TypeDir {
			continue
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA {
			return fmt.Errorf("unsupported archive entry type for %q", header.Name)
		}
		name := filepath.Base(archiveName)
		if target != "" && name != target {
			continue
		}
		if extracted[name] {
			return fmt.Errorf("duplicate archive filename %q", name)
		}
		if header.Size < 0 || total+header.Size > maxCommandDownload {
			return fmt.Errorf("extracted archive exceeds %dMB limit", maxCommandDownload>>20)
		}
		output, err := os.OpenFile(filepath.Join(temporaryDir, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
		if err != nil {
			return err
		}
		written, copyErr := io.CopyN(output, reader, header.Size)
		closeErr := output.Close()
		if copyErr != nil {
			return fmt.Errorf("extract %q: %w", name, copyErr)
		}
		if written != header.Size {
			return fmt.Errorf("extract %q: wrote %d of %d bytes", name, written, header.Size)
		}
		if closeErr != nil {
			return closeErr
		}
		total += written
		extracted[name] = true
	}
	if target != "" && !extracted[target] {
		return fmt.Errorf("target %q not found in archive", target)
	}
	for name := range extracted {
		if err := os.Rename(filepath.Join(temporaryDir, name), filepath.Join(destination, name)); err != nil {
			return err
		}
	}
	return nil
}

func resolveCommandProgram(info pluginhost.PluginInfo, program string) (string, error) {
	if program == "" || strings.IndexByte(program, 0) >= 0 {
		return "", fmt.Errorf("program name is invalid")
	}
	if filepath.IsAbs(program) {
		if filepath.Clean(program) != program || hasParentTraversal(program) {
			return "", fmt.Errorf("absolute program path is not clean")
		}
		stat, err := os.Stat(program)
		if err != nil {
			return "", err
		}
		if stat.IsDir() {
			return "", fmt.Errorf("program is a directory")
		}
		return program, nil
	}
	if err := validateCommandBinName(program); err != nil {
		return "", err
	}
	if local, err := commandBinPath(info, program); err == nil {
		if stat, statErr := os.Stat(local); statErr == nil && !stat.IsDir() {
			return local, nil
		}
	}
	resolved, err := exec.LookPath(program)
	if err != nil {
		return "", fmt.Errorf("program %q not found in plugin bin or system PATH", program)
	}
	return resolved, nil
}

func commandProcessKey(info pluginhost.PluginInfo, name string) string {
	return info.EntryPath + "\x00" + name
}

func ensurePluginDataDir(info pluginhost.PluginInfo) error {
	if info.DataDir == "" {
		return fmt.Errorf("plugin data directory is not configured")
	}
	return os.MkdirAll(info.DataDir, 0o755)
}

func commandBinDir(info pluginhost.PluginInfo) (string, error) {
	if info.DataDir == "" {
		return "", fmt.Errorf("plugin data directory is not configured")
	}
	return filepath.Join(info.DataDir, "bin"), nil
}

func commandBinPath(info pluginhost.PluginInfo, filename string) (string, error) {
	if err := validateCommandBinName(filename); err != nil {
		return "", err
	}
	dir, err := commandBinDir(info)
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, filename), nil
}

func validateCommandBinName(name string) error {
	if !commandBinNamePattern.MatchString(name) || strings.Contains(name, "..") {
		return fmt.Errorf("invalid binary filename %q", name)
	}
	return nil
}

func validateCommandEnv(values map[string]string) error {
	if len(values) > 1_024 {
		return fmt.Errorf("too many environment variables")
	}
	for key, value := range values {
		if key == "" || strings.ContainsAny(key, "=\x00") || strings.IndexByte(value, 0) >= 0 {
			return fmt.Errorf("invalid environment variable %q", key)
		}
	}
	return nil
}

func commandEnvironment(values map[string]string) []string {
	if len(values) == 0 {
		return nil
	}
	environment := os.Environ()
	for key, value := range values {
		environment = append(environment, key+"="+value)
	}
	return environment
}

type limitedCommandBuffer struct {
	buffer bytes.Buffer
	max    int
}

func (b *limitedCommandBuffer) Write(value []byte) (int, error) {
	originalLength := len(value)
	remaining := b.max - b.buffer.Len()
	if remaining > 0 {
		_, _ = b.buffer.Write(value[:min(len(value), remaining)])
	}
	return originalLength, nil
}

func (b *limitedCommandBuffer) String() string {
	return b.buffer.String()
}
