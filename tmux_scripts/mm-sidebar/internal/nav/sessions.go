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
		rows = append(rows, Row{
			ID: "session:" + session.ID, GroupID: session.ID, GroupHeading: true,
			SearchText: name, Lines: []string{heading}, Kind: ActionFocusPane,
			PaneID: paneID, Target: target, Pane: pane.Ref(), Actions: sessionActions(session, pane, ok),
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
			rows = append(rows, Row{
				ID: "session-pane:" + child.PaneID, GroupID: session.ID,
				SearchText: identity + " " + command + " " + child.CurrentPath,
				Lines:      []string{line}, Kind: ActionFocusPane, PaneID: child.PaneID,
				Target: child.Target, Pane: child.Ref(), Actions: paneActions(child),
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

func itoa(n int) string { return fmt.Sprintf("%d", n) }
