package nav

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"mm-sidebar/internal/display"
	"mm-sidebar/internal/gitstatus"
	"mm-sidebar/internal/theme"
)

// Filetree is a per-sidebar, lazy directory hierarchy. NewFiletree must be
// used by the sidebar model; the zero value remains a read-only one-shot source
// for small callers and tests.
type Filetree struct{ state *filetreeState }

// filetreeTemplate keeps the global tab registry declarative. The model replaces
// it with NewFiletree(), so hierarchy/cache state is never shared by sidebars.
type filetreeTemplate struct{}

func (filetreeTemplate) ID() string                 { return "filetree" }
func (filetreeTemplate) Short() string              { return "tree" }
func (filetreeTemplate) Title() string              { return "filetree" }
func (filetreeTemplate) Fetch(c Ctx) ([]Row, error) { return NewFiletree().Fetch(c) }

const (
	filetreeEntryLimit = 512
	filetreeCacheLimit = 256
	filetreeWatchLimit = 64
	filetreeDepthLimit = 64
)

type filetreeState struct {
	mu sync.Mutex

	root          string
	rootCanonical string
	hidden        bool
	revision      uint64
	nodes         map[string]*treeNode
	expanded      map[string]bool
	dirty         bool
	watchLimit    bool

	// projections are rebuilt only by Fetch, off the input path. materialized
	// includes cached descendants even when their ancestors are collapsed, so
	// query filtering can reveal them without causing I/O.
	rows         []Row
	materialized []Row

	// git is a whole-worktree status snapshot, never a per-row command. On a
	// failed refresh it deliberately retains the prior snapshot as stale data.
	git      *gitstatus.Snapshot
	gitWatch []string
	gitErr   error
}

type treeNode struct {
	path    string
	entries []treeEntry
	status  treeStatus
	err     error
}

type treeEntry struct {
	path      string
	name      string
	dir       bool
	canonical string
}

type treeStatus uint8

const (
	treeReady treeStatus = iota
	treeEmpty
	treeLimited
	treeFailed
)

type treeProjection uint8

const (
	projectionExpanded treeProjection = iota
	projectionCached
)

func NewFiletree() *Filetree {
	return &Filetree{state: &filetreeState{nodes: make(map[string]*treeNode), expanded: make(map[string]bool)}}
}

func (Filetree) ID() string    { return "filetree" }
func (Filetree) Short() string { return "tree" }
func (Filetree) Title() string { return "filetree" }
func (f *Filetree) Context(c Ctx, _ []Row) string {
	root := c.Root
	if root == "" {
		root = c.Cwd
	}
	home, _ := os.UserHomeDir()
	parts := []string{display.Sanitize(compactPath(root, home))}
	if c.RootPinned {
		parts = append(parts, "pinned")
	}
	if c.ShowHidden {
		parts = append(parts, "hidden on")
	} else {
		parts = append(parts, "hidden off")
	}
	s := f.runtime()
	s.mu.Lock()
	stale := s.gitErr != nil
	s.mu.Unlock()
	if stale {
		parts = append(parts, "git stale")
	}
	return strings.Join(parts, " · ")
}

// Fetch performs filesystem and Git reads without the state mutex. The mutex
// protects only snapshots and state transitions, so UI controls, FetchKey and
// WatchPaths never wait for a slow disk or child process.
func (f *Filetree) Fetch(c Ctx) ([]Row, error) {
	state := f.runtime()
	root := filepath.Clean(c.Root)
	if root == "." || root == "" {
		root = filepath.Clean(c.Cwd)
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		if err == nil {
			err = fmt.Errorf("not a directory")
		}
		return nil, FetchFailure(f, err)
	}

	rootCanonical, _ := filepath.EvalSymlinks(root)
	if rootCanonical == "" {
		rootCanonical = root
	}

	state.mu.Lock()
	if state.root != root || state.hidden != c.ShowHidden {
		state.root, state.rootCanonical, state.hidden = root, filepath.Clean(rootCanonical), c.ShowHidden
		state.nodes = make(map[string]*treeNode)
		state.expanded = make(map[string]bool)
		state.rows, state.materialized = nil, nil
		state.dirty = false
		state.watchLimit = false
		state.git, state.gitWatch, state.gitErr = nil, nil, nil
		state.revision++
	}
	if state.dirty {
		state.nodes = make(map[string]*treeNode)
		state.rows, state.materialized = nil, nil
		state.dirty = false
		state.revision++
	}
	revision := state.revision
	hidden := state.hidden
	missing := state.missingPathsLocked()
	state.mu.Unlock()

	// A bounded read is done once per materialized directory. Existing expanded
	// paths are re-read after invalidation; collapsed descendants stay untouched.
	loaded := make(map[string]*treeNode, len(missing))
	for _, path := range missing {
		loaded[path] = readTreeNode(path, hidden)
	}
	gitSnap, gitErr := gitstatus.New().Snapshot(context.Background(), root)
	var gitWatch []string
	if gitErr == nil {
		// Watch path existence checks belong with the command, before reacquiring
		// state.mu; WatchPaths itself must remain a pure snapshot read.
		gitWatch = gitSnap.WatchPaths()
	}

	state.mu.Lock()
	defer state.mu.Unlock()
	if state.root != root || state.hidden != hidden || state.revision != revision {
		// A local key/watch changed while I/O ran. Do not install stale results;
		// the already-queued refresh will build the newer revision.
		return state.cacheProjectionsLocked(c.Theme), nil
	}
	for path, node := range loaded {
		if len(state.nodes) >= filetreeCacheLimit {
			break
		}
		state.nodes[path] = node
	}
	if gitErr == nil {
		state.git, state.gitWatch = &gitSnap, gitWatch
		state.gitErr = nil
	} else if gitErr == gitstatus.ErrNotRepository {
		state.git, state.gitWatch, state.gitErr = nil, nil, nil
	} else {
		state.gitErr = gitErr
	}
	return state.cacheProjectionsLocked(c.Theme), nil
}

func (f *Filetree) runtime() *filetreeState {
	if f != nil && f.state != nil {
		return f.state
	}
	return &filetreeState{nodes: make(map[string]*treeNode), expanded: make(map[string]bool)}
}

// expandedPathsLocked returns only directories that are both expanded and
// reachable through expanded ancestors. It deliberately treats stale false keys
// as collapsed: a collapsed branch must not cause reads or watches below it.
func (s *filetreeState) expandedPathsLocked() []string {
	paths := make([]string, 0, len(s.expanded))
	for path, expanded := range s.expanded {
		if !expanded || !s.hasExpandedAncestorsLocked(path) {
			continue
		}
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
}

func (s *filetreeState) hasExpandedAncestorsLocked(path string) bool {
	for parent := filepath.Dir(path); parent != s.root; parent = filepath.Dir(parent) {
		if parent == path || !s.expanded[parent] {
			return false
		}
		path = parent
	}
	return true
}

func (s *filetreeState) missingPathsLocked() []string {
	paths := append([]string{s.root}, s.expandedPathsLocked()...)
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		if s.nodes[path] == nil && len(s.nodes)+len(out) < filetreeCacheLimit {
			out = append(out, path)
		}
	}
	return out
}

func readTreeNode(path string, showHidden bool) *treeNode {
	node := &treeNode{path: path, status: treeReady}
	dir, err := os.Open(path)
	if err != nil {
		node.status, node.err = treeFailed, err
		return node
	}
	defer dir.Close()
	entries, err := dir.ReadDir(filetreeEntryLimit + 1)
	if err != nil && err != io.EOF {
		node.status, node.err = treeFailed, err
		return node
	}
	if len(entries) > filetreeEntryLimit {
		entries = entries[:filetreeEntryLimit]
		node.status = treeLimited
	}
	for _, entry := range entries {
		if !showHidden && strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		entryPath := filepath.Join(path, entry.Name())
		isDir, canonical := entry.IsDir(), ""
		if entry.Type()&os.ModeSymlink != 0 {
			if info, statErr := os.Stat(entryPath); statErr == nil {
				isDir = info.IsDir()
			}
		}
		if isDir {
			canonical, _ = filepath.EvalSymlinks(entryPath)
			canonical = filepath.Clean(canonical)
		}
		node.entries = append(node.entries, treeEntry{path: entryPath, name: entry.Name(), dir: isDir, canonical: canonical})
	}
	sort.SliceStable(node.entries, func(i, j int) bool {
		if node.entries[i].dir != node.entries[j].dir {
			return node.entries[i].dir
		}
		return node.entries[i].name < node.entries[j].name
	})
	if len(node.entries) == 0 && node.status == treeReady {
		node.status = treeEmpty
	}
	return node
}

func (s *filetreeState) cacheProjectionsLocked(th theme.Theme) []Row {
	s.rows = s.projectionLocked(th, projectionExpanded)
	s.materialized = s.projectionLocked(th, projectionCached)
	return s.rows
}

func (s *filetreeState) rowsLocked(th theme.Theme) []Row {
	return s.projectionLocked(th, projectionExpanded)
}

// projectionLocked renders either the expanded view or every already cached
// descendant. The latter never reads a directory or Git; it is the search-only
// materialized projection built by Fetch.
func (s *filetreeState) projectionLocked(th theme.Theme, projection treeProjection) []Row {
	rows := make([]Row, 0, 64)
	root := s.nodes[s.root]
	if root == nil {
		return rows
	}
	if root.status == treeFailed {
		return append(rows, treeStatusRow(th, s.root, "tree unavailable: "+display.Sanitize(root.err.Error()), ""))
	}
	s.appendEntriesLocked(&rows, th, root, "", 0, map[string]bool{s.rootCanonical: true}, projection)
	if s.gitErr != nil {
		text := "git status stale: " + display.Sanitize(s.gitErr.Error())
		if s.git == nil {
			text = "git status unavailable: " + display.Sanitize(s.gitErr.Error())
		}
		rows = append(rows, treeStatusRow(th, s.root, text, ""))
	}
	if s.watchLimit {
		rows = append(rows, treeStatusRow(th, s.root, "watch limit reached; use r to refresh", ""))
	}
	return rows
}

func (s *filetreeState) appendEntriesLocked(rows *[]Row, th theme.Theme, node *treeNode, parent string, depth int, ancestry map[string]bool, projection treeProjection) {
	for _, entry := range node.entries {
		status, known := s.statusLocked(entry.path, entry.dir)
		if !entry.dir {
			*rows = append(*rows, fileRow(th, entry.path, parent, depth, status, known, s.gitErr))
			continue
		}
		cycle := entry.canonical != "" && ancestry[entry.canonical]
		row := dirRow(th, entry.path, parent, depth, s.expanded[entry.path], cycle, status, known, s.gitErr)
		*rows = append(*rows, row)
		if cycle || (projection == projectionExpanded && !s.expanded[entry.path]) {
			continue
		}
		if depth >= filetreeDepthLimit {
			*rows = append(*rows, treeStatusRow(th, entry.path, "depth limit reached", row.ID))
			continue
		}
		child := s.nodes[entry.path]
		if child == nil {
			if projection == projectionExpanded {
				message := "loading…"
				if len(s.nodes) >= filetreeCacheLimit {
					message = "cache limit reached; reset root to release cached directories"
				}
				*rows = append(*rows, treeStatusRow(th, entry.path, message, row.ID))
			}
			continue
		}
		switch child.status {
		case treeFailed:
			*rows = append(*rows, treeStatusRow(th, entry.path, "unavailable: "+display.Sanitize(child.err.Error()), row.ID))
			continue
		case treeEmpty:
			*rows = append(*rows, treeStatusRow(th, entry.path, "(empty)", row.ID))
		}
		next := make(map[string]bool, len(ancestry)+1)
		for path, seen := range ancestry {
			next[path] = seen
		}
		if entry.canonical != "" {
			next[entry.canonical] = true
		}
		s.appendEntriesLocked(rows, th, child, row.ID, depth+1, next, projection)
	}
	if node.status == treeLimited {
		*rows = append(*rows, treeStatusRow(th, node.path, "entry limit reached", parent))
	}
}

func (s *filetreeState) statusLocked(path string, directory bool) (gitstatus.Status, bool) {
	if s.git == nil {
		return gitstatus.Status{}, false
	}
	best, ok := s.git.Paths[filepath.Clean(path)]
	if !directory {
		return best, ok
	}
	prefix := filepath.Clean(path) + string(os.PathSeparator)
	for changedPath, status := range s.git.Paths {
		if strings.HasPrefix(changedPath, prefix) {
			if !ok || status.Kind > best.Kind {
				best, ok = status, true
			}
		}
	}
	return best, ok
}

// SyncRoot derives the tree root only until the user pins it.
func (*Filetree) SyncRoot(c Ctx) (string, string) {
	if c.Root == "" || (!c.RootPinned && c.ContentPane != c.RootPane) {
		return c.Cwd, c.ContentPane
	}
	return c.Root, c.RootPane
}

// FetchKey deliberately excludes World state. Directory/Git metadata events and
// explicit refreshes invalidate it, so unrelated tmux polling never reruns Git.
func (f *Filetree) FetchKey(Ctx) string {
	s := f.runtime()
	s.mu.Lock()
	defer s.mu.Unlock()
	return fmt.Sprintf("tree:%d", s.revision)
}

// WatchPaths covers rendered directories plus the current worktree's bounded
// Git metadata. Collapsed descendants intentionally remain unwatched; entering,
// expanding, or pressing r refreshes their status.
func (f *Filetree) WatchPaths(c Ctx) []string {
	s := f.runtime()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.root == "" || s.root != filepath.Clean(c.Root) {
		return nil
	}
	paths := []string{s.root}
	s.watchLimit = false
	// Git metadata is compact and status-bearing; reserve it before expanded
	// directories so a deep open tree cannot silently drop HEAD/index/ref events.
	if s.git != nil {
		for _, path := range s.gitWatch {
			if len(paths) >= filetreeWatchLimit {
				s.watchLimit = true
				break
			}
			paths = append(paths, path)
		}
	}
	for _, path := range s.expandedPathsLocked() {
		if len(paths) >= filetreeWatchLimit {
			s.watchLimit = true
			break
		}
		if node := s.nodes[path]; node != nil && node.status != treeFailed {
			paths = append(paths, path)
		}
	}
	sort.Strings(paths[1:])
	return dedupePaths(paths)
}

func dedupePaths(paths []string) []string {
	seen := make(map[string]struct{}, len(paths))
	out := paths[:0]
	for _, path := range paths {
		path = filepath.Clean(path)
		if _, ok := seen[path]; ok {
			continue
		}
		seen[path] = struct{}{}
		out = append(out, path)
	}
	return out
}

func (f *Filetree) Invalidate() {
	s := f.runtime()
	s.mu.Lock()
	s.dirty = true
	s.revision++
	s.mu.Unlock()
}

func (*Filetree) KeyActions() []KeyAction {
	return []KeyAction{
		{Key: "Space", Summary: "toggle directory"},
		{Key: "P", Summary: "preview path"},
		{Key: "Left/Right", Summary: "collapse / expand"},
		{Key: "h", Summary: "toggle hidden"},
		{Key: "p", Summary: "pin root"},
		{Key: "R", Summary: "reset root"},
		{Key: "Backspace", Summary: "parent directory"},
	}
}

func (f *Filetree) HandleSourceKey(key string, c Ctx) (SourceControl, bool) {
	switch key {
	case "h":
		f.Invalidate()
		return SourceControl{ShowHidden: !c.ShowHidden, SetShowHidden: true, Refresh: true}, true
	case "R":
		f.Invalidate()
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
		f.Invalidate()
		return SourceControl{Root: parent, RootPane: c.RootPane, SetRoot: true, Refresh: true}, true
	default:
		return SourceControl{}, false
	}
}

// HandleRow owns tree navigation. It never opens a path; Enter stays the
// model's normal row action. File Space is intentionally a no-op.
func (f *Filetree) HandleRowKey(key string, row Row, _ Ctx) (SourceControl, bool) {
	if row.Kind != ActionOpenDir {
		if row.Kind == ActionOpenFile {
			switch key {
			case "space", " ":
				return SourceControl{}, true
			case "left":
				return SourceControl{Refresh: true, SelectID: row.ParentID}, true
			}
		}
		return SourceControl{}, false
	}
	if row.TreeCycle {
		return SourceControl{}, key == "space" || key == " " || key == "right"
	}
	s := f.runtime()
	s.mu.Lock()
	defer s.mu.Unlock()
	expanded := s.expanded[row.Path]
	switch key {
	case "space", " ":
		if expanded {
			s.collapseLocked(row.Path)
		} else {
			s.expanded[row.Path] = true
		}
		s.revision++
		return SourceControl{Refresh: true, Loading: !expanded}, true
	case "right":
		if !expanded {
			s.expanded[row.Path] = true
			s.revision++
			return SourceControl{Refresh: true, Loading: true, SelectFirstChildOf: row.ID}, true
		}
		return SourceControl{SelectFirstChildOf: row.ID}, true
	case "left":
		if expanded {
			s.collapseLocked(row.Path)
			s.revision++
			return SourceControl{Refresh: true}, true
		}
		return SourceControl{Refresh: true, SelectID: row.ParentID}, true
	default:
		return SourceControl{}, false
	}
}

// collapseLocked discards the entire open branch. Nodes may remain cached for
// filtering, but neither descendants nor stale false keys can schedule future
// filesystem work or watches.
func (s *filetreeState) collapseLocked(path string) {
	prefix := filepath.Clean(path) + string(os.PathSeparator)
	for candidate := range s.expanded {
		if candidate == path || strings.HasPrefix(filepath.Clean(candidate), prefix) {
			delete(s.expanded, candidate)
		}
	}
}

func (f *Filetree) FilterRows(rows []Row, query string) []Row {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "" {
		return rows
	}

	// Fetch precomputes this cached-only projection so typing cannot initiate
	// filesystem/Git work or rebuild the hierarchy on the input path.
	s := f.runtime()
	s.mu.Lock()
	materialized := s.materialized
	s.mu.Unlock()
	if materialized == nil {
		materialized = rows
	}

	parents := make(map[string]string, len(materialized))
	included := make(map[string]bool, len(materialized))
	for _, row := range materialized {
		parents[row.ID] = row.ParentID
		if strings.Contains(strings.ToLower(row.SearchText), query) {
			for id := row.ID; id != "" && !included[id]; id = parents[id] {
				included[id] = true
			}
		}
	}
	out := make([]Row, 0, len(included))
	for _, row := range materialized {
		if included[row.ID] {
			out = append(out, row)
		}
	}
	return out
}

func parentDir(path string) string {
	if path == "" || path == "/" {
		return "/"
	}
	return filepath.Dir(path)
}

func dirRow(th theme.Theme, path, parent string, depth int, expanded, cycle bool, status gitstatus.Status, known bool, gitErr error) Row {
	name := display.Sanitize(filepath.Base(path))
	marker := "▸"
	if expanded {
		marker = "▾"
	}
	if cycle {
		marker = "!"
	}
	hints := []KeyAction{{Key: "Enter", Summary: "open split"}, {Key: "Space", Summary: "toggle"}, {Key: "P", Summary: "preview"}, {Key: "a", Summary: "actions"}}
	if cycle {
		hints = append(hints, KeyAction{Key: "Space", Summary: "cycle blocked"})
	}
	p := gitPresentation(name+"/", depth, marker, status, known, gitErr)
	p.Detail = gitDetail("selected directory", path, status, known, gitErr, hints)
	return Row{ID: "dir:" + path, ParentID: parent, TreeCycle: cycle, SearchText: name + " " + display.Sanitize(path), Lines: []string{indent(depth) + th.Accent.Render(marker+" "+name+"/")}, Kind: ActionOpenDir, Path: path, Actions: dirActions(path), Presentation: p}
}

func fileRow(th theme.Theme, path, parent string, depth int, status gitstatus.Status, known bool, gitErr error) Row {
	name := display.Sanitize(filepath.Base(path))
	p := gitPresentation(name, depth, "", status, known, gitErr)
	p.Detail = gitDetail("selected file", path, status, known, gitErr, []KeyAction{{Key: "Enter", Summary: "open file"}, {Key: "P", Summary: "preview"}, {Key: "a", Summary: "actions"}})
	return Row{ID: "file:" + path, ParentID: parent, SearchText: name + " " + display.Sanitize(path), Lines: []string{indent(depth) + th.Text.Render(name)}, Kind: ActionOpenFile, Path: path, Actions: fileActions(path), Presentation: p}
}

func gitPresentation(label string, depth int, marker string, status gitstatus.Status, known bool, gitErr error) Presentation {
	p := Presentation{Label: label, Depth: depth, Marker: marker}
	if known {
		p.Tone = toneForGit(status.Kind)
		// Clean is intentionally unbadged: porcelain lists changes, not every
		// tracked clean path. Every non-clean state remains readable as text.
		if status.Kind != gitstatus.Clean {
			p.Facts = []Fact{{Text: status.Kind.Badge(), Tone: p.Tone}}
		}
	}
	if gitErr != nil {
		p.Facts = append(p.Facts, Fact{Text: "stale", Tone: ToneMuted})
	}
	return p
}

func gitDetail(title, path string, status gitstatus.Status, known bool, gitErr error, hints []KeyAction) Detail {
	lines := []DetailLine{{Text: display.Sanitize(path), TruncateLeft: true}}
	if known {
		lines = append(lines, DetailLine{Text: "git: " + status.Kind.Badge(), Tone: toneForGit(status.Kind)})
		lines = append(lines, DetailLine{Text: status.StagedText(), Tone: toneForGit(status.Kind)}, DetailLine{Text: status.UnstagedText(), Tone: toneForGit(status.Kind)})
		if status.Original != "" {
			lines = append(lines, DetailLine{Text: "rename origin: " + display.Sanitize(status.Original), Tone: ToneChanged, TruncateLeft: true})
		}
	}
	if gitErr != nil {
		lines = append(lines, DetailLine{Text: "git status stale: " + display.Sanitize(gitErr.Error()), Tone: ToneMuted})
	}
	return Detail{Title: title, Lines: lines, Hints: hints}
}

func toneForGit(kind gitstatus.Kind) Tone {
	switch kind {
	case gitstatus.Conflict, gitstatus.Deleted:
		return ToneUrgent
	case gitstatus.Changed:
		return ToneChanged
	case gitstatus.Added, gitstatus.Untracked:
		return ToneBusy
	case gitstatus.Ignored:
		return ToneMuted
	default:
		return ToneText
	}
}

func treeStatusRow(th theme.Theme, path, text, parent string) Row {
	id := "tree-status:" + path + ":" + text
	return Row{ID: id, ParentID: parent, SearchText: text, Lines: []string{th.Muted.Render("  " + text)}, Presentation: Presentation{Label: text, Tone: ToneMuted, Depth: 1}}
}

func indent(depth int) string { return strings.Repeat("  ", depth) }
