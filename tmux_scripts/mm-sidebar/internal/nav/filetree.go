package nav

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"mm-sidebar/internal/display"
	"mm-sidebar/internal/theme"
)

// Filetree browses Ctx.Root two levels deep. It is the only Source implementing
// Ascender, which is what lets the model bind Backspace generically instead of
// naming this tab.
type Filetree struct{}

func (Filetree) ID() string    { return "filetree" }
func (Filetree) Short() string { return "tree" }
func (Filetree) Title() string { return "filetree" }
func (Filetree) Context(c Ctx, _ []Row) string {
	root := c.Root
	if root == "" {
		root = c.Cwd
	}
	home, _ := os.UserHomeDir()
	root = display.Sanitize(compactPath(root, home))
	parts := []string{root}
	if c.RootPinned {
		parts = append(parts, "pinned")
	}
	if c.ShowHidden {
		parts = append(parts, "hidden on")
	} else {
		parts = append(parts, "hidden off")
	}
	return strings.Join(parts, " · ")
}

// Fetch walks root two levels deep: directories before files at each level,
// second level indented two spaces.
//
// Every row carries its real absolute path from the directory read itself. There
// is no glyph-stripping or path reconstruction from a decorated display string --
// an earlier `eza --tree --icons` version stripped tree glyphs to recover paths
// and silently resolved every row to the tree root, so Enter on a nested
// directory opened a pane in the wrong place.
func (f Filetree) Fetch(c Ctx) ([]Row, error) {
	if _, err := os.ReadDir(c.Root); err != nil {
		return nil, FetchFailure(f, err)
	}
	dirs, files := readSplit(c.Root, c.ShowHidden)
	rows := make([]Row, 0, len(dirs)+len(files))
	for _, d := range dirs {
		heading := dirRow(c.Theme, d, 0)
		heading.GroupID, heading.GroupHeading, heading.Collapsible = d, true, true
		rows = append(rows, heading)
		subDirs, subFiles := readSplit(d, c.ShowHidden)
		for _, s := range subDirs {
			row := dirRow(c.Theme, s, 1)
			row.GroupID = d
			rows = append(rows, row)
		}
		for _, s := range subFiles {
			row := fileRow(c.Theme, s, 1)
			row.GroupID = d
			rows = append(rows, row)
		}
	}
	for _, f := range files {
		rows = append(rows, fileRow(c.Theme, f, 0))
	}
	return rows, nil
}

// SyncRoot derives the tree root only until the user pins it. The generic model
// invokes this optional hook; it has no filetree-specific lifecycle branch.
func (Filetree) SyncRoot(c Ctx) (string, string) {
	if c.Root == "" || (!c.RootPinned && c.ContentPane != c.RootPane) {
		return c.Cwd, c.ContentPane
	}
	return c.Root, c.RootPane
}

// WatchRoot makes the existing scoped watcher opt-in for this source only.
func (Filetree) WatchRoot(c Ctx) string { return c.Root }

// KeyActions advertises the local controls that HandleSourceKey accepts. The
// optional ActionProvider contract keeps help extensible without a filetree name
// branch in the model.
func (Filetree) KeyActions() []KeyAction {
	return []KeyAction{
		{Key: "Space", Summary: "preview path"},
		{Key: "Left/Right", Summary: "collapse / expand"},
		{Key: "h", Summary: "toggle hidden"},
		{Key: "p", Summary: "pin root"},
		{Key: "R", Summary: "reset root"},
		{Key: "Backspace", Summary: "parent directory"},
	}
}

// HandleSourceKey owns the tree's local controls: h includes dotfiles, R resets
// the root to the current content cwd, p pins/unpins that root, and Backspace
// ascends. The model only applies this generic state descriptor.
func (Filetree) HandleSourceKey(key string, c Ctx) (SourceControl, bool) {
	switch key {
	case "h":
		return SourceControl{ShowHidden: !c.ShowHidden, SetShowHidden: true, Refresh: true}, true
	case "R":
		return SourceControl{Root: c.Cwd, RootPane: c.ContentPane, SetRoot: true, RootPinned: false, SetRootPinned: true, Refresh: true}, true
	case "p":
		return SourceControl{RootPinned: !c.RootPinned, SetRootPinned: true, Refresh: true}, true
	case "backspace":
		if c.Root == "" {
			return SourceControl{}, true
		}
		parent := parentDir(c.Root)
		if parent == c.Root {
			return SourceControl{}, true
		}
		return SourceControl{Root: parent, RootPane: c.RootPane, SetRoot: true, Refresh: true}, true
	default:
		return SourceControl{}, false
	}
}

func parentDir(path string) string {
	if path == "" || path == "/" {
		return "/"
	}
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			if i == 0 {
				return "/"
			}
			return path[:i]
		}
	}
	return path
}

func dirRow(th theme.Theme, path string, depth int) Row {
	name := display.Sanitize(filepath.Base(path))
	hints := []KeyAction{{Key: "Enter", Summary: "open split"}, {Key: "Space", Summary: "preview"}, {Key: "a", Summary: "actions"}}
	if depth == 0 {
		hints = append([]KeyAction{{Key: "Right", Summary: "show children"}}, hints...)
	}
	return Row{
		ID:         "dir:" + path,
		SearchText: name + " " + display.Sanitize(path),
		Lines:      []string{indent(depth) + th.Accent.Render(name+"/")},
		Kind:       ActionOpenDir,
		Path:       path,
		Actions:    dirActions(path),
		Presentation: Presentation{
			Label: name + "/", Tone: ToneAccent, Depth: depth,
			Detail: Detail{Title: "selected directory", Lines: []DetailLine{{Text: display.Sanitize(path), TruncateLeft: true}}, Hints: hints},
		},
	}
}

func fileRow(th theme.Theme, path string, depth int) Row {
	name := display.Sanitize(filepath.Base(path))
	return Row{
		ID:         "file:" + path,
		SearchText: name + " " + display.Sanitize(path),
		Lines:      []string{indent(depth) + th.Text.Render(name)},
		Kind:       ActionOpenFile,
		Path:       path,
		Actions:    fileActions(path),
		Presentation: Presentation{
			Label: name, Depth: depth,
			Detail: Detail{Title: "selected file", Lines: []DetailLine{{Text: display.Sanitize(path), TruncateLeft: true}}, Hints: []KeyAction{{Key: "Enter", Summary: "open file"}, {Key: "Space", Summary: "preview"}, {Key: "a", Summary: "actions"}}},
		},
	}
}

func indent(depth int) string { return strings.Repeat("  ", depth) }

// readSplit returns a directory's immediate children, split into directories and
// files, each sorted by name. Symlinks are classified by their target so a
// symlinked directory (this repo has several) still expands.
func readSplit(dir string, showHidden bool) (dirs, files []string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil
	}
	for _, e := range entries {
		if !showHidden && strings.HasPrefix(e.Name(), ".") {
			continue
		}
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
