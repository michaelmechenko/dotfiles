package nav

import "mm-sidebar/internal/theme"

// Windows lists the current session's panes.
type Windows struct{}

func (Windows) ID() string    { return "windows" }
func (Windows) Short() string { return "win" }
func (Windows) Title() string { return "windows" }

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
