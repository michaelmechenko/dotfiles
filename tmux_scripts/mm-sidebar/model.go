package main

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
	"github.com/fsnotify/fsnotify"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/blocks"
	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
)

// Layout constants.
const (
	// headerLines: the tab strip plus the "▸ <active tab>" subtitle.
	headerLines = 2
	// helpLines: the inline help overlay, when toggled on with '?'.
	helpLines = 6
	// navMinHeight: the navigator never shrinks below this. When it would,
	// docked blocks are dropped from the end of the block list instead.
	navMinHeight = 3
	// navTickInterval re-polls tmux state (sessions/windows/cwd) so the sidebar
	// follows changes made elsewhere without needing input. Below ~1s the
	// repaint cost becomes visible; above ~5s the view feels stale.
	navTickInterval = 2 * time.Second
)

type model struct {
	theme theme.Theme

	// Geometry, from WindowSizeMsg (Bubble Tea tracks SIGWINCH for us).
	width, height int

	// tmux state.
	winTarget   string
	selfPane    string
	contentPane string

	// Navigator.
	tab     nav.Tab
	rows    []nav.Row
	sel     int
	vpStart int // first visible row index
	// lineRow maps each rendered navigator line back to its row index (-1 for
	// padding), rebuilt on every View. Rows are variable-height, so the mouse
	// handler cannot derive the row from the click's Y offset arithmetically.
	lineRow  []int
	showHelp bool

	// Filetree browse root. Only re-derived from the content pane's cwd when the
	// content pane actually changes (tracked by ftLastPane), so Backspace-up
	// isn't silently reset by the next poll.
	ftRoot     string
	ftLastPane string

	// Docked blocks, in render order. This slice is also the degradation
	// priority: blocks are dropped from the END first on a short pane.
	docked []blocks.Block

	feed *agentFeed
}

func newModel() *model {
	th := theme.Load()
	feed := newAgentFeed()
	return &model{
		theme: th,
		docked: []blocks.Block{
			blocks.NewAgentsGlance(th, feed.request),
			blocks.NewSystemStats(th),
		},
		feed: feed,
	}
}

// ---- messages -------------------------------------------------------------

// stateMsg is one combined tmux-state + navigator-rows refresh. Both are
// gathered in a single Cmd so a poll costs one round of forks, not one per
// consumer.
type stateMsg struct {
	snap        tmuxio.Snapshot
	contentPane string
	ftRoot      string
	tab         nav.Tab
	rows        []nav.Row
}

// tickMsg fires a block's own cadence. Blocks with genuinely different
// freshness needs (agent liveness vs. machine load) each get their own timer
// rather than sharing one dirty flag.
type tickMsg struct{ blockID string }

// navTickMsg is the navigator/tmux-state poll.
type navTickMsg struct{}

// editDoneMsg returns control after an external editor exited.
type editDoneMsg struct{}

// ---- lifecycle ------------------------------------------------------------

func (m *model) Init() tea.Cmd {
	cmds := []tea.Cmd{
		tea.ClearScreen, // the pane may still show shell output from before the split
		m.refreshState(),
		m.feed.wait(),
		m.feed.watch(),
		tea.Tick(navTickInterval, func(time.Time) tea.Msg { return navTickMsg{} }),
	}
	for _, b := range m.docked {
		cmds = append(cmds, b.Fetch(), tickFor(b))
	}
	return tea.Batch(cmds...)
}

func tickFor(b blocks.Block) tea.Cmd {
	id := b.ID()
	return tea.Tick(b.Interval(), func(time.Time) tea.Msg { return tickMsg{blockID: id} })
}

func (m *model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil

	case tea.KeyMsg:
		return m.handleKey(msg)

	case tea.MouseMsg:
		return m.handleMouse(msg)

	case stateMsg:
		m.applyState(msg)
		return m, nil

	case navTickMsg:
		return m, tea.Batch(
			m.refreshState(),
			tea.Tick(navTickInterval, func(time.Time) tea.Msg { return navTickMsg{} }),
		)

	case tickMsg:
		for _, b := range m.docked {
			if b.ID() == msg.blockID {
				return m, tea.Batch(b.Fetch(), tickFor(b))
			}
		}
		return m, nil

	case blocks.AgentRowsMsg:
		for _, b := range m.docked {
			b.Update(msg)
		}
		// Re-arm the reader: the feed goroutine publishes one result per sweep.
		return m, m.feed.wait()

	case blocks.SystemStatsMsg:
		for _, b := range m.docked {
			b.Update(msg)
		}
		return m, nil

	case editDoneMsg:
		// Returning from nvim: repaint from scratch and re-read everything, since
		// the buffer may have changed and the screen is whatever nvim left.
		return m, tea.Batch(tea.ClearScreen, m.refreshState())
	}
	return m, nil
}

// ---- state refresh --------------------------------------------------------

// refreshState gathers the tmux snapshot, resolves the content pane, and fetches
// the active tab's rows -- all in one Cmd, off the input path.
func (m *model) refreshState() tea.Cmd {
	tab := m.tab
	ftRoot := m.ftRoot
	ftLastPane := m.ftLastPane
	th := m.theme
	return func() tea.Msg {
		snap, err := tmuxio.Query()
		if err != nil {
			return nil
		}

		// The persisted tab is authoritative: tmux-sidebar-toggle may have set
		// @sidebar_source before this process started, and it survives a
		// scratch-editor round trip.
		if snap.Source != "" {
			tab = nav.ParseTab(snap.Source)
		}

		content := resolveContentPane(snap)
		cwd := ""
		if content != "" {
			cwd = tmuxio.PaneCurrentPath(content)
		}
		if cwd == "" {
			cwd = homeDir()
		}
		// Re-root the filetree only when the content pane itself changed, so a
		// Backspace-navigated root survives the next poll.
		if ftRoot == "" || content != ftLastPane {
			ftRoot = cwd
		}

		var rows []nav.Row
		switch tab {
		case nav.TabSessions:
			rows = nav.FetchSessions(th)
		case nav.TabWindows:
			rows = nav.FetchWindows(th)
		case nav.TabFiletree:
			rows = nav.FetchFiletree(th, ftRoot)
		case nav.TabScratch:
			rows = nav.FetchScratch(th, cwd)
		}
		return stateMsg{snap: snap, contentPane: content, ftRoot: ftRoot, tab: tab, rows: rows}
	}
}

func (m *model) applyState(msg stateMsg) {
	m.winTarget = msg.snap.WinTarget
	m.selfPane = msg.snap.PaneID
	m.contentPane = msg.contentPane
	m.ftLastPane = msg.contentPane
	m.ftRoot = msg.ftRoot
	m.tab = msg.tab
	m.rows = msg.rows
	m.clampSel()
	// WindowSizeMsg is the normal source of geometry, but the very first render
	// can land before it arrives; the snapshot has the same numbers.
	if m.height == 0 {
		m.width, m.height = msg.snap.PaneWidth, msg.snap.PaneHeight
	}
}

// resolveContentPane keeps @sidebar_content_pane pointing at a live pane. If the
// recorded pane is gone, the pane immediately right of the sidebar is the content
// area by construction (the sidebar is always leftmost and full height) -- the
// neo-tree "don't lose track of the target window" guarantee.
func resolveContentPane(snap tmuxio.Snapshot) string {
	if snap.ContentPane != "" && tmuxio.PaneAlive(snap.ContentPane) {
		return snap.ContentPane
	}
	found := tmuxio.RightOfPane(snap.PaneLeft)
	if found != "" && snap.WinTarget != "" {
		tmuxio.SetWinOpt(snap.WinTarget, "@sidebar_content_pane", found)
	}
	return found
}

// ---- keys -----------------------------------------------------------------

func (m *model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "esc", "ctrl+c":
		return m, m.quit()
	case "j", "down":
		m.move(1)
	case "k", "up":
		m.move(-1)
	case "g", "home":
		m.sel = 0
	case "G", "end":
		m.sel = len(m.rows) - 1
		m.clampSel()
	case "r":
		return m, tea.Batch(m.refreshState(), m.fetchAllBlocks())
	case "?":
		m.showHelp = !m.showHelp
	case "1":
		return m, m.setTab(nav.TabSessions)
	case "2":
		return m, m.setTab(nav.TabWindows)
	case "3":
		return m, m.setTab(nav.TabFiletree)
	case "4":
		return m, m.setTab(nav.TabScratch)
	case "tab":
		return m, m.cycleTab(1)
	case "shift+tab":
		return m, m.cycleTab(-1)
	case "enter":
		return m, m.act()
	case "backspace":
		if m.tab == nav.TabFiletree {
			return m, m.filetreeUp()
		}
	}
	return m, nil
}

func (m *model) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	switch msg.Button {
	case tea.MouseButtonWheelUp:
		m.move(-1)
	case tea.MouseButtonWheelDown:
		m.move(1)
	case tea.MouseButtonLeft:
		if msg.Action != tea.MouseActionPress {
			return m, nil
		}
		// Map the clicked screen line back to a navigator row through the mapping
		// the last render recorded. Clicks on the header, on padding, or on a
		// docked block are ignored -- blocks are glances and hold no cursor.
		// Either line of a two-line row selects that row.
		line := msg.Y - m.navFirstLine()
		if line >= 0 && line < len(m.lineRow) && m.lineRow[line] >= 0 {
			m.sel = m.lineRow[line]
		}
	}
	return m, nil
}

func (m *model) navFirstLine() int {
	if m.showHelp {
		return headerLines + helpLines
	}
	return headerLines
}

func (m *model) move(delta int) {
	if len(m.rows) == 0 {
		m.sel = 0
		return
	}
	n := len(m.rows)
	m.sel = ((m.sel+delta)%n + n) % n // wraps, like the bash dispatcher
}

func (m *model) clampSel() {
	if m.sel >= len(m.rows) {
		m.sel = len(m.rows) - 1
	}
	if m.sel < 0 {
		m.sel = 0
	}
}

func (m *model) setTab(t nav.Tab) tea.Cmd {
	if m.tab == t {
		return nil
	}
	m.tab = t
	m.sel = 0
	m.rows = nil
	if m.winTarget != "" {
		tmuxio.SetWinOpt(m.winTarget, "@sidebar_source", t.Name())
	}
	return m.refreshState()
}

func (m *model) cycleTab(delta int) tea.Cmd {
	n := len(nav.Tabs)
	idx := 0
	for i, t := range nav.Tabs {
		if t == m.tab {
			idx = i
		}
	}
	return m.setTab(nav.Tabs[((idx+delta)%n+n)%n])
}

func (m *model) filetreeUp() tea.Cmd {
	parent := parentDir(m.ftRoot)
	if parent == m.ftRoot {
		return nil
	}
	m.ftRoot = parent
	m.sel = 0
	return m.refreshState()
}

func (m *model) fetchAllBlocks() tea.Cmd {
	cmds := make([]tea.Cmd, 0, len(m.docked))
	for _, b := range m.docked {
		cmds = append(cmds, b.Fetch())
	}
	return tea.Batch(cmds...)
}

// act runs the selected row's action. ActionEditFile is special: it suspends the
// TUI so the editor gets this pane, then resumes -- the pane is the sidebar's,
// so there is nowhere else to put it.
func (m *model) act() tea.Cmd {
	if len(m.rows) == 0 {
		return nil
	}
	row := m.rows[m.sel]
	if row.Kind == nav.ActionEditFile {
		return tea.ExecProcess(exec.Command("nvim", "--", row.Path), func(error) tea.Msg {
			return editDoneMsg{}
		})
	}
	content := m.contentPane
	return func() tea.Msg {
		nav.Act(row, content)
		return nil
	}
}

// quit clears the window-scoped pane options and hands focus back to the content
// pane before exiting. The sidebar pane dies with this process (tmux ran it as
// the pane's command), so selecting the content pane first makes the post-close
// focus deterministic instead of whatever pane tmux happens to pick.
//
// @sidebar_source is deliberately left set, so re-opening the sidebar in this
// window restores the tab that was active.
func (m *model) quit() tea.Cmd {
	if m.winTarget != "" {
		tmuxio.UnsetWinOpt(m.winTarget, "@sidebar_pane_id")
		tmuxio.UnsetWinOpt(m.winTarget, "@sidebar_content_pane")
	}
	tmuxio.SelectPane(m.contentPane)
	return tea.Quit
}

// ---- view -----------------------------------------------------------------

// View renders exactly m.height lines: header (+ help) -> navigator -> docked
// blocks. Bubble Tea's renderer diffs this against the previous frame, so there
// is no manual clear-to-end-of-line bookkeeping and no reserved scroll row.
func (m *model) View() string {
	if m.height <= 0 || m.width <= 0 {
		return ""
	}
	lines := make([]string, 0, m.height)
	lines = append(lines, m.headerLines()...)
	if m.showHelp {
		lines = append(lines, m.helpLines()...)
	}

	usable := m.height - len(lines)
	if usable < 1 {
		usable = 1
	}

	active, navAvail := m.layout(usable)
	lines = append(lines, m.navLines(navAvail)...)
	for _, b := range active {
		lines = append(lines, m.dividerLine())
		lines = append(lines, splitLines(b.View(m.width), b.Height())...)
	}

	// Pad/clamp to exactly the pane height so the frame never scrolls.
	for len(lines) < m.height {
		lines = append(lines, "")
	}
	return joinLines(lines[:m.height])
}

// layout sizes the navigator to its ACTUAL content and lets the blocks float up
// directly beneath it, so everything the sidebar knows sits in one compact stack
// at the top of the pane and the unused space collects at the bottom.
//
// Two earlier versions both failed the same way, from opposite directions:
// giving the navigator all the leftover space, and giving it a fixed 60% share.
// A tall pane is much taller than the content -- on a 55-row pane a 3-session
// list left a 33-row void in the MIDDLE either way, between the last row and
// "▸ agents". There is no share of a 55-row pane that three sessions fill; the
// only fix is to stop reserving space the navigator cannot use.
//
// Leftover space is then offered to blocks that can show more of what they
// already hold (agents_glance drops its "+N more" and lists everything), because
// a "+1 more" above 30 blank rows is the same information-density failure in
// miniature.
func (m *model) layout(usable int) ([]blocks.Block, int) {
	for _, b := range m.docked {
		if e, ok := b.(blocks.Expandable); ok {
			e.SetExtra(0) // recomputed below; layout runs every frame
		}
	}

	// Drop blocks from the END of the list (lowest priority first, system_stats
	// before agents_glance) until they fit alongside a minimal navigator.
	active := m.docked
	for len(active) > 0 && dockCost(active) > usable-navMinHeight {
		active = active[:len(active)-1]
	}

	navAvail := m.navContentLines()
	if room := usable - dockCost(active); navAvail > room {
		navAvail = room // a long list is viewport-clipped instead
	}
	if navAvail < navMinHeight {
		navAvail = navMinHeight
	}

	for slack := usable - navAvail - dockCost(active); slack > 0; {
		grew := false
		for _, b := range active {
			e, ok := b.(blocks.Expandable)
			if !ok {
				continue
			}
			if used := e.Expand(slack); used > 0 {
				slack -= used
				grew = true
			}
		}
		if !grew {
			break
		}
	}
	return active, navAvail
}

// dockCost is the lines the given blocks occupy, including one divider row each.
func dockCost(bs []blocks.Block) int {
	total := 0
	for _, b := range bs {
		total += b.Height() + 1
	}
	return total
}

// navContentLines is how many lines the current rows actually need. Rows are
// variable-height, so this is a sum, not a count.
func (m *model) navContentLines() int {
	if len(m.rows) == 0 {
		return 1 // the "(empty)" placeholder
	}
	total := 0
	for _, r := range m.rows {
		total += len(r.Lines)
	}
	return total
}

func (m *model) headerLines() []string {
	strip := ""
	for i, t := range nav.Tabs {
		if i > 0 {
			strip += " "
		}
		chip := strconv.Itoa(i+1) + t.Short()
		if t == m.tab {
			strip += m.theme.ActiveTab.Render(chip)
		} else {
			strip += m.theme.Muted.Render(chip)
		}
	}
	return []string{
		clipLine(strip, m.width),
		clipLine(m.theme.Accent.Render("▸ "+m.tab.Name()), m.width),
	}
}

func (m *model) helpLines() []string {
	out := []string{
		"j/k ↑/↓ move    1-4/Tab switch tab",
		"Enter   act     r       refetch",
		"g/G     top/end ?       toggle help",
		"q/Esc   close   click   select row",
		"filetree: Backspace = up one dir",
		"agents: !P perm !W wait ~~ busy",
	}
	for i, l := range out {
		out[i] = clipLine(m.theme.Muted.Render(l), m.width)
	}
	return out
}

// navLines renders a viewport-clipped window of rows that follows the cursor,
// padded to exactly avail lines. Without the clipping, a row list longer than
// the space it was given scrolls the pane and pushes the header out of view.
//
// Rows are variable-height (sessions/windows are two lines, filetree/scratch
// one), so the viewport is scrolled in ROW units but measured in LINE units, and
// the rendered line -> row index mapping is recorded in m.lineRow for the mouse
// handler. Deriving the row from the click's Y offset arithmetically only worked
// while every row was exactly one line tall.
func (m *model) navLines(avail int) []string {
	if avail < 1 {
		avail = 1
	}
	m.lineRow = m.lineRow[:0]
	out := make([]string, 0, avail)
	pad := func() []string {
		for len(out) < avail {
			out = append(out, "")
			m.lineRow = append(m.lineRow, -1)
		}
		return out
	}

	if len(m.rows) == 0 {
		m.vpStart = 0
		out = append(out, clipLine(m.theme.Muted.Render("(empty)"), m.width))
		m.lineRow = append(m.lineRow, -1)
		return pad()
	}

	m.vpStart = m.scrollTo(avail)

	// 2 columns for the cursor prefix; continuation lines are indented under it.
	rowWidth := m.width - 2
	if rowWidth < 1 {
		rowWidth = 1
	}
	for i := m.vpStart; i < len(m.rows) && len(out) < avail; i++ {
		for j, line := range m.rows[i].Lines {
			if len(out) >= avail {
				break
			}
			prefix := "  "
			if j == 0 && i == m.sel {
				prefix = m.theme.Accent.Render("▶") + " "
			}
			out = append(out, prefix+clipLine(line, rowWidth))
			m.lineRow = append(m.lineRow, i)
		}
	}
	return pad()
}

// scrollTo returns the first row index to render so that the selected row is
// fully visible within avail lines, scrolling by the minimum needed. Anchoring
// the selection mid-viewport (the old behavior) doesn't generalize to
// variable-height rows without the view jumping on every move.
func (m *model) scrollTo(avail int) int {
	total := 0
	for _, r := range m.rows {
		total += len(r.Lines)
	}
	if total <= avail {
		return 0
	}
	start := m.vpStart
	if start > m.sel {
		start = m.sel
	}
	if start < 0 {
		start = 0
	}
	for start < m.sel {
		used := 0
		for i := start; i <= m.sel; i++ {
			used += len(m.rows[i].Lines)
		}
		if used <= avail {
			break
		}
		start++
	}
	return start
}

// ---- agent feed -----------------------------------------------------------

// agentFeed owns the one Resolver and serializes access to it.
//
// The resolver holds mutable caches (pane-set fingerprint, pid->cwd, pid->ppid,
// transcript paths) and is not safe for concurrent use. Bubble Tea runs Cmds in
// separate goroutines, so a tick-driven fetch and an fsnotify-driven fetch would
// otherwise enter it at the same time. Funnelling every request through one
// goroutine keeps it single-threaded AND keeps a slow sweep entirely off the
// input path -- the bash version blocked its key loop for the whole 1.26s.
type agentFeed struct {
	request chan struct{}     // coalescing trigger (buffered 1)
	results chan []agents.Row // one published sweep (buffered 1)
	watch   func() tea.Cmd
}

func newAgentFeed() *agentFeed {
	f := &agentFeed{
		request: make(chan struct{}, 1),
		results: make(chan []agents.Row, 1),
	}
	resolver := agents.NewResolver()
	go func() {
		for range f.request {
			rows, err := resolver.Resolve()
			if err != nil {
				continue
			}
			f.results <- rows
		}
	}()
	f.watch = func() tea.Cmd { return f.watchCmd(resolver.WatchDirs()) }
	return f
}

// wait blocks in its own goroutine until a sweep is published. Re-armed by the
// model each time an AgentRowsMsg is handled.
func (f *agentFeed) wait() tea.Cmd {
	return func() tea.Msg {
		return blocks.AgentRowsMsg{Rows: <-f.results}
	}
}

// watchCmd turns Claude's on-disk state into pushes. Claude Code writes live
// status into claude/sessions/<pid>.json and the Notification hook writes/clears
// /tmp/claude-session-state/<sessionId>, so watching both surfaces a state change
// as soon as it happens instead of on the next poll. pi has no equivalent file,
// which is why the periodic tick remains the backstop.
//
// The watcher runs for the process lifetime and only ever triggers a sweep; it
// never touches model state, so it needs no synchronization.
func (f *agentFeed) watchCmd(dirs []string) tea.Cmd {
	return func() tea.Msg {
		w, err := fsnotify.NewWatcher()
		if err != nil {
			return nil // no watches: the periodic tick still covers everything
		}
		for _, d := range dirs {
			_ = w.Add(d) // a missing dir (no permission prompts yet) is fine
		}
		go func() {
			defer w.Close()
			for {
				select {
				case _, ok := <-w.Events:
					if !ok {
						return
					}
					select {
					case f.request <- struct{}{}:
					default: // sweep already pending; coalesce
					}
				case _, ok := <-w.Errors:
					if !ok {
						return
					}
				}
			}
		}()
		return nil
	}
}

// dividerLine renders one full-width horizontal rule in the divider-subtle role,
// separating the navigator from each docked block.
func (m *model) dividerLine() string {
	return m.theme.Divider.Render(strings.Repeat("─", m.width))
}

// ---- small helpers --------------------------------------------------------

func clipLine(s string, width int) string {
	if width <= 0 {
		return ""
	}
	if ansi.StringWidth(s) <= width {
		return s
	}
	return ansi.Truncate(s, width, "…")
}

// splitLines normalizes a block's View to exactly n lines, so the layout math
// and the rendered frame can't disagree.
func splitLines(s string, n int) []string {
	out := make([]string, 0, n)
	cur := ""
	for _, r := range s {
		if r == '\n' {
			out = append(out, cur)
			cur = ""
			continue
		}
		cur += string(r)
	}
	out = append(out, cur)
	for len(out) < n {
		out = append(out, "")
	}
	return out[:n]
}

func joinLines(lines []string) string {
	out := ""
	for i, l := range lines {
		if i > 0 {
			out += "\n"
		}
		out += l
	}
	return out
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

func homeDir() string {
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return h
	}
	if h := os.Getenv("HOME"); h != "" {
		return h
	}
	return "/"
}
