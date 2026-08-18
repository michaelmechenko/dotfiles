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
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/charmbracelet/lipgloss"

	"mm-sidebar/internal/tmuxio"
)

// Theme holds one lipgloss style per semantic role used by the sidebar.
type Theme struct {
	// Muted: text-muted role (@color-text-muted) -- inactive tabs, idle agents,
	// help text, secondary labels.
	Muted lipgloss.Style
	// Accent: accent-secondary lavender (@color-accent-secondary) -- active tab,
	// block labels, cursor glyph, directory rows.
	Accent lipgloss.Style
	// Text: active foreground (@color-accent-highlight) -- ordinary row text.
	Text lipgloss.Style
	// Urgent: accent-primary rose (@color-accent-primary) -- awaiting-permission/waiting.
	Urgent lipgloss.Style
	// Busy: accent-tertiary dusty pink (@color-accent-tertiary) -- thinking.
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

// roles maps each semantic @color-* option to its last-resort fallback, and is
// also the batch's name list. Keep it as the single enumeration of the palette so
// a new role can't be added to one place and forgotten in the other. The values
// here are only reached when the generated active-palette fallback
// (theme/active/sidebar/fallback.json) is also missing — i.e. before the first
// `theme build`.
var roles = map[string]string{
	"@color-canvas":           "#100E11",
	"@color-text-muted":       "#656a80",
	"@color-accent-secondary": "#aeaed1",
	"@color-accent-highlight": "#bebedb",
	"@color-accent-primary":   "#d8647e",
	"@color-accent-tertiary":  "#bb9dbd",
	"@color-divider":          "#383848",
}

// loadFallback reads the generated active-palette fallback so the binary still
// renders the active theme when run outside a tmux server (e.g. `mm-sidebar agents`
// from a plain shell). Returns nil when the bundle has not been built yet.
func loadFallback() map[string]string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(home, ".config", "theme", "active", "sidebar", "fallback.json"))
	if err != nil {
		return nil
	}
	var m map[string]string
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	return m
}

// Load reads the @color-* options once. Called at startup; the palette is not
// re-read on the fly (a tmux.conf reload plus a sidebar re-toggle picks it up),
// matching how the bash dispatcher read it once into shell variables.
//
// ONE tmux fork for the whole palette, not one per role: measured at 20ms per
// fork, the per-role version cost 110ms of blank pane on every sidebar open,
// before Bubble Tea started. See tmuxio.GlobalOpts.
func Load() Theme {
	names := make([]string, 0, len(roles))
	for n := range roles {
		names = append(names, n)
	}
	got := tmuxio.GlobalOpts(names...)
	fallback := loadFallback()
	opt := func(name string) string {
		if v := got[name]; v != "" {
			return v
		}
		if fallback != nil {
			if v := fallback[name]; v != "" {
				return v
			}
		}
		return roles[name]
	}

	canvas := opt("@color-canvas")
	muted := opt("@color-text-muted")
	accent := opt("@color-accent-secondary")
	text := opt("@color-accent-highlight")
	rose := opt("@color-accent-primary")
	pink := opt("@color-accent-tertiary")
	divider := opt("@color-divider")

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
