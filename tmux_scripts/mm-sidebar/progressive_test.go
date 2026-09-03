package main

import (
	"errors"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/blocks"
	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/theme"
)

func TestMainAttentionTruthTable(t *testing.T) {
	b := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.SetAttentionOnly(true)

	b.Update(blocks.AgentRowsMsg{Rows: []agents.Row{{State: agents.StateThinking, PaneID: "%1", SessionID: "thinking"}}})
	if b.Height() != 0 || b.NavigationCount() != 0 || b.View(36) != "" {
		t.Fatalf("thinking-only attention rendered: height=%d count=%d view=%q", b.Height(), b.NavigationCount(), b.View(36))
	}

	rows := []agents.Row{
		{State: agents.StateThinking, PaneID: "%thinking", SessionID: "thinking"},
		{State: agents.StateWaiting, PaneID: "%waiting", SessionID: "waiting", WindowName: "wait"},
		{State: agents.StateAwaitingPermission, PaneID: "%permission", SessionID: "permission", WindowName: "permission"},
	}
	b.Update(blocks.AgentRowsMsg{Rows: rows})
	view := b.View(36)
	if !strings.Contains(view, "attention") || !strings.Contains(view, "!P") || !strings.Contains(view, "!W") || strings.Contains(view, "~~") {
		t.Fatalf("attention projection is not blocker-only: %q", view)
	}
	if got := b.NavigationID(0); !strings.Contains(got, "%permission") {
		t.Fatalf("permission was not ordered first: %q", got)
	}
}

func TestAttentionCapsRowsAndMakesOverflowActionable(t *testing.T) {
	b := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.SetAttentionOnly(true)
	rows := make([]agents.Row, blocks.AgentsAttentionMax+2)
	for i := range rows {
		rows[i] = agents.Row{State: agents.StateWaiting, PaneID: "%" + itoa(i), SessionID: "s" + itoa(i)}
	}
	b.Update(blocks.AgentRowsMsg{Rows: rows})
	if got := b.NavigationCount(); got != blocks.AgentsAttentionMax+1 {
		t.Fatalf("attention navigation count=%d, want capped rows plus overflow", got)
	}
	if cmd := b.ActivateNavigation(blocks.AgentsAttentionMax); cmd == nil {
		t.Fatal("overflow row is not actionable")
	} else if msg := cmd(); msg != (blocks.OpenViewMsg{ID: "agents"}) {
		t.Fatalf("overflow action=%#v", msg)
	}
}

func TestNavigatorLoadingEmptyAndErrorStatesAreDistinct(t *testing.T) {
	m := &model{width: 36, theme: theme.Theme{}, sourceLoading: true}
	if got := strings.Join(m.navLines(1), "\n"); !strings.Contains(got, "loading") {
		t.Fatalf("loading state=%q", got)
	}
	m.sourceLoading = false
	if got := strings.Join(m.navLines(1), "\n"); !strings.Contains(got, "(empty)") {
		t.Fatalf("empty state=%q", got)
	}
	m.lastFetchErr = errors.New("failed").Error()
	if got := strings.Join(m.navLines(1), "\n"); !strings.Contains(got, "unavailable") {
		t.Fatalf("error state=%q", got)
	}
}

func TestViewsPaletteAndExplicitSurfaceClose(t *testing.T) {
	m := &model{surface: surfaceMain, docked: blocks.Build(blocks.Deps{Theme: theme.Theme{}, Agents: make(chan struct{}, 1)})}
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'v'}})
	if m.surface != surfaceViews {
		t.Fatalf("v surface=%v", m.surface)
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyEnter})
	if m.surface != surfaceAgents {
		t.Fatalf("first views entry surface=%v", m.surface)
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyEsc})
	if m.surface != surfaceMain {
		t.Fatalf("Esc did not return to main: %v", m.surface)
	}
}

func TestExplicitViewsAndInspectorPreserveExactHeight(t *testing.T) {
	m := newModel(nil)
	m.width, m.height = 36, 12
	m.rows = []nav.Row{{ID: "pane", Lines: []string{"pane"}}}
	agentsView := m.agentsBlock()
	agentsView.Update(blocks.AgentRowsMsg{Rows: []agents.Row{{Agent: agents.AgentPi, SessionID: "agent", PaneID: "%1", State: agents.StateThinking}}})
	for _, next := range []surface{surfaceViews, surfaceAgents, surfaceActivity, surfaceSystem} {
		m.openSurface(next)
		if got := strings.Count(m.View(), "\n") + 1; got != m.height {
			t.Fatalf("surface %v lines=%d", next, got)
		}
	}
	cmd, ok := agentsView.BeginInspection("agent", false)
	if !ok || cmd == nil {
		t.Fatal("explicit inspector did not start")
	}
	m.surface = surfaceInspector
	if got := strings.Count(m.View(), "\n") + 1; got != m.height {
		t.Fatalf("inspector lines=%d", got)
	}
}

func TestAttentionDisappearanceFallsBackBeforeActivation(t *testing.T) {
	b := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.SetAttentionOnly(true)
	b.Update(blocks.AgentRowsMsg{Rows: []agents.Row{{State: agents.StateWaiting, PaneID: "%1", SessionID: "wait"}}})
	m := &model{surface: surfaceMain, width: 36, height: 12, rows: []nav.Row{{ID: "pane", Lines: []string{"pane"}}}, docked: []blocks.Block{b}, focusRegion: focusBlock, focusBlock: 0, focusRow: 0}
	b.Update(blocks.AgentRowsMsg{Rows: nil})
	m.syncFocus(m.currentArrangement())
	if m.focusRegion != focusNavigator {
		t.Fatalf("disappeared attention retained block focus: %v", m.focusRegion)
	}
	if m.focusBlock != 0 || b.NavigationCount() != 0 {
		t.Fatalf("stale attention remained actionable: block=%d count=%d", m.focusBlock, b.NavigationCount())
	}
}

func TestInspectActionIsExplicitLocalEffect(t *testing.T) {
	m := newModel(nil)
	m.width, m.height = 36, 12
	block := m.agentsBlock()
	block.Update(blocks.AgentRowsMsg{Rows: []agents.Row{{Agent: agents.AgentPi, SessionID: "agent", PaneID: "%1", State: agents.StateWaiting}}})
	block.SetAttentionOnly(true)
	m.focusRegion, m.focusBlock, m.focusRow = focusBlock, 0, 0
	actions := block.Actions(0)
	if len(actions) == 0 || actions[0].Local != nav.LocalEffectInspectAgent {
		t.Fatalf("first agent action=%#v", actions)
	}
	if !m.currentAgentFocus(actions[0]) {
		t.Fatal("local inspect action was misclassified as guarded pane focus")
	}
	cmd, handled := m.applyContextEffect(actions[0])
	if !handled || cmd == nil || m.surface != surfaceInspector {
		t.Fatalf("inspect effect handled=%t cmd=%v surface=%v", handled, cmd, m.surface)
	}
}

func TestInspectorInvalidatesWhenSelectedAgentDisappears(t *testing.T) {
	b := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.Update(blocks.AgentRowsMsg{Rows: []agents.Row{
		{Agent: agents.AgentPi, SessionID: "inspected", PaneID: "%1"},
		{Agent: agents.AgentPi, SessionID: "other", PaneID: "%2"},
	}})
	if _, ok := b.BeginInspection("inspected", false); !ok {
		t.Fatal("inspection did not start")
	}
	b.Update(blocks.AgentRowsMsg{Rows: []agents.Row{{Agent: agents.AgentPi, SessionID: "other", PaneID: "%2"}}})
	if b.InspectorActive() {
		t.Fatal("departed agent retained inspector")
	}
}

func TestShortExplicitViewHasNoInvisibleNavigation(t *testing.T) {
	b := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	rows := make([]agents.Row, 10)
	for i := range rows {
		rows[i] = agents.Row{State: agents.StateIdle, PaneID: "%" + itoa(i), SessionID: "s" + itoa(i)}
	}
	b.Update(blocks.AgentRowsMsg{Rows: rows})
	b.SetAttentionOnly(false)
	m := &model{surface: surfaceAgents, width: 30, height: 3, docked: []blocks.Block{b}, focusRegion: focusBlock, focusBlock: 0}
	view := m.View()
	if got := strings.Count(view, "\n") + 1; got != 3 {
		t.Fatalf("short view lines=%d", got)
	}
	if b.NavigationCount() > 1 {
		t.Fatalf("short view exposes %d actionable rows", b.NavigationCount())
	}
	if len(m.blockLines) != 3 {
		t.Fatalf("short view hit-map lines=%d", len(m.blockLines))
	}
}

func TestWorldErrorIsNotRenderedAsEmpty(t *testing.T) {
	m := &model{width: 36, srcIdx: 0, theme: theme.Theme{}, sourceLoading: true, rows: []nav.Row{{ID: "stale", Lines: []string{"stale"}}}}
	m.applyState(stateMsg{stateSeq: 1, stateErr: errors.New("tmux unavailable")})
	view := strings.Join(m.navLines(1), "\n")
	if !strings.Contains(view, "unavailable") || strings.Contains(view, "(empty)") {
		t.Fatalf("world error state=%q", view)
	}
}

func TestHelpIncludesViewsCommand(t *testing.T) {
	m := &model{}
	found := false
	for _, action := range m.registeredKeyActions() {
		if action.Key == "v" {
			found = true
		}
	}
	if !found {
		t.Fatal("help omitted views command")
	}
}

func TestSourceSwitchMarksLoadingUntilAcceptedFetch(t *testing.T) {
	m := &model{srcIdx: 0}
	m.setSource(1)
	if !m.sourceLoading {
		t.Fatal("source switch did not enter loading state")
	}
	m.applyState(stateMsg{srcIdx: 1, sourceGeneration: m.sourceGeneration, stateSeq: 1, sourceFetched: true, fetchKey: "key", contextKey: "ctx", rows: []nav.Row{}})
	if m.sourceLoading {
		t.Fatal("accepted source fetch did not clear loading state")
	}
}
