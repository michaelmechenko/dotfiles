package gitstatus

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestParsePorcelainFixturesAggregateDeterministically(t *testing.T) {
	root := "/repo"
	fixtures := []struct {
		name string
		data string
		path string
		kind Kind
	}{
		{"clean", "", "clean.txt", Clean},
		{"staged", "A  staged.txt\x00", "staged.txt", Added},
		{"modified", " M modified.txt\x00", "modified.txt", Changed},
		{"deleted", " D gone.txt\x00", "gone.txt", Deleted},
		{"untracked", "?? untracked.txt\x00", "untracked.txt", Untracked},
		{"ignored", "!! ignored.txt\x00", "ignored.txt", Ignored},
		{"conflict", "UU conflict.txt\x00", "conflict.txt", Conflict},
		{"rename destination", "R  new\x00old\x00", "new", Changed},
		{"rename origin", "R  new\x00old\x00", "old", Changed},
	}
	for _, tc := range fixtures {
		t.Run(tc.name, func(t *testing.T) {
			got := ParsePorcelain(root, []byte(tc.data))
			status, ok := got[filepath.Join(root, tc.path)]
			if tc.kind == Clean {
				if ok {
					t.Fatalf("clean path unexpectedly present: %#v", status)
				}
				return
			}
			if !ok || status.Kind != tc.kind {
				t.Fatalf("status=%#v present=%t, want %v", status, ok, tc.kind)
			}
		})
	}
	data := "?? child/new\x00 D child/dead\x00 M child/changed\x00"
	all := ParsePorcelain(root, []byte(data))
	best := Clean
	for path, status := range all {
		if strings.HasPrefix(path, filepath.Join(root, "child")+"/") && status.Kind > best {
			best = status.Kind
		}
	}
	if best != Deleted {
		t.Fatalf("directory aggregate rank=%v, want deleted", best)
	}
}

func TestParsePorcelainPreservesHostileNamesAndRenameOrigin(t *testing.T) {
	root := "/repo"
	name := "hostile\n\t\x1b name"
	got := ParsePorcelain(root, []byte("R  "+name+"\x00old\nname\x00"))
	status, ok := got[filepath.Join(root, name)]
	if !ok || status.Original != filepath.Join(root, "old\nname") {
		t.Fatalf("hostile rename = %#v present=%t", status, ok)
	}
}

func TestRunBoundedDisablesOptionalGitLocks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test helper requires a POSIX shell")
	}
	bin := t.TempDir()
	git := filepath.Join(bin, "git")
	if err := os.WriteFile(git, []byte("#!/bin/sh\nprintf '%s' \"$GIT_OPTIONAL_LOCKS\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("GIT_OPTIONAL_LOCKS", "1")

	out, err := runBounded(context.Background(), 64, t.TempDir(), "status", "--porcelain=v1")
	if err != nil || string(out) != "0" {
		t.Fatalf("GIT_OPTIONAL_LOCKS=%q err=%v, want 0", out, err)
	}
}

func TestCollectorNoRepositoryAndLinkedWorktree(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git unavailable")
	}
	if _, err := New().Snapshot(context.Background(), t.TempDir()); !errors.Is(err, ErrNotRepository) {
		t.Fatalf("no-repository error=%v", err)
	}

	parent := t.TempDir()
	main := filepath.Join(parent, "main")
	gitCommand(t, parent, "init", main)
	gitCommand(t, main, "config", "user.email", "sidebar@example.invalid")
	gitCommand(t, main, "config", "user.name", "sidebar")
	if err := os.WriteFile(filepath.Join(main, "tracked"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	gitCommand(t, main, "add", "tracked")
	gitCommand(t, main, "commit", "-m", "init")
	linked := filepath.Join(parent, "linked")
	gitCommand(t, main, "worktree", "add", "-b", "linked", linked)
	snap, err := New().Snapshot(context.Background(), linked)
	if err != nil || snap.Worktree != linked || snap.GitDir == snap.CommonDir || !strings.Contains(snap.GitDir, "worktrees") {
		t.Fatalf("linked snapshot=%#v err=%v", snap, err)
	}
	if len(snap.WatchPaths()) == 0 {
		t.Fatal("linked worktree supplied no metadata watches")
	}
}

func TestCollectorBoundsOutputAndKeepsLinkedWorktreeMetadata(t *testing.T) {
	root := t.TempDir()
	calls := 0
	run := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		calls++
		switch strings.Join(args, " ") {
		case "rev-parse --path-format=absolute --show-toplevel":
			return []byte(root + "\n"), nil
		case "rev-parse --path-format=absolute --git-dir":
			return []byte(filepath.Join(root, ".git", "worktrees", "feature") + "\n"), nil
		case "rev-parse --path-format=absolute --git-common-dir":
			return []byte(filepath.Join(root, ".git") + "\n"), nil
		default:
			return []byte(strings.Repeat("x", 33)), nil
		}
	}
	_, err := (Collector{Timeout: time.Second, MaxBytes: 32, Run: run}).Snapshot(context.Background(), root)
	if !errors.Is(err, ErrOutputTooLarge) || calls != 4 {
		t.Fatalf("err=%v calls=%d", err, calls)
	}
}

func TestCollectorPropagatesRunnerFailure(t *testing.T) {
	want := errors.New("git failed")
	_, err := (Collector{Run: func(context.Context, string, ...string) ([]byte, error) { return nil, want }}).Snapshot(context.Background(), "/repo")
	if !errors.Is(err, want) {
		t.Fatalf("error=%v, want %v", err, want)
	}
}

func gitCommand(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(args, " "), err, out)
	}
}
