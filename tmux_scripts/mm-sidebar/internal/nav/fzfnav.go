package nav

import (
	"os/exec"
	"strings"

	"github.com/charmbracelet/x/ansi"

	"mm-sidebar/internal/theme"
)

// This file holds what the sessions and windows sources share: the tmux-fzf-nav
// invocation, its TSV contract, and the row-formatting helpers.
//
// Reusing that script is what keeps the sidebar's session order identical to the
// M-w / M-s pickers: float first, then creation order -- a repo-wide invariant.
// Its field-3 *display* column is space-padded to align columns in a wide fzf
// popup and does not fit a 36-column pane, so the sidebar reads the UNPADDED
// fields 4+ that the same script also emits (added for exactly this) and formats
// its own two-line rows. Fields 1-3 are untouched, so the fzf pickers are
// unaffected.
//
//	--list-sessions: pane, target, display, sname, windows, attached, cwd, current
//	--list-windows:  pane, target, display, win:name, cmd, cwd, active

// Column widths for the two-line rows' first line. Fixed rather than derived
// from the pane width so a row can be built without knowing it; the model clips
// to the real width on render.
const (
	nameCol = 14 // session name / window index:name
	metaCol = 4  // "12w" window count
)

// cwdCol is the cells a cwd line has after the 2-cell cursor gutter and its own
// 2-space indent, at the default 36-column width.
const cwdCol = 32

// rowBuilder turns one TSV record into display lines. ok=false means the record
// lacked the unpadded fields, so the caller falls back to the padded column.
type rowBuilder func(theme.Theme, []string) ([]string, bool)

func fetchFzfNav(th theme.Theme, mode string, build rowBuilder) []Row {
	out, err := exec.Command(fzfNavPath(), mode).Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimRight(string(out), "\n"), "\n")
	if len(lines) <= 1 {
		return nil
	}
	rows := make([]Row, 0, len(lines)-1)
	for _, line := range lines[1:] { // drop the header row
		f := strings.Split(line, "\t")
		if len(f) < 3 || f[0] == "" {
			continue
		}
		display, ok := build(th, f)
		if !ok {
			// The script predates the unpadded fields: fall back to the padded
			// display column with its runs of spaces collapsed.
			display = []string{th.Text.Render(squeezeSpaces(f[2]))}
		}
		rows = append(rows, Row{
			Lines:  display,
			Kind:   ActionFocusPane,
			PaneID: f[0],
			Target: f[1],
		})
	}
	return rows
}

// padTo pads (or truncates) to exactly w display cells, counting wide glyphs as
// the cells they occupy.
func padTo(s string, w int) string {
	if n := ansi.StringWidth(s); n < w {
		return s + strings.Repeat(" ", w-n)
	}
	return ansi.Truncate(s, w, "…")
}

// truncLeft keeps the TAIL of a path, dropping leading components. A path is
// most identifying at its end -- right-truncating
// "~/.config/tmux_scripts/mm-sidebar" to 32 cells yields
// "~/.config/tmux_scripts/mm-sideb…", which is exactly the part that doesn't
// distinguish it from its siblings.
func truncLeft(s string, w int) string {
	if ansi.StringWidth(s) <= w {
		return s
	}
	r := []rune(s)
	for i := 1; i <= len(r); i++ {
		if cand := "…" + string(r[i:]); ansi.StringWidth(cand) <= w {
			return cand
		}
	}
	return s
}

// squeezeSpaces collapses runs of two or more spaces into one and trims the
// result -- undoing tmux-fzf-nav's column padding. Only reached by the
// compatibility fallback above now that the script emits unpadded fields.
func squeezeSpaces(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	prevSpace := false
	for _, r := range s {
		if r == ' ' {
			if !prevSpace {
				b.WriteRune(r)
			}
			prevSpace = true
			continue
		}
		prevSpace = false
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}
