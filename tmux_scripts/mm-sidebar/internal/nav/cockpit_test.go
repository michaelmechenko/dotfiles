package nav

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mm-sidebar/internal/projectcatalog"
	"mm-sidebar/internal/tmuxio"
)

func TestRepositoryPresentationKeepsCountsInDetail(t *testing.T) {
	row := repositoryHeading(Ctx{}, projectcatalog.Entry{Root: "/work/deadlock-modding", CommonDir: "/work/deadlock-modding/.git", Pinned: true, Live: true, Available: true}, 3, 7)
	if row.Presentation.Label != "deadlock-modding" {
		t.Fatalf("repository list label=%q", row.Presentation.Label)
	}
	if strings.Contains(row.Presentation.Label, "worktree") || strings.Contains(row.Presentation.Label, "branch") {
		t.Fatalf("verbose counts remained in list label: %q", row.Presentation.Label)
	}
	detail := row.Presentation.Detail.PlainText()
	for _, want := range []string{"/work/deadlock-modding", "3 worktrees", "7 branches", "pinned", "live"} {
		if !strings.Contains(detail, want) {
			t.Fatalf("repository detail missing %q: %q", want, detail)
		}
	}
}

func TestFiletreeStartsCollapsedAndCarriesCachedChildren(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "alpha")
	if err := os.Mkdir(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "child.txt"), []byte("child"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "root.txt"), []byte("root"), 0o600); err != nil {
		t.Fatal(err)
	}
	rows, err := (Filetree{}).Fetch(Ctx{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 || !rows[0].GroupHeading || !rows[0].Collapsible || rows[0].ToggleOnEnter || rows[1].GroupID != rows[0].GroupID {
		t.Fatalf("filetree disclosure rows=%#v", rows)
	}
	if rows[0].Presentation.Label != "alpha/" || rows[1].Presentation.Depth != 1 || rows[1].Presentation.Label != "child.txt" {
		t.Fatalf("filetree hierarchy presentation=%#v", rows)
	}
	if got := rows[0].Presentation.Detail.PlainText(); !strings.Contains(got, dir) || !strings.Contains(got, "Space preview") {
		t.Fatalf("directory detail=%q", got)
	}
}

func TestSemanticPanePresentationRetainsAlertsAndActiveState(t *testing.T) {
	world := tmuxio.NewWorld(tmuxio.Snapshot{SessionID: "$1"}, nil, []tmuxio.PaneRow{{
		PaneID: "%1", SessionID: "$1", WindowIndex: 1, WindowName: "editor", Command: "nvim", PaneActive: true, Bell: true,
	}})
	rows, err := (Windows{}).Fetch(Ctx{World: world})
	if err != nil || len(rows) != 1 {
		t.Fatalf("pane rows=%#v err=%v", rows, err)
	}
	if rows[0].Presentation.Tone != ToneAccent || len(rows[0].Presentation.Facts) < 2 || rows[0].Presentation.Facts[1].Text != "!" {
		t.Fatalf("semantic pane state=%#v", rows[0].Presentation)
	}
}

func TestSourceContextsAreUsefulAndPure(t *testing.T) {
	projects := Projects{}.Context(Ctx{}, []Row{{GroupHeading: true}, {GroupHeading: true}})
	filetree := Filetree{}.Context(Ctx{Root: "/Users/me/.config", RootPinned: true, ShowHidden: false}, nil)
	if projects != "2 repositories · r refresh" {
		t.Fatalf("projects context=%q", projects)
	}
	if !strings.Contains(filetree, "/Users/me/.config") || !strings.Contains(filetree, "pinned") || !strings.Contains(filetree, "hidden off") {
		t.Fatalf("filetree context=%q", filetree)
	}
}
