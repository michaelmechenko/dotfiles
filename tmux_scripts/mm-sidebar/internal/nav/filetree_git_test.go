package nav

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mm-sidebar/internal/gitstatus"
	"mm-sidebar/internal/theme"
)

func TestFiletreeAggregatesDirectoryGitStatusAndRetainsStaleSnapshot(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "dir")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	changed := filepath.Join(root, "changed.txt")
	if err := os.WriteFile(changed, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := NewFiletree()
	if _, err := f.Fetch(Ctx{Root: root}); err != nil {
		t.Fatal(err)
	}
	f.state.mu.Lock()
	f.state.git = &gitstatus.Snapshot{Worktree: root, Paths: map[string]gitstatus.Status{
		filepath.Join(dir, "deleted-child"): {Kind: gitstatus.Deleted, Staged: ' ', Unstaged: 'D'},
		changed:                             {Kind: gitstatus.Changed, Staged: 'M', Unstaged: ' '},
	}}
	rows := f.state.rowsLocked(theme.Theme{})
	f.state.mu.Unlock()
	if len(rows) != 2 {
		t.Fatalf("rows=%#v", rows)
	}
	if rows[0].Presentation.Tone != ToneUrgent || rows[0].Presentation.Facts[0].Text != "deleted" {
		t.Fatalf("directory aggregate=%#v", rows[0].Presentation)
	}
	if rows[1].Presentation.Tone != ToneChanged || rows[1].Presentation.Facts[0].Text != "changed" {
		t.Fatalf("changed file=%#v", rows[1].Presentation)
	}
	detail := rows[1].Presentation.Detail.PlainText()
	for _, want := range []string{"git: changed", "staged: M", "unstaged: clean"} {
		if !contains(detail, want) {
			t.Fatalf("detail missing %q: %q", want, detail)
		}
	}

	f.state.mu.Lock()
	f.state.gitErr = errors.New("timeout")
	rows = f.state.rowsLocked(theme.Theme{})
	f.state.mu.Unlock()
	if !contains(rows[1].Presentation.Detail.PlainText(), "git status stale: timeout") || rows[1].Presentation.Facts[len(rows[1].Presentation.Facts)-1].Text != "stale" {
		t.Fatalf("stale cache=%#v", rows[1].Presentation)
	}
}

func TestFiletreeWatchPathsKeepGitMetadataBeforeExpandedDirectories(t *testing.T) {
	root := t.TempDir()
	f := NewFiletree()
	if _, err := f.Fetch(Ctx{Root: root}); err != nil {
		t.Fatal(err)
	}
	f.state.mu.Lock()
	f.state.git = &gitstatus.Snapshot{Worktree: root}
	f.state.gitWatch = []string{filepath.Join(root, ".git", "HEAD"), filepath.Join(root, ".git", "index")}
	for i := 0; i < filetreeWatchLimit; i++ {
		path := filepath.Join(root, "expanded", string(rune('a'+i)))
		f.state.expanded[path] = true
		f.state.nodes[path] = &treeNode{status: treeReady}
	}
	f.state.mu.Unlock()
	paths := f.WatchPaths(Ctx{Root: root})
	if len(paths) < 3 || paths[1] != filepath.Join(root, ".git", "HEAD") || paths[2] != filepath.Join(root, ".git", "index") {
		t.Fatalf("git metadata was not reserved: %#v", paths)
	}
}

func contains(s, want string) bool { return strings.Contains(s, want) }

func TestFiletreeHeaderUsesCachedRepositoryIdentity(t *testing.T) {
	f := NewFiletree()
	root := "/repo/feature"
	f.state.git = &gitstatus.Snapshot{Worktree: root, GitDir: "/repo/.git/worktrees/feature", CommonDir: "/repo/.git", Branch: "topic"}
	// Context must remain usable with no command runner available.
	t.Setenv("PATH", "")
	value := f.Context(Ctx{Root: root, RootPinned: true}, nil)
	if !strings.Contains(value, "/repo/feature · topic · wt:feature · pinned") {
		t.Fatalf("linked header=%q", value)
	}
	f.state.gitErr = errors.New("timeout")
	if value := f.Context(Ctx{Root: root}, nil); !strings.Contains(value, "topic") || !strings.Contains(value, "git stale") {
		t.Fatalf("stale header=%q", value)
	}
	f.state.git.GitDir = f.state.git.CommonDir
	f.state.git.Branch = "detached"
	if value := f.Context(Ctx{Root: root}, nil); strings.Contains(value, "wt:") || !strings.Contains(value, "detached") {
		t.Fatalf("main detached header=%q", value)
	}
	f.state.git = nil
	f.state.gitErr = nil
	if value := f.Context(Ctx{Root: root}, nil); strings.Contains(value, "wt:") || strings.Contains(value, "detached") {
		t.Fatalf("nonrepository header=%q", value)
	}
}

func TestFiletreeSelectedPathsCompactOnlyActualHome(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	for _, tc := range []struct{ path, want string }{
		{home, "~"}, {filepath.Join(home, "dir"), "~/dir"},
		{home + "-other/dir", home + "-other/dir"}, {"/outside/dir", "/outside/dir"},
	} {
		for _, row := range []Row{
			dirRow(theme.Theme{}, tc.path, "", 0, false, false, gitstatus.Status{}, false, nil),
			fileRow(theme.Theme{}, tc.path, "", 0, gitstatus.Status{}, false, nil),
		} {
			if row.Presentation.Detail.Lines[0].Text != tc.want || row.Path != tc.path {
				t.Fatalf("path=%q display=%q action=%q", tc.path, row.Presentation.Detail.Lines[0].Text, row.Path)
			}
		}
	}
}
