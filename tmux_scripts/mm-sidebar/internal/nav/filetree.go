package nav

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"mm-sidebar/internal/theme"
)

// Filetree browses Ctx.Root two levels deep. It is the only Source implementing
// Ascender, which is what lets the model bind Backspace generically instead of
// naming this tab.
type Filetree struct{}

func (Filetree) ID() string    { return "filetree" }
func (Filetree) Short() string { return "tree" }
func (Filetree) Title() string { return "filetree" }

// Fetch walks root two levels deep: directories before files at each level,
// second level indented two spaces.
//
// Every row carries its real absolute path from the directory read itself. There
// is no glyph-stripping or path reconstruction from a decorated display string --
// an earlier `eza --tree --icons` version stripped tree glyphs to recover paths
// and silently resolved every row to the tree root, so Enter on a nested
// directory opened a pane in the wrong place.
func (Filetree) Fetch(c Ctx) []Row {
	dirs, files := readSplit(c.Root)
	rows := make([]Row, 0, len(dirs)+len(files))
	for _, d := range dirs {
		rows = append(rows, dirRow(c.Theme, d, 0))
		subDirs, subFiles := readSplit(d)
		for _, s := range subDirs {
			rows = append(rows, dirRow(c.Theme, s, 1))
		}
		for _, s := range subFiles {
			rows = append(rows, fileRow(c.Theme, s, 1))
		}
	}
	for _, f := range files {
		rows = append(rows, fileRow(c.Theme, f, 0))
	}
	return rows
}

// Up implements Ascender: move the browse root to its parent.
func (Filetree) Up(c Ctx) (string, bool) {
	parent := parentDir(c.Root)
	if parent == c.Root {
		return c.Root, false
	}
	return parent, true
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
