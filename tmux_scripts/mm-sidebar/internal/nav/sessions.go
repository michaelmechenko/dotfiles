package nav

import (
	"fmt"
	"os"
	"sort"

	"mm-sidebar/internal/tmuxio"
)

// Sessions lists every tmux session, float-first then creation order, followed
// by its non-sidebar panes in window/pane order. It uses only the immutable
// World already collected by the model.
type Sessions struct{}

func (Sessions) ID() string    { return "sessions" }
func (Sessions) Short() string { return "sess" }
func (Sessions) Title() string { return "sessions" }
func (Sessions) Context(_ Ctx, rows []Row) string {
	count := 0
	for _, row := range rows {
		if row.GroupHeading {
			count++
		}
	}
	label := itoa(count) + " sessions"
	if count == 1 {
		label = "1 session"
	}
	return label + " · cached tmux world"
}

func (s Sessions) Fetch(c Ctx) ([]Row, error) {
	home, _ := os.UserHomeDir()
	panes := c.World.Panes()
	rows := make([]Row, 0, len(c.World.Sessions())+len(panes))
	for _, session := range c.World.Sessions() {
		pane, ok := sessionPane(session, panes, c.World.Snapshot.PaneID)
		paneID, target := "", ""
		if ok {
			paneID, target = pane.PaneID, pane.Target
		}
		dot := " "
		if session.Attached {
			dot = "●"
		}
		name := safe(session.Name)
		heading := c.Theme.Text.Render(name) + " " +
			c.Theme.Muted.Render(itoa(session.Windows)+"w") + " " +
			c.Theme.Accent.Render(dot) + badge(c.Theme, session.Activity, session.Bell, session.Silence)
		state := itoa(session.Windows) + " windows"
		if session.Windows == 1 {
			state = "1 window"
		}
		if session.Attached {
			state += " · attached"
		}
		sessionFacts := []Fact{{Text: state, Tone: ToneMuted}}
		sessionFacts = append(sessionFacts, alertFacts(session.Activity, session.Bell, session.Silence)...)
		rows = append(rows, Row{

			ID: "session:" + session.ID, GroupID: session.ID, GroupHeading: true,
			SearchText: name, Lines: []string{heading}, Kind: ActionFocusPane,
			PaneID: paneID, Target: target, Pane: pane.Ref(), Actions: sessionActions(session, pane, ok),
			Presentation: Presentation{Label: name, Marker: "▸", Facts: sessionFacts, Detail: Detail{Title: "selected session", Lines: []DetailLine{{Text: name}, {Text: state, Tone: ToneMuted}}, Hints: []KeyAction{{Key: "Enter", Summary: "focus session"}, {Key: "a", Summary: "actions"}}}},
		})

		children := make([]tmuxio.PaneRow, 0, session.Windows)
		for _, candidate := range panes {
			if candidate.SessionID == session.ID && !candidate.Sidebar && candidate.PaneID != c.World.Snapshot.PaneID {
				children = append(children, candidate)
			}
		}
		sort.SliceStable(children, func(i, j int) bool {
			if children[i].WindowIndex != children[j].WindowIndex {
				return children[i].WindowIndex < children[j].WindowIndex
			}
			return children[i].PaneIndex < children[j].PaneIndex
		})
		for _, child := range children {
			identity := itoa(child.WindowIndex) + ":" + safe(child.WindowName)
			if label := safe(child.PaneLabel); label != "" {
				identity = label + " · " + identity
			}
			command := safe(child.Command)
			if command == "" {
				command = "-"
			}
			cwd := compactPath(child.CurrentPath, home)
			line := "  " + c.Theme.Text.Render(identity) + " " + c.Theme.Muted.Render(command+" · "+cwd) + badge(c.Theme, child.Activity, child.Bell, child.Silence)
			paneFacts := []Fact{{Text: command, Tone: ToneMuted}}
			paneFacts = append(paneFacts, alertFacts(child.Activity, child.Bell, child.Silence)...)
			rows = append(rows, Row{
				ID: "session-pane:" + child.PaneID, GroupID: session.ID,
				SearchText: identity + " " + command + " " + child.CurrentPath,
				Lines:      []string{line}, Kind: ActionFocusPane, PaneID: child.PaneID,
				Target: child.Target, Pane: child.Ref(), Actions: paneActions(child),
				Presentation: Presentation{Label: identity, Depth: 1, Facts: paneFacts, Detail: Detail{Title: "selected pane", Lines: []DetailLine{{Text: identity}, {Text: command, Tone: ToneMuted}, {Text: child.CurrentPath, TruncateLeft: true}}, Hints: []KeyAction{{Key: "Enter", Summary: "focus pane"}, {Key: "a", Summary: "actions"}}}},
			})
		}
	}
	return rows, nil
}

// sessionPane prefers the active pane in the active window, retaining the
// public picker fallback of the first pane when a session has no active client.
func sessionPane(session tmuxio.Session, panes []tmuxio.PaneRow, sidebarPane string) (tmuxio.PaneRow, bool) {
	var fallback tmuxio.PaneRow
	found := false
	for _, pane := range panes {
		if pane.SessionID != session.ID || pane.Sidebar || pane.PaneID == sidebarPane {
			continue
		}
		if !found {
			fallback, found = pane, true
		}
		if pane.PaneActive && pane.WindowActive {
			return pane, true
		}
	}
	return fallback, found
}

func alertFacts(activity, bell, silence bool) []Fact {
	switch {
	case bell:
		return []Fact{{Text: "!", Tone: ToneAccent}}
	case silence:
		return []Fact{{Text: "~", Tone: ToneMuted}}
	case activity:
		return []Fact{{Text: "*", Tone: ToneAccent}}
	default:
		return nil
	}
}

func itoa(n int) string { return fmt.Sprintf("%d", n) }
