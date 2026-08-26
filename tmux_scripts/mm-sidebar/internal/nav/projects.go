package nav

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"mm-sidebar/internal/display"
	"mm-sidebar/internal/projectcatalog"
	"mm-sidebar/internal/tmuxio"
	wtapi "mm-sidebar/internal/worktrunk"
)

// Projects lists Git worktrees discovered from the cwd of live world panes.
// Git runs only during this source's gated Fetch: refreshState never polls Git
// while another tab is active, nor when the shared tmux fingerprint is stable.
type Projects struct {
	Worktrunk wtapi.Client
	Catalog   *projectcatalog.Catalog
}

func (p Projects) catalog() *projectcatalog.Catalog {
	if p.Catalog != nil {
		return p.Catalog
	}
	return projectcatalog.New(projectcatalog.Config{})
}

func (Projects) ID() string    { return "projects" }
func (Projects) Short() string { return "proj" }
func (Projects) Title() string { return "projects" }

// FetchKey depends only on the live pane cwd set. This deliberately excludes
// activity/bell/session metadata from World's broad fingerprint, so an open
// projects tab does not poll Git every time unrelated tmux state changes.
func (Projects) FetchKey(c Ctx) string {
	cwds := projectCwds(c.World.Panes())
	sort.Strings(cwds)
	return strings.Join(cwds, "\x1f")
}

func (p Projects) Fetch(c Ctx) ([]Row, error) {
	cwds := projectCwds(c.World.Panes())
	catalog := p.catalog()
	entries, err := catalog.Observe(cwds)
	if err != nil {
		return nil, FetchFailure(p, err)
	}
	repositories := catalog.Inventory(entries, p.Worktrunk)
	rows := make([]Row, 0, len(entries)*2)
	for _, repo := range repositories {
		rows = append(rows, repositoryHeading(c, repo.Entry))
		for _, item := range repo.Worktrees {
			wt := worktree{Path: item.Path, Branch: item.Branch, RepoRoot: item.RepoRoot, CommonDir: item.CommonDir, BranchOnly: item.BranchOnly, Main: item.Main}
			if item.WorktrunkItem != nil {
				wt.Status = statusFromWorktrunk(*item.WorktrunkItem)
			}
			row := projectRow(c, wt)
			row.GroupID = repo.CommonDir
			row.Lines = indentLines(row.Lines)
			rows = append(rows, row)
		}
	}
	return rows, nil
}

// projectCwds excludes all sidebar lifecycle panes, which can otherwise make a
// project appear live merely because another window owns a sidebar there.
func projectCwds(panes []tmuxio.PaneRow) []string {
	cwds := make([]string, 0, len(panes))
	seen := make(map[string]bool)
	for _, pane := range panes {
		cwd := cleanProjectPath(pane.CurrentPath)
		if pane.Sidebar || cwd == "" || seen[cwd] {
			continue
		}
		seen[cwd] = true
		cwds = append(cwds, cwd)
	}
	return cwds
}

// cleanProjectPath is the lexical representation retained by rows/actions.
// Canonical Git identity remains the catalog's resolved common directory.
func cleanProjectPath(path string) string {
	if path == "" {
		return ""
	}
	return filepath.Clean(path)
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

func repositoryHeading(c Ctx, entry projectcatalog.Entry) Row {
	home, _ := os.UserHomeDir()
	name := display.Sanitize(filepath.Base(entry.Root))
	status := ""
	if entry.Pinned {
		status = " pinned"
	}
	if !entry.Available {
		status += " unavailable"
	}
	first := "▾ " + name + status
	second := "  " + truncLeft(compactPath(entry.Root, home), cwdCol)
	row := Row{
		ID:           "repo:" + entry.CommonDir,
		GroupID:      entry.CommonDir,
		GroupHeading: true,
		SearchText:   strings.TrimSpace(name + " " + entry.Root + " " + entry.CommonDir + status),
		Lines:        []string{c.Theme.Accent.Render(first), c.Theme.Muted.Render(second)},
		Kind:         ActionNone,
		Actions: []ContextAction{{
			ID:        "pin",
			Label:     "pin repository",
			Kind:      ContextPinRepository,
			CommonDir: entry.CommonDir,
		}},
	}
	if entry.Pinned {
		row.Actions[0] = ContextAction{ID: "unpin", Label: "unpin repository", Kind: ContextUnpinRepository, CommonDir: entry.CommonDir}
	}
	if !entry.Live {
		row.Actions = append(row.Actions, ContextAction{
			ID: "forget", Label: "forget repository", Destructive: true,
			Kind: ContextForgetRepository, CommonDir: entry.CommonDir,
		})
	}
	return row
}

func indentLines(lines []string) []string {
	out := make([]string, len(lines))
	for i, line := range lines {
		out[i] = "  " + line
	}
	return out
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

func projectRow(c Ctx, wt worktree) Row {
	home, _ := os.UserHomeDir()
	path := cleanProjectPath(wt.Path)
	wt.RepoRoot, wt.CommonDir = cleanProjectPath(wt.RepoRoot), cleanProjectPath(wt.CommonDir)
	if wt.BranchOnly {
		path = wt.RepoRoot
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
		CommonDir:  wt.CommonDir,
		Actions:    projectActions(path, wt.CommonDir, nil),
	}
	if wt.BranchOnly {
		row.ID = "branch:" + wt.CommonDir + ":" + wt.Branch
		row.Kind = ActionNone
		row.Actions = []ContextAction{{
			ID:        "materialize",
			Label:     "create worktree and open split",
			Kind:      ContextMaterializeBranch,
			RepoRoot:  wt.RepoRoot,
			Branch:    wt.Branch,
			CommonDir: wt.CommonDir,
		}}
		return row
	}
	if livePanes > 0 {
		row.Kind, row.PaneID, row.Target, row.Pane = ActionFocusPane, pane.PaneID, pane.Target, pane.Ref()
		row.Actions = projectActions(path, wt.CommonDir, &pane)
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
		if pane.Sidebar || !pathContains(root, pane.CurrentPath) {
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
