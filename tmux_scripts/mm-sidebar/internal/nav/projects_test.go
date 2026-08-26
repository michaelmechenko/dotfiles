package nav

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
	wtapi "mm-sidebar/internal/worktrunk"
)

func TestParseWorktreesPreservesGitOrderBranchesAndVerbatimPaths(t *testing.T) {
	rows := parseWorktreesZ([]byte("worktree /repo with\nnewline\x00HEAD abc\x00branch refs/heads/main\x00\x00worktree /repo-feature\x00HEAD def\x00detached\x00\x00"))
	if len(rows) != 2 {
		t.Fatalf("worktrees = %#v", rows)
	}
	if rows[0] != (worktree{Path: "/repo with\nnewline", Branch: "main"}) || rows[1] != (worktree{Path: "/repo-feature", Branch: "(detached)"}) {
		t.Fatalf("parsed worktrees = %#v", rows)
	}
}

func TestProjectsFetchKeyDependsOnlyOnPaneCwds(t *testing.T) {
	p := Projects{}
	one := tmuxio.NewWorld(tmuxio.Snapshot{}, []tmuxio.Session{{ID: "$1", Activity: false}}, []tmuxio.PaneRow{{PaneID: "%1", CurrentPath: "/b"}, {PaneID: "%2", CurrentPath: "/a"}})
	two := tmuxio.NewWorld(tmuxio.Snapshot{}, []tmuxio.Session{{ID: "$1", Activity: true}}, []tmuxio.PaneRow{{PaneID: "%2", CurrentPath: "/a", Bell: true}, {PaneID: "%1", CurrentPath: "/b"}})
	if got, want := p.FetchKey(Ctx{World: one}), p.FetchKey(Ctx{World: two}); got != want || got != "/a\x1f/b" {
		t.Fatalf("project keys = %q / %q", got, want)
	}
}

func TestWorktrunkRowsNormalizeAndSortWorktreesBeforeBranches(t *testing.T) {
	main, feature := "main", "feat/x"
	ahead, behind, conflict := 2, 1, true
	state := "diverged"
	list := wtapi.List{Schema: 2, Items: []wtapi.Item{
		{Branch: &feature, DefaultBranch: &wtapi.DefaultBranch{Ahead: &ahead, Behind: &behind, MergeConflicts: &conflict}, Display: wtapi.Display{State: &state}},
		{Branch: &main, Worktree: &wtapi.Worktree{Path: "/repo", Main: true, Changes: &wtapi.Changes{Modified: true}}},
	}}
	rows := worktrunkRows(repository{Root: "/repo", CommonDir: "/repo/.git"}, list)
	sortWorktrees(rows)
	if len(rows) != 2 || rows[0].Path != "/repo" || !rows[1].BranchOnly {
		t.Fatalf("rows = %#v", rows)
	}
	if rows[1].Status.Ahead == nil || *rows[1].Status.Ahead != 2 || !rows[1].Status.WouldConflict {
		t.Fatalf("branch status = %#v", rows[1].Status)
	}
}

func TestBranchOnlyRowExposesMaterializeActionAndStatus(t *testing.T) {
	ahead, behind := 3, 1
	row := projectRow(Ctx{Theme: theme.Theme{}}, worktree{
		Branch: "feat/x", RepoRoot: "/repo", CommonDir: "/repo/.git", BranchOnly: true,
		Status: projectStatus{Modified: true, Ahead: &ahead, Behind: &behind},
	})
	if row.Kind != ActionNone || len(row.Actions) != 1 || row.Actions[0].Kind != ContextMaterializeBranch {
		t.Fatalf("branch action = %#v", row)
	}
	if row.Actions[0].RepoRoot != "/repo" || row.Actions[0].Branch != "feat/x" {
		t.Fatalf("materialize target = %#v", row.Actions[0])
	}
	for _, want := range []string{"branch", "!", "↑3", "↓1"} {
		if !strings.Contains(row.SearchText, want) {
			t.Fatalf("search text %q missing %q", row.SearchText, want)
		}
	}
}

func TestProjectsFallsBackToGitWhenWorktrunkFails(t *testing.T) {
	root := initProjectRepo(t)
	calls := 0
	projects := Projects{Worktrunk: wtapi.Client{Run: func(context.Context, string, ...string) ([]byte, error) {
		calls++
		return nil, errors.New("missing")
	}}}
	world := tmuxio.NewWorld(tmuxio.Snapshot{PaneID: "%sidebar"}, nil, []tmuxio.PaneRow{{PaneID: "%work", CurrentPath: root}})
	rows, err := projects.Fetch(Ctx{Theme: theme.Theme{}, World: world})
	if err != nil || calls != 1 || len(rows) != 1 || rows[0].Path == "" || rows[0].SearchText == "" {
		t.Fatalf("fallback rows=%#v calls=%d err=%v", rows, calls, err)
	}
}

func TestProjectsUsesSchemaTwoWithoutChangingFetchKey(t *testing.T) {
	root := initProjectRepo(t)
	branch := "main"
	payload, err := json.Marshal(wtapi.List{Schema: 2, Items: []wtapi.Item{{Branch: &branch, Worktree: &wtapi.Worktree{Path: root, Main: true}}}})
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	projects := Projects{Worktrunk: wtapi.Client{Run: func(context.Context, string, ...string) ([]byte, error) {
		calls++
		return payload, nil
	}}}
	world := tmuxio.NewWorld(tmuxio.Snapshot{PaneID: "%sidebar"}, nil, []tmuxio.PaneRow{{PaneID: "%work", CurrentPath: root}})
	keyBefore := projects.FetchKey(Ctx{World: world})
	rows, err := projects.Fetch(Ctx{Theme: theme.Theme{}, World: world})
	keyAfter := projects.FetchKey(Ctx{World: world})
	if err != nil || calls != 1 || len(rows) != 1 || keyBefore != keyAfter {
		t.Fatalf("rows=%#v calls=%d keys=%q/%q err=%v", rows, calls, keyBefore, keyAfter, err)
	}
}

func initProjectRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	commands := [][]string{
		{"init", "-b", "main"},
		{"config", "user.email", "test@example.com"},
		{"config", "user.name", "Test"},
	}
	for _, args := range commands {
		if out, err := exec.Command("git", append([]string{"-C", root}, args...)...).CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v: %s", args, err, out)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "README"), []byte("test\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "-C", root, "add", "README").CombinedOutput(); err != nil {
		t.Fatalf("git add: %v: %s", err, out)
	}
	if out, err := exec.Command("git", "-C", root, "commit", "-m", "initial").CombinedOutput(); err != nil {
		t.Fatalf("git commit: %v: %s", err, out)
	}
	return filepath.Clean(root)
}

func TestProjectRowReusesLiveWorktreePane(t *testing.T) {
	world := tmuxio.NewWorld(
		tmuxio.Snapshot{PaneID: "%sidebar"}, nil,
		[]tmuxio.PaneRow{{PaneID: "%sidebar", CurrentPath: "/repo"}, {PaneID: "%work", Target: "$1:2.0", CurrentPath: "/repo/feature"}},
	)
	row := projectRow(Ctx{Theme: theme.Theme{}, World: world}, worktree{Path: "/repo", Branch: "main"})
	if row.Kind != ActionFocusPane || row.PaneID != "%work" || len(row.Actions) == 0 || row.Actions[0].ID != "focus" {
		t.Fatalf("project row did not reuse live pane: %#v", row)
	}
	if !strings.Contains(row.SearchText, "main") {
		t.Fatalf("project row lost branch search text: %#v", row)
	}
}
