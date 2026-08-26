package nav

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mm-sidebar/internal/projectcatalog"
	"mm-sidebar/internal/tmuxio"
	wtapi "mm-sidebar/internal/worktrunk"
)

func TestCatalogContextActionsRequestGenericRefresh(t *testing.T) {
	catalog := catalogForActions(t, map[string]projectcatalog.Identity{
		"/repo": {Root: "/repo", CommonDir: "/repo/.git"},
	})
	entries, err := catalog.Observe([]string{"/repo"})
	if err != nil || len(entries) != 1 {
		t.Fatalf("seed catalog = %#v, %v", entries, err)
	}
	queries := 0
	executor := ContextExecutor{Catalog: catalog, ListPanes: func() ([]tmuxio.PaneRow, error) {
		queries++
		return nil, nil
	}}

	result, err := executor.Execute(nil, ContextAction{Kind: ContextPinRepository, CommonDir: "/repo/.git"}, tmuxContent())
	if err != nil || !result.Refresh {
		t.Fatalf("pin result = %#v, %v", result, err)
	}
	result, err = executor.Execute(nil, ContextAction{Kind: ContextForgetRepository, CommonDir: "/repo/.git"}, tmuxContent())
	if err != nil || !result.Refresh || queries != 1 {
		t.Fatalf("forget result = %#v, %v; queries=%d", result, err, queries)
	}
}

func TestForgetRechecksLiveNonSidebarPanes(t *testing.T) {
	catalog := catalogForActions(t, map[string]projectcatalog.Identity{
		"/repo":       {Root: "/repo", CommonDir: "/repo/.git"},
		"/repo/child": {Root: "/repo", CommonDir: "/repo/.git"},
	})
	if _, err := catalog.Observe([]string{"/repo"}); err != nil {
		t.Fatal(err)
	}
	panes := []tmuxio.PaneRow{
		{PaneID: "%sidebar-a", CurrentPath: "/repo", Sidebar: true},
		{PaneID: "%sidebar-b", CurrentPath: "/repo", Sidebar: true},
		{PaneID: "%content", CurrentPath: "/repo/child"},
	}
	executor := ContextExecutor{Catalog: catalog, ListPanes: func() ([]tmuxio.PaneRow, error) { return panes, nil }}
	_, err := executor.Execute(nil, ContextAction{Kind: ContextForgetRepository, CommonDir: "/repo/.git"}, tmuxContent())
	if err == nil || err.Error() != "project is live; cannot forget" {
		t.Fatalf("forget live project error = %v", err)
	}
	panes = panes[:2]
	result, err := executor.Execute(nil, ContextAction{Kind: ContextForgetRepository, CommonDir: "/repo/.git"}, tmuxContent())
	if err != nil || !result.Refresh {
		t.Fatalf("forget sidebar-only project = %#v, %v", result, err)
	}
}

func TestProjectWorktreeOpenRejectsChangedCommonDir(t *testing.T) {
	catalog := catalogForActions(t, map[string]projectcatalog.Identity{
		"/repo/worktree": {Root: "/repo/worktree", CommonDir: "/replacement/.git"},
	})
	executor := ContextExecutor{Catalog: catalog}
	_, err := executor.Execute(nil, ContextAction{
		Kind: ContextOpenDir, Path: "/repo/worktree", CommonDir: "/repo/.git",
	}, tmuxContent())
	if err == nil || err.Error() != "repository changed; worktree not opened" {
		t.Fatalf("context worktree error = %v", err)
	}
}

func TestProjectToolsRejectChangedCommonDirBeforeTmux(t *testing.T) {
	catalog := catalogForActions(t, map[string]projectcatalog.Identity{
		"/repo/worktree": {Root: "/repo/worktree", CommonDir: "/replacement/.git"},
	})
	executor := ContextExecutor{Catalog: catalog}
	for _, kind := range []ContextActionKind{ContextNewWindow, ContextOpenLazygit, ContextOpenPi, ContextOpenClaude} {
		_, err := executor.Execute(nil, ContextAction{Kind: kind, Path: "/repo/worktree", CommonDir: "/repo/.git"}, tmuxContent())
		if err == nil || !strings.HasPrefix(err.Error(), "repository changed;") {
			t.Fatalf("kind %d changed common dir error = %v", kind, err)
		}
	}
}

func TestLocalProjectEffectRejectsChangedCommonDir(t *testing.T) {
	root := initProjectRepo(t)
	action := ContextAction{Local: LocalEffectSource, RepoRoot: root, CommonDir: "/replacement/.git"}
	if err := ValidateProjectAction(action); err == nil || err.Error() != "repository changed; action cancelled" {
		t.Fatalf("local changed common dir error = %v", err)
	}
}

func TestProjectWorktreeEnterRejectsChangedCommonDir(t *testing.T) {
	root := initProjectRepo(t)
	err := Act(nil, Row{Kind: ActionOpenDir, Path: root, CommonDir: "/replacement/.git"}, tmuxContent())
	if err == nil || err.Error() != "repository changed; worktree not opened" {
		t.Fatalf("enter worktree error = %v", err)
	}
}

func TestMaterializeRejectsChangedCommonDirBeforeSwitch(t *testing.T) {
	catalog := catalogForActions(t, map[string]projectcatalog.Identity{
		"/repo": {Root: "/repo", CommonDir: "/replacement/.git"},
	})
	executor := ContextExecutor{Catalog: catalog}
	_, err := executor.Execute(nil, ContextAction{
		Kind: ContextMaterializeBranch, RepoRoot: "/repo", Branch: "feature", CommonDir: "/repo/.git",
	}, tmuxContent())
	if err == nil || err.Error() != "repository changed; worktree not created" {
		t.Fatalf("changed common dir error = %v", err)
	}
}

func TestMaterializeRejectsSwitchedWorktreeWithChangedCommonDir(t *testing.T) {
	catalog := catalogForActions(t, map[string]projectcatalog.Identity{
		"/repo":             {Root: "/repo", CommonDir: "/repo/.git"},
		"/created-worktree": {Root: "/created-worktree", CommonDir: "/replacement/.git"},
	})
	log := filepath.Join(t.TempDir(), "tmux.log")
	fakeTmux := filepath.Join(t.TempDir(), "tmux")
	if err := os.WriteFile(fakeTmux, []byte("#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$MM_SIDEBAR_TEST_TMUX_LOG\"\nprintf '1\\n'\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MM_SIDEBAR_TEST_TMUX_LOG", log)
	t.Setenv("PATH", filepath.Dir(fakeTmux)+":"+os.Getenv("PATH"))

	executor := ContextExecutor{
		Catalog: catalog,
		Worktrunk: wtapi.Client{Run: func(_ context.Context, _ string, _ ...string) ([]byte, error) {
			return []byte(`{"path":"/created-worktree"}`), nil
		}},
	}
	content := tmuxio.PaneRef{PaneID: "%content", SessionID: "$1", WindowIndex: 0}
	_, err := executor.Execute(tmuxio.NewClient("%sidebar", ""), ContextAction{
		Kind: ContextMaterializeBranch, RepoRoot: "/repo", Branch: "feature", CommonDir: "/repo/.git",
	}, content)
	if err == nil || err.Error() != "repository changed; worktree not opened" {
		t.Fatalf("changed switched worktree error = %v", err)
	}
	calls, readErr := os.ReadFile(log)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if strings.Contains(string(calls), "split-window") {
		t.Fatalf("changed worktree was split anyway: %s", calls)
	}
}

func catalogForActions(t *testing.T, identities map[string]projectcatalog.Identity) *projectcatalog.Catalog {
	t.Helper()
	return projectcatalog.New(projectcatalog.Config{
		Path: filepath.Join(t.TempDir(), "projects.json"),
		Now:  func() time.Time { return time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC) },
		Resolve: func(path string) (projectcatalog.Identity, error) {
			identity, ok := identities[path]
			if !ok {
				return projectcatalog.Identity{}, errors.New("missing")
			}
			return identity, nil
		},
	})
}

func tmuxContent() tmuxio.PaneRef { return tmuxio.PaneRef{} }
