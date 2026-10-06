// Package gitstatus owns bounded, read-only Git snapshots for one worktree.
// It never discovers repositories recursively and callers cache its result per
// browse root. Porcelain is parsed as NUL records so hostile filenames remain
// data, never delimiters or terminal control sequences.
package gitstatus

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const (
	DefaultTimeout  = 1500 * time.Millisecond
	DefaultMaxBytes = 1 << 20
)

var (
	ErrOutputTooLarge = errors.New("git status output exceeds sidebar limit")
	// ErrNotRepository is an ordinary filetree state, not a stale Git failure.
	ErrNotRepository = errors.New("not a git repository")
)

// Kind is the deterministic presentation priority for one path or directory.
type Kind uint8

const (
	Clean Kind = iota
	Ignored
	Untracked
	Added
	Changed
	Deleted
	Conflict
)

func (k Kind) Badge() string {
	switch k {
	case Conflict:
		return "conflict"
	case Deleted:
		return "deleted"
	case Changed:
		return "changed"
	case Added:
		return "added"
	case Untracked:
		return "untracked"
	case Ignored:
		return "ignored"
	default:
		return "clean"
	}
}

// Status preserves Git's staged/unstaged columns alongside the aggregate kind.
type Status struct {
	Kind     Kind
	Staged   byte // porcelain X; space means none
	Unstaged byte // porcelain Y; space means none
	Original string
}

func (s Status) StagedText() string {
	if s.Staged == ' ' || s.Staged == 0 || s.Kind == Untracked || s.Kind == Ignored {
		return "staged: clean"
	}
	return "staged: " + string(s.Staged)
}

func (s Status) UnstagedText() string {
	switch s.Kind {
	case Untracked:
		return "unstaged: untracked"
	case Ignored:
		return "unstaged: ignored"
	}
	if s.Unstaged == ' ' || s.Unstaged == 0 {
		return "unstaged: clean"
	}
	return "unstaged: " + string(s.Unstaged)
}

// Snapshot covers exactly one Git worktree. Paths are absolute clean paths and
// include both sides of a rename/copy so directory aggregation remains correct
// even when the origin no longer exists in the filesystem.
type Snapshot struct {
	Worktree  string
	GitDir    string
	CommonDir string
	Branch    string // short symbolic branch, or "detached" for detached HEAD
	Paths     map[string]Status
}

// WatchPaths names bounded metadata locations whose changes can invalidate a
// snapshot. Directories are watched as well as files so atomic replacement is
// observed even when a file watch is removed by the kernel.
func (s Snapshot) WatchPaths() []string {
	candidates := []string{
		s.Worktree,
		filepath.Join(s.Worktree, ".git"),
		s.GitDir,
		s.CommonDir,
		filepath.Join(s.GitDir, "HEAD"),
		filepath.Join(s.GitDir, "index"),
		filepath.Join(s.CommonDir, "HEAD"),
		filepath.Join(s.CommonDir, "index"),
		filepath.Join(s.CommonDir, "packed-refs"),
		filepath.Join(s.CommonDir, "refs"),
		filepath.Join(s.CommonDir, "refs", "heads"),
		filepath.Join(s.CommonDir, "refs", "tags"),
		filepath.Join(s.CommonDir, "refs", "remotes"),
	}
	seen := make(map[string]struct{}, len(candidates))
	out := make([]string, 0, len(candidates))
	for _, path := range candidates {
		if path == "" {
			continue
		}
		path = filepath.Clean(path)
		if _, ok := seen[path]; ok {
			continue
		}
		// fsnotify cannot add a currently absent leaf. Its parent is also in the
		// list above, so an atomic replacement still reaches the model.
		if _, err := os.Lstat(path); err != nil {
			continue
		}
		seen[path] = struct{}{}
		out = append(out, path)
	}
	return out
}

// Runner is injectable for deterministic fixtures. It must be read-only.
type Runner func(context.Context, string, ...string) ([]byte, error)

type Collector struct {
	Timeout  time.Duration
	MaxBytes int64
	Run      Runner
}

func New() Collector {
	// Run is intentionally nil here: Snapshot closes over the configured byte
	// limit when it installs the default bounded runner.
	return Collector{Timeout: DefaultTimeout, MaxBytes: DefaultMaxBytes}
}

// Snapshot resolves worktree and linked-worktree metadata, then reads one
// porcelain -z snapshot. Every command is bounded by the same caller context;
// no command is ever issued per displayed row.
func (c Collector) Snapshot(ctx context.Context, dir string) (Snapshot, error) {
	if c.Timeout <= 0 {
		c.Timeout = DefaultTimeout
	}
	if c.MaxBytes <= 0 {
		c.MaxBytes = DefaultMaxBytes
	}
	if c.Run == nil {
		max := c.MaxBytes
		c.Run = func(ctx context.Context, dir string, args ...string) ([]byte, error) {
			return runBounded(ctx, max, dir, args...)
		}
	}
	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()
	root, err := c.path(ctx, dir, "--show-toplevel")
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 128 {
			return Snapshot{}, ErrNotRepository
		}
		return Snapshot{}, err
	}
	gitDir, err := c.path(ctx, root, "--git-dir")
	if err != nil {
		return Snapshot{}, err
	}
	common, err := c.path(ctx, root, "--git-common-dir")
	if err != nil {
		return Snapshot{}, err
	}
	out, err := c.Run(ctx, root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching")
	if err != nil {
		return Snapshot{}, err
	}
	if int64(len(out)) > c.MaxBytes {
		return Snapshot{}, ErrOutputTooLarge
	}
	branchOut, err := c.Run(ctx, root, "symbolic-ref", "--quiet", "--short", "HEAD")
	branch := "detached"
	if err != nil {
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != 1 || ctx.Err() != nil {
			return Snapshot{}, err
		}
	} else {
		if int64(len(branchOut)) > c.MaxBytes {
			return Snapshot{}, ErrOutputTooLarge
		}
		if len(branchOut) < 2 || branchOut[len(branchOut)-1] != '\n' {
			return Snapshot{}, fmt.Errorf("git symbolic-ref returned incomplete branch")
		}
		branch = strings.TrimSuffix(string(branchOut), "\n")
	}
	return Snapshot{Worktree: root, GitDir: gitDir, CommonDir: common, Branch: branch, Paths: ParsePorcelain(root, out)}, nil
}

func (c Collector) path(ctx context.Context, dir, flag string) (string, error) {
	out, err := c.Run(ctx, dir, "rev-parse", "--path-format=absolute", flag)
	if err != nil {
		return "", err
	}
	if !strings.HasSuffix(string(out), "\n") {
		return "", fmt.Errorf("git %s returned incomplete path", flag)
	}
	path := strings.TrimSuffix(string(out), "\n")
	if path == "" {
		return "", fmt.Errorf("git %s returned an empty path", flag)
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
		return filepath.Clean(resolved), nil
	}
	return filepath.Clean(absolute), nil
}

// ParsePorcelain parses porcelain v1 -z. Rename/copy records have a second
// NUL-delimited origin path; both names are retained at the same changed rank.
func ParsePorcelain(root string, data []byte) map[string]Status {
	paths := make(map[string]Status)
	records := strings.Split(string(data), "\x00")
	for i := 0; i < len(records); i++ {
		record := records[i]
		if len(record) < 3 || record[2] != ' ' {
			continue
		}
		x, y := record[0], record[1]
		path := record[3:]
		status := Status{Kind: classify(x, y), Staged: x, Unstaged: y}
		if x == '?' && y == '?' {
			status = Status{Kind: Untracked}
		} else if x == '!' && y == '!' {
			status = Status{Kind: Ignored}
		}
		if (x == 'R' || x == 'C' || y == 'R' || y == 'C') && i+1 < len(records) {
			origin := records[i+1]
			i++
			status.Original = absolute(root, origin)
			paths[status.Original] = merge(paths[status.Original], status)
		}
		paths[absolute(root, path)] = merge(paths[absolute(root, path)], status)
	}
	return paths
}

func absolute(root, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Clean(filepath.Join(root, path))
}

func merge(old, next Status) Status {
	if next.Kind >= old.Kind {
		return next
	}
	return old
}

func classify(x, y byte) Kind {
	if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
		return Conflict
	}
	if x == 'D' || y == 'D' {
		return Deleted
	}
	if x == 'M' || y == 'M' || x == 'R' || y == 'R' || x == 'T' || y == 'T' || x == 'C' || y == 'C' {
		return Changed
	}
	if x == 'A' || y == 'A' {
		return Added
	}
	return Clean
}

func runBounded(ctx context.Context, maxBytes int64, dir string, args ...string) ([]byte, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	// status must never take optional index locks: besides avoiding contention,
	// lock acquisition can rewrite index metadata and feed the filetree watcher.
	cmd.Env = append(os.Environ(), "GIT_OPTIONAL_LOCKS=0")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	kill := func() {
		if cmd.Process == nil {
			return
		}
		if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil {
			_ = cmd.Process.Kill()
		}
	}
	stop := context.AfterFunc(ctx, kill)
	defer stop()
	out, readErr := io.ReadAll(io.LimitReader(stdout, maxBytes+1))
	overflow := int64(len(out)) > maxBytes
	if overflow {
		kill()
	}
	waitErr := cmd.Wait()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if overflow {
		return nil, ErrOutputTooLarge
	}
	if readErr != nil {
		return nil, readErr
	}
	return out, waitErr
}
