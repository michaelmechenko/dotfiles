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
