// Package nav is the sidebar's navigator: the flexible, tab-switchable top
// region that owns the cursor and the Enter action. The docked blocks below it
// are read-only glances and live in package blocks.
//
// A tab is a Source in the Sources registry. Everything tab-shaped derives from
// that one slice -- the tab strip, the 1..N number keys, Tab/S-Tab cycling, and
// the persisted @sidebar_source value -- so ADDING A TAB IS ONE TYPE PLUS ONE
// SLICE ENTRY and touches no other file. See mm-sidebar.md's "Extending" section
// for the recipe.
//
// Data sources are deliberately reused rather than reimplemented, so the sidebar
// can't drift from the pickers that share them:
//
//	sessions / windows -> tmux-fzf-nav --list-sessions / --list-windows
//	                      (keeps the float-first, creation-ordered session
//	                       sequence every other surface in this repo presents)
//	filetree           -> os.ReadDir, two levels
//	scratch            -> ~/.config/tmux_scratch/{global,<slug>}.md
//	file opens         -> tmux-open-target (same nvim-split placement as
//	                      extrakto / tmux-fzf-url / shell Ctrl-T)
package nav

import (
	"os"
	"os/exec"
	"path/filepath"

	"mm-sidebar/internal/theme"
)

// Ctx is everything a Source may need to build its rows. It is passed by value
// and must not be retained -- the model rebuilds it on every poll.
//
// A new Source that needs some other piece of state adds a field here rather
// than reaching for tmux itself, so the per-poll tmux cost stays in one place
// (the model's single batched Query).
type Ctx struct {
	Theme       theme.Theme
	Cwd         string // the content pane's current directory
	ContentPane string // pane id the sidebar navigates/opens into
	Root        string // filetree browse root (Ascender moves this)
}

// Source is one navigator tab.
//
// Fetch must be safe to call off the input path (the model runs it inside a
// tea.Cmd) and should return rows already styled via Ctx.Theme, because the
// model only clips them to width.
type Source interface {
	// ID is the stable, persisted @sidebar_source value. Changing an existing
	// one silently resets that window's remembered tab.
	ID() string
	// Short is the tab-strip chip. Keep it to 3-4 cells; the pane is 36 columns
	// and the full names wrapped.
	Short() string
	// Title is the "▸ <title>" subtitle under the strip.
	Title() string
	// Fetch builds the rows, in display order.
	Fetch(Ctx) []Row
}

// Ascender is the optional half of Source: a tab with a navigable hierarchy,
// where Backspace should move up a level. Only filetree implements it, which is
// what keeps the model from special-casing one tab by name.
type Ascender interface {
	// Up returns the new Ctx.Root, or ok=false when already at the top.
	Up(Ctx) (root string, ok bool)
}

// Sources is every tab, in display order. This slice IS the tab configuration:
// the order is the 1..N key order and the strip order.
//
// Keep sessions first -- tmux-sidebar-toggle seeds @sidebar_source with
// "sessions" on a window's first open, and DefaultSource is the fallback for an
// unrecognized value.
var Sources = []Source{
	Sessions{},
	Windows{},
	Filetree{},
	Scratch{},
}

// DefaultSource is the index used when @sidebar_source is empty or unknown.
const DefaultSource = 0

// SourceByID maps a persisted @sidebar_source value back to its index,
// falling back to DefaultSource. Replaces the old ParseTab.
func SourceByID(id string) int {
	for i, s := range Sources {
		if s.ID() == id {
			return i
		}
	}
	return DefaultSource
}

// ActionKind is what Enter on a row does.
type ActionKind int

const (
	// ActionNone: a row that isn't actionable.
	ActionNone ActionKind = iota
	// ActionFocusPane: switch-client + select-pane (sessions / windows).
	ActionFocusPane
	// ActionOpenDir: split a new pane in the content area at Path.
	ActionOpenDir
	// ActionOpenFile: hand Path to tmux-open-target (nvim split).
	ActionOpenFile
	// ActionEditFile: suspend the TUI and edit Path in this pane.
	ActionEditFile
)

// Row is one navigator entry: one or more pre-styled display lines plus its
// action payload.
//
// Lines is a slice, not a single string, because sessions and windows render as
// two lines (identity on the first, cwd on the second). Four columns of
// tmux-fzf-nav's popup-width display simply do not fit a 36-column pane on one
// line -- squeezing the padding fixed the alignment but not the
// over-subscription, and the cwd (the most useful field for telling two
// same-named sessions apart) was the thing that truncated away. Filetree and
// scratch rows stay single-line; the render loop handles both uniformly.
type Row struct {
	Lines  []string
	Kind   ActionKind
	PaneID string // ActionFocusPane
	Target string // ActionFocusPane
	Path   string // ActionOpenDir / ActionOpenFile / ActionEditFile
}

// OpenFileCmd builds the tmux-open-target invocation for a file row. The origin
// pane is passed through TMUX_OPEN_PANE, the same channel extrakto and
// tmux-fzf-url use, so the nvim split lands next to the content pane rather
// than next to the sidebar.
func OpenFileCmd(contentPane, path string) *exec.Cmd {
	cmd := exec.Command(openTargetPath(), path)
	cmd.Env = append(os.Environ(), "TMUX_OPEN_PANE="+contentPane)
	return cmd
}

func configDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.Getenv("HOME")
	}
	return filepath.Join(home, ".config")
}

func scriptPath(name string) string {
	return filepath.Join(configDir(), "tmux_scripts", name)
}

func fzfNavPath() string     { return scriptPath("tmux-fzf-nav") }
func openTargetPath() string { return scriptPath("tmux-open-target") }
