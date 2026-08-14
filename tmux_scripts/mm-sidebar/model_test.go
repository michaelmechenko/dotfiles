package main

import (
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"mm-sidebar/internal/blocks"
	"mm-sidebar/internal/nav"
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
