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

	"mm-sidebar/internal/projectcatalog"
	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
	wtapi "mm-sidebar/internal/worktrunk"
)

func TestRepositoryHeadingIsInertAndOnlyForgettableWhenNotLive(t *testing.T) {
	offline := repositoryHeading(Ctx{Theme: theme.Theme{}}, projectcatalog.Entry{Root: "/repo", CommonDir: "/repo/.git"})
	if offline.Kind != ActionNone || !offline.GroupHeading || len(offline.Lines) != 2 || len(offline.Actions) != 2 || !offline.Actions[1].Destructive {
		t.Fatalf("offline heading = %#v", offline)
	}
	live := repositoryHeading(Ctx{Theme: theme.Theme{}}, projectcatalog.Entry{Root: "/repo", CommonDir: "/repo/.git", Live: true})
	if len(live.Actions) != 1 || live.Actions[0].ID != "pin" {
		t.Fatalf("live heading exposes forget: %#v", live.Actions)
	}
}

func TestProjectsFetchKeyDependsOnlyOnContentPaneCwds(t *testing.T) {
	p := Projects{}
	one := tmuxio.NewWorld(tmuxio.Snapshot{}, []tmuxio.Session{{ID: "$1", Activity: false}}, []tmuxio.PaneRow{{PaneID: "%1", CurrentPath: "/b"}, {PaneID: "%2", CurrentPath: "/a"}, {PaneID: "%sidebar-a", CurrentPath: "/sidebar-a", Sidebar: true}, {PaneID: "%sidebar-b", CurrentPath: "/sidebar-b", Sidebar: true}})
	two := tmuxio.NewWorld(tmuxio.Snapshot{}, []tmuxio.Session{{ID: "$1", Activity: true}}, []tmuxio.PaneRow{{PaneID: "%2", CurrentPath: "/a", Bell: true}, {PaneID: "%1", CurrentPath: "/b"}, {PaneID: "%sidebar-c", CurrentPath: "/another-sidebar", Sidebar: true}})
	if got, want := p.FetchKey(Ctx{World: one}), p.FetchKey(Ctx{World: two}); got != want || got != "/a\x1f/b" {
		t.Fatalf("project keys = %q / %q", got, want)
	}
}

func TestProjectsFetchKeyCanonicalizesEquivalentPanePaths(t *testing.T) {
	world := tmuxio.NewWorld(tmuxio.Snapshot{}, nil, []tmuxio.PaneRow{
		{PaneID: "%1", CurrentPath: "/repo/feature/.."},
		{PaneID: "%2", CurrentPath: "/repo"},
	})
	if got := (Projects{}).FetchKey(Ctx{World: world}); got != "/repo" {
		t.Fatalf("canonical project fetch key = %q, want /repo", got)
	}
}

func TestProjectsExcludeEverySidebarFromObserveAndLiveWorktreeMatching(t *testing.T) {
	catalog := projectCatalogWithIdentities(t, map[string]projectcatalog.Identity{
		"/repo":           {Root: "/repo", CommonDir: "/repo/.git"},
		"/sidebar-a/repo": {Root: "/sidebar-a/repo", CommonDir: "/sidebar-a/repo/.git"},
		"/sidebar-b/repo": {Root: "/sidebar-b/repo", CommonDir: "/sidebar-b/repo/.git"},
	})
	world := tmuxio.NewWorld(tmuxio.Snapshot{}, nil, []tmuxio.PaneRow{
		{PaneID: "%content", CurrentPath: "/repo"},
		{PaneID: "%sidebar-a", CurrentPath: "/sidebar-a/repo", Sidebar: true},
		{PaneID: "%sidebar-b", CurrentPath: "/sidebar-b/repo", Sidebar: true},
	})
	rows, err := (Projects{Catalog: catalog, Worktrunk: wtapi.Client{Run: func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("unavailable")
	}}}).Fetch(Ctx{Theme: theme.Theme{}, World: world})
	if err != nil || len(rows) != 1 || rows[0].ID != "repo:/repo/.git" {
		t.Fatalf("sidebar cwd entered catalog: rows=%#v err=%v", rows, err)
	}
	if _, count := panesForWorktree(world, "/sidebar-a/repo"); count != 0 {
		t.Fatalf("sidebar pane was treated as a live worktree: %d", count)
	}
}

func TestCatalogInventoryNormalizesAndSortsWorktreesBeforeBranches(t *testing.T) {
	main, feature := "main", "feat/x"
	ahead, behind, conflict := 2, 1, true
	state := "diverged"
	payload, err := json.Marshal(wtapi.List{Schema: 2, Items: []wtapi.Item{
		{Branch: &feature, DefaultBranch: &wtapi.DefaultBranch{Ahead: &ahead, Behind: &behind, MergeConflicts: &conflict}, Display: wtapi.Display{State: &state}},
		{Branch: &main, Worktree: &wtapi.Worktree{Path: "/repo", Main: true, Changes: &wtapi.Changes{Modified: true}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	catalog := testProjectCatalog(t)
	repos := catalog.Inventory([]projectcatalog.Entry{{Root: "/repo", CommonDir: "/repo/.git", Available: true}}, wtapi.Client{Run: func(context.Context, string, ...string) ([]byte, error) { return payload, nil }})
	if len(repos) != 1 || len(repos[0].Worktrees) != 2 || repos[0].Worktrees[0].Path != "/repo" || !repos[0].Worktrees[1].BranchOnly {
		t.Fatalf("inventory = %#v", repos)
	}
	status := statusFromWorktrunk(*repos[0].Worktrees[1].WorktrunkItem)
	if status.Ahead == nil || *status.Ahead != 2 || !status.WouldConflict {
		t.Fatalf("branch status = %#v", status)
	}
}

func TestProjectActionsAreOrderedAndUseCanonicalPaths(t *testing.T) {
	world := tmuxio.NewWorld(tmuxio.Snapshot{PaneID: "%sidebar"}, nil, []tmuxio.PaneRow{{
		PaneID: "%work", SessionID: "$1", WindowID: "@2", WindowIndex: 3, Target: "$1:3.0", CurrentPath: "/repo/feature",
	}})
	row := projectRow(Ctx{Theme: theme.Theme{}, World: world}, worktree{Path: "/repo/feature/../feature", CommonDir: "/repo/.git", Branch: "main"})
	want := []string{"focus", "shell-split", "shell-window", "filetree", "lazygit", "scratch", "pi", "claude", "copy-path", "reveal"}
	if len(row.Actions) != len(want) {
		t.Fatalf("project actions = %#v", row.Actions)
	}
	for i, id := range want {
		if row.Actions[i].ID != id {
			t.Fatalf("action %d = %q, want %q: %#v", i, row.Actions[i].ID, id, row.Actions)
		}
	}
	if row.Path != "/repo/feature" || row.ID != "worktree:/repo/feature" {
		t.Fatalf("project row path was not cleaned: %#v", row)
	}
	for _, index := range []int{1, 2, 4, 6, 7, 8, 9} {
		if got := row.Actions[index].Path; got != "/repo/feature" {
			t.Fatalf("action %q path = %q, want canonical worktree", row.Actions[index].ID, got)
		}
	}
	for _, index := range []int{1, 2, 3, 4, 5, 6, 7} {
		if got := row.Actions[index].CommonDir; got != "/repo/.git" {
			t.Fatalf("action %q common dir = %q, want guarded identity", row.Actions[index].ID, got)
		}
	}
	if row.Actions[0].Pane != (tmuxio.PaneRef{PaneID: "%work", SessionID: "$1", WindowID: "@2", WindowIndex: 3}) {
		t.Fatalf("focus action lost immutable pane ref: %#v", row.Actions[0])
	}
	if got := row.Actions[3]; got.Local != LocalEffectSource || got.SourceID != "filetree" || !got.SourceControl.RootPinned || got.SourceControl.Root != "/repo/feature" {
		t.Fatalf("filetree effect = %#v", got)
	}
	if got := row.Actions[5]; got.Local != LocalEffectEditFile || !strings.HasSuffix(got.Path, "/tmux_scratch/-repo-feature.md") {
		t.Fatalf("scratch effect = %#v", got)
	}
}

func TestProjectActionsOmitFocusWithoutLivePane(t *testing.T) {
	actions := projectActions("/repo/./feature", "/repo/.git", nil)
	if len(actions) != 9 || actions[0].ID != "shell-split" || actions[len(actions)-1].ID != "reveal" {
		t.Fatalf("no-pane project actions = %#v", actions)
	}
	if actions[0].Path != "/repo/feature" {
		t.Fatalf("shell split path = %q, want cleaned worktree", actions[0].Path)
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
	projects := Projects{Catalog: testProjectCatalog(t), Worktrunk: wtapi.Client{Run: func(context.Context, string, ...string) ([]byte, error) {
		calls++
		return nil, errors.New("missing")
	}}}
	world := tmuxio.NewWorld(tmuxio.Snapshot{PaneID: "%sidebar"}, nil, []tmuxio.PaneRow{{PaneID: "%work", CurrentPath: root}})
	rows, err := projects.Fetch(Ctx{Theme: theme.Theme{}, World: world})
	if err != nil || calls != 1 || len(rows) != 2 || !rows[0].GroupHeading || rows[1].Path == "" || rows[1].SearchText == "" {
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
	projects := Projects{Catalog: testProjectCatalog(t), Worktrunk: wtapi.Client{Run: func(context.Context, string, ...string) ([]byte, error) {
		calls++
		return payload, nil
	}}}
	world := tmuxio.NewWorld(tmuxio.Snapshot{PaneID: "%sidebar"}, nil, []tmuxio.PaneRow{{PaneID: "%work", CurrentPath: root}})
	keyBefore := projects.FetchKey(Ctx{World: world})
	rows, err := projects.Fetch(Ctx{Theme: theme.Theme{}, World: world})
	keyAfter := projects.FetchKey(Ctx{World: world})
	if err != nil || calls != 1 || len(rows) != 2 || !rows[0].GroupHeading || keyBefore != keyAfter {
		t.Fatalf("rows=%#v calls=%d keys=%q/%q err=%v", rows, calls, keyBefore, keyAfter, err)
	}
}

func testProjectCatalog(t *testing.T) *projectcatalog.Catalog {
	t.Helper()
	return projectcatalog.New(projectcatalog.Config{Path: filepath.Join(t.TempDir(), "projects.json")})
}

func projectCatalogWithIdentities(t *testing.T, identities map[string]projectcatalog.Identity) *projectcatalog.Catalog {
	t.Helper()
	return projectcatalog.New(projectcatalog.Config{
		Path: filepath.Join(t.TempDir(), "projects.json"),
		Resolve: func(path string) (projectcatalog.Identity, error) {
			identity, ok := identities[path]
			if !ok {
				return projectcatalog.Identity{}, errors.New("not a repository")
			}
			return identity, nil
		},
	})
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
		[]tmuxio.PaneRow{{PaneID: "%sidebar", CurrentPath: "/repo", Sidebar: true}, {PaneID: "%work", Target: "$1:2.0", CurrentPath: "/repo/feature"}},
	)
	row := projectRow(Ctx{Theme: theme.Theme{}, World: world}, worktree{Path: "/repo", Branch: "main", CommonDir: "/repo/.git"})
	if row.Kind != ActionFocusPane || row.PaneID != "%work" || row.CommonDir != "/repo/.git" || len(row.Actions) < 2 || row.Actions[0].ID != "focus" || row.Actions[1].CommonDir != "/repo/.git" {
		t.Fatalf("project row did not reuse live pane: %#v", row)
	}
	if !strings.Contains(row.SearchText, "main") {
		t.Fatalf("project row lost branch search text: %#v", row)
	}
}
