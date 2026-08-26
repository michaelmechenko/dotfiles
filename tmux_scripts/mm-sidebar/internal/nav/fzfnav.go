package nav

import (
	"strings"

	"github.com/charmbracelet/x/ansi"

	"mm-sidebar/internal/display"
	"mm-sidebar/internal/theme"
)

// This file holds the sessions/windows formatting helpers. The sidebar reads
// those rows directly from tmuxio.World; tmux-fzf-nav remains the public picker
// implementation and its list modes stay byte-compatible for shell callers.

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

func safe(s string) string { return display.Sanitize(s) }

func compactPath(path, home string) string {
	if home != "" && (path == home || strings.HasPrefix(path, home+"/")) {
		path = "~" + strings.TrimPrefix(path, home)
	}
	return safe(path)
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
// badge is intentionally informational: tmux alert state is folded into the
// shared World snapshot and never changes selection or focus. Bell wins over
// silence, then ordinary activity, so each row stays compact at sidebar width.
func badge(th theme.Theme, activity, bell, silence bool) string {
	switch {
	case bell:
		return " " + th.Accent.Render("!")
	case silence:
		return " " + th.Muted.Render("~")
	case activity:
		return " " + th.Accent.Render("*")
	default:
		return ""
	}
}

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
