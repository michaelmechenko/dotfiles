// Package nav is the sidebar's tab-switchable main navigator. Blocker attention
// and the explicit agents/activity/system views live in package blocks.
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
//	sessions / windows -> immutable tmuxio.World (keeps float-first session and
//	                      window/pane ordering without another tmux query)
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
	"mm-sidebar/internal/tmuxio"
)

// Ctx is everything a Source may need to build its rows. It is passed by value
// and must not be retained -- the model rebuilds it on every poll.
//
// A new Source that needs some other piece of state adds a field here rather
// than reaching for tmux itself, so the per-poll tmux cost stays in one place
// (the model's single batched Query).
type Ctx struct {
	Theme       theme.Theme
	Cwd         string       // the content pane's current directory
	ContentPane string       // pane id the sidebar navigates/opens into
	Root        string       // source-owned browse root
	RootPane    string       // pane from which Root was last derived
	RootPinned  bool         // source keeps Root across content-pane changes
	ShowHidden  bool         // source-owned hidden-entry display preference
	World       tmuxio.World // immutable global state for world-fed sources
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
	// Fetch builds the rows, in display order. Typed errors let the model retain
	// last-good rows while the next gated poll retries transient failures.
	Fetch(Ctx) ([]Row, error)
}

// Ascender is the optional half of Source: a tab with a navigable hierarchy,
// where Backspace should move up a level. Only filetree implements it, which is
// what keeps the model from special-casing one tab by name.
// FetchError identifies a source failure without treating an empty successful
// result as an error. It is intentionally typed so callers can retain prior
// rows and retry without inventing a second source-specific error channel.
type FetchError struct {
	SourceID string
	Err      error
}

func (e *FetchError) Error() string { return e.SourceID + ": " + e.Err.Error() }
func (e *FetchError) Unwrap() error { return e.Err }

func FetchFailure(source Source, err error) error {
	if err == nil {
		return nil
	}
	return &FetchError{SourceID: source.ID(), Err: err}
}

// RootSynchronizer is an optional source lifecycle hook for sources whose
// context has a browse root. It keeps root derivation source-owned: the model
// supplies only generic state and never recognizes a source by ID.
type RootSynchronizer interface {
	// SyncRoot returns the source's current root and the pane it is associated
	// with. It is called from the refresh command, after the current content cwd
	// is known. A pinned root may intentionally retain an older RootPane.
	SyncRoot(Ctx) (root, rootPane string)
}

// SourceController is an optional key-control surface. It makes a source's
// local controls available without adding source-name branches to model.go.
type SourceController interface {
	HandleSourceKey(key string, c Ctx) (SourceControl, bool)
}

// SourceControl is a state update returned by SourceController. A zero value
// changes nothing; Refresh asks the model to refetch after applying it.
type SourceControl struct {
	Root, RootPane string
	SetRoot        bool
	RootPinned     bool
	SetRootPinned  bool
	ShowHidden     bool
	SetShowHidden  bool
	Refresh        bool
}

// Watchable is the optional filesystem-watch half of Source. The model owns the
// watcher lifetime, while the source decides whether it needs a root watched.
type Watchable interface {
	WatchRoot(Ctx) string
}

// FetchKeyer is an optional invalidation surface for a source whose expensive
// Fetch does not depend on the complete tmux World fingerprint. Projects uses
// it so bell/activity/session changes cannot turn the 2-second tmux refresh into
// recurring Git work.
type FetchKeyer interface {
	FetchKey(Ctx) string
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
	Projects{},
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
// Lines is a slice because sources may choose multi-line rows. Compact grouped
// sources use one line per heading/child; windows retain a second cwd line.
type Row struct {
	// ID is a stable source-local identity for future selection retention.
	// SearchText is the unstyled searchable representation for future filtering.
	// Neither changes current rendering or action behavior.
	ID         string
	SearchText string
	Lines      []string
	Kind       ActionKind
	PaneID     string         // ActionFocusPane
	Target     string         // ActionFocusPane
	Pane       tmuxio.PaneRef // stable target for focus actions
	Path       string         // ActionOpenDir / ActionOpenFile / ActionEditFile
	// CommonDir carries a project worktree's expected canonical Git identity.
	// Empty preserves generic filetree and scratch directory behavior.
	CommonDir string
	// GroupID joins an inert heading and its child rows. Filtering retains a
	// matching child's heading so grouped sources never lose their context.
	GroupID      string
	GroupHeading bool
	// Collapsible headings start closed. ExpandedLines lets the generic model
	// render local disclosure state without scraping or restyling ANSI output.
	Collapsible   bool
	ExpandedLines []string
	// Actions are source-owned descriptors for the generic a/: palette.
	Actions []ContextAction
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
