package blocks

import (
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"mm-sidebar/internal/agentdetail"
	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/display"
	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
)

// AgentsGlanceMax is the default cap in the explicit full agents view.
const AgentsGlanceMax = 6

// AgentsAttentionMax caps the main-surface blocker summary. Its overflow row
// opens the full agents view; hidden agents are never directly actionable.
const AgentsAttentionMax = 4

// AgentRowsMsg carries a fresh agent sweep into the model. It is produced by the
// model's long-lived resolver goroutine, not by AgentsGlance.Fetch: the resolver
// holds mutable caches and must not be entered concurrently, which is exactly
// what would happen if a tick-driven Cmd and an fsnotify-driven Cmd both called
// it. See model.go's agentFeed.
type AgentRowsMsg struct {
	Rows             []agents.Row
	WorldFingerprint string
}

func (AgentRowsMsg) IsBlockMsg() {}

// AgentDetailMsg is the result of an on-demand selected-agent inspection. Its
// identity and generation are checked by AgentsGlance before it can replace the
// current selection: a slow tail/Git read for a row that was moved past can
// never render beneath a different agent.
type AgentDetailMsg struct {
	Identity   string
	Generation uint64
	Data       agentdetail.Data
	Err        error
}

func (AgentDetailMsg) IsBlockMsg() {}

type detailState uint8

const (
	detailInactive detailState = iota
	detailLoading
	detailReady
	detailUnavailable
)

const detailMaxLines = 7

type stateObservation struct {
	state string
	since time.Time
}

// AgentsGlance owns the complete agent roster. In attention mode it projects
// only permission/wait blockers onto the main surface; in full mode it powers
// the explicit agents view. Both projections are urgency-sorted and capped.
type AgentsGlance struct {
	theme  theme.Theme
	client *tmuxio.Client
	// rows holds every agent from the last sweep, urgency-sorted. Truncation is a
	// render-time decision (see limit), not something baked in on receipt, so the
	// layout can grant more room without waiting for another sweep.
	rows          []agents.Row
	extra         int // additional rows granted in the explicit full agents view
	attentionOnly bool
	viewport      int // explicit-view height; zero means unconstrained
	focus         int // selected visible row; -1 when keyboard focus is elsewhere
	// observedStates is keyed by the stable agent/session identity, not a screen
	// index or urgency rank. It survives resorting and carries the timestamp at
	// which the current state first appeared; absent sessions are pruned on each
	// sweep so a reused identity cannot inherit an old age.
	observedStates map[string]stateObservation
	hover          int // hovered visible row; -1 when the pointer is elsewhere

	// request is how the block asks the model's resolver goroutine for a sweep.
	// Buffered and non-blocking: a coalescing trigger, not a queue.
	request chan<- struct{}

	// The inspector is selection-scoped and deliberately separate from the
	// recurring resolver. It reads a bounded transcript tail plus local Git only
	// after the agent block is focused or explicitly refreshed.
	details          *agentdetail.Collector
	now              func() time.Time
	detailState      detailState
	detailIdentity   string
	detailRow        agents.Row
	detailGeneration uint64
	detailData       agentdetail.Data
	detailErr        error
}

// AgentsGlanceOption configures the on-demand inspector. The clock is injected
// so freshness/caching behavior is deterministic in focused tests.
type AgentsGlanceOption func(*AgentsGlance)

func WithDetailCollector(details *agentdetail.Collector) AgentsGlanceOption {
	return func(b *AgentsGlance) { b.details = details }
}

func WithClock(now func() time.Time) AgentsGlanceOption {
	return func(b *AgentsGlance) {
		if now == nil {
			return
		}
		b.now = now
		// Options apply in order: a later WithDetailCollector deliberately wins,
		// while an earlier custom collector remains the owner of its own clock.
		if b.details == nil {
			b.details = agentdetail.New(agentdetail.Config{Now: now})
		}
	}
}

// NewAgentsGlance builds a standalone block for package users and tests.
func NewAgentsGlance(th theme.Theme, request chan<- struct{}, options ...AgentsGlanceOption) *AgentsGlance {
	return NewAgentsGlanceWithClient(th, tmuxio.NewClient("", ""), request, options...)
}

// NewAgentsGlanceWithClient builds the sidebar block with its invoking tmux
// client context. request is the resolver goroutine's trigger channel.
func NewAgentsGlanceWithClient(th theme.Theme, client *tmuxio.Client, request chan<- struct{}, options ...AgentsGlanceOption) *AgentsGlance {
	b := &AgentsGlance{
		theme: th, client: client, request: request, focus: -1, hover: -1,
		now: time.Now, observedStates: make(map[string]stateObservation),
	}
	for _, option := range options {
		option(b)
	}
	if b.details == nil {
		b.details = agentdetail.New(agentdetail.Config{Now: b.now})
	}
	return b
}

func (b *AgentsGlance) ID() string { return "agents_glance" }

// Interval: agent liveness wants roughly the same freshness the navigator does.
// fsnotify on claude/sessions and the permission-state dir pushes most changes
// in sooner than this; the tick is the backstop that also picks up pi panes
// (pi has no state file to watch).
func (b *AgentsGlance) Interval() time.Duration { return 2 * time.Second }

// Fetch nudges the resolver goroutine rather than resolving inline, so a slow
// sweep can never block the input loop -- the failure the bash version had, where
// a keypress landing inside the 1.26s sweep waited for all of it.
func (b *AgentsGlance) Fetch() tea.Cmd {
	return func() tea.Msg {
		select {
		case b.request <- struct{}{}:
		default: // a sweep is already pending; coalesce
		}
		return nil
	}
}

func (b *AgentsGlance) Update(msg tea.Msg) {
	switch m := msg.(type) {
	case AgentRowsMsg:
		rows := make([]agents.Row, len(m.Rows))
		copy(rows, m.Rows)
		b.observeStates(rows)
		// Stable sort by urgency only: within a rank, the resolver's order (Claude
		// rows in sessions-dir order, then pi rows) is preserved so rows don't
		// shuffle between sweeps.
		sort.SliceStable(rows, func(i, j int) bool {
			priority := func(state string) int {
				switch state {
				case agents.StateAwaitingPermission:
					return 0
				case agents.StateWaiting:
					return 1
				default:
					return agents.StateRank(state) + 1
				}
			}
			return priority(rows[i].State) < priority(rows[j].State)
		})
		b.rows = rows
		if len(rows) == 0 {
			// An empty sweep has no selected agent. Drop every inspector allocation
			// before the next layout so Height and View remain exactly aligned and a
			// late detail command cannot render beneath the empty placeholder.
			b.clearDetail()
		}
		// State is intentionally excluded from detailIdentity: it is live glance
		// data, not an inspector input. Keep the selected row current so its state
		// age changes without restarting a transcript/Git inspection.
		detailCurrent := b.detailIdentity == ""
		for _, row := range rows {
			if detailIdentity(row) == b.detailIdentity {
				b.detailRow = row
				detailCurrent = true
				break
			}
		}
		if !detailCurrent {
			b.clearDetail()
		}
		// The pointer may still be over the same screen line after a refresh, but
		// that line can now belong to another urgency-sorted agent. The model clears
		// hover before every block update; keep this local guard for direct callers.
		b.hover = -1
	case AgentDetailMsg:
		if m.Identity == "" || m.Identity != b.detailIdentity || m.Generation != b.detailGeneration {
			return
		}
		b.detailData, b.detailErr = m.Data, m.Err
		if m.Err != nil {
			b.detailState = detailUnavailable
		} else {
			b.detailState = detailReady
		}
	}
}

// SetAttentionOnly switches between the main-surface blocker summary and the
// explicit full agents view. It never changes the collected roster.
func (b *AgentsGlance) SetAttentionOnly(attention bool) {
	b.attentionOnly = attention
	b.extra, b.focus, b.hover = 0, -1, -1
}

func (b *AgentsGlance) AttentionOnly() bool { return b.attentionOnly }

func (b *AgentsGlance) SetViewportHeight(height int) { b.viewport = height }

func (b *AgentsGlance) visibleRows() []agents.Row {
	if !b.attentionOnly {
		return b.rows
	}
	rows := make([]agents.Row, 0, len(b.rows))
	for _, row := range b.rows {
		if row.State == agents.StateAwaitingPermission || row.State == agents.StateWaiting {
			rows = append(rows, row)
		}
	}
	return rows
}

func (b *AgentsGlance) shown() (n, more int) {
	rows := b.visibleRows()
	limit := AgentsGlanceMax + b.extra
	if b.attentionOnly {
		limit = AgentsAttentionMax
	}
	if limit > len(rows) {
		limit = len(rows)
	}
	if !b.attentionOnly && b.viewport > 0 {
		available := b.viewport - 1 // label
		if len(rows) > available && available > 0 {
			available-- // +N more
		}
		if available < 0 {
			available = 0
		}
		if limit > available {
			limit = available
		}
	}
	return limit, len(rows) - limit
}

func (b *AgentsGlance) SetExtra(n int) {
	if b.attentionOnly {
		b.extra = 0
		return
	}
	b.extra = n
}

// Expand is used only by the explicit full agents view. The main attention
// summary stays capped so it cannot take over the navigator.
func (b *AgentsGlance) Expand(n int) int {
	if b.attentionOnly || n <= 0 {
		return 0
	}
	before := b.Height()
	_, more := b.shown()
	if n > more {
		n = more
	}
	b.extra += n
	return b.Height() - before
}

func (b *AgentsGlance) Height() int {
	n, more := b.shown()
	if b.attentionOnly && n == 0 {
		return 0
	}
	h := 1 + n
	if more > 0 {
		h++
	}
	if !b.attentionOnly && h < 2 {
		return 2
	}
	return h
}

func (b *AgentsGlance) View(width int) string {
	if b.Height() == 0 {
		return ""
	}
	rows := b.visibleRows()
	lines := make([]string, 0, b.Height())
	if b.attentionOnly {
		lines = append(lines, attentionLabel(b.theme, width))
	} else {
		lines = append(lines, label(b.theme.Accent, "agents"))
	}
	if len(rows) == 0 {
		lines = append(lines, b.theme.Muted.Render("(none)"))
		return join(lines, width)
	}
	n, more := b.shown()
	for i, r := range rows[:n] {
		prefix := "  "
		if i == b.focus {
			prefix = b.theme.Accent.Render("▶") + " "
		}
		lines = append(lines, prefix+b.renderRow(i, r))
	}
	if more > 0 {
		prefix := "  "
		if b.attentionOnly && b.focus == n {
			prefix = b.theme.Accent.Render("▶") + " "
		}
		lines = append(lines, prefix+b.theme.Muted.Render("+"+strconv.Itoa(more)+" more · v agents"))
	}
	return join(lines, width)
}

func attentionLabel(th theme.Theme, width int) string {
	text := " attention "
	remain := width - len(text) - 1
	if remain < 0 {
		remain = 0
	}
	return th.Divider.Render("─") + th.Accent.Render(text) + th.Divider.Render(strings.Repeat("─", remain))
}

// BeginInspection is the only entry into the inspector. Merely selecting or
// focusing an agent never starts transcript or Git work.
func (b *AgentsGlance) BeginInspection(sessionID string, fresh bool) (tea.Cmd, bool) {
	var row agents.Row
	found := false
	for _, candidate := range b.rows {
		if candidate.SessionID == sessionID {
			row, found = candidate, true
			break
		}
	}
	if !found {
		return nil, false
	}
	identity := detailIdentity(row)
	if identity != b.detailIdentity {
		b.detailGeneration++
		b.detailIdentity, b.detailRow = identity, row
		b.detailData, b.detailErr = agentdetail.Data{}, nil
	}
	b.detailState = detailLoading
	return b.refreshDetail(fresh), true
}

func (b *AgentsGlance) clearDetail() {
	b.detailGeneration++
	b.detailState = detailInactive
	b.detailIdentity = ""
	b.detailRow = agents.Row{}
	b.detailData, b.detailErr = agentdetail.Data{}, nil
}

func (b *AgentsGlance) RefreshInspector(fresh bool) tea.Cmd { return b.refreshDetail(fresh) }

func (b *AgentsGlance) refreshDetail(fresh bool) tea.Cmd {
	if b.detailIdentity == "" || b.detailState == detailInactive || b.details == nil {
		return nil
	}
	b.detailGeneration++
	identity, generation, row := b.detailIdentity, b.detailGeneration, b.detailRow
	b.detailState, b.detailErr = detailLoading, nil
	return func() tea.Msg {
		var (
			data agentdetail.Data
			err  error
		)
		if fresh {
			data, err = b.details.CollectFresh(row)
		} else {
			data, err = b.details.Collect(row)
		}
		return AgentDetailMsg{Identity: identity, Generation: generation, Data: data, Err: err}
	}
}

func (b *AgentsGlance) rowByNavigationID(id string) (agents.Row, bool) {
	for i := 0; i < b.NavigationCount(); i++ {
		if navigationIdentity(b.rows[i]) == id {
			return b.rows[i], true
		}
	}
	return agents.Row{}, false
}

func navigationIdentity(r agents.Row) string { return r.IdentityKey() }

func detailIdentity(r agents.Row) string {
	return strings.Join([]string{r.Agent, r.PaneID, r.SessionID, r.Transcript, r.Cwd}, "\x1f")
}

// observedIdentity uses the agent's persistent session ID when available. A
// pane ID is only a fallback for malformed/legacy rows with no session ID.
func observedIdentity(r agents.Row) string {
	stable := r.SessionID
	if stable == "" || stable == "-" {
		stable = r.PaneID
	}
	return strings.Join([]string{r.Agent, stable}, "\x1f")
}

func (b *AgentsGlance) observeStates(rows []agents.Row) {
	now := b.now()
	seen := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		identity := observedIdentity(row)
		if identity == "\x1f" {
			continue
		}
		seen[identity] = struct{}{}
		if prior, ok := b.observedStates[identity]; ok && prior.state == row.State {
			continue
		}
		b.observedStates[identity] = stateObservation{state: row.State, since: now}
	}
	for identity := range b.observedStates {
		if _, ok := seen[identity]; !ok {
			delete(b.observedStates, identity)
		}
	}
}

func (b *AgentsGlance) stateAge(row agents.Row) time.Duration {
	observation, ok := b.observedStates[observedIdentity(row)]
	if !ok || observation.since.IsZero() {
		return 0
	}
	age := b.now().Sub(observation.since)
	if age < 0 {
		return 0
	}
	return age
}

func humanAge(age time.Duration) string {
	switch {
	case age < time.Minute:
		return "now"
	case age < time.Hour:
		return strconv.Itoa(int(age/time.Minute)) + "m"
	case age < 24*time.Hour:
		return strconv.Itoa(int(age/time.Hour)) + "h"
	default:
		return strconv.Itoa(int(age/(24*time.Hour))) + "d"
	}
}

func (b *AgentsGlance) detailLines() []string {
	if b.detailState == detailInactive {
		return nil
	}
	lines := []string{"state: " + display.Sanitize(b.detailRow.State) + " · " + humanAge(b.stateAge(b.detailRow))}
	switch b.detailState {
	case detailLoading:
		lines = append(lines, "inspecting…")
	case detailUnavailable:
		lines = append(lines, "inspector unavailable")
	case detailReady:
		for _, field := range []struct{ label, value string }{
			{"prompt", b.detailData.Prompt}, {"response", b.detailData.Response},
			{"plan", b.detailData.Plan}, {"cwd", b.detailData.Cwd},
		} {
			if field.value != "" && field.value != "-" {
				lines = append(lines, field.label+": "+display.Sanitize(field.value))
			}
		}
		if b.detailData.Worktree != "" && b.detailData.Worktree != "-" && filepath.Clean(b.detailData.Worktree) != filepath.Clean(b.detailData.Cwd) {
			lines = append(lines, "worktree: "+display.Sanitize(b.detailData.Worktree))
		}
		if b.detailData.Git != "" && b.detailData.Git != "-" {
			lines = append(lines, "git: "+display.Sanitize(b.detailData.Git))
		}
	}
	if len(lines) > detailMaxLines {
		return lines[:detailMaxLines]
	}
	return lines
}

func (b *AgentsGlance) InspectorView(width, height int) string {
	lines := []string{label(b.theme.Accent, "agent inspector")}
	lines = append(lines, b.detailLines()...)
	lines = append(lines, b.theme.Muted.Render("r refresh  Esc back"))
	for len(lines) < height {
		lines = append(lines, "")
	}
	if len(lines) > height {
		lines = lines[:height]
	}
	return join(lines, width)
}

func (b *AgentsGlance) InspectorActive() bool { return b.detailState != detailInactive }

// OnClick implements Clickable: a click on an agent row switches to that agent's
// pane. Line 0 is the "▸ agents" label and the trailing "+N more" counter is
// inert, as is the "(none)" placeholder -- View's line order is
// label, rows[0..n), then the optional counter, so block-local line i+1 is
// rows[i].
//
// The tmux calls fork and block, so they are returned inside a Cmd and run off
// the input path, mirroring the model's own act().
//
// agents.Row already carries both fields FocusPane wants: PaneID is "%161" and
// Target is the human-facing "sess:2.1", which switch-client resolves -- so an
// agent in a DIFFERENT session switches the client correctly with no extra
// plumbing.
func (b *AgentsGlance) OnClick(line int) tea.Cmd {
	if i := b.NavigationIndex(line); i >= 0 {
		return b.ActivateNavigation(i)
	}
	return nil
}

// NavigationCount exposes only currently visible agent rows. Hidden rows behind
// "+N more" are intentionally not keyboard reachable until the layout expands
// the block, keeping keyboard focus consistent with what is rendered.
func (b *AgentsGlance) NavigationCount() int {
	n, more := b.shown()
	if b.attentionOnly && more > 0 {
		return n + 1
	}
	return n
}

// SetHoverLine implements Hoverable. Only rendered agent rows accept hover;
// labels, placeholders, and the hidden-row counter clear it.
func (b *AgentsGlance) SetHoverLine(line int) bool {
	index := b.NavigationIndex(line)
	if index < 0 {
		b.hover = -1
		return false
	}
	b.hover = index
	return true
}

func (b *AgentsGlance) SetNavigationIndex(index int) {
	if index < 0 || index >= b.NavigationCount() {
		b.focus = -1
		return
	}
	b.focus = index
}

// NavigationID and NavigationIndexByID implement SelectionIdentifiable. Agent
// session plus full pane identity survives urgency sorting but not an in-place
// session replacement, so a retained selection cannot target the replacement.
func (b *AgentsGlance) NavigationID(index int) string {
	if index < 0 || index >= b.NavigationCount() {
		return ""
	}
	rows := b.visibleRows()
	shown, _ := b.shown()
	if index >= shown {
		return "view:agents"
	}
	return rows[index].IdentityKey()
}

func (b *AgentsGlance) NavigationIndexByID(id string) int {
	if id == "" {
		return -1
	}
	rows := b.visibleRows()
	shown, _ := b.shown()
	for i := 0; i < b.NavigationCount(); i++ {
		if i >= shown {
			if id == "view:agents" {
				return i
			}
			continue
		}
		if rows[i].IdentityKey() == id {
			return i
		}
	}
	return -1
}

func (b *AgentsGlance) NavigationIndex(line int) int {
	i := line - 1 // line 0 is the block label
	if i < 0 || i >= b.NavigationCount() {
		return -1
	}
	return i
}

func (b *AgentsGlance) ActivateNavigation(index int) tea.Cmd {
	if index < 0 || index >= b.NavigationCount() {
		return nil
	}
	rows := b.visibleRows()
	shown, _ := b.shown()
	if index >= shown {
		return func() tea.Msg { return OpenViewMsg{ID: "agents"} }
	}
	row := rows[index]
	ref := tmuxio.PaneRef{
		PaneID: row.PaneID, SessionID: row.TmuxSessionID,
		WindowID: row.WindowID, WindowIndex: row.WindowIndex,
	}
	return func() tea.Msg {
		b.client.FocusPaneRef(ref)
		return nil
	}
}

// Actions implements the optional block action registry. It intentionally uses
// existing response/plan dispatchers: the glance remains a focused shortcut,
// not a second M-b picker or an approval surface.
func (b *AgentsGlance) Actions(index int) []nav.ContextAction {
	if index < 0 || index >= b.NavigationCount() {
		return nil
	}
	rows := b.visibleRows()
	shown, _ := b.shown()
	if index >= shown {
		return nil
	}
	r := rows[index]
	ref := tmuxio.PaneRef{
		PaneID: r.PaneID, SessionID: r.TmuxSessionID,
		WindowID: r.WindowID, WindowIndex: r.WindowIndex,
	}
	return []nav.ContextAction{
		{ID: "inspect", Label: "inspect agent", Local: nav.LocalEffectInspectAgent, Agent: r.Agent, AgentSessionID: r.SessionID},
		{ID: "focus", Label: "focus agent", Kind: nav.ContextFocusPane, Pane: ref, PaneID: r.PaneID, Target: r.Target, Agent: r.Agent, AgentSessionID: r.SessionID},
		{ID: "response", Label: "open last response", Kind: nav.ContextAgentResponse, Pane: ref, Agent: r.Agent, AgentSessionID: r.SessionID},
		{ID: "plan", Label: "open plan / last response", Kind: nav.ContextAgentPlan, Pane: ref, Agent: r.Agent, AgentSessionID: r.SessionID},
		{ID: "copy-session", Label: "copy session ID", Kind: nav.ContextCopyText, Text: r.SessionID},
	}
}

// stateTagWidth keeps every row's location starting in the same column so the
// block scans vertically. All four tags are padded to this width.
const stateTagWidth = 2

// renderRow: "<2-char state tag> <pane label · window · session>", colored by
// state using the same palette roles as tmux-claude-menu --colorize (rose = blocked on you,
// dusty pink = working, muted = idle).
//
// Two deliberate choices, both forced by the narrow column budget (28 at the
// time; the reasoning still holds at 36):
//
//   - The tag column is FIXED WIDTH. The words this replaced (!perm / !wait / … /
//     a bare space) were 5, 5, 1 and 1 cells wide, so no two rows started their
//     location in the same column and the block was unscannable.
//   - There is no "[claude]" / "[pi]" suffix. It cost 8 of 28 columns and was the
//     least actionable field on the row -- and it was spending them on the urgent
//     rows, where the *location* (the thing you act on) got truncated instead. A
//     pi pane's window is already auto-named `node`, which reads as pi in
//     practice. State is still double-encoded as color, not just the tag.
func (b *AgentsGlance) renderRow(index int, r agents.Row) string {
	var tag string
	style := b.theme.Muted
	switch r.State {
	case agents.StateAwaitingPermission:
		tag, style = "!P", b.theme.Urgent
	case agents.StateWaiting:
		tag, style = "!W", b.theme.Urgent
	case agents.StateThinking:
		tag, style = "~~", b.theme.Busy
	default:
		tag = "" // idle: blank, padded below
	}
	for len(tag) < stateTagWidth {
		tag += " "
	}
	loc := agentLocation(r)
	locationStyle := b.theme.Text
	if index == b.hover {
		locationStyle = locationStyle.Underline(true)
	}
	return style.Render(tag) + " " + locationStyle.Render(loc)
}

// agentLocation keeps the display identity ordered from pane-specific to broad:
// label · window · session. "-" is the TSV placeholder for an absent field and
// must not leak into the visible location. The normal ANSI-aware line clipping
// happens after composition, preserving this left-to-right priority at 36 cols.
func agentLocation(r agents.Row) string {
	parts := make([]string, 0, 3)
	if r.PaneLabel != "" && r.PaneLabel != "-" {
		parts = append(parts, display.Sanitize(r.PaneLabel))
	}
	if r.WindowName != "" && r.WindowName != "-" {
		parts = append(parts, display.Sanitize(r.WindowName))
	}
	if r.SessionName != "" && r.SessionName != "-" {
		parts = append(parts, display.Sanitize(r.SessionName))
	}
	return strings.Join(parts, " · ")
}

func join(lines []string, width int) string {
	out := ""
	for i, l := range lines {
		if i > 0 {
			out += "\n"
		}
		out += clip(l, width)
	}
	return out
}
