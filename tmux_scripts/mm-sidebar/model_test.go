package main

import (
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
)

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

// ---- Leak B: the help overlay must not drift from the tab registry --------

// TestHelpOverlayHeightIsFixed guards the invariant navFirstLine depends on.
// The overlay's line COUNT feeds the click -> row mapping, so a line added here
// without updating helpLineCount silently offsets every mouse click by one.
func TestHelpOverlayHeightIsFixed(t *testing.T) {
	if got := len(helpOverlay()); got != helpLineCount {
		t.Fatalf("helpOverlay has %d lines but helpLineCount is %d; the mouse "+
			"mapping derives from the constant, so these must agree", got, helpLineCount)
	}
}

// TestHelpOverlayDerivesTabCount: the strip derives its chips from nav.Sources,
// so the help must too. Hardcoding "1-4" meant a fifth tab made the help lie.
func TestHelpOverlayDerivesTabCount(t *testing.T) {
	want := "1-" + itoa(len(nav.Sources)) + "/Tab"
	for _, line := range helpOverlay() {
		if strings.Contains(line, want) {
			return
		}
	}
	t.Fatalf("no help line mentions %q; helpOverlay must derive the tab count "+
		"from nav.Sources (currently %d sources)", want, len(nav.Sources))
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}

// TestStaleStateCannotRevertSource guards the race between a source refresh and
// persistSource. A refresh started before the tab choice carries the previous
// generation; applying it must not put the model back on the old source.
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

// TestSetSourceAdvancesGeneration ensures every in-process source choice
// invalidates refreshes already in flight, even before the tmux option write
// completes.
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

func testRows(n int) []nav.Row {
	rows := make([]nav.Row, n)
	for i := range rows {
		rows[i] = nav.Row{Lines: []string{"row"}}
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
