package nav

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"mm-sidebar/internal/display"
	"mm-sidebar/internal/tmuxio"
)

// Projects lists Git worktrees discovered from the cwd of live world panes.
// Git runs only during this source's gated Fetch: refreshState never polls Git
// while another tab is active, nor when the shared tmux fingerprint is stable.
type Projects struct{}

func (Projects) ID() string    { return "projects" }
func (Projects) Short() string { return "proj" }
func (Projects) Title() string { return "projects" }

// FetchKey depends only on the live pane cwd set. This deliberately excludes
// activity/bell/session metadata from World's broad fingerprint, so an open
// projects tab does not poll Git every time unrelated tmux state changes.
func (Projects) FetchKey(c Ctx) string {
	cwds := make([]string, 0, len(c.World.Panes()))
	seen := make(map[string]bool)
	for _, pane := range c.World.Panes() {
		if pane.CurrentPath != "" && !seen[pane.CurrentPath] {
			seen[pane.CurrentPath] = true
			cwds = append(cwds, pane.CurrentPath)
		}
	}
	sort.Strings(cwds)
	return strings.Join(cwds, "\x1f")
}

func (p Projects) Fetch(c Ctx) ([]Row, error) {
	repos := repositories(c.World.Panes())
	worktrees := make([]worktree, 0, len(repos))
	seen := make(map[string]bool)
	for _, repo := range repos {
		for _, wt := range listWorktrees(repo.Root) {
			if !seen[wt.Path] {
				seen[wt.Path] = true
				worktrees = append(worktrees, wt)
			}
		}
	}
	rows := make([]Row, 0, len(worktrees))
	for _, wt := range worktrees {
		rows = append(rows, projectRow(c, wt))
	}
	return rows, nil
}

type worktree struct {
	Path   string
	Branch string
}

// repositories resolves each distinct pane cwd on demand and deduplicates
// worktrees by Git common-dir, so one repository pays for one worktree-list
// command even when several of its worktrees have live panes.
type repository struct {
	CommonDir string
	Root      string
}

func repositories(panes []tmuxio.PaneRow) []repository {
	cwds := make(map[string]bool)
	for _, pane := range panes {
		if pane.CurrentPath != "" {
			cwds[pane.CurrentPath] = true
		}
	}
	// One root probe per distinct cwd, then one common-dir probe per distinct
	// worktree root. Removing exactly one output newline preserves a newline that
	// is part of a valid filesystem path.
	roots := make(map[string]bool)
	for cwd := range cwds {
		if root := gitPathOutput("-C", cwd, "rev-parse", "--show-toplevel"); root != "" {
			roots[filepath.Clean(root)] = true
		}
	}
	byCommon := make(map[string]repository)
	for root := range roots {
		common := gitPathOutput("-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir")
		if common == "" {
			continue
		}
		common = filepath.Clean(common)
		if current, ok := byCommon[common]; !ok || root < current.Root {
			byCommon[common] = repository{CommonDir: common, Root: root}
		}
	}
	keys := make([]string, 0, len(byCommon))
	for common := range byCommon {
		keys = append(keys, common)
	}
	sort.Strings(keys)
	out := make([]repository, 0, len(keys))
	for _, common := range keys {
		out = append(out, byCommon[common])
	}
	return out
}

func gitOutput(args ...string) string {
	out, err := exec.Command("git", args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func gitPathOutput(args ...string) string {
	out, err := exec.Command("git", args...).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSuffix(strings.TrimSuffix(string(out), "\n"), "\r")
}

func listWorktrees(root string) []worktree {
	out, err := exec.Command("git", "-C", root, "worktree", "list", "--porcelain", "-z").Output()
	if err != nil || len(out) == 0 {
		return nil
	}
	return parseWorktreesZ(out)
}

// parseWorktreesZ reads Git's NUL-delimited porcelain. Unlike line mode, -z
// emits paths verbatim, including spaces, quotes, tabs, and newlines.
func parseWorktreesZ(out []byte) []worktree {
	var rows []worktree
	var current *worktree
	flush := func() {
		if current != nil && current.Path != "" {
			if current.Branch == "" {
				current.Branch = "(detached)"
			}
			rows = append(rows, *current)
		}
		current = nil
	}
	for _, raw := range strings.Split(string(out), "\x00") {
		line := raw
		if line == "" {
			flush()
			continue
		}
		key, value, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		switch key {
		case "worktree":
			flush()
			current = &worktree{Path: value}
		case "branch":
			if current != nil {
				current.Branch = strings.TrimPrefix(value, "refs/heads/")
			}
		case "detached":
			if current != nil {
				current.Branch = "(detached)"
			}
		}
	}
	flush()
	return rows
}

func projectRow(c Ctx, wt worktree) Row {
	home, _ := os.UserHomeDir()
	path := filepath.Clean(wt.Path)
	name := filepath.Base(path)
	branch := display.Sanitize(wt.Branch)
	identity := display.Sanitize(name) + " · " + branch
	lines := []string{
		c.Theme.Text.Render(identity),
		"  " + c.Theme.Muted.Render(truncLeft(compactPath(path, home), cwdCol)),
	}
	row := Row{
		ID:         "worktree:" + path,
		SearchText: identity + " " + display.Sanitize(path),
		Lines:      lines,
		Kind:       ActionOpenDir,
		Path:       path,
		Actions:    dirActions(path),
	}
	if pane, ok := paneForWorktree(c.World, path); ok {
		row.Kind, row.PaneID, row.Target, row.Pane = ActionFocusPane, pane.PaneID, pane.Target, pane.Ref()
		row.Actions = append([]ContextAction{{ID: "focus", Label: "focus worktree pane", Kind: ContextFocusPane, Pane: pane.Ref(), PaneID: pane.PaneID, Target: pane.Target}}, row.Actions...)
	}
	return row
}

func paneForWorktree(world tmuxio.World, root string) (tmuxio.PaneRow, bool) {
	var best tmuxio.PaneRow
	bestLen := -1
	for _, pane := range world.Panes() {
		if pane.PaneID == world.Snapshot.PaneID || !pathContains(root, pane.CurrentPath) {
			continue
		}
		// Prefer a pane at the root itself, then the shallowest child path.
		if n := len(pane.CurrentPath); bestLen < 0 || n < bestLen {
			best, bestLen = pane, n
		}
	}
	return best, bestLen >= 0
}

func pathContains(root, path string) bool {
	root, path = filepath.Clean(root), filepath.Clean(path)
	if root == "." || path == "." {
		return false
	}
	return path == root || strings.HasPrefix(path, root+string(filepath.Separator))
}
