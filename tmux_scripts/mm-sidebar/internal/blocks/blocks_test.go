package blocks

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/theme"
)

// newTestBlocks builds every registered block with an inert theme and a
// buffered trigger channel, so a block whose Fetch does a non-blocking send has
// somewhere to send.
func newTestBlocks() []Block {
	return Build(Deps{
		Theme:  theme.Theme{},
		Agents: make(chan struct{}, 1),
	})
}

func lineCount(s string) int {
	if s == "" {
		return 1
	}
	return strings.Count(s, "\n") + 1
}

// TestViewEmitsExactlyHeightLines is the invariant the whole layout rests on:
// layout.go budgets space using Height() while View() supplies the actual rows,
// so any disagreement either shifts the frame or silently truncates a block.
//
// It runs over blocks.Factories rather than a hand-listed set, so a block added
// later is covered without touching this file.
func TestViewEmitsExactlyHeightLines(t *testing.T) {
	for _, b := range newTestBlocks() {
		for _, width := range []int{1, 10, 28, 36, 80, 200} {
			h, got := b.Height(), lineCount(b.View(width))
			if got != h {
				t.Errorf("%s.View(%d) emitted %d lines, Height() says %d",
					b.ID(), width, got, h)
			}
		}
	}
}

// TestHeightDoesNotFetch: layout calls Height() several times per frame, so it
// must read cached state only. A Height() that shelled out would make every
// render fork. Proxy check -- Height must be stable and instant across repeated
// calls with no intervening Update.
func TestHeightIsStableWithoutUpdate(t *testing.T) {
	for _, b := range newTestBlocks() {
		first := b.Height()
		for i := 0; i < 100; i++ {
			if got := b.Height(); got != first {
				t.Fatalf("%s.Height() unstable without an Update: %d then %d",
					b.ID(), first, got)
			}
		}
	}
}

// TestBlockIDsAreUnique: the tick router matches a tickMsg to its block by ID,
// so a duplicate would send one block's refresh to another and leave the twin
// permanently stale.
func TestBlockIDsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, b := range newTestBlocks() {
		if seen[b.ID()] {
			t.Errorf("duplicate block ID %q -- tickMsg routing is by ID", b.ID())
		}
		seen[b.ID()] = true
	}
}

// TestBlockIntervalsAreSafe permits passive blocks (Interval <= 0), which the
// model deliberately does not schedule. Positive intervals remain timer-driven.
func TestBlockIntervalsAreSafe(t *testing.T) {
	for _, b := range newTestBlocks() {
		if b.Interval() < 0 {
			t.Errorf("%s.Interval() is %v; passive blocks must use exactly zero", b.ID(), b.Interval())
		}
	}
}

// ---- 2.2: the sysctl values are machine constants, cached once -------------

// TestMachineConstantsAreCached documents why cpuThreads/memTotal exist: they
// replaced two sysctl forks that ran on every 5s sample, forever, for values
// that cannot change while the process lives.
func TestMachineConstantsAreCached(t *testing.T) {
	threads, total := cpuThreads(), memTotal()
	if threads < 1 {
		t.Fatalf("cpuThreads() = %d, want >= 1 (it must fall back to 1)", threads)
	}
	for i := 0; i < 50; i++ {
		if cpuThreads() != threads || memTotal() != total {
			t.Fatal("machine constants changed between calls; the sync.Once cache is broken")
		}
	}
	t.Logf("cached: threads=%d memTotal=%d bytes", threads, total)
}

// TestGaugeNeverExceedsTrack: fill is derived from a percentage that sampleCPU
// can briefly report above 100, so the bar must clamp rather than build a
// negative-length track (which would panic in strings.Repeat).
func TestGaugeHandlesOutOfRangeValues(t *testing.T) {
	b := NewSystemStats(theme.Theme{})
	for _, v := range []int{-50, -1, 0, 1, 50, 99, 100, 101, 1000} {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("gauge(%d) panicked: %v", v, r)
				}
			}()
			b.gauge("cpu", clampPct(v), false)
		}()
	}
}

func TestAgentsGlanceNavigationMatchesVisibleRows(t *testing.T) {
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	rows := make([]agents.Row, AgentsGlanceMax+2)
	for i := range rows {
		rows[i] = agents.Row{PaneID: "%1", Target: "sess:1", SessionName: "s"}
	}
	b.Update(AgentRowsMsg{Rows: rows})

	if got := b.NavigationCount(); got != AgentsGlanceMax {
		t.Fatalf("default navigation count = %d, want %d", got, AgentsGlanceMax)
	}
	if got := b.NavigationIndex(0); got != -1 {
		t.Fatalf("label mapped to row %d, want -1", got)
	}
	if got := b.NavigationIndex(1); got != 0 {
		t.Fatalf("first visible row mapped to %d, want 0", got)
	}
	if got := b.NavigationIndex(b.Height() - 1); got != -1 {
		t.Fatalf("more counter mapped to row %d, want -1", got)
	}

	b.SetExtra(2)
	if got := b.NavigationCount(); got != AgentsGlanceMax+2 {
		t.Fatalf("expanded navigation count = %d, want %d", got, AgentsGlanceMax+2)
	}
}

func TestAgentsGlanceHoverUnderlinesLocationOnly(t *testing.T) {
	lipgloss.SetColorProfile(termenv.TrueColor)
	t.Cleanup(func() { lipgloss.SetColorProfile(termenv.Ascii) })
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.Update(AgentRowsMsg{Rows: []agents.Row{{
		PaneID: "%1", Target: "sess:1", State: agents.StateWaiting,
		PaneLabel: "build", WindowName: "work", SessionName: "m",
	}}})
	b.SetNavigationIndex(0)
	if !b.SetHoverLine(1) {
		t.Fatal("agent row did not accept hover")
	}
	view := b.View(80)
	if !strings.Contains(view, "\x1b[4") {
		t.Fatalf("location is not underlined: %q", view)
	}
	if strings.Contains(view, "\x1b[4m!W") || strings.Contains(view, "\x1b[4;4m!W") {
		t.Fatalf("urgency tag was underlined: %q", view)
	}
	if !strings.Contains(view, "▶") {
		t.Fatalf("keyboard cursor disappeared while hovering: %q", view)
	}
	if b.SetHoverLine(0) {
		t.Fatal("label accepted hover")
	}
	if view := b.View(80); strings.Contains(view, "\x1b[4") {
		t.Fatalf("inert line did not clear hover: %q", view)
	}
}

func TestAgentLocationSanitizesHostileTmuxFields(t *testing.T) {
	got := agentLocation(agents.Row{
		PaneLabel:   "label\x1f\n\t\x1b中é",
		WindowName:  "window\r\u0080",
		SessionName: "session\\\"'",
	})
	if strings.ContainsAny(got, "\x1f\n\t\r\x1b") {
		t.Fatalf("agent location leaked control byte: %q", got)
	}
	for _, escaped := range []string{`\x1f`, `\n`, `\t`, `\x1b`, `\r`, `\u0080`} {
		if !strings.Contains(got, escaped) {
			t.Fatalf("agent location missing %q: %q", escaped, got)
		}
	}
	if !strings.Contains(got, "中é") {
		t.Fatalf("agent location lost ordinary Unicode: %q", got)
	}
}

func TestAgentLocationIncludesOnlyPresentSegments(t *testing.T) {
	if got := agentLocation(agents.Row{PaneLabel: "p", WindowName: "w", SessionName: "s"}); got != "p · w · s" {
		t.Fatalf("labeled location = %q", got)
	}
	if got := agentLocation(agents.Row{WindowName: "w", SessionName: "s"}); got != "w · s" {
		t.Fatalf("unlabeled location = %q", got)
	}
	if got := agentLocation(agents.Row{PaneLabel: "p", WindowName: "-", SessionName: "s"}); got != "p · s" {
		t.Fatalf("missing window location = %q", got)
	}
}

func TestAgentsGlanceExposesRegistryOwnedContextActions(t *testing.T) {
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.Update(AgentRowsMsg{Rows: []agents.Row{{
		PaneID: "%1", Target: "sess:1", SessionID: "stable-session", Agent: agents.AgentPi,
	}}})
	actions := b.Actions(0)
	if len(actions) != 4 || actions[0].ID != "focus" || actions[1].ID != "response" || actions[2].ID != "plan" || actions[3].Text != "stable-session" || actions[1].AgentSessionID != "stable-session" || actions[2].AgentSessionID != "stable-session" {
		t.Fatalf("agent actions = %#v", actions)
	}
	if got := b.Actions(1); got != nil {
		t.Fatalf("hidden agent actions = %#v, want nil", got)
	}
}

func TestAgentsGlanceSelectionRejectsSamePaneSessionReplacement(t *testing.T) {
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	old := agents.Row{Agent: agents.AgentClaude, SessionID: "old", PaneID: "%1", TmuxSessionID: "$1", WindowID: "@1", WindowIndex: 1}
	b.Update(AgentRowsMsg{Rows: []agents.Row{old}})
	id := b.NavigationID(0)
	replacement := old
	replacement.SessionID = "new"
	b.Update(AgentRowsMsg{Rows: []agents.Row{replacement}})
	if b.NavigationIndexByID(id) != -1 {
		t.Fatal("selection still resolved to same-pane replacement")
	}
}

func TestAgentLocationsLabelFallbackAndTruncation(t *testing.T) {
	labeled := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	labeled.Update(AgentRowsMsg{Rows: []agents.Row{{
		PaneID: "%1", PaneLabel: "label", WindowName: "window", SessionName: "session",
	}}})
	if view := labeled.View(20); !fitsWidth(view, 20) || !strings.Contains(view, "label") {
		t.Fatalf("labeled location did not preserve its left edge under clipping: %q", view)
	}

	unlabeled := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	unlabeled.Update(AgentRowsMsg{Rows: []agents.Row{{
		PaneID: "%1", WindowName: "window", SessionName: "session",
	}}})
	if view := unlabeled.View(80); !strings.Contains(view, "window · session") {
		t.Fatalf("unlabeled location regressed: %q", view)
	}
}

func fitsWidth(view string, width int) bool {
	for _, line := range strings.Split(view, "\n") {
		if ansi.StringWidth(line) > width {
			return false
		}
	}
	return true
}

func TestAgentsGlanceSelectionAndActivation(t *testing.T) {
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.Update(AgentRowsMsg{Rows: []agents.Row{{PaneID: "%1", Target: "sess:1", SessionName: "s"}}})
	b.SetNavigationIndex(0)
	if b.focus != 0 {
		t.Fatalf("focus = %d, want 0", b.focus)
	}
	b.SetNavigationIndex(2)
	if b.focus != -1 {
		t.Fatalf("out-of-range focus = %d, want -1", b.focus)
	}
	if cmd := b.ActivateNavigation(0); cmd == nil {
		t.Fatal("valid agent activation returned no command")
	}
	if cmd := b.ActivateNavigation(1); cmd != nil {
		t.Fatal("hidden agent activation returned a command")
	}
}
