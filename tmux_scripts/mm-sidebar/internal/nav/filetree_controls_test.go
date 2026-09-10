package nav

import (
	"os"
	"path/filepath"
	"testing"

	"mm-sidebar/internal/theme"
)

func TestFiletreeActionsAdvertiseEverySourceControl(t *testing.T) {
	got := Filetree{}.KeyActions()
	want := []string{"Space", "Left/Right", "h", "p", "R", "Backspace"}
	if len(got) != len(want) {
		t.Fatalf("actions = %#v", got)
	}
	for i, key := range want {
		if got[i].Key != key || got[i].Summary == "" {
			t.Fatalf("action %d = %#v, want key %q with summary", i, got[i], key)
		}
	}
}

func TestFiletreeControlsOwnHiddenRootAndPinState(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".hidden"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	f := Filetree{}
	ctx := Ctx{Theme: theme.Theme{}, Cwd: root, ContentPane: "%1", Root: root, RootPane: "%1"}
	rows, err := f.Fetch(ctx)
	if err != nil || len(rows) != 0 {
		t.Fatalf("hidden default rows = %#v, %v", rows, err)
	}
	control, ok := f.HandleSourceKey("h", ctx)
	if !ok || !control.SetShowHidden || !control.ShowHidden || !control.Refresh {
		t.Fatalf("hidden control = %#v, handled=%t", control, ok)
	}
	ctx.ShowHidden = control.ShowHidden
	rows, err = f.Fetch(ctx)
	if err != nil || len(rows) != 1 {
		t.Fatalf("hidden-enabled rows = %#v, %v", rows, err)
	}
	if len(rows[0].Actions) == 0 || rows[0].Actions[0].Kind != ContextPreviewPath {
		t.Fatalf("filetree row does not lead with explicit preview: %#v", rows[0].Actions)
	}
	pin, ok := f.HandleSourceKey("p", ctx)
	if !ok || !pin.SetRootPinned || !pin.RootPinned {
		t.Fatalf("pin control = %#v, handled=%t", pin, ok)
	}
	rootAfter, paneAfter := f.SyncRoot(Ctx{Cwd: "/other", ContentPane: "%2", Root: root, RootPane: "%1", RootPinned: true})
	if rootAfter != root || paneAfter != "%1" {
		t.Fatalf("pinned root was rederived: root=%q pane=%q", rootAfter, paneAfter)
	}
	reset, ok := f.HandleSourceKey("R", Ctx{Cwd: "/other", ContentPane: "%2", Root: root})
	if !ok || !reset.SetRoot || !reset.SetRootPinned || reset.RootPinned || reset.Root != "/other" || reset.RootPane != "%2" {
		t.Fatalf("reset control = %#v, handled=%t", reset, ok)
	}
}
