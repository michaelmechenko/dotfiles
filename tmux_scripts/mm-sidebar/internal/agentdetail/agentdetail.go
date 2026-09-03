// Package agentdetail collects a small, local-only summary for one selected
// agent. It deliberately reads only bounded JSONL tails: the inspector is an
// on-demand sidebar affordance, not a second transcript viewer.
package agentdetail

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"golang.org/x/sys/unix"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/display"
)

const (
	maxTailBytes = 64 << 10
	maxPlanBytes = 12 << 10
	maxGitBytes  = 64 << 10
	maxTextRunes = 180
	cacheTTL     = 2 * time.Second
	gitTimeout   = 350 * time.Millisecond
)

// Data is the compact inspector payload. Every field is safe to render: text
// from transcripts, plans, Git, and tmux metadata has terminal controls made
// visible before it reaches a block.
type Data struct {
	Prompt   string
	Response string
	Plan     string
	Cwd      string
	Worktree string
	Git      string
}

// Config makes local paths, time, and the Git commands injectable for tests.
// ConfigDir is normally ~/.config; Claude plan references are constrained below
// that directory and must name claude/plans/<safe-name>.md.
type Config struct {
	ConfigDir string
	Now       func() time.Time
	GitStatus func(context.Context, string) ([]byte, error)
	GitRoot   func(context.Context, string) ([]byte, error)
}

type cacheEntry struct {
	at   time.Time
	data Data
	err  error
}

// Collector caches a selected agent's bounded local summary. It is safe for
// Bubble Tea commands to enter concurrently: a selection generation in the
// block, not this cache, decides which result can render.
type Collector struct {
	configDir string
	now       func() time.Time
	gitStatus func(context.Context, string) ([]byte, error)
	gitRoot   func(context.Context, string) ([]byte, error)

	mu    sync.Mutex
	cache map[string]cacheEntry
}

func New(cfg Config) *Collector {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.ConfigDir == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			cfg.ConfigDir = filepath.Join(home, ".config")
		}
	}
	if cfg.GitStatus == nil {
		cfg.GitStatus = runGitStatus
	}
	if cfg.GitRoot == nil {
		cfg.GitRoot = runGitRoot
	}
	return &Collector{
		configDir: cfg.ConfigDir,
		now:       cfg.Now,
		gitStatus: cfg.GitStatus,
		gitRoot:   cfg.GitRoot,
		cache:     make(map[string]cacheEntry),
	}
}

// Collect reads at most maxTailBytes from the agent transcript and maxPlanBytes
// from a Claude plan that the tail explicitly references. Git worktree and
// porcelain-v2 status commands each have a short timeout. Nothing here polls or
// uses the network.
func (c *Collector) Collect(row agents.Row) (Data, error) {
	return c.collect(row, false)
}

// CollectFresh performs the same bounded inspection but intentionally skips the
// short cache. It is used only by an explicit user refresh, never by polling.
func (c *Collector) CollectFresh(row agents.Row) (Data, error) {
	return c.collect(row, true)
}

func (c *Collector) collect(row agents.Row, fresh bool) (Data, error) {
	tail, transcriptKey, transcriptErr := c.transcriptTail(row.Agent, row.Transcript)
	// A live agent can briefly have no transcript while its process/registry is
	// already visible. That is not a reason to discard its cwd, worktree, and
	// Git context; leave prompt/response at their explicit unavailable fallbacks.
	prompt, response, planRef := "", "", ""
	if transcriptErr == nil {
		prompt, response, planRef = latestTranscriptText(row.Agent, tail)
	}
	plan, planKey, err := c.claudePlan(row.Agent, planRef)
	if err != nil {
		return Data{}, err
	}
	key := strings.Join([]string{stableRowKey(row), transcriptKey, planKey, row.Cwd}, "\x1f")
	now := c.now()

	if !fresh {
		c.mu.Lock()
		if hit, ok := c.cache[key]; ok && now.Sub(hit.at) < cacheTTL {
			c.mu.Unlock()
			return hit.data, hit.err
		}
		c.mu.Unlock()
	}

	data := Data{
		Prompt:   clean(prompt),
		Response: clean(response),
		Plan:     clean(plan),
		Cwd:      clean(row.Cwd),
	}
	if data.Cwd == "-" {
		data.Cwd = ""
	}
	if data.Cwd != "" {
		if out, gitErr := c.gitRootWithTimeout(row.Cwd); gitErr == nil {
			data.Worktree = clean(strings.TrimSpace(string(out)))
		}
		if out, gitErr := c.gitStatusWithTimeout(row.Cwd); gitErr == nil {
			data.Git = clean(parseGitStatus(out))
		}
	}
	c.mu.Lock()
	c.cache[key] = cacheEntry{at: now, data: data}
	c.mu.Unlock()
	return data, nil
}

func stableRowKey(row agents.Row) string {
	return strings.Join([]string{row.Agent, row.PaneID, row.SessionID, row.Transcript}, "\x1f")
}

func (c *Collector) transcriptTail(agent, path string) ([]byte, string, error) {
	if path == "" || path == "-" {
		return nil, "-", errors.New("transcript unavailable")
	}
	root := c.transcriptRoot(agent)
	f, info, err := openRegularUnderRoot(root, path)
	if err != nil {
		return nil, "-", errors.New("transcript unavailable")
	}
	defer f.Close()
	start := info.Size() - maxTailBytes
	if start < 0 {
		start = 0
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil, "-", errors.New("transcript unavailable")
	}
	data, err := io.ReadAll(io.LimitReader(f, maxTailBytes))
	if err != nil {
		return nil, "-", errors.New("transcript unavailable")
	}
	if start > 0 {
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			data = data[i+1:]
		} else {
			data = nil // one overlong partial JSON line is not safe to parse
		}
	}
	return data, fmt.Sprintf("%s:%d:%d", path, info.Size(), info.ModTime().UnixNano()), nil
}

func (c *Collector) transcriptRoot(agent string) string {
	switch agent {
	case agents.AgentClaude:
		return filepath.Join(c.configDir, "claude", "projects")
	case agents.AgentPi:
		return filepath.Join(c.configDir, "pi-config", "agent", "sessions")
	default:
		return ""
	}
}

// openRegularUnderRoot opens a path through no-follow directory descriptors.
// It accepts only a regular file beneath root, so a transcript cannot make the
// inspector block on a FIFO/device or escape through a final or parent symlink.
func openRegularUnderRoot(root, path string) (*os.File, os.FileInfo, error) {
	if root == "" || path == "" {
		return nil, nil, errors.New("invalid path")
	}
	root = filepath.Clean(root)
	path = filepath.Clean(path)
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return nil, nil, errors.New("path outside root")
	}
	components := strings.Split(rel, string(filepath.Separator))

	fd, err := unix.Open(root, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, nil, err
	}
	for i, component := range components {
		flags := unix.O_RDONLY | unix.O_NOFOLLOW | unix.O_CLOEXEC
		if i < len(components)-1 {
			flags |= unix.O_DIRECTORY
		} else {
			// A special file can otherwise block during open before we can reject
			// it with fstat. O_NONBLOCK is harmless for the regular files we keep.
			flags |= unix.O_NONBLOCK
		}
		next, openErr := unix.Openat(fd, component, flags, 0)
		_ = unix.Close(fd)
		if openErr != nil {
			return nil, nil, openErr
		}
		fd = next
	}
	file := os.NewFile(uintptr(fd), path)
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		if err == nil {
			err = errors.New("not a regular file")
		}
		return nil, nil, err
	}
	return file, info, nil
}

// Claude plans are discovered only from the already-bounded tail. The reference
// grammar rejects traversal and absolute paths; symlinks and non-regular files
// are rejected too, so a transcript cannot turn this inspector into an arbitrary
// file reader.
var planRefRE = regexp.MustCompile(`(?:^|[^a-zA-Z0-9_-])(claude/plans/[a-z0-9-]+\.md)(?:$|[^a-zA-Z0-9_-])`)

// isPrimaryPlanRef keeps the sidebar aligned with tmux-claude-plan: subagent
// plans use a "-agent-<suffix>.md" filename and must never become the parent
// session's plan preview.
func isPrimaryPlanRef(ref string) bool {
	return !strings.Contains(strings.TrimSuffix(filepath.Base(ref), ".md"), "-agent-")
}

func (c *Collector) claudePlan(agent, ref string) (string, string, error) {
	if agent != agents.AgentClaude || ref == "" || c.configDir == "" {
		return "", "-", nil
	}
	if !planRefRE.MatchString("/"+ref) || !isPrimaryPlanRef(ref) {
		return "", "-", nil
	}
	match := planRefRE.FindStringSubmatch("/" + ref)
	if len(match) != 2 || match[1] != ref {
		return "", "-", nil
	}
	path := filepath.Join(c.configDir, filepath.FromSlash(ref))
	root := filepath.Clean(c.configDir) + string(filepath.Separator)
	if !strings.HasPrefix(filepath.Clean(path), root) {
		return "", "-", nil
	}
	f, info, err := openRegularUnderRoot(c.configDir, path)
	if err != nil {
		return "", "-", nil
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxPlanBytes))
	if err != nil {
		return "", "-", nil
	}
	return firstPlanLine(string(data)), fmt.Sprintf("%s:%d:%d", path, info.Size(), info.ModTime().UnixNano()), nil
}

// latestTranscriptText returns the latest user prompt and assistant response
// from the bounded tail. It accepts only the two transcript schemas we own;
// malformed/partial JSONL records and tool-only content never become text in the
// inspector. Claude plan references are found while scanning assistant records,
// even when the most recent response no longer repeats the path.
func latestTranscriptText(agent string, data []byte) (prompt, response, planRef string) {
	lines := strings.Split(string(data), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		var entry json.RawMessage
		if json.Unmarshal([]byte(lines[i]), &entry) != nil {
			continue
		}
		text, role := transcriptText(agent, entry)
		if role == "" {
			continue
		}
		if role == "assistant" {
			if agent == agents.AgentClaude && planRef == "" {
				refs := planRefRE.FindAllStringSubmatch(text, -1)
				for j := len(refs) - 1; j >= 0; j-- {
					if isPrimaryPlanRef(refs[j][1]) {
						planRef = refs[j][1]
						break
					}
				}
			}
			if response == "" && text != "" {
				response = text
			}
		} else if role == "user" && prompt == "" && text != "" {
			prompt = text
		}
		if prompt != "" && response != "" && (agent != agents.AgentClaude || planRef != "") {
			break
		}
	}
	return prompt, response, planRef
}

// transcriptText understands Claude's {type:"user"|"assistant",message:{…}}
// records and Pi's {type:"message",message:{role:"user"|"assistant",…}}
// records. It never falls back to arbitrary nested text, avoiding tool
// input/output leaks.
func transcriptText(agent string, raw json.RawMessage) (string, string) {
	var entry struct {
		Type    string `json:"type"`
		Message struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"`
		} `json:"message"`
	}
	if json.Unmarshal(raw, &entry) != nil {
		return "", ""
	}
	role := ""
	switch {
	case agent == agents.AgentClaude && (entry.Type == "assistant" || entry.Type == "user"):
		role = entry.Type
	case agent == agents.AgentPi && entry.Type == "message" && (entry.Message.Role == "assistant" || entry.Message.Role == "user"):
		role = entry.Message.Role
	default:
		return "", ""
	}
	return contentText(entry.Message.Content), role
}

func contentText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return text
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) != nil {
		return ""
	}
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if part.Type == "text" && part.Text != "" {
			out = append(out, part.Text)
		}
	}
	return strings.Join(out, " ")
}

func firstPlanLine(plan string) string {
	for _, line := range strings.Split(plan, "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(line, "#"))
		if line != "" {
			return line
		}
	}
	return ""
}

func clean(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > maxTextRunes {
		r := []rune(s)
		s = string(r[:maxTextRunes-1]) + "…"
	}
	return display.Sanitize(s)
}

func (c *Collector) gitStatusWithTimeout(cwd string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()
	return c.gitStatus(ctx, cwd)
}

func (c *Collector) gitRootWithTimeout(cwd string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()
	return c.gitRoot(ctx, cwd)
}

var errGitOutputTooLarge = errors.New("git status output exceeds inspector limit")

func runGitStatus(ctx context.Context, cwd string) ([]byte, error) {
	return runBoundedOutput(ctx, cwd, "git", "status", "--porcelain=v2", "--branch", "--untracked-files=normal")
}

func runGitRoot(ctx context.Context, cwd string) ([]byte, error) {
	return runBoundedOutput(ctx, cwd, "git", "rev-parse", "--show-toplevel")
}

// runBoundedOutput streams at most maxGitBytes of porcelain output. The command
// owns a process group so timeout and overflow kill every inherited pipe holder;
// Wait always reaps the direct child before this function returns.
func runBoundedOutput(ctx context.Context, dir, command string, args ...string) ([]byte, error) {
	cmd := exec.Command(command, args...)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	killGroup := func() {
		if cmd.Process != nil {
			if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil {
				_ = cmd.Process.Kill()
			}
		}
	}
	stopCancel := context.AfterFunc(ctx, killGroup)
	defer stopCancel()

	out, readErr := io.ReadAll(io.LimitReader(stdout, maxGitBytes+1))
	overflow := len(out) > maxGitBytes
	if overflow {
		killGroup()
	}
	waitErr := cmd.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if overflow {
		return nil, errGitOutputTooLarge
	}
	if readErr != nil {
		return nil, readErr
	}
	if waitErr != nil {
		return nil, waitErr
	}
	return out, nil
}

// parseGitStatus produces a terse deterministic status: branch then staged,
// unstaged, untracked, and conflicted entry counts. Porcelain v2 is explicitly
// machine-readable, so branch names with spaces/control text remain data rather
// than shell input.
func parseGitStatus(data []byte) string {
	branch := "detached"
	staged, unstaged, untracked, conflicted := 0, 0, 0, 0
	for _, line := range strings.Split(string(data), "\n") {
		switch {
		case strings.HasPrefix(line, "# branch.head "):
			branch = strings.TrimPrefix(line, "# branch.head ")
		case strings.HasPrefix(line, "1 ") || strings.HasPrefix(line, "2 "):
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			xy := fields[1]
			if len(xy) >= 2 {
				if xy[0] != '.' {
					staged++
				}
				if xy[1] != '.' {
					unstaged++
				}
			}
		case strings.HasPrefix(line, "u "):
			conflicted++
		case strings.HasPrefix(line, "? "):
			untracked++
		}
	}
	parts := []string{branch}
	if staged > 0 {
		parts = append(parts, fmt.Sprintf("+%d", staged))
	}
	if unstaged > 0 {
		parts = append(parts, fmt.Sprintf("~%d", unstaged))
	}
	if untracked > 0 {
		parts = append(parts, fmt.Sprintf("?%d", untracked))
	}
	if conflicted > 0 {
		parts = append(parts, fmt.Sprintf("!%d", conflicted))
	}
	return strings.Join(parts, " ")
}
