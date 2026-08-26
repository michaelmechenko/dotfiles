package nav

import (
	"strings"
	"testing"

	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
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
