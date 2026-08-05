package nav

import "mm-sidebar/internal/theme"

// Sessions lists every tmux session, float-first then creation order.
type Sessions struct{}

func (Sessions) ID() string    { return "sessions" }
func (Sessions) Short() string { return "sess" }
func (Sessions) Title() string { return "sessions" }

func (Sessions) Fetch(c Ctx) []Row {
	return fetchFzfNav(c.Theme, "--list-sessions", sessionRow)
}

// sessionRow: "<name padded> <Nw> <●>" over "  <cwd>". The attached dot and the
// window count are session-level facts the old padded display column had no room
// for.
func sessionRow(th theme.Theme, f []string) ([]string, bool) {
	if len(f) < 8 {
		return nil, false
	}
	name, windows, attached, cwd, current := f[3], f[4], f[5], f[6], f[7]

	dot := " "
	if attached == "1" {
		dot = "●"
	}
	nameStyle := th.Text
	if current == "1" {
		nameStyle = th.Accent // the session this sidebar lives in
	}
	first := nameStyle.Render(padTo(name, nameCol)) + " " +
		th.Muted.Render(padTo(windows+"w", metaCol)) + " " +
		th.Accent.Render(dot)
	return []string{first, "  " + th.Muted.Render(truncLeft(cwd, cwdCol))}, true
}
