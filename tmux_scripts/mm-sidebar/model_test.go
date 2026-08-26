package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/blocks"
	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
)

func TestProjectsStyleRowsClipAtEverySidebarWidth(t *testing.T) {
	for _, width := range []int{30, 36, 44} {
		m := &model{
			width:       width,
			focusRegion: focusNavigator,
			theme:       theme.Theme{Accent: lipgloss.NewStyle()},
			rows: []nav.Row{{Lines: []string{
				"config-feature-long-name · feat/worktrunk conflict +!? ↑12 ↓3 4 panes",
				"  ~/.worktrees/config/feat-worktrunk",
			}}},
		}
		lines := m.navLines(2)
		if len(lines) != 2 {
			t.Fatalf("width %d rendered %d lines", width, len(lines))
		}
		for _, line := range lines {
			if got := lipgloss.Width(line); got > width {
				t.Fatalf("width %d rendered %d cells: %q", width, got, line)
			}
		}
	}
}

func TestNewModelSeedsSidebarPaneForImmediateQuit(t *testing.T) {
	m := newModel(tmuxio.NewClient("%sidebar", "/dev/ttys001"))
	if m.selfPane != "%sidebar" {
		t.Fatalf("self pane = %q, want %%sidebar before first refresh", m.selfPane)
	}
}

func TestCloseScriptExportsImmutableSidebarPane(t *testing.T) {
	t.Setenv("MM_SIDEBAR_OWNER_WINDOW", "@source")
	got := closeScript("%sidebar")
	for _, assignment := range []string{
		"TMUX_PANE='%sidebar'",
		"MM_SIDEBAR_EXPECTED_PANE='%sidebar'",
		"MM_SIDEBAR_EXPECTED_WINDOW='@source'",
	} {
		if !strings.Contains(got, assignment) {
			t.Fatalf("close command lost immutable owner %q: %q", assignment, got)
		}
	}
	if !strings.HasSuffix(got, "tmux-sidebar-toggle' --close") {
		t.Fatalf("close command does not use canonical close owner: %q", got)
	}
}

// ---- Leak A: a new block's messages must reach it -------------------------

// stubMsg is a block message of a type model.go has never heard of -- the whole
// point of the test. It must satisfy blocks.BlockMsg.
type stubMsg struct{ payload string }

func (stubMsg) IsBlockMsg() {}

// stubBlock is a minimal Block that records whether it was handed its message.
type stubBlock struct{ got string }

func (*stubBlock) ID() string              { return "stub" }
func (*stubBlock) Interval() time.Duration { return time.Second }
func (*stubBlock) Fetch() tea.Cmd          { return nil }
func (*stubBlock) Height() int             { return 1 }
func (*stubBlock) View(int) string         { return "stub" }

func (b *stubBlock) Update(msg tea.Msg) {
	if m, ok := msg.(stubMsg); ok {
		b.got = m.payload
	}
}

// TestUpdateRoutesUnknownBlockMsg is the regression guard for the registry leak
// that made "adding a block is one type plus one Factories entry" false.
//
// Before the BlockMsg marker, Update type-switched on each block message by
// name, so a third block's message fell through to the default arm: it fetched,
// published, and rendered nothing, with no error anywhere.
func TestUpdateRoutesUnknownBlockMsg(t *testing.T) {
	b := &stubBlock{}
	m := &model{docked: []blocks.Block{b}}

	if _, cmd := m.Update(stubMsg{payload: "delivered"}); cmd != nil {
		t.Errorf("a plain block message should not schedule a Cmd, got %T", cmd)
	}
	if b.got != "delivered" {
		t.Fatalf("block never received its own message: got %q, want %q", b.got, "delivered")
	}
}

// TestBroadcastReachesEveryBlock: blocks ignore messages they don't own, so a
// broadcast must be safe to send to all of them, not just the intended one.
func TestBroadcastReachesEveryBlock(t *testing.T) {
	a, b := &stubBlock{}, &stubBlock{}
	m := &model{docked: []blocks.Block{a, b}}

	m.Update(stubMsg{payload: "x"})

	if a.got != "x" || b.got != "x" {
		t.Fatalf("broadcast missed a block: first=%q second=%q", a.got, b.got)
	}
}

// ---- Leak B: help must follow the action registries ----------------------

// TestHelpOverlayHeightIsFixed guards the invariant navFirstLine depends on.
// The overlay's line COUNT feeds the click -> row mapping, so action changes
// cannot change its height without updating the geometry constant.
func TestHelpOverlayHeightIsFixed(t *testing.T) {
	if got, want := len(helpOverlay(globalKeyActions)), helpLineCount(globalKeyActions); got != want {
		t.Fatalf("helpOverlay has %d lines but helpLineCount is %d; mouse mapping must derive from the same registry", got, want)
	}
}

func TestRegisteredKeyActionsIncludeOptionalSourceActions(t *testing.T) {
	m := &model{srcIdx: nav.SourceByID("filetree")}
	actions := m.registeredKeyActions()
	for _, want := range []string{"d", "h", "p", "R", "Backspace"} {
		found := false
		for _, action := range actions {
			if action.Key == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("registered actions do not include %q: %#v", want, actions)
		}
	}
	if got, want := len(helpOverlay(actions)), helpLineCount(actions); got != want {
		t.Fatalf("source actions changed compact help height: got %d want %d", got, want)
	}
}

func TestSourceSwitchClearsFetchErrorFromPreviousContext(t *testing.T) {
	m := &model{srcIdx: 0, lastFetchErr: "sessions unavailable"}
	m.setSource(1)
	if m.lastFetchErr != "" {
		t.Fatalf("source switch retained stale fetch error %q", m.lastFetchErr)
	}
}

func TestDiagnosticsViewIsExactHeightAndUsesCachedState(t *testing.T) {
	world := tmuxio.NewWorld(
		tmuxio.Snapshot{WindowID: "@3", SessionID: "$2", PaneID: "%sidebar"},
		[]tmuxio.Session{{ID: "$2", Name: "m*"}},
		[]tmuxio.PaneRow{{PaneID: "%sidebar", SessionID: "$2"}, {PaneID: "%content", SessionID: "$2"}},
	)
	m := &model{
		client:           tmuxio.NewClient("%sidebar", "/dev/ttys001"),
		width:            36,
		height:           12,
		srcIdx:           nav.SourceByID("filetree"),
		selfPane:         "%sidebar",
		contentPane:      "%content",
		sourceRoot:       "/tmp/root",
		watchRoot:        "/tmp/root",
		world:            world,
		worldFingerprint: "cached-world",
		lastSnapshot:     world.Snapshot,
		lastRefresh:      17 * time.Millisecond,
		refreshApplied:   3,
		sourceFetches:    2,
		sourceSkips:      1,
		blockVisible:     map[string]bool{"agents_glance": true},
		diagnostics:      true,
	}
	view := m.View()
	if got := len(strings.Split(view, "\n")); got != m.height {
		t.Fatalf("diagnostics lines = %d, want %d: %q", got, m.height, view)
	}
	for _, want := range []string{"diagnostics/help", "cached-world", "watch: /tmp/root", "refresh: applied=3"} {
		if !strings.Contains(view, want) {
			t.Fatalf("diagnostics missing cached %q: %q", want, view)
		}
	}
}

// TestStaleStateCannotRevertSource guards the race between a source refresh and
// persistSource. A refresh started before the tab choice carries the previous
// generation; applying it must not put the model back on the old source.
func TestMovedContentPaneIsRejectedAndRecomputedInOwnerWindow(t *testing.T) {
	client := tmuxio.NewClient("%sidebar", "")
	world := tmuxio.NewWorld(
		tmuxio.Snapshot{SessionID: "$1", WindowIndex: 0, PaneID: "%sidebar", ContentPane: "%moved", PaneLeft: 0},
		nil,
		[]tmuxio.PaneRow{
			{PaneID: "%moved", SessionID: "$2", WindowIndex: 0, PaneLeft: 40},
			{PaneID: "%right", SessionID: "$1", WindowIndex: 0, PaneLeft: 36},
		},
	)
	if got := resolveContentPane(client, world); got != "%right" {
		t.Fatalf("moved content pane resolved to %q, want owner-window %%right", got)
	}
}

func TestStaleStateCannotRevertSource(t *testing.T) {
	oldRows := []nav.Row{{Lines: []string{"old"}}}
	m := &model{
		srcIdx:           1,
		sourceGeneration: 1,
		rows:             []nav.Row{{Lines: []string{"new"}}},
	}

	m.Update(stateMsg{
		srcIdx:           0,
		sourceGeneration: 0,
		rows:             oldRows,
		fetchKey:         "old",
	})

	if m.srcIdx != 1 {
		t.Fatalf("stale refresh reverted source to %d, want 1", m.srcIdx)
	}
	if got := m.rows[0].Lines[0]; got != "new" {
		t.Fatalf("stale refresh replaced rows with %q, want new", got)
	}
}

// Every refresh, including a skipped source fetch, shares one completion order.
func TestRefreshSequenceRejectsLateRowsAndSkippedWorld(t *testing.T) {
	m := &model{}
	newerWorld := tmuxio.NewWorld(tmuxio.Snapshot{ContentPane: "%new"}, nil, nil)
	olderWorld := tmuxio.NewWorld(tmuxio.Snapshot{ContentPane: "%old"}, nil, nil)
	m.Update(stateMsg{srcIdx: 0, rows: []nav.Row{{Lines: []string{"new"}}}, fetchKey: "new", contextKey: "ctx", stateSeq: 2, world: newerWorld, contentPane: "%new"})
	m.Update(stateMsg{srcIdx: 0, stateSeq: 1, world: olderWorld, contentPane: "%old"})
	if got := m.rows[0].Lines[0]; got != "new" || m.contentPane != "%new" {
		t.Fatalf("late skipped refresh replaced newer state: row=%q pane=%q", got, m.contentPane)
	}
}

func TestStaleAgentWorldResultIsDiscarded(t *testing.T) {
	block := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	block.Update(blocks.AgentRowsMsg{Rows: []agents.Row{{PaneID: "%new", SessionName: "new"}}})
	m := &model{
		worldFingerprint: "world-new",
		docked:           []blocks.Block{block},
		feed:             &agentFeed{results: make(chan agentResult, 1)},
	}
	m.Update(blocks.AgentRowsMsg{
		Rows: []agents.Row{{PaneID: "%old", SessionName: "old"}}, WorldFingerprint: "world-old",
	})
	if got := block.NavigationID(0); got != "%new" {
		t.Fatalf("stale agent result replaced current world rows: %q", got)
	}
}

func TestTypedFetchErrorRetainsOnlySameContextRows(t *testing.T) {
	m := &model{rows: []nav.Row{{Lines: []string{"good"}}}, fetchKey: "good-key", rowContextKey: "same"}
	m.applyState(stateMsg{
		srcIdx: 0, rows: []nav.Row{{Lines: []string{"bad"}}}, fetchKey: "bad-key", contextKey: "same", stateSeq: 2,
		fetchErr: &nav.FetchError{SourceID: "sessions", Err: errors.New("temporary")},
	})
	if got := m.rows[0].Lines[0]; got != "good" || m.fetchKey != "" {
		t.Fatalf("same-context fetch error did not retain rows and invalidate retry key: rows=%#v key=%q", m.rows, m.fetchKey)
	}
	m.applyState(stateMsg{
		srcIdx: 0, fetchKey: "other-key", contextKey: "other", stateSeq: 3,
		fetchErr: &nav.FetchError{SourceID: "sessions", Err: errors.New("temporary")},
	})
	if len(m.rows) != 0 || m.fetchKey != "" {
		t.Fatalf("changed-context fetch error retained actionable rows or retry key: rows=%#v key=%q", m.rows, m.fetchKey)
	}
}

func TestContextPaletteRequiresExplicitConfirmation(t *testing.T) {
	action := nav.ContextAction{ID: "kill-pane", Label: "kill pane", Destructive: true, Kind: nav.ContextKillPane}
	m := &model{rows: []nav.Row{{ID: "pane:%1", Lines: []string{"pane"}, Actions: []nav.ContextAction{action}}}}
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	if !m.actionPalette {
		t.Fatal("a did not open row-owned context palette")
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyEnter})
	if m.confirmAction == nil || !m.confirmAction.Destructive {
		t.Fatalf("destructive action ran without confirmation: %#v", m.confirmAction)
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'n'}})
	if m.confirmAction != nil || !m.actionPalette {
		t.Fatal("n did not cancel only the destructive confirmation")
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyEnter})
	if _, cmd := m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'y'}}); cmd == nil || m.actionPalette {
		t.Fatal("confirmed y did not dispatch action and close palette")
	}
}

func TestContextPalettePreservesExactHeight(t *testing.T) {
	actions := []nav.ContextAction{{ID: "one", Label: "one"}, {ID: "two", Label: "two"}, {ID: "three", Label: "three"}}
	m := &model{width: 12, height: 3, rows: []nav.Row{{ID: "pane:%1", Lines: []string{"pane"}, Actions: actions}}}
	m.openActionPalette()
	if got := strings.Count(m.View(), "\n") + 1; got != m.height {
		t.Fatalf("palette View lines = %d, want %d", got, m.height)
	}
	if len(m.lineRow) != 0 || len(m.blockLines) != 0 {
		t.Fatal("palette retained stale navigator or mouse hit maps")
	}
}

func TestPanePreviewSanitizesCaptureAndPreservesExactHeight(t *testing.T) {
	m := &model{width: 36, height: 4, theme: theme.Theme{}}
	m.Update(panePreviewMsg{title: "preview pane", body: "plain\n\x1b[31mred\x1b[0m\t\x01"})
	view := m.View()
	if got := strings.Count(view, "\n") + 1; got != m.height {
		t.Fatalf("preview lines = %d, want %d: %q", got, m.height, view)
	}
	if strings.Contains(view, "\x1b[31m") || !strings.Contains(view, `\x1b[31mred\x1b[0m\t\x01`) {
		t.Fatalf("preview leaked or lost captured controls: %q", view)
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyEsc})
	if m.panePreview {
		t.Fatal("Esc did not close pane preview")
	}
}

func TestContextPaletteIsSourceAgnostic(t *testing.T) {
	m := &model{rows: []nav.Row{{ID: "file:/tmp/a", Lines: []string{"a"}, Actions: []nav.ContextAction{{ID: "copy-path", Label: "copy path", Kind: nav.ContextCopyPath}}}}}
	m.openActionPalette()
	if got := len(m.selectedActions()); got != 1 || !m.actionPalette {
		t.Fatalf("palette ignored row-owned descriptor: actions=%d open=%t", got, m.actionPalette)
	}
}

func TestProjectFilterChildMatchKeepsOnlyItsHeading(t *testing.T) {
	m := &model{query: "feature", rows: []nav.Row{
		{ID: "repo", GroupID: "repo", GroupHeading: true, SearchText: "repository", Lines: []string{"repo"}},
		{ID: "main", GroupID: "repo", SearchText: "main", Lines: []string{"main"}},
		{ID: "feature", GroupID: "repo", SearchText: "feature", Lines: []string{"feature"}},
		{ID: "other", GroupID: "other", GroupHeading: true, SearchText: "other", Lines: []string{"other"}},
	}}
	rows := m.navigatorRows()
	if len(rows) != 2 || !rows[0].GroupHeading || rows[1].ID != "feature" {
		t.Fatalf("child grouped filter = %#v", rows)
	}
}

func TestProjectFilterHeadingMatchKeepsAllChildren(t *testing.T) {
	m := &model{query: "repo", rows: []nav.Row{
		{ID: "repo", GroupID: "repo", GroupHeading: true, SearchText: "repository /repos/main", Lines: []string{"repo"}},
		{ID: "main", GroupID: "repo", SearchText: "main", Lines: []string{"main"}},
		{ID: "feature", GroupID: "repo", SearchText: "feature", Lines: []string{"feature"}},
		{ID: "other", GroupID: "other", GroupHeading: true, SearchText: "other", Lines: []string{"other"}},
		{ID: "other-child", GroupID: "other", SearchText: "unrelated", Lines: []string{"unrelated"}},
	}}
	rows := m.navigatorRows()
	if len(rows) != 3 || rows[0].ID != "repo" || rows[1].ID != "main" || rows[2].ID != "feature" {
		t.Fatalf("heading grouped filter = %#v", rows)
	}
}

func TestGenericActionCompletionForcesRefresh(t *testing.T) {
	m := newModel(tmuxio.NewClient("", ""))
	defer m.Close()
	if _, cmd := m.Update(contextActionMsg{result: nav.ActionResult{Refresh: true}}); cmd == nil {
		t.Fatal("refreshing action completion returned no refresh command")
	}
}

func TestSetSourceAdvancesGeneration(t *testing.T) {
	m := &model{srcIdx: 0}
	m.setSource(1)
	if m.srcIdx != 1 || m.sourceGeneration != 1 {
		t.Fatalf("setSource state = source %d generation %d, want 1/1", m.srcIdx, m.sourceGeneration)
	}
}

// navigableStub gives model tests a block-owned actionable region without
// depending on tmux or the concrete agents block.
type navigableStub struct {
	stubBlock
	id    string
	count int
	focus int
	acted int
}

func (b *navigableStub) ID() string {
	if b.id != "" {
		return b.id
	}
	return "navigable-stub"
}
func (b *navigableStub) NavigationCount() int         { return b.count }
func (b *navigableStub) SetNavigationIndex(index int) { b.focus = index }
func (b *navigableStub) NavigationIndex(line int) int {
	if line > 0 && line <= b.count {
		return line - 1
	}
	return -1
}
func (b *navigableStub) ActivateNavigation(index int) tea.Cmd {
	if index < 0 || index >= b.count {
		return nil
	}
	b.acted = index
	return func() tea.Msg { return nil }
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}

func testRows(n int) []nav.Row {
	rows := make([]nav.Row, n)
	for i := range rows {
		id := "row-" + itoa(i)
		rows[i] = nav.Row{ID: id, SearchText: id, Lines: []string{"row"}}
	}
	return rows
}

func TestWithinRegionMovementWrapsWithoutChangingRegion(t *testing.T) {
	b := &navigableStub{count: 2, focus: -1}
	m := &model{height: 20, width: 36, rows: testRows(2), docked: []blocks.Block{b}}

	m.moveWithinRegion(1)
	if m.focusRegion != focusNavigator || m.sel != 1 {
		t.Fatalf("navigator move = row %d, want row 1", m.sel)
	}
	m.moveWithinRegion(1)
	if m.focusRegion != focusNavigator || m.sel != 0 {
		t.Fatalf("navigator boundary left its region: region=%d row=%d", m.focusRegion, m.sel)
	}

	m.cycleFocusRegion(1)
	m.moveWithinRegion(1)
	m.moveWithinRegion(1)
	if m.focusRegion != focusBlock || m.focusRow != 0 {
		t.Fatalf("block movement did not wrap in place: region=%d row=%d", m.focusRegion, m.focusRow)
	}
}

func TestRegionCyclingPreservesSelectionsAndKeyAliases(t *testing.T) {
	first := &navigableStub{id: "first", count: 2, focus: -1}
	second := &navigableStub{id: "second", count: 2, focus: -1}
	m := &model{height: 30, width: 36, rows: testRows(2), sel: 1, docked: []blocks.Block{first, second}}

	m.handleKey(tea.KeyMsg{Type: tea.KeyF13}) // Ctrl-Tab transport
	if m.focusRegion != focusBlock || m.focusBlock != 0 || m.focusRow != 0 {
		t.Fatalf("F13 region = block %d row %d, want first block row 0", m.focusBlock, m.focusRow)
	}
	m.moveWithinRegion(1)
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'J'}})
	if m.focusBlock != 1 || m.focusRow != 0 {
		t.Fatalf("J region = block %d row %d, want second block row 0", m.focusBlock, m.focusRow)
	}
	m.moveWithinRegion(1)
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'J'}})
	if m.focusRegion != focusNavigator || m.sel != 1 {
		t.Fatalf("navigator selection was not preserved: region=%d row=%d", m.focusRegion, m.sel)
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'J'}})
	if m.focusBlock != 0 || m.focusRow != 1 {
		t.Fatalf("first block selection was not preserved: block=%d row=%d", m.focusBlock, m.focusRow)
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyF14}) // Ctrl-Shift-Tab transport
	if m.focusRegion != focusNavigator || m.sel != 1 {
		t.Fatalf("F14 region = navigator row %d, want preserved row 1", m.sel)
	}
}

func TestRegionCyclingSkipsInformationalAndDegradedBlocks(t *testing.T) {
	first := &navigableStub{id: "first", count: 1, focus: -1}
	info := &stubBlock{}
	degraded := &navigableStub{id: "degraded", count: 1, focus: -1}
	m := &model{height: 8, width: 36, rows: testRows(3), docked: []blocks.Block{first, info, degraded}}

	regions := m.focusRegions()
	if len(regions) != 2 || regions[0].block != navigatorTarget || regions[1].block != 0 {
		t.Fatalf("visible focus regions = %#v, want navigator then first block", regions)
	}
	m.cycleFocusRegion(1)
	if m.focusBlock != 0 {
		t.Fatalf("cycle entered block %d, want first visible actionable block", m.focusBlock)
	}
	m.cycleFocusRegion(1)
	if m.focusRegion != focusNavigator {
		t.Fatal("cycle did not skip informational and degraded blocks")
	}
}

func TestInformationalBlocksAreSkipped(t *testing.T) {
	info := &stubBlock{}
	action := &navigableStub{count: 1, focus: -1}
	m := &model{height: 20, width: 36, rows: testRows(1), docked: []blocks.Block{info, action}}

	got := m.visibleNavigableBlocks()
	if len(got) != 1 || got[0] != 1 {
		t.Fatalf("visible navigable blocks = %v, want [1]", got)
	}
	m.cycleFocusRegion(1)
	if m.focusBlock != 1 || m.focusRow != 0 {
		t.Fatalf("focus landed on block %d row %d, want informational block skipped", m.focusBlock, m.focusRow)
	}
}

func TestBlockEnterUsesBlockActivation(t *testing.T) {
	b := &navigableStub{count: 2, focus: -1}
	m := &model{height: 20, width: 36, docked: []blocks.Block{b}, focusRegion: focusBlock, focusBlock: 0, focusRow: 1}
	if cmd := m.act(); cmd == nil {
		t.Fatal("Enter on an actionable block returned no command")
	}
	if b.acted != 1 {
		t.Fatalf("activated row %d, want 1", b.acted)
	}
}

func TestLayoutDropsLowPriorityTailBlock(t *testing.T) {
	info := &stubBlock{}
	action := &navigableStub{count: 1, focus: -1}
	m := &model{height: 8, width: 36, rows: testRows(3), docked: []blocks.Block{info, action}}
	arr := m.layout(6) // header already removed; nav minimum is 3
	if len(arr.blocks) != 1 || arr.blocks[0].ID() != info.ID() {
		t.Fatalf("short layout kept blocks %v, want only the first block", blockIDs(arr.blocks))
	}
}

func blockIDs(bs []blocks.Block) []string {
	ids := make([]string, len(bs))
	for i, b := range bs {
		ids[i] = b.ID()
	}
	return ids
}

type visibilityStub struct {
	id         string
	visible    bool
	background bool
	fetches    int
}

func (b *visibilityStub) ID() string              { return b.id }
func (*visibilityStub) Interval() time.Duration   { return time.Second }
func (b *visibilityStub) Fetch() tea.Cmd          { return func() tea.Msg { b.fetches++; return nil } }
func (*visibilityStub) Update(tea.Msg)            {}
func (*visibilityStub) Height() int               { return 1 }
func (b *visibilityStub) View(int) string         { return b.id }
func (b *visibilityStub) SetVisible(v bool)       { b.visible = v }
func (b *visibilityStub) FetchInBackground() bool { return b.background }

func runCmd(cmd tea.Cmd) {
	if cmd == nil {
		return
	}
	if batch, ok := cmd().(tea.BatchMsg); ok {
		for _, nested := range batch {
			runCmd(nested)
		}
	}
}

func TestHiddenBlockSkipsFetchUntilVisible(t *testing.T) {
	shown := &visibilityStub{id: "shown"}
	hidden := &visibilityStub{id: "hidden"}
	m := &model{
		width: 36, height: 7, rows: testRows(1), docked: []blocks.Block{shown, hidden},
		blockVisible: make(map[string]bool),
	}
	m.syncBlockVisibility()
	runCmd(shown.Fetch())
	if !shown.visible || hidden.visible || shown.fetches != 1 || hidden.fetches != 0 {
		t.Fatalf("short layout visibility/fetches = shown(%t,%d) hidden(%t,%d)", shown.visible, shown.fetches, hidden.visible, hidden.fetches)
	}
	if m.shouldFetchBlock(hidden) {
		t.Fatal("hidden block opting out of background fetch was scheduled")
	}

	m.height = 10
	m.syncBlockVisibility()
	if !hidden.visible {
		t.Fatal("visible transition did not notify block")
	}
}

func TestFiletreeWatchCoversTwoLevelViewAndStops(t *testing.T) {
	root := t.TempDir()
	sub := filepath.Join(root, "sub")
	if err := os.Mkdir(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	watch := newFiletreeWatch(ctx)
	watch.Start()
	watch.SetRoot(root)
	select {
	case <-watch.configured:
	case <-time.After(time.Second):
		t.Fatal("filetree watcher did not configure")
	}

	cmd := watch.wait()
	result := make(chan tea.Msg, 1)
	go func() { result <- cmd() }()
	if err := os.WriteFile(filepath.Join(sub, "changed"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case msg := <-result:
		if _, ok := msg.(filetreeChangedMsg); !ok {
			t.Fatalf("watch message = %T, want filetreeChangedMsg", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("immediate-subdirectory change did not refresh filetree")
	}

	cancel()
	watch.Close()
}

func TestAgentFeedCloseWithoutStartDoesNotLeak(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	feed := newAgentFeed(ctx, tmuxio.NewClient("", ""))
	cancel()
	done := make(chan struct{})
	go func() { feed.Close(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("unstarted agent feed did not close")
	}
}

func TestAgentSelectionSurvivesUrgencyResort(t *testing.T) {
	b := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.Update(blocks.AgentRowsMsg{Rows: []agents.Row{
		{PaneID: "%a", Target: "m:1.0", SessionName: "m", State: agents.StateIdle},
		{PaneID: "%b", Target: "m:1.1", SessionName: "m", State: agents.StateThinking},
	}})
	m := &model{height: 20, width: 36, rows: testRows(1), docked: []blocks.Block{b}}
	m.setBlockFocus(0, 1) // %a is second after the initial urgency sort

	m.broadcast(blocks.AgentRowsMsg{Rows: []agents.Row{
		{PaneID: "%a", Target: "m:1.0", SessionName: "m", State: agents.StateWaiting},
		{PaneID: "%b", Target: "m:1.1", SessionName: "m", State: agents.StateIdle},
	}})
	if m.focusBlock != 0 || m.focusRow != 0 {
		t.Fatalf("selected agent moved to row %d, want its new row 0", m.focusRow)
	}
	if got := b.NavigationID(m.focusRow); got != "%a" {
		t.Fatalf("selected agent changed to %q, want %%a", got)
	}
}

func TestMouseHoverUnderlinesOnlyAnActionableAgentRow(t *testing.T) {
	lipgloss.SetColorProfile(termenv.TrueColor)
	t.Cleanup(func() { lipgloss.SetColorProfile(termenv.Ascii) })
	b := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.Update(blocks.AgentRowsMsg{Rows: []agents.Row{{PaneID: "%1", Target: "sess:1", SessionName: "s", WindowName: "w"}}})
	m := &model{theme: theme.Theme{}, width: 36, height: 12, rows: testRows(1), docked: []blocks.Block{b}}
	m.View() // record the rendered line maps before delivering mouse motion

	rowY := -1
	for i, hit := range m.blockLines {
		if hit.block != nil && hit.block.ID() == b.ID() && hit.local == 1 {
			rowY = m.navFirstLine() + len(m.lineRow) + i
			break
		}
	}
	if rowY < 0 {
		t.Fatal("could not locate the rendered agent row")
	}
	m.handleMouse(tea.MouseMsg{Action: tea.MouseActionMotion, Y: rowY})
	if got := m.View(); !strings.Contains(got, "\x1b[4") {
		t.Fatalf("hovered row did not render underline: %q", got)
	}
	if m.focusRegion != focusNavigator || m.sel != 0 {
		t.Fatalf("hover changed keyboard focus: region=%d row=%d", m.focusRegion, m.sel)
	}

	m.handleMouse(tea.MouseMsg{Action: tea.MouseActionMotion, Y: 0})
	if got := m.View(); strings.Contains(got, "\x1b[4") {
		t.Fatalf("leaving the row retained underline: %q", got)
	}
}

func TestHostileFiletreeRowsKeepHeightMouseMapAndActionTarget(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "hostile\x1f\n\t\x1b'\\中é.txt")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	rows, err := (nav.Filetree{}).Fetch(nav.Ctx{Root: root, Theme: theme.Theme{}})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Path != path || rows[0].ID != "file:"+path || rows[0].SearchText == "" {
		t.Fatalf("filetree row lost raw action metadata: %#v", rows)
	}
	if strings.Contains(rows[0].Lines[0], "\n") || strings.Contains(rows[0].Lines[0], "\x1b") {
		t.Fatalf("hostile filename reached display line: %q", rows[0].Lines[0])
	}
	for _, width := range []int{1, 36} {
		m := &model{theme: theme.Theme{}, width: width, height: 8, rows: rows}
		view := m.View()
		if got := strings.Count(view, "\n") + 1; got != m.height {
			t.Fatalf("width %d: View emitted %d lines, want %d: %q", width, got, m.height, view)
		}
		if strings.Contains(view, "\x1b") {
			t.Fatalf("width %d: View leaked an escape byte: %q", width, view)
		}
		_, cmd := m.handleMouse(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: m.navFirstLine()})
		if cmd != nil || m.sel != 0 {
			t.Fatalf("width %d: click selected row %d with command %v, want hostile row without acting", width, m.sel, cmd)
		}
		if cmd := m.act(); cmd == nil || m.rows[m.sel].Path != path {
			t.Fatalf("width %d: selected action no longer targets raw path", width)
		}
	}
}

func TestInlineFilterTypingPreservesSourceOrderAndSelection(t *testing.T) {
	rows := []nav.Row{
		{ID: "one", SearchText: "match alpha", Lines: []string{"one"}},
		{ID: "two", SearchText: "match beta", Lines: []string{"two"}},
		{ID: "three", SearchText: "match gamma", Lines: []string{"three"}},
	}
	m := &model{width: 36, height: 12, rows: rows, sel: 1}
	m.clampSel() // selectionID = two before filtering changes the view

	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("match")})
	if !m.queryActive || m.query != "match" {
		t.Fatalf("filter state = active:%t query:%q, want active match", m.queryActive, m.query)
	}
	got := m.navigatorRows()
	if len(got) != 3 || got[0].ID != "one" || got[1].ID != "two" || got[2].ID != "three" {
		t.Fatalf("filter reordered source rows: %#v", got)
	}
	if m.sel != 1 || m.selectionID != "two" {
		t.Fatalf("filter lost selected row: index=%d id=%q", m.sel, m.selectionID)
	}

	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(" beta")})
	if got := m.navigatorRows(); len(got) != 1 || got[0].ID != "two" || m.sel != 0 {
		t.Fatalf("narrowed filter = %#v selected=%d, want only two", got, m.sel)
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyEsc})
	if m.queryActive || m.query != "" || m.selectionID != "two" || m.sel != 1 {
		t.Fatalf("Esc did not clear filter and restore row two: active=%t query=%q id=%q sel=%d", m.queryActive, m.query, m.selectionID, m.sel)
	}
}

func TestInlineFilterUnicodePasteAndBackspace(t *testing.T) {
	m := &model{
		width: 36, height: 10,
		rows: []nav.Row{{ID: "tokyo", SearchText: "東京 station", Lines: []string{"tokyo"}}},
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("東京"), Paste: true})
	if m.query != "東京" || len(m.navigatorRows()) != 1 {
		t.Fatalf("Unicode paste was not accepted: query=%q rows=%#v", m.query, m.navigatorRows())
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyBackspace})
	if m.query != "東" {
		t.Fatalf("Backspace removed bytes rather than one Unicode rune: %q", m.query)
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("京\nstation"), Paste: true})
	if m.query != "東京 station" || len(m.navigatorRows()) != 1 {
		t.Fatalf("paste did not normalize a one-line searchable query: %q %#v", m.query, m.navigatorRows())
	}
}

func TestInlineFilterStableSelectionSurvivesRefreshByRowID(t *testing.T) {
	m := &model{rows: []nav.Row{
		{ID: "a", SearchText: "match a", Lines: []string{"a"}},
		{ID: "b", SearchText: "match b", Lines: []string{"b"}},
		{ID: "c", SearchText: "match c", Lines: []string{"c"}},
	}, sel: 1, query: "match", queryActive: true}
	m.clampSel()
	m.rememberNavigatorSelection()
	m.rows = []nav.Row{
		{ID: "c", SearchText: "match c", Lines: []string{"c"}},
		{ID: "a", SearchText: "match a", Lines: []string{"a"}},
		{ID: "b", SearchText: "match b", Lines: []string{"b"}},
	}
	m.clampSel()
	if m.sel != 2 || m.selectionID != "b" || m.navigatorRows()[m.sel].ID != "b" {
		t.Fatalf("refresh changed selected row instead of locating Row.ID: index=%d id=%q rows=%#v", m.sel, m.selectionID, m.navigatorRows())
	}
}

func TestInlineFilterEmptyMatchesRendersPlaceholderWithoutNavigatorFocus(t *testing.T) {
	m := &model{theme: theme.Theme{}, width: 36, height: 8, rows: []nav.Row{{ID: "a", SearchText: "alpha", Lines: []string{"alpha"}}}}
	m.beginQuery()
	m.appendQuery("missing")
	if rows := m.navigatorRows(); len(rows) != 0 {
		t.Fatalf("empty query result = %#v, want none", rows)
	}
	if got := m.View(); !strings.Contains(got, "(no matches)") {
		t.Fatalf("empty filter did not render a no-match placeholder: %q", got)
	}
	if regions := m.focusRegions(); len(regions) != 0 {
		t.Fatalf("empty filter retained navigator focus region: %#v", regions)
	}
	if cmd := m.act(); cmd != nil {
		t.Fatal("Enter on an empty filter result returned an action")
	}
}

func TestInlineFilterMovesMouseMapsBelowQueryAndHelp(t *testing.T) {
	m := &model{
		theme: theme.Theme{}, width: 36, height: 16, showHelp: true,
		rows: []nav.Row{
			{ID: "a", SearchText: "match a", Lines: []string{"a"}},
			{ID: "b", SearchText: "match b", Lines: []string{"b"}},
		},
	}
	m.beginQuery()
	m.appendQuery("match")
	m.View() // records maps for this exact header + help + query frame
	if want := headerLines + m.helpLineCount() + queryLineCount; m.navFirstLine() != want {
		t.Fatalf("navigator begins at %d, want %d with help and query", m.navFirstLine(), want)
	}
	// The old pre-query navigator Y is now a query/help line and must not select.
	m.handleMouse(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: headerLines + m.helpLineCount()})
	if m.sel != 0 {
		t.Fatalf("query line was treated as a navigator row: selected %d", m.sel)
	}
	m.handleMouse(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: m.navFirstLine() + 1})
	if m.sel != 1 || m.selectionID != "b" {
		t.Fatalf("query-aware mouse map selected row %d id %q, want b", m.sel, m.selectionID)
	}
}

func TestQueryLineChangesDegradationAndKeepsExactHeight(t *testing.T) {
	first, second := &stubBlock{}, &stubBlock{}
	m := &model{theme: theme.Theme{}, width: 36, height: 9, rows: testRows(1), docked: []blocks.Block{first, second}}
	if arr := m.currentArrangement(); len(arr.blocks) != 2 {
		t.Fatalf("baseline layout blocks = %d, want 2", len(arr.blocks))
	}
	m.beginQuery()
	if arr := m.currentArrangement(); len(arr.blocks) != 1 {
		t.Fatalf("query line did not consume one layout row: blocks = %d, want 1", len(arr.blocks))
	}
	m.showHelp = true
	if arr := m.currentArrangement(); len(arr.blocks) != 0 {
		t.Fatalf("help + query layout did not degrade docked blocks: %d remain", len(arr.blocks))
	}
	for _, height := range []int{1, 2, 9, 20} {
		m.height = height
		if got := strings.Count(m.View(), "\n") + 1; got != height {
			t.Fatalf("height %d: View emitted %d lines", height, got)
		}
	}
}

func TestInlineFilterSynchronizesBlockVisibility(t *testing.T) {
	first := &visibilityStub{id: "first"}
	second := &visibilityStub{id: "second"}
	m := &model{
		width: 36, height: 9, rows: testRows(1), docked: []blocks.Block{first, second},
		blockVisible: make(map[string]bool),
	}
	runCmd(m.syncBlockVisibility())
	if !first.visible || !second.visible || first.fetches != 1 || second.fetches != 1 {
		t.Fatalf("initial visibility = first(%t,%d) second(%t,%d), want both visible and fetched", first.visible, first.fetches, second.visible, second.fetches)
	}
	_, cmd := m.handleKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'/'}})
	runCmd(cmd)
	if !first.visible || second.visible || second.fetches != 1 {
		t.Fatalf("query entry did not publish degradation: first(%t,%d) second(%t,%d)", first.visible, first.fetches, second.visible, second.fetches)
	}
	_, cmd = m.handleKey(tea.KeyMsg{Type: tea.KeyEsc})
	runCmd(cmd)
	if !second.visible || second.fetches != 2 {
		t.Fatalf("clearing query did not reveal and fetch block: second(%t,%d)", second.visible, second.fetches)
	}
}

func TestInlineFilterRetainsF13F14RegionCycling(t *testing.T) {
	block := &navigableStub{count: 1, focus: -1}
	m := &model{height: 20, width: 36, rows: []nav.Row{{ID: "a", SearchText: "alpha", Lines: []string{"a"}}}, docked: []blocks.Block{block}}
	m.beginQuery()
	m.appendQuery("alpha")
	m.handleKey(tea.KeyMsg{Type: tea.KeyF13})
	if m.focusRegion != focusBlock || m.focusBlock != 0 {
		t.Fatalf("F13 stopped cycling regions while filtering: region=%d block=%d", m.focusRegion, m.focusBlock)
	}
	m.handleKey(tea.KeyMsg{Type: tea.KeyF14})
	if m.focusRegion != focusNavigator {
		t.Fatalf("F14 stopped cycling back to navigator while filtering: region=%d", m.focusRegion)
	}
}

func TestMouseAgentClickSetsKeyboardFocus(t *testing.T) {
	b := blocks.NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.Update(blocks.AgentRowsMsg{Rows: []agents.Row{{PaneID: "%1", Target: "sess:1", SessionName: "s"}}})
	m := &model{
		theme:  theme.Theme{},
		width:  36,
		height: 12,
		rows:   testRows(1),
		docked: []blocks.Block{b},
	}
	m.View() // records the rendered line-to-block map used by mouse handling

	rowY := -1
	for i, hit := range m.blockLines {
		if hit.block != nil && hit.block.ID() == b.ID() && hit.local == 1 {
			rowY = m.navFirstLine() + len(m.lineRow) + i
			break
		}
	}
	if rowY < 0 {
		t.Fatal("could not locate the rendered agent row")
	}
	_, cmd := m.handleMouse(tea.MouseMsg{
		Button: tea.MouseButtonLeft,
		Action: tea.MouseActionPress,
		Y:      rowY,
	})
	if cmd == nil {
		t.Fatal("mouse click returned no activation command")
	}
	if m.focusRegion != focusBlock || m.focusBlock != 0 || m.focusRow != 0 {
		t.Fatalf("mouse focus = region %d block %d row %d, want block 0 row 0", m.focusRegion, m.focusBlock, m.focusRow)
	}
}
