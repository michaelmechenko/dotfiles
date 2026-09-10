package main

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/blocks"
	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/theme"
)

func TestCockpitExactFrameGrid(t *testing.T) {
	for _, width := range []int{30, 36, 44} {
		for _, height := range []int{7, 12, 24} {
			m := &model{width: width, height: height, srcIdx: 0, focusRegion: focusNavigator, theme: theme.Theme{}, rows: []nav.Row{{
				ID: "wide", Presentation: nav.Presentation{Label: strings.Repeat("wide label ", 8), Facts: []nav.Fact{{Text: strings.Repeat("metadata ", 8)}}, Detail: nav.Detail{Title: "selected item", Lines: []nav.DetailLine{{Text: "/" + strings.Repeat("long/path/", 12), TruncateLeft: true}}, Hints: []nav.KeyAction{{Key: "Enter", Summary: "focus"}}}},
			}}}
			view := m.View()
			if got := strings.Count(view, "\n") + 1; got != height {
				t.Fatalf("%dx%d frame lines=%d", width, height, got)
			}
			for _, line := range strings.Split(view, "\n") {
				if got := lipgloss.Width(line); got > width {
					t.Fatalf("%dx%d line width=%d: %q", width, height, got, line)
				}
			}
		}
	}
}

func TestContextRailReplacesRepeatedSourceSubtitle(t *testing.T) {
	m := &model{width: 36, height: 12, srcIdx: nav.SourceByID("projects"), theme: theme.Theme{}, rows: []nav.Row{
		{ID: "repo:a", GroupID: "a", GroupHeading: true, Presentation: nav.Presentation{Label: "alpha"}},
		{ID: "repo:b", GroupID: "b", GroupHeading: true, Presentation: nav.Presentation{Label: "beta"}},
	}}
	lines := m.headerLines()
	if len(lines) != 2 || strings.Contains(lines[1], "▸ projects") || !strings.Contains(lines[1], "2 repositories") {
		t.Fatalf("context rail = %#v", lines)
	}
}

func TestMainCockpitUsesSelectedDetailAtNormalHeight(t *testing.T) {
	m := &model{width: 36, height: 16, srcIdx: 0, focusRegion: focusNavigator, theme: theme.Theme{}, rows: []nav.Row{{
		ID: "one", SearchText: "one", Presentation: nav.Presentation{
			Label:  "one",
			Detail: nav.Detail{Title: "selected pane", Lines: []nav.DetailLine{{Text: "/a/full/path", TruncateLeft: true}}, Hints: []nav.KeyAction{{Key: "Enter", Summary: "focus"}}},
		},
	}}}
	view := m.View()
	for _, want := range []string{"selected pane", "/a/full/path", "Enter focus"} {
		if !strings.Contains(view, want) {
			t.Fatalf("cockpit missing %q: %q", want, view)
		}
	}
	if got := strings.Count(view, "\n") + 1; got != 16 {
		t.Fatalf("cockpit height=%d", got)
	}
	for _, line := range strings.Split(view, "\n") {
		if lipgloss.Width(line) > 36 {
			t.Fatalf("cockpit line overflow: %q", line)
		}
	}
}

func TestTallSparseCockpitUsesCachedWorkingAndActivity(t *testing.T) {
	agentBlock := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	agentBlock.SetAttentionOnly(true)
	activity := blocks.NewActivity(theme.Theme{}, nil)
	thinking := agents.Row{Agent: agents.AgentPi, State: agents.StateThinking, PaneID: "%1", SessionID: "agent", WindowName: "editor"}
	agentBlock.Update(blocks.AgentRowsMsg{Rows: []agents.Row{thinking}})
	activity.Update(blocks.AgentRowsMsg{Rows: []agents.Row{thinking}})
	waiting := thinking
	waiting.State = agents.StateWaiting
	activity.Update(blocks.AgentRowsMsg{Rows: []agents.Row{waiting}})
	m := &model{width: 36, height: 30, srcIdx: 0, focusRegion: focusNavigator, theme: theme.Theme{}, docked: []blocks.Block{agentBlock, activity}, rows: []nav.Row{{
		ID: "one", Presentation: nav.Presentation{Label: "one", Detail: nav.Detail{Title: "selected pane", Lines: []nav.DetailLine{{Text: "/repo"}}}},
	}}}
	view := m.View()
	for _, want := range []string{"active agents", "~~", "recent activity", "waiting"} {
		if !strings.Contains(view, want) {
			t.Fatalf("hybrid cockpit missing %q: %q", want, view)
		}
	}
	if activityVisible := activity.FetchInBackground(); activityVisible {
		t.Fatal("ambient projection changed activity collection policy")
	}
}

func TestVeryShortMainPreservesOneUrgentAgentBeforeDetail(t *testing.T) {
	agentBlock := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	agentBlock.SetAttentionOnly(true)
	agentBlock.Update(blocks.AgentRowsMsg{Rows: []agents.Row{
		{State: agents.StateAwaitingPermission, PaneID: "%1", SessionID: "one", WindowName: "one"},
		{State: agents.StateWaiting, PaneID: "%2", SessionID: "two", WindowName: "two"},
	}})
	m := &model{width: 30, height: 7, srcIdx: 0, focusRegion: focusNavigator, theme: theme.Theme{}, docked: []blocks.Block{agentBlock}, rows: []nav.Row{{
		ID: "one", Presentation: nav.Presentation{Label: "one", Detail: nav.Detail{Title: "selected detail", Lines: []nav.DetailLine{{Text: "optional"}}}},
	}}}
	view := m.View()
	if !strings.Contains(view, "!P") || strings.Contains(view, "selected detail") {
		t.Fatalf("short priority frame=%q", view)
	}
}

func TestVeryShortMainSuppressesSelectedDetail(t *testing.T) {
	m := &model{width: 30, height: 7, srcIdx: 0, focusRegion: focusNavigator, theme: theme.Theme{}, rows: []nav.Row{{
		ID: "one", Presentation: nav.Presentation{Label: "one", Detail: nav.Detail{Title: "selected detail", Lines: []nav.DetailLine{{Text: "hidden at short height"}}}},
	}}}
	if view := m.View(); strings.Contains(view, "selected detail") {
		t.Fatalf("short frame retained optional detail: %q", view)
	}
}

func TestFiletreeDisclosureUsesLeftRightWithoutCommand(t *testing.T) {
	group := "/root/alpha"
	m := &model{srcIdx: nav.SourceByID("filetree"), focusRegion: focusNavigator, rows: []nav.Row{
		{ID: "dir:" + group, GroupID: group, GroupHeading: true, Collapsible: true, Presentation: nav.Presentation{Label: "alpha"}},
		{ID: "file:" + group + "/child", GroupID: group, Presentation: nav.Presentation{Label: "child", Depth: 1}},
		{ID: "file:/root/top", Presentation: nav.Presentation{Label: "top"}},
	}}
	if got := len(m.navigatorRows()); got != 2 {
		t.Fatalf("collapsed filetree rows=%d", got)
	}
	if _, cmd := m.handleKey(tea.KeyMsg{Type: tea.KeyRight}); cmd != nil || len(m.navigatorRows()) != 3 {
		t.Fatalf("Right disclosure started work or stayed closed: cmd=%v rows=%d", cmd, len(m.navigatorRows()))
	}
	m.sel = 1
	if _, cmd := m.handleKey(tea.KeyMsg{Type: tea.KeyLeft}); cmd != nil || len(m.navigatorRows()) != 2 || m.sel != 0 {
		t.Fatalf("Left disclosure started work or lost parent: cmd=%v rows=%d sel=%d", cmd, len(m.navigatorRows()), m.sel)
	}
}

func TestQuestionOpensDedicatedHelpSurface(t *testing.T) {
	m := &model{width: 30, height: 8, srcIdx: nav.SourceByID("filetree"), sel: 1, lineRow: []int{0}, rows: []nav.Row{{ID: "file", Presentation: nav.Presentation{Label: "file"}}}}
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'?'}})
	if len(m.lineRow) != 0 || len(m.blockLines) != 0 {
		t.Fatalf("help entry retained stale hit maps: rows=%v blocks=%v", m.lineRow, m.blockLines)
	}
	m.handleMouse(tea.MouseMsg{X: 0, Y: 2, Button: tea.MouseButtonLeft, Action: tea.MouseActionPress})
	if m.sel != 1 {
		t.Fatalf("help click changed underlying selection to %d", m.sel)
	}
	if m.surface != surfaceHelp {
		t.Fatalf("? surface=%v, want help", m.surface)
	}
	view := m.View()
	if strings.Contains(view, "file\n") || !strings.Contains(view, "help") || !strings.Contains(view, "Space") {
		t.Fatalf("dedicated help view=%q", view)
	}
	if len(m.lineRow) != 0 || len(m.blockLines) != 0 || strings.Count(view, "\n")+1 != 8 {
		t.Fatalf("help geometry/hit maps: rows=%v blocks=%v view=%q", m.lineRow, m.blockLines, view)
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'G'}})
	if end := m.View(); !strings.Contains(end, "help / close") {
		t.Fatalf("help viewport did not reach final action: %q", end)
	}
}
