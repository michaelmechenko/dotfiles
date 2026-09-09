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
	if err != nil || len(sessions) != 2 || !world.Sessions()[0].Bell || !sessions[0].GroupHeading || !sessions[0].Actions[len(sessions[0].Actions)-1].Destructive {
		t.Fatalf("session outline badges/actions = %#v %#v, %v", world.Sessions(), sessions, err)
	}
	if sessions[1].PaneID != "%1" || sessions[1].GroupHeading || sessions[1].GroupID != "$work" || !strings.Contains(sessions[1].SearchText, "/repo") {
		t.Fatalf("session pane child = %#v", sessions[1])
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
	if err != nil || len(sessions) != 4 {
		t.Fatalf("session outline = %#v, %v", sessions, err)
	}
	for _, row := range sessions {
		if row.PaneID == "%self-sidebar" || row.PaneID == "%other-sidebar" {
			t.Fatalf("sidebar entered session outline: %#v", sessions)
		}
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
	if err != nil || len(sessions) != 5 {
		t.Fatalf("sessions = %#v, %v", sessions, err)
	}
	wantSessionIDs := []string{"session:$float", "session-pane:%float", "session:$work", "session-pane:%first", "session-pane:%later"}
	for i, want := range wantSessionIDs {
		if sessions[i].ID != want {
			t.Fatalf("session outline row %d = %q, want %q: %#v", i, sessions[i].ID, want, sessions)
		}
	}
	if len(sessions[0].Lines) != 1 || len(sessions[1].Lines) != 1 || !strings.Contains(sessions[4].SearchText, "/later") {
		t.Fatalf("session outline is not compact/searchable: %#v", sessions)
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
