package nav

import (
	"os"
	"sort"

	"mm-sidebar/internal/tmuxio"
)

// Windows lists the current session's PANES, one row each -- a 3-pane window
// produces three rows sharing a sid:win target. It is user-facing as "panes"
// for that reason; only the ID still says "windows".
type Windows struct{}

// ID stays "windows" deliberately. It is the value persisted in the
// @sidebar_source window option, and SourceByID falls back to the first source
// on an unknown id -- so renaming it would silently reset every window's saved
// tab to "sessions" on upgrade. The label is cosmetic; the id is state.
func (Windows) ID() string    { return "windows" }
func (Windows) Short() string { return "pane" }
func (Windows) Title() string { return "panes" }
func (Windows) Context(_ Ctx, rows []Row) string {
	label := itoa(len(rows)) + " panes"
	if len(rows) == 1 {
		label = "1 pane"
	}
	return label + " · current session"
}

func (w Windows) Fetch(c Ctx) ([]Row, error) {
	home, _ := os.UserHomeDir()
	panes := c.World.Panes()
	current := c.World.Snapshot.SessionID
	filtered := make([]tmuxio.PaneRow, 0, len(panes))
	for _, pane := range panes {
		// The sidebar pane is lifecycle infrastructure, not a navigation target.
		// Excluding it also prevents the generic kill action from bypassing the
		// canonical close owner and stranding saved layout state.
		if pane.SessionID == current && !pane.Sidebar {
			filtered = append(filtered, pane)
		}
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		if filtered[i].WindowIndex != filtered[j].WindowIndex {
			return filtered[i].WindowIndex < filtered[j].WindowIndex
		}
		return filtered[i].PaneIndex < filtered[j].PaneIndex
	})
	rows := make([]Row, 0, len(filtered))
	for _, pane := range filtered {
		name, cmd, cwd := itoa(pane.WindowIndex)+":"+safe(pane.WindowName), safe(pane.Command), compactPath(pane.CurrentPath, home)
		identity := name
		if label := safe(pane.PaneLabel); label != "" {
			identity = label + " · " + name
		}
		if cmd == "" {
			cmd = "-"
		}
		nameStyle := c.Theme.Text
		if pane.PaneActive {
			nameStyle = c.Theme.Accent
		}
		first := nameStyle.Render(padTo(identity, nameCol)) + " " + c.Theme.Muted.Render(cmd) + badge(c.Theme, pane.Activity, pane.Bell, pane.Silence)
		facts := []Fact{{Text: cmd, Tone: ToneMuted}}
		facts = append(facts, alertFacts(pane.Activity, pane.Bell, pane.Silence)...)
		labelTone := ToneText
		if pane.PaneActive {
			labelTone = ToneAccent
		}
		rows = append(rows, Row{
			ID: "pane:" + pane.PaneID, SearchText: identity + " " + cmd + " " + cwd,
			Lines: []string{first, "  " + c.Theme.Muted.Render(truncLeft(cwd, cwdCol))},
			Kind:  ActionFocusPane, PaneID: pane.PaneID, Target: pane.Target, Pane: pane.Ref(),
			Actions:      paneActions(pane),
			Presentation: Presentation{Label: identity, Tone: labelTone, Facts: facts, Detail: Detail{Title: "selected pane", Lines: []DetailLine{{Text: identity}, {Text: cmd, Tone: ToneMuted}, {Text: pane.CurrentPath, TruncateLeft: true}}, Hints: []KeyAction{{Key: "Enter", Summary: "focus pane"}, {Key: "a", Summary: "actions"}}}},
		})
	}
	return rows, nil
}
