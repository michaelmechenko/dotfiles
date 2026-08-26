package nav

import (
	"fmt"
	"os"

	"mm-sidebar/internal/tmuxio"
)

// Sessions lists every tmux session, float-first then creation order.
type Sessions struct{}

func (Sessions) ID() string    { return "sessions" }
func (Sessions) Short() string { return "sess" }
func (Sessions) Title() string { return "sessions" }

func (s Sessions) Fetch(c Ctx) ([]Row, error) {
	home, _ := os.UserHomeDir()
	panes := c.World.Panes()
	rows := make([]Row, 0, len(c.World.Sessions()))
	for _, session := range c.World.Sessions() {
		pane, ok := sessionPane(session, panes, c.World.Snapshot.PaneID)
		cwd := "-"
		paneID, target := "", ""
		if ok {
			cwd, paneID = compactPath(pane.CurrentPath, home), pane.PaneID
			target = pane.SessionID + ":" + itoa(pane.WindowIndex)
		}
		dot := " "
		if session.Attached {
			dot = "●"
		}
		name := safe(session.Name)
		first := c.Theme.Text.Render(padTo(name, nameCol)) + " " +
			c.Theme.Muted.Render(padTo(itoa(session.Windows)+"w", metaCol)) + " " +
			c.Theme.Accent.Render(dot) + badge(c.Theme, session.Activity, session.Bell, session.Silence)
		rows = append(rows, Row{
			ID: "session:" + session.ID, SearchText: name + " " + cwd,
			Lines: []string{first, "  " + c.Theme.Muted.Render(truncLeft(cwd, cwdCol))},
			Kind:  ActionFocusPane, PaneID: paneID, Target: target, Pane: pane.Ref(),
			Actions: sessionActions(session, pane, ok),
		})
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
