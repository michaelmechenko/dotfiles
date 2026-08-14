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
	// Field 8 (current-session flag) is deliberately not read. It used to accent
	// the name of the session this sidebar lives in, which was noise: you are
	// always in that session, so the marker never distinguished anything you
	// were choosing between. tmux-fzf-nav still emits it for other consumers.
	name, windows, attached, cwd := f[3], f[4], f[5], f[6]

	dot := " "
	if attached == "1" {
		dot = "●"
	}
	first := th.Text.Render(padTo(name, nameCol)) + " " +
		th.Muted.Render(padTo(windows+"w", metaCol)) + " " +
		th.Accent.Render(dot)
	return []string{first, "  " + th.Muted.Render(truncLeft(cwd, cwdCol))}, true
}
