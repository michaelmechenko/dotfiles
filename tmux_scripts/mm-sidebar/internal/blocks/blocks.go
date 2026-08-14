// Package blocks holds the sidebar's docked blocks: fixed-height, read-only
// glances rendered below the flexible navigator and visible regardless of which
// navigator tab is active.
//
// The layout is a stack: header -> navigator -> blocks, in Order. That array is
// the whole "which blocks, in what order" configuration, and it doubles as the
// degradation priority -- on a short pane the model drops blocks from the END
// of the list first, protecting the primary navigator instead of squeezing
// everything unusably thin.
//
// Adding a block is one type implementing Block plus one entry in the model's
// block slice. (The bash version needed a hand-written case statement in three
// separate dispatch functions, because macOS's /bin/bash 3.2 has neither
// associative arrays nor namerefs to look up "fetch_$id". An interface makes
// that whole workaround moot.)
package blocks

import (
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
)

// Block is a docked region of the sidebar.
//
// Blocks have no keys of their own and never hold the cursor: they are glances,
// not pickers. Keyboard-driven agent switching lives on the M-b cross-session
// menu (tmux-claude-menu), which already covers it -- agents_glance deliberately
// doesn't duplicate that picker.
//
// A block may still accept a MOUSE click by implementing Clickable, which is not
// the same thing: a click is an unambiguous point at one row, so it needs no
// cursor to live in the block and no traversal path into it.
type Block interface {
	// ID is the block's stable name, used in the layout and in logs.
	ID() string
	// Interval is how often Fetch should run. Blocks with genuinely
	// independent cadences (system load vs. agent liveness) declare their own
	// rather than sharing one global dirty flag.
	Interval() time.Duration
	// Fetch is the expensive half: it returns a Cmd that gathers data off the
	// input path and delivers it as a message.
	Fetch() tea.Cmd
	// Update absorbs this block's own message type and ignores everything else.
	Update(tea.Msg)
	// Height is the block's current desired row count, computed from already
	// cached state (never fetches), so the layout can reserve space for it.
	Height() int
	// View renders exactly Height() lines, each at most width columns.
	View(width int) string
}

// BlockMsg marks a message owned by a docked block, so the model can broadcast
// it to every block without naming each concrete type.
//
// Without this the model's Update had one type-switch arm per block message, and
// a new block's message fell through to the default arm -- its Update was never
// called, so it fetched, published, and rendered nothing, silently. That made
// the "adding a block is one type plus one Factories entry" contract false for
// any block that carries its own data. Implement this on every block message.
//
// The method is EXPORTED on purpose. An unexported marker would seal the
// interface to this package, so a block living in a sibling package
// (internal/<name>/, which tmux-sidebar-build's glob already covers) could never
// satisfy it -- reintroducing the same "your message goes nowhere" failure one
// package over. A test in package main caught exactly that.
type BlockMsg interface{ IsBlockMsg() }

// Expandable is the optional half of Block: a block that is holding data it
// isn't showing, and can show more of it when the layout has space going spare.
//
// This exists because the sidebar's real problem is a pane much taller than its
// content. Rather than pad the gap with nothing, the layout offers it to blocks
// that are truncating -- agents_glance replacing "+N more" with the actual rows.
// A block that always shows everything simply doesn't implement this.
type Expandable interface {
	// SetExtra resets the granted allowance. The layout calls this every frame
	// before measuring, so a grant never accumulates across renders.
	SetExtra(n int)
	// Expand offers up to n extra lines and returns how many were taken (0 if
	// the block has nothing hidden). The return value is the block's Height
	// delta, so the layout can subtract it from the remaining slack.
	Expand(n int) int
}

// Clickable is the optional mouse half of Block: a block with actionable rows.
//
// The block hit-tests ITSELF rather than exposing its rows positionally, so its
// truncation and ordering stay private and the model needs no accessor. The
// model's only job is knowing which lines belong to which block, which it records
// while rendering (see model.go's blockLines) rather than recomputing from the
// layout -- the same reason the navigator's lineRow table exists.
type Clickable interface {
	// OnClick receives the 0-based line offset WITHIN this block's own rendered
	// region: 0 is its label row. Returns nil when that line isn't actionable
	// (the label, a placeholder, a "+N more" counter).
	OnClick(line int) tea.Cmd
}

// label renders a block's title row in the same "▸ name" idiom the header's
// active-tab subtitle uses, so each block is visually delimited without
// spending a row on a blank divider.
func label(style styler, text string) string {
	return style.Render("▸ " + text)
}

// styler is the subset of lipgloss.Style the blocks need, kept as an interface
// so this file doesn't have to import lipgloss just for a type name.
type styler interface {
	Render(...string) string
}

// clip truncates a possibly-styled string to width display cells. It is
// ANSI-aware and width-aware (wide CJK glyphs and nerd-font icons count as the
// cells they actually occupy), unlike the bash version's byte/rune length check
// on an ANSI-stripped copy, which misaligned the fixed-width frame on any such
// glyph and dropped color past the cut.
func clip(s string, width int) string {
	if width <= 0 {
		return ""
	}
	if ansi.StringWidth(s) <= width {
		return s
	}
	return ansi.Truncate(s, width, "…")
}
