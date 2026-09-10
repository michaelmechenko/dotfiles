package blocks

import (
	"strings"
	"testing"
	"time"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/theme"
)

func TestAmbientAgentsShowActiveStatesWithoutIdle(t *testing.T) {
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.Update(AgentRowsMsg{Rows: []agents.Row{
		{State: agents.StateAwaitingPermission, PaneID: "%1", SessionID: "permission", WindowName: "permission"},
		{State: agents.StateWaiting, PaneID: "%2", SessionID: "waiting", WindowName: "waiting"},
		{State: agents.StateThinking, PaneID: "%3", SessionID: "thinking", WindowName: "thinking"},
		{State: agents.StateIdle, PaneID: "%4", SessionID: "idle", WindowName: "idle"},
	}})
	lines := b.AmbientLines(36, 5)
	view := strings.Join(lines, "\n")
	for _, want := range []string{"permission", "waiting", "thinking"} {
		if !strings.Contains(view, want) {
			t.Fatalf("ambient agents missing %q: %q", want, view)
		}
	}
	if strings.Contains(view, "idle") || len(lines) > 5 {
		t.Fatalf("ambient agents included idle/overflow: %#v", lines)
	}
}

func TestAmbientActivityIsReadOnlyAndOmitsEmptyPanel(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	if lines := b.AmbientLines(36, 4); len(lines) != 0 {
		t.Fatalf("empty ambient activity=%#v", lines)
	}
	b.addAt(time.Now(), "OK", "response completed · editor", false, activityAgent, agents.Row{}, "", gitSnapshot{})
	beforePending, beforeVisible := len(b.pending), b.visible
	lines := b.AmbientLines(36, 4)
	if len(lines) != 2 || !strings.Contains(strings.Join(lines, "\n"), "response completed") {
		t.Fatalf("ambient activity=%#v", lines)
	}
	if len(b.pending) != beforePending || b.visible != beforeVisible || b.gitInFlight {
		t.Fatalf("ambient activity changed collection state: pending=%d visible=%t inFlight=%t", len(b.pending), b.visible, b.gitInFlight)
	}
}
