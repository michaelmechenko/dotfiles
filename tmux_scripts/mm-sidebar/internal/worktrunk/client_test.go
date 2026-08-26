package worktrunk

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestParseListSchemaTwoPreservesIndependentFactsAndHostilePath(t *testing.T) {
	input := `{"schema":2,"repo":{"default_branch":"main"},"items":[{"branch":"feat/x","head":{"short_sha":"abc1234","subject":"subject"},"worktree":{"path":"/tmp/a\nquote\"","main":false,"current":false,"detached":false,"branch_mismatch":false,"duplicate_branch":false,"locked":{"reason":"keep"},"changes":{"staged":true,"modified":false,"untracked":true,"renamed":false,"deleted":false,"conflicted":false}},"default_branch":{"ahead":2,"behind":1,"orphan":false,"merge_conflicts":true},"display":{"state":"diverged","symbols":"+?↕"}}]}`
	list, err := ParseList([]byte(input))
	if err != nil {
		t.Fatal(err)
	}
	item := list.Items[0]
	if item.Worktree == nil || item.Worktree.Path != "/tmp/a\nquote\"" || item.Worktree.Locked == nil {
		t.Fatalf("worktree facts lost: %#v", item.Worktree)
	}
	if item.DefaultBranch == nil || item.DefaultBranch.Ahead == nil || *item.DefaultBranch.Ahead != 2 || item.DefaultBranch.MergeConflicts == nil || !*item.DefaultBranch.MergeConflicts {
		t.Fatalf("default branch facts lost: %#v", item.DefaultBranch)
	}
}

func TestParseListRejectsMalformedAndUnsupportedSchemas(t *testing.T) {
	if _, err := ParseList([]byte(`{"schema":1,"items":[]}`)); !errors.Is(err, ErrUnsupportedSchema) {
		t.Fatalf("schema error = %v", err)
	}
	if _, err := ParseList([]byte(`{`)); err == nil || !strings.Contains(err.Error(), "parse worktrunk list") {
		t.Fatalf("malformed error = %v", err)
	}
}

func TestListUsesBoundedSchemaTwoLocalInvocation(t *testing.T) {
	var gotBinary string
	var gotArgs []string
	client := Client{
		Binary:  "fake-wt",
		Timeout: 1500 * time.Millisecond,
		Run: func(_ context.Context, binary string, args ...string) ([]byte, error) {
			gotBinary, gotArgs = binary, append([]string(nil), args...)
			return []byte(`{"schema":2,"repo":{},"items":[]}`), nil
		},
	}
	if _, err := client.List("/repo with spaces"); err != nil {
		t.Fatal(err)
	}
	want := []string{"-C", "/repo with spaces", "--config-set", "list.json-schema=2", "--config-set", "list.timeout-ms=1500", "list", "--branches", "--format=json"}
	if gotBinary != "fake-wt" || !reflect.DeepEqual(gotArgs, want) {
		t.Fatalf("invocation = %q %#v, want %q %#v", gotBinary, gotArgs, "fake-wt", want)
	}
}

func TestCommandFailureSurfacesFirstStderrLine(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "fake-wt")
	if err := os.WriteFile(binary, []byte("#!/bin/sh\nprintf 'approval required\\nextra detail\\n' >&2\nexit 1\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	_, err := (Client{Binary: binary}).Switch("/repo", "feat/x")
	if err == nil || err.Error() != "worktrunk switch: approval required" {
		t.Fatalf("error = %v", err)
	}
}

func TestSwitchUsesExistingBranchWithoutApprovalBypass(t *testing.T) {
	var gotArgs []string
	client := Client{Run: func(_ context.Context, _ string, args ...string) ([]byte, error) {
		gotArgs = append([]string(nil), args...)
		return []byte(`{"action":"created_worktree","branch":"feat/x","path":"/tmp/repo/feat-x"}`), nil
	}}
	result, err := client.Switch("/repo", "feat/x")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"-C", "/repo", "--config-set", "list.json-schema=2", "switch", "feat/x", "--no-cd", "--format=json"}
	if !reflect.DeepEqual(gotArgs, want) || result.Path != "/tmp/repo/feat-x" {
		t.Fatalf("switch = %#v args=%#v", result, gotArgs)
	}
	for _, arg := range gotArgs {
		if arg == "--yes" || arg == "--no-hooks" || arg == "--create" {
			t.Fatalf("unsafe or out-of-scope flag: %q", arg)
		}
	}
}
