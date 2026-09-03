package blocks

import (
	"strings"
	"testing"
	"time"

	"mm-sidebar/internal/agentdetail"
	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/theme"
)

func TestAgentsGlanceTracksStateAgeAcrossTransitionsAndPrunesAbsentSessions(t *testing.T) {
	now := time.Date(2026, 3, 18, 10, 0, 0, 0, time.UTC)
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1), WithClock(func() time.Time { return now }))
	row := agents.Row{Agent: agents.AgentClaude, SessionID: "stable", PaneID: "%1", State: agents.StateWaiting}
	b.Update(AgentRowsMsg{Rows: []agents.Row{row}})
	identity := observedIdentity(row)
	if got := b.observedStates[identity].since; !got.Equal(now) {
		t.Fatalf("initial state since = %v", got)
	}
	now = now.Add(2*time.Minute + 5*time.Second)
	moved := row
	moved.PaneID = "%99"
	b.Update(AgentRowsMsg{Rows: []agents.Row{moved}})
	if got := humanAge(b.stateAge(moved)); got != "2m" {
		t.Fatalf("unchanged state age = %q", got)
	}
	row.State = agents.StateThinking
	b.Update(AgentRowsMsg{Rows: []agents.Row{row}})
	if got := humanAge(b.stateAge(row)); got != "now" {
		t.Fatalf("changed state age = %q", got)
	}
	b.Update(AgentRowsMsg{})
	if _, ok := b.observedStates[identity]; ok {
		t.Fatal("absent session retained state timestamp")
	}
}

func TestInspectorStartsOnlyExplicitlyAndOmitsDuplicateFields(t *testing.T) {
	now := time.Date(2026, 3, 18, 10, 0, 0, 0, time.UTC)
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1), WithClock(func() time.Time { return now }))
	row := agents.Row{Agent: agents.AgentPi, SessionID: "stable", PaneID: "%1", State: agents.StateWaiting, Transcript: "/tmp/pi.jsonl", Cwd: "/worktrees/sidebar"}
	b.Update(AgentRowsMsg{Rows: []agents.Row{row}})
	b.SetNavigationIndex(0)
	if b.InspectorActive() {
		t.Fatal("selection started inspector")
	}
	if _, ok := b.BeginInspection("stable", false); !ok {
		t.Fatal("explicit inspection was rejected")
	}
	now = now.Add(2 * time.Minute)
	b.Update(AgentDetailMsg{Identity: b.detailIdentity, Generation: b.detailGeneration, Data: agentdetail.Data{
		Response: "latest assistant response", Cwd: "/worktrees/sidebar", Worktree: "/worktrees/sidebar", Git: "feature +1",
	}})
	view := b.InspectorView(36, 10)
	for _, want := range []string{"state: waiting · 2m", "response:", "cwd:", "git:"} {
		if !strings.Contains(view, want) {
			t.Fatalf("inspector missing %q: %q", want, view)
		}
	}
	for _, absent := range []string{"prompt:", "worktree:", "no recent"} {
		if strings.Contains(view, absent) {
			t.Fatalf("inspector retained %q: %q", absent, view)
		}
	}
}

func TestEmptyAgentUpdateClearsExplicitInspector(t *testing.T) {
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.Update(AgentRowsMsg{Rows: []agents.Row{{Agent: agents.AgentPi, PaneID: "%1", SessionID: "stable"}}})
	if _, ok := b.BeginInspection("stable", false); !ok {
		t.Fatal("inspection did not start")
	}
	b.Update(AgentRowsMsg{})
	if b.InspectorActive() {
		t.Fatal("empty roster retained inspector")
	}
}
