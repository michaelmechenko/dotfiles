package blocks

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// gitTimeout bounds an on-demand probe so a stalled repository never holds a
// sidebar command goroutine indefinitely. Git is never called from View/Update.
const gitTimeout = 2 * time.Second

type gitSnapshot struct {
	Root      string
	CommonDir string
	GitDir    string
	Branch    string
	Dirty     bool
	Conflict  bool
	Operation string
}

type gitResultMsg struct {
	Cwd   string
	Token uint64
	Snap  gitSnapshot
	Err   error
}

func (gitResultMsg) IsBlockMsg() {}

type gitRunner func(context.Context, string, ...string) ([]byte, error)

func runGit(ctx context.Context, dir string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	return cmd.Output()
}

// probeGit resolves worktree/common-dir identity before reading one bounded
// porcelain-v2 snapshot. The two commands are intentional: status alone cannot
// distinguish worktrees sharing a common git dir.
func canonicalGitPath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(absolute); err == nil {
		return filepath.Clean(resolved), nil
	}
	return filepath.Clean(absolute), nil
}

func gitPathOutput(out []byte) (string, error) {
	path := string(out)
	if !strings.HasSuffix(path, "\n") {
		return "", errors.New("git identity probe returned incomplete output")
	}
	path = strings.TrimSuffix(path, "\n")
	if path == "" {
		return "", errors.New("git identity probe returned incomplete output")
	}
	return path, nil
}

func probeGit(runner gitRunner, cwd string) (gitSnapshot, error) {
	ctx, cancel := context.WithTimeout(context.Background(), gitTimeout)
	defer cancel()
	// Each rev-parse value is queried independently. rev-parse has no NUL
	// output mode, so a three-value newline stream cannot represent a legal
	// pathname containing a newline. A single value has one terminal newline;
	// trim only that delimiter and preserve all embedded path bytes.
	rootOut, err := runner(ctx, cwd, "rev-parse", "--path-format=absolute", "--show-toplevel")
	if err != nil {
		return gitSnapshot{}, err
	}
	commonOut, err := runner(ctx, cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return gitSnapshot{}, err
	}
	gitDirOut, err := runner(ctx, cwd, "rev-parse", "--path-format=absolute", "--git-dir")
	if err != nil {
		return gitSnapshot{}, err
	}
	rootRaw, err := gitPathOutput(rootOut)
	if err != nil {
		return gitSnapshot{}, err
	}
	common, err := gitPathOutput(commonOut)
	if err != nil {
		return gitSnapshot{}, err
	}
	gitDir, err := gitPathOutput(gitDirOut)
	if err != nil {
		return gitSnapshot{}, err
	}
	root, err := canonicalGitPath(rootRaw)
	if err != nil {
		return gitSnapshot{}, err
	}
	common, err = canonicalGitPath(common)
	if err != nil {
		return gitSnapshot{}, err
	}
	gitDir, err = canonicalGitPath(gitDir)
	if err != nil {
		return gitSnapshot{}, err
	}
	status, err := runner(ctx, root, "status", "--porcelain=v2", "--branch", "-z")
	if err != nil {
		return gitSnapshot{}, err
	}
	s := gitSnapshot{Root: root, CommonDir: common, GitDir: gitDir}
	for _, record := range strings.Split(string(status), "\x00") {
		switch {
		case strings.HasPrefix(record, "# branch.head "):
			s.Branch = strings.TrimPrefix(record, "# branch.head ")
		case strings.HasPrefix(record, "# branch.ab "):
			// branch ahead/behind does not make a worktree dirty.
		case strings.HasPrefix(record, "u "):
			s.Dirty, s.Conflict = true, true
		case strings.HasPrefix(record, "1 "), strings.HasPrefix(record, "2 "), strings.HasPrefix(record, "? "):
			s.Dirty = true
		}
	}
	// Operation sentinels are cheap filesystem checks on the identity already
	// returned by Git; they do not recursively search repositories.
	for _, operation := range []struct{ name, label string }{
		{"MERGE_HEAD", "merge"}, {"rebase-merge", "rebase"}, {"rebase-apply", "rebase"},
		{"CHERRY_PICK_HEAD", "cherry-pick"}, {"BISECT_LOG", "bisect"},
	} {
		if _, err := os.Stat(filepath.Join(s.GitDir, operation.name)); err == nil {
			s.Operation = operation.label
			break
		}
	}
	return s, nil
}
