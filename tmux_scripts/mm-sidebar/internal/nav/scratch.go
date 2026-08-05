package nav

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Scratch offers exactly two markdown buffers: a global one and a per-project
// one, both edited in this pane via tea.ExecProcess.
type Scratch struct{}

func (Scratch) ID() string    { return "scratch" }
func (Scratch) Short() string { return "scr" }
func (Scratch) Title() string { return "scratch" }

// Fetch deliberately does NOT read SMAP-TODOS.md -- smap is Claude-only and pi
// disregards it, so the scratch tab stays tool-agnostic.
func (Scratch) Fetch(c Ctx) []Row {
	dir := ScratchDir()
	_ = os.MkdirAll(dir, 0o755)
	entries := []struct {
		label string
		path  string
	}{
		{"global", filepath.Join(dir, "global.md")},
		{"project: " + filepath.Base(c.Cwd), filepath.Join(dir, Slug(c.Cwd)+".md")},
	}
	rows := make([]Row, 0, len(entries))
	for _, e := range entries {
		rows = append(rows, Row{
			Lines: []string{c.Theme.Accent.Render(e.label) + "  " +
				c.Theme.Muted.Render(scratchSize(e.path))},
			Kind: ActionEditFile,
			Path: e.path,
		})
	}
	return rows
}

// ScratchDir is where the scratch tab's buffers live. Gitignored via
// .git/info/exclude (not .gitignore), same convention as tmux_sessions/ and
// SMAP-TODOS.md.
func ScratchDir() string { return filepath.Join(configDir(), "tmux_scratch") }

func scratchSize(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return "(empty)"
	}
	n := strings.Count(string(b), "\n")
	if n == 0 && len(b) == 0 {
		return "(empty)"
	}
	return strconv.Itoa(n) + " lines"
}

// Slug derives a per-project key from a path by replacing both '/' and '.' with
// '-', matching Claude Code's own claude/projects/<slug> naming and the scheme
// the repo's skills use.
func Slug(path string) string {
	return strings.NewReplacer("/", "-", ".", "-").Replace(path)
}
