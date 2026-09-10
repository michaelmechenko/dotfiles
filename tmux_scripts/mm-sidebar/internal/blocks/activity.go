package blocks

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/display"
	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
)

const (
	activityMax     = 6
	activityHistory = 50
)

type activityKind uint8

const (
	activityAgent activityKind = iota
	activityGit
)

type activityEntry struct {
	ID       string
	At       time.Time
	Tag      string
	Text     string
	Urgent   bool
	Kind     activityKind
	Agent    agents.Row
	Path     string
	Snapshot gitSnapshot
}

// Activity is a passive, process-local recent-transition feed. It never polls:
// World and AgentRows establish facts, and only a relevant transition or an
// explicit RefreshMsg schedules a bounded Git probe.
type Activity struct {
	theme  theme.Theme
	client *tmuxio.Client
	now    func() time.Time
	git    gitRunner

	entries      []activityEntry // newest first
	facts        map[string]agents.Row
	activeAgents map[string]agents.Row // waiting/permission facts; history stays resolved
	activeGit    map[string]gitSnapshot
	seeded       bool
	world        tmuxio.World
	extra        int
	viewport     int // explicit-view height; zero means unconstrained
	focus        int
	hover        int
	seq          uint64
	gitSeq       uint64
	gitInFlight  bool
	pending      map[string]uint64 // cwd -> queued token, coalescing equivalent work
	latest       map[string]uint64 // cwd -> most recently issued token
	gitSeen      map[string]gitSnapshot
	gitSeenAt    map[string]time.Time
	roots        map[string]struct{}
	visible      bool
}

func NewActivity(th theme.Theme, client *tmuxio.Client) *Activity {
	if client == nil {
		client = tmuxio.NewClient("", "")
	}
	return &Activity{
		theme: th, client: client, now: time.Now, git: runGit, focus: -1, hover: -1,
		facts: map[string]agents.Row{}, activeAgents: map[string]agents.Row{}, activeGit: map[string]gitSnapshot{}, pending: map[string]uint64{}, latest: map[string]uint64{}, gitSeen: map[string]gitSnapshot{}, gitSeenAt: map[string]time.Time{}, roots: map[string]struct{}{},
	}
}

func (b *Activity) ID() string              { return "activity" }
func (b *Activity) Interval() time.Duration { return 0 } // passive: no timer
func (b *Activity) Fetch() tea.Cmd          { return b.reactPending() }
func (b *Activity) FetchInBackground() bool { return false }
func (b *Activity) SetVisible(visible bool) { b.visible = visible }

func (b *Activity) Update(msg tea.Msg) {
	switch m := msg.(type) {
	case WorldMsg:
		b.world = m.World
		b.roots = map[string]struct{}{} // explicit r probes only currently live roots
		for _, p := range m.World.Panes() {
			if p.Sidebar || p.CurrentPath == "" {
				continue
			}
			root := filepath.Clean(p.CurrentPath)
			b.roots[root] = struct{}{}
		}
	case AgentRowsMsg:
		b.updateAgents(m.Rows)
	case gitResultMsg:
		b.gitInFlight = false
		b.updateGit(m)
	}
}

func (b *Activity) updateAgents(rows []agents.Row) {
	// One accepted snapshot may establish several related facts. Capture its
	// timestamp once so their ordering describes a single observed transition.
	now := b.now()
	next := make(map[string]agents.Row, len(rows))
	for _, r := range rows {
		if r.PaneID != "" {
			next[r.IdentityKey()] = r
			if r.Cwd != "" && r.Cwd != "-" {
				b.roots[filepath.Clean(r.Cwd)] = struct{}{}
			}
		}
	}
	if !b.seeded { // first snapshot establishes agent facts without emitting history
		b.facts, b.seeded = next, true
		for id, r := range next {
			if r.State == agents.StateAwaitingPermission || r.State == agents.StateWaiting {
				b.activeAgents[id] = r
			}
		}
		// Git work remains explicit: relevant later transitions or `r` establish
		// baselines. Opening the sidebar never probes every pane cwd.
		return
	}
	for id, old := range b.facts {
		current, ok := next[id]
		if !ok {
			b.resolveAgentFact(old, now)
			b.addAt(now, "OUT", "agent exited · "+activityLocation(old), false, activityAgent, old, "", gitSnapshot{})
			b.queueRoot(old.Cwd)
			continue
		}
		b.agentTransition(old, current, now)
	}
	for id, current := range next {
		if _, existed := b.facts[id]; !existed {
			b.addAt(now, "IN", "agent started · "+activityLocation(current), false, activityAgent, current, "", gitSnapshot{})
			if current.State == agents.StateAwaitingPermission {
				b.addAt(now, "!P", "permission requested · "+activityLocation(current), true, activityAgent, current, "", gitSnapshot{})
			} else if current.State == agents.StateWaiting {
				b.addAt(now, "!W", "waiting · "+activityLocation(current), true, activityAgent, current, "", gitSnapshot{})
				// A freshly discovered agent can already be waiting for a
				// completed response; establish its cwd baseline now rather than
				// waiting for a transition that already happened before this feed.
				b.queueRoot(current.Cwd)
			}
		}
	}
	b.facts = next
	b.activeAgents = map[string]agents.Row{}
	for id, r := range next {
		if r.State == agents.StateAwaitingPermission || r.State == agents.StateWaiting {
			b.activeAgents[id] = r
		}
	}
}

func (b *Activity) agentTransition(old, current agents.Row, now time.Time) {
	if old.State == current.State {
		return
	}
	b.resolveAgentFact(old, now)
	loc := activityLocation(current)
	switch current.State {
	case agents.StateAwaitingPermission:
		b.addAt(now, "!P", "permission requested · "+loc, true, activityAgent, current, "", gitSnapshot{})
	case agents.StateWaiting:
		// A completed response becomes waiting without ever being a "working"
		// event. Add in causal order; newest-first rendering puts the live wait
		// above its completion at the same captured timestamp.
		if old.State == agents.StateThinking {
			b.addAt(now, "OK", "response completed · "+loc, false, activityAgent, current, "", gitSnapshot{})
		}
		b.addAt(now, "!W", "waiting · "+loc, true, activityAgent, current, "", gitSnapshot{})
		b.queueRoot(current.Cwd)
	case agents.StateIdle:
		if old.State == agents.StateThinking || old.State == agents.StateWaiting || old.State == agents.StateAwaitingPermission {
			b.addAt(now, "OK", "response completed · "+loc, false, activityAgent, current, "", gitSnapshot{})
			b.queueRoot(current.Cwd)
		}
	}
}

func (b *Activity) resolveAgentFact(old agents.Row, now time.Time) {
	switch old.State {
	case agents.StateAwaitingPermission:
		b.resolveUrgentAgent(old, "!P")
		b.addAt(now, "OK", "permission resolved · "+activityLocation(old), false, activityAgent, old, "", gitSnapshot{})
	case agents.StateWaiting:
		b.resolveUrgentAgent(old, "!W")
		b.addAt(now, "OK", "waiting resolved · "+activityLocation(old), false, activityAgent, old, "", gitSnapshot{})
	}
}

func (b *Activity) resolveUrgentAgent(agent agents.Row, tag string) {
	for i := range b.entries {
		e := &b.entries[i]
		if e.Kind == activityAgent && e.Tag == tag && e.Urgent && e.Agent.IdentityKey() == agent.IdentityKey() {
			e.Urgent = false
			return
		}
	}
}

func (b *Activity) resolveUrgentGit(key string) {
	for i := range b.entries {
		e := &b.entries[i]
		if e.Kind == activityGit && e.Tag == "G!" && e.Urgent && gitKey(e.Snapshot) == key {
			e.Urgent = false
			return
		}
	}
}

func gitKey(s gitSnapshot) string {
	return s.Root + "\x00" + s.CommonDir + "\x00" + s.GitDir
}

func (b *Activity) add(tag, text string, urgent bool, kind activityKind, agent agents.Row, path string, snap gitSnapshot) {
	b.addAt(b.now(), tag, text, urgent, kind, agent, path, snap)
}

func (b *Activity) addAt(at time.Time, tag, text string, urgent bool, kind activityKind, agent agents.Row, path string, snap gitSnapshot) {
	b.seq++
	e := activityEntry{ID: fmt.Sprintf("%d", b.seq), At: at, Tag: tag, Text: display.Sanitize(text), Urgent: urgent, Kind: kind, Agent: agent, Path: path, Snapshot: snap}
	b.entries = append([]activityEntry{e}, b.entries...)
	if len(b.entries) <= activityHistory {
		return
	}
	// Prefer evicting the oldest resolved/nonurgent event. Active permission and
	// wait facts live separately, so history is always resolved; the urgency
	// preference still preserves the most useful recent blockers under pressure.
	cut := len(b.entries) - 1
	for i := len(b.entries) - 1; i >= 0; i-- {
		if !b.entries[i].Urgent {
			cut = i
			break
		}
	}
	b.entries = append(b.entries[:cut], b.entries[cut+1:]...)
}

func (b *Activity) queueRoot(cwd string) {
	if cwd == "" || cwd == "-" {
		return
	}
	cwd = filepath.Clean(cwd)
	if _, pending := b.pending[cwd]; !pending {
		b.gitSeq++
		b.pending[cwd] = b.gitSeq
	}
}

// React schedules only transition-requested or explicit-refresh roots. The
// pending map is cleared before running commands so consecutive events can
// supersede a slow probe with a newer token; updateGit rejects that stale result.
func (b *Activity) React(msg tea.Msg) tea.Cmd {
	if _, ok := msg.(RefreshMsg); ok {
		for root := range b.roots {
			b.queueRoot(root)
		}
	}
	return b.reactPending()
}

func (b *Activity) reactPending() tea.Cmd {
	if !b.visible || b.gitInFlight || len(b.pending) == 0 {
		return nil
	}
	// Serialize probes across cwd aliases. Two pane cwds can resolve to the same
	// worktree; allowing them to complete out of order can invent dirty/clean or
	// branch transitions in the identity-keyed history.
	var cwd string
	var token uint64
	for candidate, queued := range b.pending {
		if token == 0 || queued < token || (queued == token && candidate < cwd) {
			cwd, token = candidate, queued
		}
	}
	delete(b.pending, cwd)
	b.latest[cwd] = token
	b.gitInFlight = true
	return func() tea.Msg {
		snap, err := probeGit(b.git, cwd)
		return gitResultMsg{Cwd: cwd, Token: token, Snap: snap, Err: err}
	}
}

func (b *Activity) updateGit(m gitResultMsg) {
	// A result is valid only when no newer request for this cwd was issued. A
	// changed worktree identity also starts a silent baseline, never borrowing a
	// status from a different checkout at the same path.
	if queued, ok := b.pending[m.Cwd]; ok && queued != m.Token {
		return // a newer event is queued but has not started yet
	}
	if b.latest[m.Cwd] != m.Token {
		return
	}
	delete(b.latest, m.Cwd)
	if m.Err != nil || m.Snap.Root == "" {
		return
	}
	key := gitKey(m.Snap)
	now := b.now()
	old, seen := b.gitSeen[key]
	b.gitSeen[key] = m.Snap
	b.gitSeenAt[key] = now
	b.pruneGitSeen()
	if m.Snap.Dirty || m.Snap.Operation != "" || m.Snap.Conflict {
		b.activeGit[key] = m.Snap
	} else {
		delete(b.activeGit, key)
	}
	if !seen {
		return
	}
	if old.Dirty != m.Snap.Dirty {
		text := "worktree clean · "
		if m.Snap.Dirty {
			text = "worktree dirty · "
		}
		b.addAt(now, "GD", text+m.Snap.Root, false, activityGit, agents.Row{}, m.Snap.Root, m.Snap)
	}
	if old.Operation != m.Snap.Operation {
		if old.Operation != "" {
			b.addAt(now, "GO", "Git "+old.Operation+" cleared · "+m.Snap.Root, false, activityGit, agents.Row{}, m.Snap.Root, m.Snap)
		}
		if m.Snap.Operation != "" {
			b.addAt(now, "GO", "Git "+m.Snap.Operation+" started · "+m.Snap.Root, false, activityGit, agents.Row{}, m.Snap.Root, m.Snap)
		}
	}
	if old.Conflict != m.Snap.Conflict {
		if m.Snap.Conflict {
			b.addAt(now, "G!", "Git conflict needs attention · "+m.Snap.Root, true, activityGit, agents.Row{}, m.Snap.Root, m.Snap)
		} else {
			b.resolveUrgentGit(key)
			b.addAt(now, "G!", "Git conflict cleared · "+m.Snap.Root, false, activityGit, agents.Row{}, m.Snap.Root, m.Snap)
		}
	}
	if old.Branch != "" && m.Snap.Branch != "" && old.Branch != m.Snap.Branch {
		b.addAt(now, "GB", "branch "+old.Branch+" → "+m.Snap.Branch+" · "+m.Snap.Root, false, activityGit, agents.Row{}, m.Snap.Root, m.Snap)
	}
}

func (b *Activity) pruneGitSeen() {
	for len(b.gitSeen) > activityHistory {
		var oldest string
		var at time.Time
		for key, seen := range b.gitSeenAt {
			if oldest == "" || seen.Before(at) || (seen.Equal(at) && key < oldest) {
				oldest, at = key, seen
			}
		}
		delete(b.gitSeen, oldest)
		delete(b.gitSeenAt, oldest)
		delete(b.activeGit, oldest)
	}
}

func (b *Activity) shown() (int, int) {
	n := activityMax + b.extra
	if n > len(b.entries) {
		n = len(b.entries)
	}
	if b.viewport > 0 {
		available := b.viewport - 1 // label
		if len(b.entries) > available && available > 0 {
			available-- // +N more
		}
		if available < 0 {
			available = 0
		}
		if n > available {
			n = available
		}
	}
	return n, len(b.entries) - n
}
func (b *Activity) SetViewportHeight(height int) { b.viewport = height }
func (b *Activity) SetExtra(n int)               { b.extra = n }
func (b *Activity) Expand(n int) int {
	_, more := b.shown()
	if n <= 0 || more == 0 {
		return 0
	}
	before := b.Height()
	if n > more {
		n = more
	}
	b.extra += n
	return b.Height() - before
}
func (b *Activity) Height() int {
	n, more := b.shown()
	h := 1 + n
	if more > 0 {
		h++
	}
	if h < 2 {
		return 2
	}
	return h
}

// AmbientLines returns recent cached transitions without changing visibility,
// queuing Git work, or mutating the explicit view's viewport/focus state.
func (b *Activity) AmbientLines(width, max int) []string {
	if len(b.entries) == 0 || max < 2 {
		return nil
	}
	lines := []string{label(b.theme.Accent, "recent activity")}
	for _, e := range b.entries {
		if len(lines) >= max {
			break
		}
		style := b.theme.Text
		if e.Urgent {
			style = b.theme.Urgent
		}
		lines = append(lines, "  "+style.Render(padTag(e.Tag)+" "+relativeAge(b.now().Sub(e.At))+" "+e.Text))
	}
	return strings.Split(join(lines, width), "\n")
}

func (b *Activity) View(width int) string {
	lines := []string{label(b.theme.Accent, "activity")}
	if len(b.entries) == 0 {
		lines = append(lines, b.theme.Muted.Render("(none yet)"))
		return join(lines, width)
	}
	n, more := b.shown()
	for i, e := range b.entries[:n] {
		prefix := "  "
		if i == b.focus {
			prefix = b.theme.Accent.Render("▶") + " "
		}
		style := b.theme.Text
		if e.Urgent {
			style = b.theme.Urgent
		}
		if i == b.hover {
			style = style.Underline(true)
		}
		lines = append(lines, prefix+style.Render(padTag(e.Tag)+" "+relativeAge(b.now().Sub(e.At))+" "+e.Text))
	}
	if more > 0 {
		lines = append(lines, b.theme.Muted.Render("  +"+strconv.Itoa(more)+" more"))
	}
	return join(lines, width)
}
func padTag(s string) string {
	for len(s) < 3 {
		s += " "
	}
	return s
}
func relativeAge(d time.Duration) string {
	age := "now"
	if d >= time.Hour {
		hours := int(d / time.Hour)
		if hours > 99 {
			hours = 99
		}
		age = strconv.Itoa(hours) + "h"
	} else if d >= time.Minute {
		age = strconv.Itoa(int(d/time.Minute)) + "m"
	}
	return fmt.Sprintf("%3s", age)
}

func (b *Activity) OnClick(line int) tea.Cmd {
	if i := b.NavigationIndex(line); i >= 0 {
		return b.ActivateNavigation(i)
	}
	return nil
}
func (b *Activity) NavigationCount() int { n, _ := b.shown(); return n }
func (b *Activity) NavigationIndex(line int) int {
	i := line - 1
	if i < 0 || i >= b.NavigationCount() {
		return -1
	}
	return i
}
func (b *Activity) SetNavigationIndex(i int) {
	if i < 0 || i >= b.NavigationCount() {
		b.focus = -1
	} else {
		b.focus = i
	}
}
func (b *Activity) SetHoverLine(line int) bool {
	i := b.NavigationIndex(line)
	b.hover = i
	return i >= 0
}
func (b *Activity) NavigationID(i int) string {
	if i < 0 || i >= b.NavigationCount() {
		return ""
	}
	return b.entries[i].ID
}
func (b *Activity) NavigationIndexByID(id string) int {
	for i := 0; i < b.NavigationCount(); i++ {
		if b.entries[i].ID == id {
			return i
		}
	}
	return -1
}

func (b *Activity) ActivateNavigation(i int) tea.Cmd {
	if i < 0 || i >= b.NavigationCount() {
		return nil
	}
	e := b.entries[i]
	if e.Kind == activityAgent {
		return func() tea.Msg {
			if !b.currentAgent(e.Agent) {
				b.client.DisplayMessage("sidebar: stale agent")
				return nil
			}
			ref := tmuxio.PaneRef{PaneID: e.Agent.PaneID, SessionID: e.Agent.TmuxSessionID, WindowID: e.Agent.WindowID, WindowIndex: e.Agent.WindowIndex}
			b.client.FocusPaneRef(ref)
			return nil
		}
	}
	return b.worktreeAction(e.Path)
}

// IsCurrentAgentAction implements AgentActionValidator for context actions
// originating from historical activity entries. The full immutable pane
// identity and the agent session must both still occur in the latest accepted
// agent facts; tmuxio then rechecks the pane identity in its command queue.
func (b *Activity) IsCurrentAgentAction(action nav.ContextAction) bool {
	if action.Agent == "" || action.AgentSessionID == "" {
		return false
	}
	return b.currentAgent(agents.Row{
		Agent:         action.Agent,
		SessionID:     action.AgentSessionID,
		PaneID:        action.Pane.PaneID,
		TmuxSessionID: action.Pane.SessionID,
		WindowID:      action.Pane.WindowID,
		WindowIndex:   action.Pane.WindowIndex,
	})
}

func (b *Activity) currentAgent(agent agents.Row) bool {
	current, ok := b.facts[agent.IdentityKey()]
	return ok && current.SessionID == agent.SessionID
}
func (b *Activity) worktreeAction(path string) tea.Cmd {
	return func() tea.Msg {
		if info, err := os.Stat(path); err != nil || !info.IsDir() {
			b.client.DisplayMessage("activity: worktree no longer exists")
			return nil
		}
		if pane, ok := b.shallowestPane(path); ok {
			b.client.FocusPaneRef(pane)
			return nil
		}
		if pane, ok := b.contentRef(); ok {
			b.client.SplitAt(pane, path)
		} else {
			b.client.DisplayMessage("activity: no live content pane")
		}
		return nil
	}
}
func (b *Activity) shallowestPane(path string) (tmuxio.PaneRef, bool) {
	var candidates []tmuxio.PaneRow
	for _, p := range b.world.Panes() {
		if !p.Sidebar && p.CurrentPath != "" && strings.HasPrefix(path+string(filepath.Separator), filepath.Clean(p.CurrentPath)+string(filepath.Separator)) {
			candidates = append(candidates, p)
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return len(candidates[i].CurrentPath) < len(candidates[j].CurrentPath) })
	if len(candidates) == 0 {
		return tmuxio.PaneRef{}, false
	}
	return candidates[0].Ref(), true
}
func (b *Activity) contentRef() (tmuxio.PaneRef, bool) {
	p, ok := b.world.PaneSet()[b.world.Snapshot.ContentPane]
	return p.Ref(), ok
}
func (b *Activity) Actions(i int) []nav.ContextAction {
	if i < 0 || i >= b.NavigationCount() {
		return nil
	}
	e := b.entries[i]
	if e.Kind == activityAgent {
		r := e.Agent
		ref := tmuxio.PaneRef{PaneID: r.PaneID, SessionID: r.TmuxSessionID, WindowID: r.WindowID, WindowIndex: r.WindowIndex}
		return []nav.ContextAction{{ID: "focus", Label: "focus agent", Kind: nav.ContextFocusPane, Pane: ref, Agent: r.Agent, AgentSessionID: r.SessionID}, {ID: "response", Label: "open last response", Kind: nav.ContextAgentResponse, Pane: ref, Agent: r.Agent, AgentSessionID: r.SessionID}, {ID: "plan", Label: "open plan / last response", Kind: nav.ContextAgentPlan, Pane: ref, Agent: r.Agent, AgentSessionID: r.SessionID}, {ID: "copy-session", Label: "copy session ID", Kind: nav.ContextCopyText, Text: r.SessionID}}
	}
	if pane, ok := b.shallowestPane(e.Path); ok {
		return []nav.ContextAction{{ID: "focus", Label: "focus worktree", Kind: nav.ContextFocusPane, Pane: pane}, {ID: "split", Label: "open split here", Kind: nav.ContextOpenDir, Pane: pane, Path: e.Path}, {ID: "new-window", Label: "new window here", Kind: nav.ContextNewWindow, Pane: pane, Path: e.Path}, {ID: "copy-path", Label: "copy path", Kind: nav.ContextCopyPath, Path: e.Path}, {ID: "reveal", Label: "reveal in Finder", Kind: nav.ContextRevealPath, Path: e.Path}}
	}
	if pane, ok := b.contentRef(); ok {
		return []nav.ContextAction{{ID: "split", Label: "open split here", Kind: nav.ContextOpenDir, Pane: pane, Path: e.Path}, {ID: "new-window", Label: "new window here", Kind: nav.ContextNewWindow, Pane: pane, Path: e.Path}, {ID: "copy-path", Label: "copy path", Kind: nav.ContextCopyPath, Path: e.Path}, {ID: "reveal", Label: "reveal in Finder", Kind: nav.ContextRevealPath, Path: e.Path}}
	}
	return []nav.ContextAction{{ID: "copy-path", Label: "copy path", Kind: nav.ContextCopyPath, Path: e.Path}}
}
func activityLocation(r agents.Row) string {
	parts := []string{}
	for _, s := range []string{r.PaneLabel, r.WindowName, r.SessionName} {
		if s != "" && s != "-" {
			parts = append(parts, display.Sanitize(s))
		}
	}
	return strings.Join(parts, " · ")
}
