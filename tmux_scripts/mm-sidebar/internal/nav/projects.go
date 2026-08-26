package nav

import (
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"mm-sidebar/internal/display"
	"mm-sidebar/internal/tmuxio"
	wtapi "mm-sidebar/internal/worktrunk"
)

// Projects lists Git worktrees discovered from the cwd of live world panes.
// Git runs only during this source's gated Fetch: refreshState never polls Git
// while another tab is active, nor when the shared tmux fingerprint is stable.
type Projects struct {
	Worktrunk wtapi.Client
}

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
	projects := make([]worktree, 0, len(repos))
	for _, repo := range repos {
		items, err := p.Worktrunk.List(repo.Root)
		if err == nil {
			projects = append(projects, worktrunkRows(repo, items)...)
			continue
		}
		// Worktrunk is optional. Preserve Git's stable, NUL-safe discovery per
		// repository when wt is absent, slow, blocked on approval, or malformed.
		for _, wt := range listWorktrees(repo.Root) {
			wt.RepoRoot, wt.CommonDir = repo.Root, repo.CommonDir
			projects = append(projects, wt)
		}
	}
	sortWorktrees(projects)
	rows := make([]Row, 0, len(projects))
	for _, wt := range projects {
		rows = append(rows, projectRow(c, wt))
	}
	return rows, nil
}

type worktree struct {
	Path       string
	Branch     string
	RepoRoot   string
	CommonDir  string
	BranchOnly bool
	Main       bool
	Status     projectStatus
}

type projectStatus struct {
	Staged, Modified, Untracked bool
	Conflicted, WouldConflict   bool
	Locked, Prunable            bool
	Operation                   string
	Ahead, Behind               *int
	State                       string
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

func worktrunkRows(repo repository, list wtapi.List) []worktree {
	rows := make([]worktree, 0, len(list.Items))
	seen := make(map[string]bool)
	for _, item := range list.Items {
		branch := "(detached)"
		if item.Branch != nil && *item.Branch != "" {
			branch = *item.Branch
		}
		row := worktree{
			Branch:    branch,
			RepoRoot:  repo.Root,
			CommonDir: repo.CommonDir,
			Status:    statusFromWorktrunk(item),
		}
		if item.Worktree == nil {
			if item.Branch == nil || *item.Branch == "" {
				continue
			}
			row.BranchOnly = true
		} else {
			if item.Worktree.Path == "" {
				continue
			}
			row.Path, row.Main = item.Worktree.Path, item.Worktree.Main
		}
		key := row.Path
		if row.BranchOnly {
			key = "branch\x00" + row.Branch
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		rows = append(rows, row)
	}
	return rows
}

func statusFromWorktrunk(item wtapi.Item) projectStatus {
	status := projectStatus{}
	if item.Worktree != nil {
		status.Locked = item.Worktree.Locked != nil
		status.Prunable = item.Worktree.Prunable != nil
		if item.Worktree.Operation != nil {
			status.Operation = *item.Worktree.Operation
		}
		if changes := item.Worktree.Changes; changes != nil {
			status.Staged, status.Modified, status.Untracked = changes.Staged, changes.Modified, changes.Untracked
			status.Conflicted = changes.Conflicted != nil && *changes.Conflicted
		}
	}
	if relation := item.DefaultBranch; relation != nil {
		status.Ahead, status.Behind = relation.Ahead, relation.Behind
		status.WouldConflict = relation.MergeConflicts != nil && *relation.MergeConflicts
	}
	if item.Display.State != nil {
		status.State = *item.Display.State
	}
	return status
}

func sortWorktrees(rows []worktree) {
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.CommonDir != b.CommonDir {
			return a.CommonDir < b.CommonDir
		}
		if a.BranchOnly != b.BranchOnly {
			return !a.BranchOnly
		}
		if a.Main != b.Main {
			return a.Main
		}
		if a.Branch != b.Branch {
			return a.Branch < b.Branch
		}
		return a.Path < b.Path
	})
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
	if wt.BranchOnly {
		path = filepath.Clean(wt.RepoRoot)
	}
	name := filepath.Base(path)
	branch := display.Sanitize(wt.Branch)
	identity := display.Sanitize(name) + " · " + branch
	pane, livePanes := panesForWorktree(c.World, path)
	if wt.BranchOnly {
		livePanes = 0
	}
	statusText, statusView := renderProjectStatus(c, wt, livePanes)
	first := c.Theme.Text.Render(identity)
	if statusView != "" {
		first += " " + statusView
	}
	lines := []string{
		first,
		"  " + c.Theme.Muted.Render(truncLeft(compactPath(path, home), cwdCol)),
	}
	row := Row{
		ID:         "worktree:" + path,
		SearchText: strings.TrimSpace(identity + " " + display.Sanitize(path) + " " + statusText),
		Lines:      lines,
		Kind:       ActionOpenDir,
		Path:       path,
		Actions:    dirActions(path),
	}
	if wt.BranchOnly {
		row.ID = "branch:" + wt.CommonDir + ":" + wt.Branch
		row.Kind = ActionNone
		row.Actions = []ContextAction{{
			ID:       "materialize",
			Label:    "create worktree and open split",
			Kind:     ContextMaterializeBranch,
			RepoRoot: wt.RepoRoot,
			Branch:   wt.Branch,
		}}
		return row
	}
	if livePanes > 0 {
		row.Kind, row.PaneID, row.Target, row.Pane = ActionFocusPane, pane.PaneID, pane.Target, pane.Ref()
		row.Actions = append([]ContextAction{{ID: "focus", Label: "focus worktree pane", Kind: ContextFocusPane, Pane: pane.Ref(), PaneID: pane.PaneID, Target: pane.Target}}, row.Actions...)
	}
	return row
}

func renderProjectStatus(c Ctx, wt worktree, livePanes int) (plain, styled string) {
	type part struct{ plain, styled string }
	parts := make([]part, 0, 8)
	add := func(text, view string) { parts = append(parts, part{text, view}) }
	if wt.BranchOnly {
		add("branch", c.Theme.Muted.Render("branch"))
	}
	if livePanes > 0 {
		text := strconv.Itoa(livePanes) + " pane"
		if livePanes != 1 {
			text += "s"
		}
		add(text, c.Theme.Accent.Render(text))
	}
	if wt.Status.Conflicted || wt.Status.WouldConflict {
		add("conflict", c.Theme.Urgent.Render("conflict"))
	}
	if wt.Status.Operation != "" {
		op := display.Sanitize(wt.Status.Operation)
		add(op, c.Theme.Busy.Render(op))
	}
	if wt.Status.Locked {
		add("locked", c.Theme.Muted.Render("locked"))
	}
	if wt.Status.Prunable {
		add("stale", c.Theme.Urgent.Render("stale"))
	}
	dirty := ""
	if wt.Status.Staged {
		dirty += "+"
	}
	if wt.Status.Modified {
		dirty += "!"
	}
	if wt.Status.Untracked {
		dirty += "?"
	}
	if dirty != "" {
		add(dirty, c.Theme.Busy.Render(dirty))
	}
	if wt.Status.Ahead != nil && *wt.Status.Ahead > 0 {
		text := "↑" + strconv.Itoa(*wt.Status.Ahead)
		add(text, c.Theme.Accent.Render(text))
	}
	if wt.Status.Behind != nil && *wt.Status.Behind > 0 {
		text := "↓" + strconv.Itoa(*wt.Status.Behind)
		add(text, c.Theme.Muted.Render(text))
	}
	if wt.Status.State == "integrated" || wt.Status.State == "empty" {
		add("integrated", c.Theme.Muted.Render("integrated"))
	}
	plainParts, viewParts := make([]string, 0, len(parts)), make([]string, 0, len(parts))
	for _, part := range parts {
		plainParts = append(plainParts, part.plain)
		viewParts = append(viewParts, part.styled)
	}
	return strings.Join(plainParts, " "), strings.Join(viewParts, " ")
}

func paneForWorktree(world tmuxio.World, root string) (tmuxio.PaneRow, bool) {
	best, count := panesForWorktree(world, root)
	return best, count > 0
}

func panesForWorktree(world tmuxio.World, root string) (tmuxio.PaneRow, int) {
	var best tmuxio.PaneRow
	bestLen, count := -1, 0
	for _, pane := range world.Panes() {
		if pane.PaneID == world.Snapshot.PaneID || !pathContains(root, pane.CurrentPath) {
			continue
		}
		count++
		// Prefer a pane at the root itself, then the shallowest child path.
		if n := len(pane.CurrentPath); bestLen < 0 || n < bestLen {
			best, bestLen = pane, n
		}
	}
	return best, count
}

func pathContains(root, path string) bool {
	root, path = filepath.Clean(root), filepath.Clean(path)
	if root == "." || path == "." {
		return false
	}
	return path == root || strings.HasPrefix(path, root+string(filepath.Separator))
}
