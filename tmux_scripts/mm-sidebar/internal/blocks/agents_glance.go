package blocks

import (
	"sort"
	"strconv"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/theme"
)

// AgentsGlanceMax caps how many agent rows the block shows before collapsing the
// rest into a "+N more" line.
const AgentsGlanceMax = 6

// AgentRowsMsg carries a fresh agent sweep into the model. It is produced by the
// model's long-lived resolver goroutine, not by AgentsGlance.Fetch: the resolver
// holds mutable caches and must not be entered concurrently, which is exactly
// what would happen if a tick-driven Cmd and an fsnotify-driven Cmd both called
// it. See model.go's agentFeed.
type AgentRowsMsg struct {
	Rows []agents.Row
}

// AgentsGlance is a read-only condensed agent status block: always visible
// regardless of the active navigator tab, capped, and sorted by urgency so the
// rows that most need attention are the ones that survive truncation.
type AgentsGlance struct {
	theme theme.Theme
	rows  []agents.Row
	more  int

	// request is how the block asks the model's resolver goroutine for a sweep.
	// Buffered and non-blocking: a coalescing trigger, not a queue.
	request chan<- struct{}
}

// NewAgentsGlance builds the block. request is the resolver goroutine's trigger
// channel.
func NewAgentsGlance(th theme.Theme, request chan<- struct{}) *AgentsGlance {
	return &AgentsGlance{theme: th, request: request}
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
	m, ok := msg.(AgentRowsMsg)
	if !ok {
		return
	}
	rows := make([]agents.Row, len(m.Rows))
	copy(rows, m.Rows)
	// Stable sort by urgency only: within a rank, the resolver's order (Claude
	// rows in sessions-dir order, then pi rows) is preserved so rows don't
	// shuffle between sweeps.
	sort.SliceStable(rows, func(i, j int) bool {
		return agents.StateRank(rows[i].State) < agents.StateRank(rows[j].State)
	})
	if len(rows) > AgentsGlanceMax {
		b.more = len(rows) - AgentsGlanceMax
		rows = rows[:AgentsGlanceMax]
	} else {
		b.more = 0
	}
	b.rows = rows
}

// Height: label + rows (+ the "+N more" line). Minimum 2 so the block never
// vanishes entirely -- an empty agents list still shows "▸ agents / (none)".
func (b *AgentsGlance) Height() int {
	h := 1 + len(b.rows)
	if b.more > 0 {
		h++
	}
	if h < 2 {
		h = 2
	}
	return h
}

func (b *AgentsGlance) View(width int) string {
	lines := make([]string, 0, b.Height())
	lines = append(lines, label(b.theme.Accent, "agents"))
	if len(b.rows) == 0 {
		lines = append(lines, b.theme.Muted.Render("(none)"))
		return join(lines, width)
	}
	for _, r := range b.rows {
		lines = append(lines, "  "+b.renderRow(r))
	}
	if b.more > 0 {
		lines = append(lines, b.theme.Muted.Render("  +"+strconv.Itoa(b.more)+" more"))
	}
	return join(lines, width)
}

// stateTagWidth keeps every row's location starting in the same column so the
// block scans vertically. All four tags are padded to this width.
const stateTagWidth = 2

// renderRow: "<2-char state tag> <window · session>", colored by state using the
// same palette roles as tmux-claude-menu --colorize (rose = blocked on you,
// dusty pink = working, muted = idle).
//
// Two deliberate choices, both forced by the 28-column budget:
//
//   - The tag column is FIXED WIDTH. The words this replaced (!perm / !wait / … /
//     a bare space) were 5, 5, 1 and 1 cells wide, so no two rows started their
//     location in the same column and the block was unscannable.
//   - There is no "[claude]" / "[pi]" suffix. It cost 8 of 28 columns and was the
//     least actionable field on the row -- and it was spending them on the urgent
//     rows, where the *location* (the thing you act on) got truncated instead. A
//     pi pane's window is already auto-named `node`, which reads as pi in
//     practice. State is still double-encoded as color, not just the tag.
func (b *AgentsGlance) renderRow(r agents.Row) string {
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
	loc := r.SessionName
	// "-" is the resolver's placeholder for an absent field (empty fields break
	// tab-delimited shell consumers); don't render it as a location.
	if r.WindowName != "" && r.WindowName != "-" {
		loc = r.WindowName + " · " + r.SessionName
	}
	return style.Render(tag) + " " + b.theme.Text.Render(loc)
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
