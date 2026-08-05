// Package theme resolves the sidebar's colors from the same tmux @color-*
// user options every other surface in this repo keys off, so the sidebar
// inherits palette changes without carrying its own hex.
//
// Palette discipline (see COLORS.md): no new hex is introduced here. The
// fallbacks below exist only so the binary still renders if it is run outside
// a tmux server (e.g. `mm-sidebar agents --tsv` from a plain shell);
// they duplicate the tmux.conf values rather than inventing colors.
package theme

import (
	"github.com/charmbracelet/lipgloss"

	"mm-sidebar/internal/tmuxio"
)

// Theme holds one lipgloss style per semantic role used by the sidebar.
type Theme struct {
	// Muted: text-muted role (@color-inactive) -- inactive tabs, idle agents,
	// help text, secondary labels.
	Muted lipgloss.Style
	// Accent: accent-secondary lavender (@color-lavender2) -- active tab,
	// block labels, cursor glyph, directory rows.
	Accent lipgloss.Style
	// Text: active foreground (@color-active) -- ordinary row text.
	Text lipgloss.Style
	// Urgent: accent-primary rose (@color-rose) -- awaiting-permission/waiting.
	Urgent lipgloss.Style
	// Busy: accent-tertiary dusty pink (@color-dusty_pink) -- thinking.
	Busy lipgloss.Style
	// Divider: divider-subtle (@color-divider) -- the horizontal rules between
	// the navigator and each docked block, and the unfilled gauge track.
	Divider lipgloss.Style
	// ActiveTab: the selected tab chip -- dark canvas text on an accent fill.
	//
	// Deliberately NOT reverse video. Reverse would swap in whatever the terminal
	// considers its default background, which COLORS.md already records rendering
	// as a light gray (the reason pi's moor pager uses --statusbar=plain over the
	// default `inverse`). Setting both halves explicitly is also the convention
	// COLORS.md documents for an active accent block: nvim's lualine status block
	// is canvas fg on a per-mode accent bg, bold.
	ActiveTab lipgloss.Style
}

// Load reads the @color-* options once. Called at startup; the palette is not
// re-read on the fly (a tmux.conf reload plus a sidebar re-toggle picks it up),
// matching how the bash dispatcher read it once into shell variables.
func Load() Theme {
	canvas := opt("@color-canvas", "#100E11")
	muted := opt("@color-inactive", "#656a80")
	accent := opt("@color-lavender2", "#aeaed1")
	text := opt("@color-active", "#bebedb")
	rose := opt("@color-rose", "#d8647e")
	pink := opt("@color-dusty_pink", "#bb9dbd")
	divider := opt("@color-divider", "#383848")

	return Theme{
		Muted:   lipgloss.NewStyle().Foreground(lipgloss.Color(muted)),
		Accent:  lipgloss.NewStyle().Foreground(lipgloss.Color(accent)),
		Text:    lipgloss.NewStyle().Foreground(lipgloss.Color(text)),
		Urgent:  lipgloss.NewStyle().Foreground(lipgloss.Color(rose)),
		Busy:    lipgloss.NewStyle().Foreground(lipgloss.Color(pink)),
		Divider: lipgloss.NewStyle().Foreground(lipgloss.Color(divider)),
		ActiveTab: lipgloss.NewStyle().
			Foreground(lipgloss.Color(canvas)).
			Background(lipgloss.Color(accent)).
			Bold(true),
	}
}

func opt(name, fallback string) string {
	if v := tmuxio.ShowGlobalOpt(name); v != "" {
		return v
	}
	return fallback
}
