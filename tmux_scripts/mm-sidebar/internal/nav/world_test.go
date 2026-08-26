package nav

import (
	"strings"
	"testing"

	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
)

func TestPaneLabelsBadgesAndActionsComeFromWorldRows(t *testing.T) {
	world := tmuxio.NewWorld(
		tmuxio.Snapshot{SessionID: "$work"},
		[]tmuxio.Session{{ID: "$work", Name: "work", Windows: 1}},
		[]tmuxio.PaneRow{{PaneID: "%1", SessionID: "$work", WindowIndex: 2, PaneIndex: 0, WindowName: "editor", Command: "nvim", CurrentPath: "/repo", PaneLabel: "review", Activity: true, Bell: true}},
	)
	rows, err := (Windows{}).Fetch(Ctx{Theme: theme.Theme{}, World: world})
	if err != nil || len(rows) != 1 {
		t.Fatalf("rows = %#v, %v", rows, err)
	}
	if !strings.Contains(rows[0].SearchText, "review · 2:editor") {
		t.Fatalf("pane label was not first-class navigator identity: %q", rows[0].SearchText)
	}
	if len(rows[0].Actions) < 5 || rows[0].Actions[1].ID != "label" || !rows[0].Actions[len(rows[0].Actions)-1].Destructive {
		t.Fatalf("pane actions = %#v", rows[0].Actions)
	}
	sessions, err := (Sessions{}).Fetch(Ctx{Theme: theme.Theme{}, World: world})
	if err != nil || len(sessions) != 1 || !world.Sessions()[0].Bell || !sessions[0].Actions[len(sessions[0].Actions)-1].Destructive {
		t.Fatalf("session badges/actions = %#v %#v, %v", world.Sessions(), sessions, err)
	}
}

func TestSidebarPanesAreNeverNavigationTargets(t *testing.T) {
	world := tmuxio.NewWorld(
		tmuxio.Snapshot{SessionID: "$work", PaneID: "%self-sidebar"},
		[]tmuxio.Session{{ID: "$work", Name: "work", Windows: 1}, {ID: "$other", Name: "other", Windows: 1}},
		[]tmuxio.PaneRow{
			{PaneID: "%self-sidebar", SessionID: "$work", WindowIndex: 1, PaneActive: true, WindowActive: true, Sidebar: true},
			{PaneID: "%work", SessionID: "$work", WindowIndex: 1, CurrentPath: "/work"},
			{PaneID: "%other-sidebar", SessionID: "$other", WindowIndex: 2, PaneActive: true, WindowActive: true, Sidebar: true},
			{PaneID: "%other", SessionID: "$other", WindowIndex: 2, CurrentPath: "/other"},
		},
	)
	ctx := Ctx{Theme: theme.Theme{}, World: world}
	windows, err := (Windows{}).Fetch(ctx)
	if err != nil || len(windows) != 1 || windows[0].PaneID != "%work" {
		t.Fatalf("window targets = %#v, %v", windows, err)
	}
	sessions, err := (Sessions{}).Fetch(ctx)
	if err != nil || len(sessions) != 2 || sessions[0].PaneID == "%self-sidebar" || sessions[1].PaneID == "%other-sidebar" {
		t.Fatalf("session targets = %#v, %v", sessions, err)
	}
}

func TestWorldFedSourcesShareFloatFirstOrdering(t *testing.T) {
	world := tmuxio.NewWorld(
		tmuxio.Snapshot{SessionID: "$work", WindowIndex: 2},
		[]tmuxio.Session{{ID: "$float", Name: "float", Windows: 1}, {ID: "$work", Name: "work", Windows: 2, Attached: true}},
		[]tmuxio.PaneRow{
			{PaneID: "%float", SessionID: "$float", SessionName: "float", WindowIndex: 1, PaneIndex: 0, PaneActive: true, WindowActive: true, CurrentPath: "/float"},
			{PaneID: "%later", SessionID: "$work", SessionName: "work", WindowIndex: 3, PaneIndex: 1, CurrentPath: "/later", WindowName: "later", Command: "zsh"},
			{PaneID: "%first", SessionID: "$work", SessionName: "work", WindowIndex: 2, PaneIndex: 0, PaneActive: true, WindowActive: true, CurrentPath: "/first", WindowName: "main", Command: "nvim"},
		},
	)
	ctx := Ctx{Theme: theme.Theme{}, World: world}
	sessions, err := (Sessions{}).Fetch(ctx)
	if err != nil || len(sessions) != 2 {
		t.Fatalf("sessions = %#v, %v", sessions, err)
	}
	if sessions[0].ID != "session:$float" || sessions[1].ID != "session:$work" {
		t.Fatalf("session rows lost world order: %#v", sessions)
	}
	windows, err := (Windows{}).Fetch(ctx)
	if err != nil || len(windows) != 2 {
		t.Fatalf("windows = %#v, %v", windows, err)
	}
	if windows[0].PaneID != "%first" || windows[1].PaneID != "%later" {
		t.Fatalf("window rows = %#v, want window/pane order", windows)
	}
	for _, row := range append(sessions, windows...) {
		if row.ID == "" || row.SearchText == "" {
			t.Fatalf("source row omitted stable filter fields: %#v", row)
		}
	}
}
