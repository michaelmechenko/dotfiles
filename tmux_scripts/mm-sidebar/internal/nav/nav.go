// Package nav is the sidebar's navigator: the flexible, tab-switchable top
// region (sessions / windows / filetree / scratch) that owns the cursor and the
// Enter action. The docked blocks below it are read-only glances and live in
// package blocks.
//
// Data sources are deliberately reused rather than reimplemented, so the
// sidebar can't drift from the pickers that share them:
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
	"sort"
	"strings"

	"github.com/charmbracelet/x/ansi"

	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
)

// Tab identifies a navigator source. Order is the display order and the 1-4
// key order; Tabs is the single list to extend when adding one.
type Tab int

const (
	TabSessions Tab = iota
	TabWindows
	TabFiletree
	TabScratch
)

// Tabs is every tab, in display order.
var Tabs = []Tab{TabSessions, TabWindows, TabFiletree, TabScratch}

// Short is the tab-strip label. Kept to 3-4 chars because the whole sidebar is
// 36 columns and the full names wrapped.
func (t Tab) Short() string {
	switch t {
	case TabSessions:
		return "sess"
	case TabWindows:
		return "win"
	case TabFiletree:
		return "tree"
	case TabScratch:
		return "scr"
	}
	return "?"
}

// Name is the persisted @sidebar_source value and the subtitle text.
func (t Tab) Name() string {
	switch t {
	case TabSessions:
		return "sessions"
	case TabWindows:
		return "windows"
	case TabFiletree:
		return "filetree"
	case TabScratch:
		return "scratch"
	}
	return "unknown"
}

// ParseTab maps a persisted @sidebar_source value back to a Tab, defaulting to
// sessions (the documented first-open default) for anything unrecognized.
func ParseTab(s string) Tab {
	for _, t := range Tabs {
		if t.Name() == s {
			return t
		}
	}
	return TabSessions
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

// FetchSessions and FetchWindows shell out to tmux-fzf-nav's list modes.
//
// Reusing the script is what keeps the sidebar's session order identical to the
// M-w / M-s pickers (float first, then creation order -- a repo-wide invariant).
// Its field-3 *display* column, though, is space-padded to align columns in a
// wide fzf popup and does not fit here, so the sidebar reads the UNPADDED
// fields 4+ that the same script also emits (added for exactly this) and
// formats its own two-line rows. Fields 1-3 are untouched, so the fzf pickers
// are unaffected.
//
// Sessions field layout: pane, target, display, sname, windows, attached, cwd,
// current. Windows: pane, target, display, win:name, cmd, cwd, active.
func FetchSessions(th theme.Theme) []Row {
	return fetchFzfNav(th, "--list-sessions", sessionRow)
}

// FetchWindows lists the current session's panes.
func FetchWindows(th theme.Theme) []Row {
	return fetchFzfNav(th, "--list-windows", windowRow)
}

// Column widths for the two-line rows' first line. Fixed rather than derived
// from the pane width so a row can be built without knowing it; the model clips
// to the real width on render.
const (
	nameCol = 14 // session name / window index:name
	metaCol = 4  // "12w" window count
)

func fetchFzfNav(th theme.Theme, mode string, build func(theme.Theme, []string) ([]string, bool)) []Row {
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

// sessionRow: "<name padded> <Nw> <●>" over "  <cwd>". The attached dot and the
// window count are session-level facts the old display column had no room for.
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

// padTo pads (or truncates) to exactly w display cells, counting wide glyphs as
// the cells they occupy.
func padTo(s string, w int) string {
	if n := ansi.StringWidth(s); n < w {
		return s + strings.Repeat(" ", w-n)
	}
	return ansi.Truncate(s, w, "…")
}

// cwdCol is the cells a cwd line has after the 2-cell cursor gutter and its own
// 2-space indent, at the default 36-column width.
const cwdCol = 32

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

// FetchFiletree walks root two levels deep: directories before files at each
// level, second level indented two spaces.
//
// Every row carries its real absolute path from the directory read itself.
// There is no glyph-stripping or path reconstruction from a decorated display
// string -- an earlier `eza --tree --icons` version stripped tree glyphs to
// recover paths and silently resolved every row to the tree root, so
// Enter-on-a-nested-directory opened a pane in the wrong place.
func FetchFiletree(th theme.Theme, root string) []Row {
	dirs, files := readSplit(root)
	rows := make([]Row, 0, len(dirs)+len(files))
	for _, d := range dirs {
		rows = append(rows, dirRow(th, d, 0))
		subDirs, subFiles := readSplit(d)
		for _, c := range subDirs {
			rows = append(rows, dirRow(th, c, 1))
		}
		for _, c := range subFiles {
			rows = append(rows, fileRow(th, c, 1))
		}
	}
	for _, f := range files {
		rows = append(rows, fileRow(th, f, 0))
	}
	return rows
}

func dirRow(th theme.Theme, path string, depth int) Row {
	return Row{
		Lines: []string{indent(depth) + th.Accent.Render(filepath.Base(path)+"/")},
		Kind:  ActionOpenDir,
		Path:  path,
	}
}

func fileRow(th theme.Theme, path string, depth int) Row {
	return Row{
		Lines: []string{indent(depth) + th.Text.Render(filepath.Base(path))},
		Kind:  ActionOpenFile,
		Path:  path,
	}
}

func indent(depth int) string { return strings.Repeat("  ", depth) }

// readSplit returns a directory's immediate children, split into directories and
// files, each sorted by name. Symlinks are classified by their target so a
// symlinked directory (this repo has several) still expands.
func readSplit(dir string) (dirs, files []string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil
	}
	for _, e := range entries {
		path := filepath.Join(dir, e.Name())
		isDir := e.IsDir()
		if e.Type()&os.ModeSymlink != 0 {
			if info, err := os.Stat(path); err == nil {
				isDir = info.IsDir()
			}
		}
		if isDir {
			dirs = append(dirs, path)
		} else {
			files = append(files, path)
		}
	}
	sort.Strings(dirs)
	sort.Strings(files)
	return dirs, files
}

// ScratchDir is where the scratch tab's buffers live. Gitignored via
// .git/info/exclude (not .gitignore), same convention as tmux_sessions/ and
// SMAP-TODOS.md.
func ScratchDir() string { return filepath.Join(configDir(), "tmux_scratch") }

// FetchScratch offers exactly two buffers: a global one and a per-project one.
// It deliberately does NOT read SMAP-TODOS.md -- smap is Claude-only and pi
// disregards it, so the scratch tab stays tool-agnostic.
func FetchScratch(th theme.Theme, cwd string) []Row {
	dir := ScratchDir()
	_ = os.MkdirAll(dir, 0o755)
	entries := []struct {
		label string
		path  string
	}{
		{"global", filepath.Join(dir, "global.md")},
		{"project: " + filepath.Base(cwd), filepath.Join(dir, Slug(cwd)+".md")},
	}
	rows := make([]Row, 0, len(entries))
	for _, e := range entries {
		rows = append(rows, Row{
			Lines: []string{th.Accent.Render(e.label) + "  " + th.Muted.Render(scratchSize(e.path))},
			Kind:  ActionEditFile,
			Path:  e.path,
		})
	}
	return rows
}

func scratchSize(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return "(empty)"
	}
	n := strings.Count(string(b), "\n")
	if n == 0 && len(b) == 0 {
		return "(empty)"
	}
	return itoa(n) + " lines"
}

// Slug derives a per-project key from a path by replacing both '/' and '.' with
// '-', matching Claude Code's own claude/projects/<slug> naming and the scheme
// the repo's skills use.
func Slug(path string) string {
	return strings.NewReplacer("/", "-", ".", "-").Replace(path)
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

// Act performs a row's action. ActionEditFile is handled by the caller (it has
// to suspend the TUI), so it is a no-op here.
func Act(r Row, contentPane string) {
	switch r.Kind {
	case ActionFocusPane:
		tmuxio.FocusPane(r.PaneID, r.Target)
	case ActionOpenDir:
		tmuxio.SplitAt(contentPane, r.Path)
	case ActionOpenFile:
		_ = OpenFileCmd(contentPane, r.Path).Run()
	}
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

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
