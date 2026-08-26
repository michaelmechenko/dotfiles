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
		t.Fatalf("initial state since = %v, want %v", got, now)
	}

	now = now.Add(2*time.Minute + 5*time.Second)
	moved := row
	moved.PaneID = "%99" // pane movement must not reset a session's state age.
	b.Update(AgentRowsMsg{Rows: []agents.Row{moved}})
	if got := b.observedStates[identity].since; !got.Equal(now.Add(-2*time.Minute - 5*time.Second)) {
		t.Fatalf("unchanged state reset timestamp: %v", got)
	}

	row.State = agents.StateThinking
	b.Update(AgentRowsMsg{Rows: []agents.Row{row}})
	if got := b.observedStates[identity].since; !got.Equal(now) {
		t.Fatalf("changed state since = %v, want %v", got, now)
	}
	if got := humanAge(b.stateAge(row)); got != "now" {
		t.Fatalf("changed state age = %q, want now", got)
	}

	now = now.Add(time.Hour + time.Minute)
	if got := humanAge(b.stateAge(row)); got != "1h" {
		t.Fatalf("state age = %q, want 1h", got)
	}
	b.Update(AgentRowsMsg{})
	if _, ok := b.observedStates[identity]; ok {
		t.Fatal("absent session retained its state timestamp")
	}
}

func TestAgentsGlanceEmptyUpdateClearsInspectorAndPreservesHeightView(t *testing.T) {
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1))
	b.Update(AgentRowsMsg{Rows: []agents.Row{{
		Agent: agents.AgentPi, PaneID: "%1", SessionID: "stable", State: agents.StateIdle,
		Transcript: "/tmp/pi.jsonl", Cwd: "/worktrees/sidebar",
	}}})
	if !b.SelectionChanged(b.NavigationID(0)) {
		t.Fatal("selection did not start inspector")
	}
	b.Update(AgentDetailMsg{
		Identity: b.detailIdentity, Generation: b.detailGeneration,
		Data: agentdetail.Data{Prompt: "prompt", Response: "response", Cwd: "/worktrees/sidebar"},
	})
	b.Expand(detailMaxLines)
	if b.detailExtra == 0 || b.Height() <= 2 {
		t.Fatalf("inspector was not allocated before empty update: extra=%d height=%d", b.detailExtra, b.Height())
	}

	b.Update(AgentRowsMsg{})
	if b.detailState != detailInactive || b.detailIdentity != "" || b.detailExtra != 0 {
		t.Fatalf("empty update retained inspector state: state=%d identity=%q extra=%d", b.detailState, b.detailIdentity, b.detailExtra)
	}
	for _, width := range []int{1, 24, 80} {
		view := b.View(width)
		if got := lineCount(view); got != b.Height() {
			t.Fatalf("View(%d) lines=%d, Height=%d: %q", width, got, b.Height(), view)
		}
		if strings.Contains(view, "state:") || strings.Contains(view, "response:") {
			t.Fatalf("View(%d) retained detail: %q", width, view)
		}
	}
}

func TestAgentsGlanceInspectorRendersStateAgeAndBoundedContextWithinSlack(t *testing.T) {
	now := time.Date(2026, 3, 18, 10, 0, 0, 0, time.UTC)
	b := NewAgentsGlance(theme.Theme{}, make(chan struct{}, 1), WithClock(func() time.Time { return now }))
	row := agents.Row{
		Agent: agents.AgentPi, SessionID: "stable", PaneID: "%1", State: agents.StateWaiting,
		Transcript: "/tmp/pi.jsonl", Cwd: "/worktrees/sidebar",
	}
	b.Update(AgentRowsMsg{Rows: []agents.Row{row}})
	if !b.SelectionChanged(b.NavigationID(0)) {
		t.Fatal("selection did not start inspector")
	}
	now = now.Add(2 * time.Minute)
	b.Update(AgentDetailMsg{
		Identity: b.detailIdentity, Generation: b.detailGeneration,
		Data: agentdetail.Data{
			Prompt: "latest user prompt", Response: "latest assistant response", Plan: "active plan",
			Cwd: "/worktrees/sidebar/subdir", Worktree: "/worktrees/sidebar", Git: "feature +1 ~2 ?3",
		},
	})
	if b.detailState != detailReady {
		t.Fatalf("detail state = %d, want ready", b.detailState)
	}
	wantDetailLines := len(b.detailLines())
	if got := b.Expand(detailMaxLines); got != wantDetailLines || b.detailExtra != wantDetailLines {
		t.Fatalf("detail expansion = %d/%d, want %d/%d", got, b.detailExtra, wantDetailLines, wantDetailLines)
	}
	view := b.View(24)
	for _, want := range []string{"state: waiting · 2m", "prompt:", "response:", "plan:", "cwd:", "worktree:", "git:"} {
		if !strings.Contains(view, want) {
			t.Fatalf("inspector missing %q: %q", want, view)
		}
	}
	for _, pair := range [][2]string{{"state:", "prompt:"}, {"prompt:", "response:"}, {"response:", "plan:"}, {"plan:", "cwd:"}, {"cwd:", "worktree:"}, {"worktree:", "git:"}} {
		if strings.Index(view, pair[0]) >= strings.Index(view, pair[1]) {
			t.Fatalf("inspector priority %q before %q regressed: %q", pair[0], pair[1], view)
		}
	}
	if got := lineCount(view); got != b.Height() {
		t.Fatalf("View lines = %d, Height = %d", got, b.Height())
	}
	if !fitsWidth(view, 24) {
		t.Fatalf("inspector exceeded width: %q", view)
	}
}
