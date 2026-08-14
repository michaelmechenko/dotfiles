package nav

import "mm-sidebar/internal/theme"

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

func (Windows) Fetch(c Ctx) []Row {
	return fetchFzfNav(c.Theme, "--list-windows", windowRow)
}

// windowRow: "<index:name padded> <cmd>" over "  <cwd>".
func windowRow(th theme.Theme, f []string) ([]string, bool) {
	if len(f) < 7 {
		return nil, false
	}
	wname, cmd, cwd, active := f[3], f[4], f[5], f[6]

	nameStyle := th.Text
	if active == "1" {
		nameStyle = th.Accent // the active pane of its window
	}
	first := nameStyle.Render(padTo(wname, nameCol)) + " " + th.Muted.Render(cmd)
	return []string{first, "  " + th.Muted.Render(truncLeft(cwd, cwdCol))}, true
}
