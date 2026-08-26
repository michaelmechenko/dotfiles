package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"
	"github.com/fsnotify/fsnotify"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/blocks"
	"mm-sidebar/internal/display"
	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
	"mm-sidebar/internal/trace"
)

// Layout constants.
const (
	// headerLines: the tab strip plus the "▸ <active tab>" subtitle.
	headerLines = 2
	// navTickInterval re-polls tmux state (sessions/windows/cwd) so the sidebar
	// follows changes made elsewhere without needing input. Below ~1s the
	// repaint cost becomes visible; above ~5s the view feels stale.
	navTickInterval = 2 * time.Second
)

type model struct {
	client *tmuxio.Client
	theme  theme.Theme

	// Lifetime is owned by runSidebar. Every watcher and background resolver
	// selects on ctx.Done so a Bubble Tea quit or HUP cannot leave work behind.
	ctx    context.Context
	cancel context.CancelFunc
	close  sync.Once

	// Geometry, from WindowSizeMsg (Bubble Tea tracks SIGWINCH for us).
	width, height int

	// tmux state.
	winTarget    string
	selfPane     string
	contentPane  string
	contentRef   tmuxio.PaneRef
	contentCwd   string
	sidebarWidth int // persisted @sidebar_width; zero means use the launch fallback

	// Navigator. srcIdx indexes nav.Sources -- the registry is the only place
	// tabs are enumerated, so there is no tab enum to keep in sync.
	srcIdx int
	// sourceGeneration invalidates refreshes started before a local tab choice.
	// The persisted tmux option is authoritative only for generation zero (the
	// initial load); after that, an in-process choice must win over an older
	// snapshot that races with it.
	sourceGeneration uint64
	// rows always preserves the source's display order. Filtering is a view over
	// this slice rather than a replacement, so source order and refresh payloads
	// remain authoritative.
	rows []nav.Row
	sel  int // index into navigatorRows(), never the unfiltered source slice
	// selectionID keeps the navigator cursor attached to its source-local Row.ID
	// when a refresh reorders rows or a query narrows and widens the view.
	selectionID string
	vpStart     int // first visible filtered row index
	// queryActive owns the inline filter focus. A query line is rendered while it
	// is active; Esc clears it and returns to normal navigator keys before a
	// later Esc can close the sidebar.
	queryActive bool
	query       string
	// actionPalette is a generic modal over the selected row's source-owned
	// descriptors. It deliberately stores no source type or tab name.
	actionPalette  bool
	actionSel      int
	paletteActions []nav.ContextAction
	confirmAction  *nav.ContextAction
	// panePreview is an explicit, on-demand modal from a pane row action. It
	// never participates in the recurring World poll or source fetch key.
	panePreview  bool
	previewTitle string
	previewLines []string
	previewErr   error
	// diagnostics is a cached modal: it reads model state collected by normal
	// refreshes and never starts a tmux, Git, or filesystem command of its own.
	diagnostics bool
	// lineRow maps each rendered navigator line back to its row index (-1 for
	// padding), rebuilt on every View. Rows are variable-height, so the mouse
	// handler cannot derive the row from the click's Y offset arithmetically.
	lineRow []int
	// blockLines maps each rendered line BELOW the navigator to its owning block
	// and the line's offset within that block. Dividers and padding get a nil
	// block. Recorded during View for the same reason lineRow is: the mapping
	// then cannot disagree with the frame, whereas recomputing it from layout()
	// would read Height() values that layout resets and re-grants every frame.
	blockLines []blockHit
	showHelp   bool
	// Hover follows the rendered block-local line, independently of keyboard
	// focus. Hoverable blocks decide whether that line is actionable.
	hoverBlock blocks.Hoverable
	hoverLine  int

	// Keyboard focus spans the navigator and any visible block implementing
	// blocks.Navigable. Informational blocks remain outside this sequence.
	focusRegion       focusRegion
	focusBlock        int            // index in docked when focusRegion == focusBlock
	focusRow          int            // selected row in the active block
	blockSelections   map[int]int    // retained selection for each Navigable block
	blockSelectionIDs map[int]string // stable IDs for blocks whose rows reorder

	// fetchKey identifies the inputs `rows` was last fetched for: source id,
	// content pane, filetree root and the tmux fingerprint. refreshState skips
	// the source's Fetch entirely while it is unchanged.
	fetchKey string
	// stateSeq orders every refresh completion, including skipped and failed
	// polls. Bubble Tea Cmds run concurrently; an older World must never replace
	// newer pane targets, rows, or agent inputs.
	stateSeq         uint64
	appliedStateSeq  uint64
	worldFingerprint string
	rowContextKey    string
	// Diagnostics retains the latest accepted observation and refresh outcome.
	// These counters describe work the normal refresh already performed; viewing
	// diagnostics is therefore free of recurring forks.
	world          tmuxio.World
	lastSnapshot   tmuxio.Snapshot
	lastStateErr   string
	lastFetchErr   string
	lastRefresh    time.Duration
	refreshApplied uint64
	sourceFetches  uint64
	sourceSkips    uint64

	// Source-owned root state is meaningful only to optional RootSynchronizer /
	// SourceController implementations. Keeping it generic prevents filetree
	// controls from creating source-name branches in the model.
	sourceRoot     string
	sourceRootPane string
	rootPinned     bool
	showHidden     bool
	watchRoot      string // last root handed to the optional filesystem watcher

	// Docked blocks, in render order. This slice is also the degradation
	// priority: blocks are dropped from the END first on a short pane.
	docked []blocks.Block
	// blockVisible records the latest layout decision. It drives optional block
	// visibility and background-fetch contracts without naming concrete blocks.
	blockVisible map[string]bool

	feed      *agentFeed
	fileWatch *filetreeWatch
}

// blockHit is one rendered line's owner: the block it belongs to and the line's
// offset inside that block. A nil Block marks a divider or padding row.
type blockHit struct {
	block blocks.Block
	local int
}

type focusRegion uint8

const (
	focusNavigator focusRegion = iota
	focusBlock
)

func newModel(client *tmuxio.Client) *model {
	return newModelWithContext(context.Background(), client)
}

func newModelWithContext(parent context.Context, client *tmuxio.Client) *model {
	if client == nil {
		client = tmuxio.NewClient("", "")
	}
	ctx, cancel := context.WithCancel(parent)
	th := theme.Load(client)
	feed := newAgentFeed(ctx, client)
	return &model{
		client:       client,
		theme:        th,
		ctx:          ctx,
		cancel:       cancel,
		selfPane:     client.PaneID(),
		docked:       blocks.Build(blocks.Deps{Theme: th, Client: client, Agents: feed.request}),
		blockVisible: make(map[string]bool),
		feed:         feed,
		fileWatch:    newFiletreeWatch(ctx),
	}
}

// Close stops all process-lifetime work. It is idempotent because HUP, q, and
// Bubble Tea errors can all converge on the same shutdown path.
func (m *model) Close() {
	m.close.Do(func() {
		m.cancel()
		m.feed.Close()
		m.fileWatch.Close()
	})
}

// ---- messages -------------------------------------------------------------

// stateMsg is one combined tmux-state + navigator-rows refresh. Both are
// gathered in a single Cmd so a poll costs one round of forks, not one per
// consumer.
type stateMsg struct {
	world            tmuxio.World
	snap             tmuxio.Snapshot
	contentPane      string
	cwd              string
	root             string
	rootPane         string
	srcIdx           int
	sourceGeneration uint64
	rows             []nav.Row
	// fetchKey identifies the inputs `rows` was fetched for. Empty means the
	// source was NOT re-fetched this poll and the model must keep its cached
	// rows -- see refreshState.
	fetchKey      string
	contextKey    string
	stateSeq      uint64
	stateErr      error
	fetchErr      error
	elapsed       time.Duration
	sourceFetched bool
}

// tickMsg fires a block's own cadence. Blocks with genuinely different
// freshness needs (agent liveness vs. machine load) each get their own timer
// rather than sharing one dirty flag.
type tickMsg struct{ blockID string }

// navTickMsg is the navigator/tmux-state poll.
type navTickMsg struct{}

// filetreeChangedMsg is emitted by the scoped watcher when the current root or
// one of its immediate subdirectories changes. Its refresh must be forced: the
// tmux fingerprint intentionally cannot see filesystem-only changes.
type filetreeChangedMsg struct{}

// editDoneMsg returns control after an external editor exited.
type editDoneMsg struct{}

type sidebarWidthMsg int

type panePreviewMsg struct {
	title string
	body  string
	err   error
}

// contextActionMsg is the generic completion channel for source-owned palette
// actions. A successful action can request a fresh source snapshot without
// teaching the model which source produced it.
type contextActionMsg struct {
	result nav.ActionResult
	err    error
}

type localContextActionMsg struct {
	action nav.ContextAction
	err    error
}

// ---- lifecycle ------------------------------------------------------------

func (m *model) Init() tea.Cmd {
	m.feed.Start()
	m.fileWatch.Start()
	cmds := []tea.Cmd{
		tea.ClearScreen, // the pane may still show shell output from before the split
		m.refreshState(false),
		m.feed.wait(),
		m.fileWatch.wait(),
		tea.Tick(navTickInterval, func(time.Time) tea.Msg { return navTickMsg{} }),
	}
	// Do not fetch here: dimensions have not arrived, so visibility/degradation
	// is unknown. syncBlockVisibility samples newly visible blocks after the
	// first state/size update instead.
	for _, b := range m.docked {
		cmds = append(cmds, tickFor(b))
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
		return m, m.syncBlockVisibility()

	case tea.KeyMsg:
		return m.handleKey(msg)

	case tea.MouseMsg:
		return m.handleMouse(msg)

	case stateMsg:
		// A refresh that began before a local tab choice may still finish after
		// it. Its snapshot and rows belong to the old source, so discard the
		// whole state message rather than letting it revert the selection.
		if msg.sourceGeneration != m.sourceGeneration {
			return m, nil
		}
		if msg.stateSeq < m.appliedStateSeq {
			return m, nil
		}
		m.applyState(msg)
		if msg.stateErr == nil && m.feed != nil {
			m.feed.setWorld(msg.world)
		}
		return m, m.syncBlockVisibility()

	case navTickMsg:
		return m, tea.Batch(
			m.refreshState(false),
			tea.Tick(navTickInterval, func(time.Time) tea.Msg { return navTickMsg{} }),
		)

	case filetreeChangedMsg:
		// Always re-arm the one blocking wait. The watcher is source-optional, so
		// a queued event after a tab switch is inert without naming that source.
		if m.fileWatch == nil {
			return m, nil
		}
		if m.srcIdx < 0 || m.srcIdx >= len(nav.Sources) {
			return m, m.fileWatch.wait()
		}
		if _, ok := nav.Sources[m.srcIdx].(nav.Watchable); !ok {
			return m, m.fileWatch.wait()
		}
		return m, tea.Batch(m.refreshState(true), m.fileWatch.wait())

	case tickMsg:
		for _, b := range m.docked {
			if b.ID() == msg.blockID {
				cmds := []tea.Cmd{tickFor(b)}
				if m.shouldFetchBlock(b) {
					cmds = append(cmds, b.Fetch())
				}
				return m, tea.Batch(cmds...)
			}
		}
		return m, nil

	// AgentRowsMsg is a BlockMsg too, so this arm MUST stay above the generic one
	// (Go takes the first matching case). It is listed separately only because of
	// the feed re-arm, which is model-owned resolver plumbing rather than
	// something a block knows about.
	case blocks.AgentRowsMsg:
		// A resolver sweep may finish after a newer World was accepted. Re-arm
		// the feed either way, but never publish rows for stale pane identities.
		if msg.WorldFingerprint == "" || msg.WorldFingerprint == m.worldFingerprint {
			m.broadcast(msg)
		}
		return m, tea.Batch(m.feed.wait(), m.syncBlockVisibility())

	// Every other block message, including ones added later. Blocks ignore
	// messages they don't own, so a broadcast is cheaper than a registry lookup
	// and keeps model.go out of the "add a block" recipe entirely.
	case blocks.BlockMsg:
		m.broadcast(msg)
		return m, m.syncBlockVisibility()

	case sidebarWidthMsg:
		m.sidebarWidth = int(msg)
		return m, nil

	case panePreviewMsg:
		m.previewTitle, m.previewErr = msg.title, msg.err
		m.previewLines = previewLines(msg.body)
		m.panePreview = true
		return m, nil

	case localContextActionMsg:
		if msg.err != nil {
			m.client.ShowMessage(msg.err.Error())
			return m, nil
		}
		cmd, _ := m.applyContextEffect(msg.action)
		return m, cmd

	case contextActionMsg:
		if msg.err != nil {
			m.client.ShowMessage(msg.err.Error())
			return m, nil
		}
		if msg.result.Refresh {
			return m, m.refreshState(true)
		}
		return m, nil

	case editDoneMsg:
		// Returning from nvim: repaint from scratch and re-read everything, since
		// the buffer may have changed and the screen is whatever nvim left.
		return m, tea.Batch(tea.ClearScreen, m.refreshState(true))
	}
	return m, nil
}

// broadcast hands a block message to every docked block. Blocks absorb only
// their own message type and ignore the rest, which is what lets a new block
// arrive without model.go learning its name.
func (m *model) broadcast(msg tea.Msg) {
	// A data refresh can replace the row below a stationary pointer. Clear it
	// before block-owned updates so hover never transfers to a different row.
	m.clearHover()
	for _, b := range m.docked {
		b.Update(msg)
	}
	// Re-resolve identity-backed selections immediately, before a following
	// Enter can act on a stale row index. View repeats this after layout.
	m.syncFocus(m.currentArrangement())
}

// ---- state refresh --------------------------------------------------------

// refreshState gathers the tmux snapshot, resolves the content pane, and fetches
// the active tab's rows -- all in one Cmd, off the input path.
//
// The source Fetch is GATED. Through revision 4 it ran unconditionally every
// 2s, and on the sessions/panes tabs it shells tmux-fzf-nav, which itself forks
// display-message + list-sessions + list-panes + awk: ~8 processes every two
// seconds, forever, whether or not anything had changed. It now runs only when
// fetchKey moves -- i.e. when the tab, the content pane, the filetree root, or
// the tmux fingerprint (Snapshot.Fingerprint) actually differs.
//
// Because the key includes the source id and the root, a tab switch and a
// Backspace-ascend both invalidate it on their own and need no special casing.
// force is for the inputs the key CANNOT see: an explicit `r`, and returning
// from the scratch editor (the file changed; no tmux state did).
func (m *model) refreshState(force bool) tea.Cmd {
	srcIdx := m.srcIdx
	sourceGeneration := m.sourceGeneration
	root, rootPane := m.sourceRoot, m.sourceRootPane
	rootPinned, showHidden := m.rootPinned, m.showHidden
	lastKey := m.fetchKey
	th := m.theme
	client := m.client
	m.stateSeq++
	stateSeq := m.stateSeq
	return func() tea.Msg {
		started := time.Now()
		if trace.Enabled {
			defer trace.Phase("refresh-total", started)
		}
		t := started
		world, err := client.World()
		if err != nil {
			return stateMsg{srcIdx: srcIdx, sourceGeneration: sourceGeneration, stateSeq: stateSeq, stateErr: err, elapsed: time.Since(started)}
		}
		snap := world.Snapshot
		trace.Phase("tmux-world", t)
		if sourceGeneration == 0 && snap.Source != "" {
			srcIdx = nav.SourceByID(snap.Source)
		}

		panes := world.PaneSet()
		content := resolveContentPane(client, world)
		cwd := panes.CurrentPath(content)
		if cwd == "" {
			cwd = homeDir()
		}
		source := nav.Sources[srcIdx]
		ctx := nav.Ctx{
			Theme: th, Cwd: cwd, ContentPane: content, Root: root, RootPane: rootPane,
			RootPinned: rootPinned, ShowHidden: showHidden, World: world,
		}
		if rooted, ok := source.(nav.RootSynchronizer); ok {
			root, rootPane = rooted.SyncRoot(ctx)
			ctx.Root, ctx.RootPane = root, rootPane
		}

		contextKey := strings.Join([]string{source.ID(), content, cwd, root, strconv.FormatBool(rootPinned), strconv.FormatBool(showHidden)}, "\x1f")
		invalidation := snap.Fingerprint
		if keyed, ok := source.(nav.FetchKeyer); ok {
			invalidation = keyed.FetchKey(ctx)
		}
		key := contextKey + "\x1f" + invalidation
		if !force && key == lastKey {
			trace.Phase("source-skipped", time.Now())
			return stateMsg{
				world: world, snap: snap, contentPane: content, cwd: cwd, root: root, rootPane: rootPane,
				srcIdx: srcIdx, sourceGeneration: sourceGeneration, stateSeq: stateSeq, contextKey: contextKey,
				elapsed: time.Since(started),
			}
		}

		t = time.Now()
		rows, fetchErr := source.Fetch(ctx)
		trace.Phase("source-fetch:"+source.ID(), t)
		return stateMsg{
			world: world, snap: snap, contentPane: content, cwd: cwd, root: root, rootPane: rootPane,
			srcIdx: srcIdx, sourceGeneration: sourceGeneration,
			rows: rows, fetchKey: key, contextKey: contextKey,
			stateSeq: stateSeq, fetchErr: fetchErr, elapsed: time.Since(started), sourceFetched: true,
		}
	}
}

func (m *model) applyState(msg stateMsg) {
	m.appliedStateSeq = msg.stateSeq
	m.refreshApplied++
	m.lastRefresh = msg.elapsed
	if msg.sourceFetched {
		m.sourceFetches++
	} else if msg.stateErr == nil {
		m.sourceSkips++
	}
	if msg.stateErr != nil {
		m.lastStateErr = msg.stateErr.Error()
		return
	}
	m.lastStateErr = ""
	m.world, m.lastSnapshot = msg.world, msg.snap
	m.winTarget = msg.snap.WinTarget
	m.sidebarWidth = msg.snap.SidebarWidth
	m.worldFingerprint = msg.world.Fingerprint()
	if msg.snap.PaneID != "" {
		m.selfPane = msg.snap.PaneID
	}
	m.contentPane = msg.contentPane
	m.contentRef = msg.world.PaneSet()[msg.contentPane].Ref()
	m.contentCwd = msg.cwd
	m.sourceRoot = msg.root
	m.sourceRootPane = msg.rootPane
	m.srcIdx = msg.srcIdx
	m.syncSourceWatch()
	if msg.fetchKey != "" {
		if msg.fetchErr == nil {
			m.lastFetchErr = ""
			m.rememberNavigatorSelection()
			m.rows = msg.rows
			m.fetchKey = msg.fetchKey
			m.rowContextKey = msg.contextKey
		} else {
			m.lastFetchErr = msg.fetchErr.Error()
			// A failed fetch must retry even when it belongs to the same context:
			// keeping fetchKey would make the next unchanged World skip it forever.
			m.fetchKey = ""
			if msg.contextKey != m.rowContextKey {
				// Rows from another source/root/content pane are unsafe to keep: their
				// Enter actions target the old context, so clear them while retaining
				// only the new context identity.
				m.rows = nil
				m.rowContextKey = msg.contextKey
			}
		}
	}
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
func resolveContentPane(client *tmuxio.Client, world tmuxio.World) string {
	snap, panes := world.Snapshot, world.PaneSet()
	if pane, ok := panes[snap.ContentPane]; ok && pane.SessionID == snap.SessionID && pane.WindowIndex == snap.WindowIndex {
		return snap.ContentPane
	}
	bestLeft, found := 0, ""
	for _, pane := range world.Panes() {
		if pane.SessionID != snap.SessionID || pane.WindowIndex != snap.WindowIndex || pane.PaneLeft <= snap.PaneLeft {
			continue
		}
		if found == "" || pane.PaneLeft < bestLeft {
			bestLeft, found = pane.PaneLeft, pane.PaneID
		}
	}
	if found != "" && snap.WinTarget != "" {
		client.SetWinOpt(snap.WinTarget, "@sidebar_content_pane", found)
	}
	return found
}

// ---- keys -----------------------------------------------------------------

func (m *model) handleKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	key := msg.String()
	if m.diagnostics {
		switch key {
		case "esc", "q", "d", "enter", "space":
			m.diagnostics = false
		}
		return m, nil
	}
	if m.panePreview {
		switch key {
		case "esc", "q", "enter", "space":
			m.panePreview, m.previewLines, m.previewErr = false, nil, nil
		}
		return m, nil
	}
	if m.actionPalette {
		return m.handleActionKey(msg)
	}
	if m.queryActive {
		return m.handleQueryKey(msg)
	}
	if controller, ok := nav.Sources[m.srcIdx].(nav.SourceController); ok {
		if control, handled := controller.HandleSourceKey(key, m.navCtx()); handled {
			return m, m.applySourceControl(control)
		}
	}
	switch key {
	case "q", "esc", "ctrl+c":
		return m, m.quit()
	case "/":
		m.beginQuery()
		return m, m.syncBlockVisibility()
	case "a", ":":
		m.openActionPalette()
		return m, nil
	// Lowercase movement stays in the current focus region. Region rotation is
	// explicit so a long navigator list cannot accidentally enter an agent row.
	case "j", "down":
		m.moveWithinRegion(1)
	case "k", "up":
		m.moveWithinRegion(-1)
	// Ghostty transports Ctrl-Tab/Ctrl-Shift-Tab as unmodified F13/F14 so tmux
	// forwards them into this pane without root bindings. Keep those aliases
	// local to the sidebar: F13 remains Ctrl-Tab for zsh and pi elsewhere.
	case "J", "f13":
		m.cycleFocusRegion(1)
	case "K", "f14":
		m.cycleFocusRegion(-1)
	case "g", "home":
		m.focusFirst()
	case "G", "end":
		m.focusLast()
	case "r":
		return m, tea.Batch(m.refreshState(true), m.fetchAllBlocks())
	case "w":
		return m, m.cycleSidebarWidth()
	case "?":
		m.showHelp = !m.showHelp
		return m, m.syncBlockVisibility()
	case "d":
		m.diagnostics = true
		return m, nil
	case "tab":
		return m, m.cycleTab(1)
	case "shift+tab":
		return m, m.cycleTab(-1)
	case "enter":
		return m, m.act()
	default:
		// Number keys select a tab by position, derived from the registry -- so a
		// fifth Source is reachable as "5" with no edit here. The length check has
		// to come FIRST: an if-statement's init clause runs before its condition,
		// so indexing key[0] there panics on an empty KeyMsg.String() and takes the
		// whole sidebar down.
		if len(key) == 1 {
			if d := int(key[0] - '0'); d >= 1 && d <= len(nav.Sources) {
				return m, m.setSource(d - 1)
			}
		}
	}
	return m, nil
}

// handleActionKey owns the in-TUI confirmation boundary. A destructive action
// can only leave this pane after a second explicit y/Enter confirmation; its
// tmuxio execution then revalidates the immutable rendered identity.
func (m *model) handleActionKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	key := msg.String()
	if m.confirmAction != nil {
		switch key {
		case "y", "Y", "enter":
			action := *m.confirmAction
			m.closeActionPalette()
			return m, m.runContextAction(action)
		case "n", "N", "esc", "q":
			m.confirmAction = nil
		}
		return m, nil
	}
	actions := m.paletteActions
	if len(actions) == 0 {
		m.closeActionPalette()
		return m, nil
	}
	switch key {
	case "esc", "q":
		m.closeActionPalette()
	case "j", "down":
		m.actionSel = (m.actionSel + 1) % len(actions)
	case "k", "up":
		m.actionSel = (m.actionSel - 1 + len(actions)) % len(actions)
	case "enter":
		action := actions[m.actionSel]
		if action.Destructive {
			m.confirmAction = &action
			return m, nil
		}
		m.closeActionPalette()
		return m, m.runContextAction(action)
	}
	return m, nil
}

func (m *model) openActionPalette() {
	actions := m.selectedActions()
	if len(actions) == 0 {
		return
	}
	m.paletteActions = append(m.paletteActions[:0], actions...)
	m.actionPalette, m.actionSel, m.confirmAction = true, 0, nil
}

func (m *model) closeActionPalette() {
	m.actionPalette, m.actionSel, m.confirmAction = false, 0, nil
	m.paletteActions = nil
}

func (m *model) selectedActions() []nav.ContextAction {
	if m.focusRegion == focusBlock {
		if m.focusBlock < 0 || m.focusBlock >= len(m.docked) {
			return nil
		}
		if actionable, ok := m.docked[m.focusBlock].(blocks.Actionable); ok {
			return actionable.Actions(m.focusRow)
		}
		return nil
	}
	rows := m.navigatorRows()
	if m.sel < 0 || m.sel >= len(rows) {
		return nil
	}
	return rows[m.sel].Actions
}

func (m *model) runContextAction(action nav.ContextAction) tea.Cmd {
	if action.Local != nav.LocalEffectNone {
		return func() tea.Msg {
			return localContextActionMsg{action: action, err: nav.ValidateProjectAction(action)}
		}
	}
	if action.Kind == nav.ContextPreviewPane {
		return func() tea.Msg {
			body, err := m.client.CapturePane(action.Pane)
			return panePreviewMsg{title: action.Label, body: body, err: err}
		}
	}
	content := m.contentRef
	return func() tea.Msg {
		result, err := nav.ExecuteContextAction(m.client, action, content)
		return contextActionMsg{result: result, err: err}
	}
}

// applyContextEffect owns context actions that affect only this TUI. Their
// descriptors name an optional source or an editor path, so this lifecycle code
// stays generic rather than branching on the Projects/Filetree/Scratch types.
func (m *model) applyContextEffect(action nav.ContextAction) (tea.Cmd, bool) {
	switch action.Local {
	case nav.LocalEffectSource:
		idx := nav.SourceByID(action.SourceID)
		if idx < 0 || idx >= len(nav.Sources) || nav.Sources[idx].ID() != action.SourceID {
			return nil, true
		}
		control := action.SourceControl
		if control.SetRoot {
			m.sourceRoot, m.sourceRootPane = control.Root, control.RootPane
		}
		if control.SetRootPinned {
			m.rootPinned = control.RootPinned
		}
		if control.SetShowHidden {
			m.showHidden = control.ShowHidden
		}
		if idx != m.srcIdx {
			return m.setSource(idx), true
		}
		if control.Refresh {
			m.sourceGeneration++
			m.sel, m.selectionID = 0, ""
			m.queryActive, m.query = false, ""
			m.rows = nil
			m.lastFetchErr = ""
			m.syncSourceWatch()
			return m.refreshState(false), true
		}
		return nil, true
	case nav.LocalEffectEditFile:
		return m.editFile(action.Path), true
	default:
		return nil, false
	}
}

func (m *model) editFile(path string) tea.Cmd {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return func() tea.Msg {
			m.client.ShowMessage(err.Error())
			return nil
		}
	}
	return tea.ExecProcess(exec.Command("nvim", "--", path), func(error) tea.Msg {
		return editDoneMsg{}
	})
}

// handleQueryKey keeps printable input (including Bubble Tea's bracketed-paste
// KeyRunes messages) inside the filter while leaving the non-text F13/F14
// focus-region controls available. This makes filtering a navigator view, not a
// separate modal that can strand block focus.
func (m *model) handleQueryKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.clearQuery()
		return m, m.syncBlockVisibility()
	case "ctrl+c":
		return m, m.quit()
	case "backspace":
		m.deleteQueryRune()
		return m, m.syncBlockVisibility()
	case "f13":
		m.cycleFocusRegion(1)
		return m, nil
	case "f14":
		m.cycleFocusRegion(-1)
		return m, nil
	case "up":
		m.moveWithinRegion(-1)
		return m, nil
	case "down":
		m.moveWithinRegion(1)
		return m, nil
	case "enter":
		return m, m.act()
	}
	if msg.Type == tea.KeyRunes {
		m.appendQuery(string(msg.Runes))
		return m, m.syncBlockVisibility()
	}
	return m, nil
}

func (m *model) beginQuery() {
	m.rememberNavigatorSelection()
	m.queryActive = true
}

func (m *model) clearQuery() {
	m.rememberNavigatorSelection()
	m.queryActive, m.query = false, ""
	m.clampSel()
}

// appendQuery accepts Unicode and bracketed paste while keeping the inline
// control to one terminal line. Control characters cannot match a source's
// sanitized SearchText or render safely, so normalize them to spaces.
func (m *model) appendQuery(text string) {
	m.rememberNavigatorSelection()
	text = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, text)
	if text == "" {
		return
	}
	m.query += text
	m.clampSel()
}

func (m *model) deleteQueryRune() {
	if m.query == "" {
		return
	}
	m.rememberNavigatorSelection()
	_, size := utf8.DecodeLastRuneInString(m.query)
	m.query = m.query[:len(m.query)-size]
	m.clampSel()
}

func (m *model) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	if m.actionPalette {
		return m, nil
	}
	if !tea.MouseEvent(msg).IsWheel() {
		m.hoverAt(msg.Y)
	}
	switch msg.Button {
	case tea.MouseButtonWheelUp:
		m.wheel(-1, msg.Y)
	case tea.MouseButtonWheelDown:
		m.wheel(1, msg.Y)
	case tea.MouseButtonLeft:
		if msg.Action != tea.MouseActionPress {
			return m, nil
		}
		// Map the clicked screen line back through the tables the last render
		// recorded: the navigator region first, then the docked blocks below it.
		// Clicks on the header, on a divider, or on padding do nothing.
		line := msg.Y - m.navFirstLine()
		if line < 0 {
			return m, nil
		}
		if line < len(m.lineRow) {
			// Navigator: either line of a two-line row selects that row.
			if m.lineRow[line] >= 0 {
				m.focusRegion = focusNavigator
				m.sel = m.lineRow[line]
				m.rememberNavigatorSelection()
			}
			return m, nil
		}
		// A docked block. A click acts immediately; Navigable blocks additionally
		// adopt the clicked row as keyboard focus before activation.
		if i := line - len(m.lineRow); i < len(m.blockLines) {
			hit := m.blockLines[i]
			if c, ok := hit.block.(blocks.Clickable); ok {
				if n, ok := hit.block.(blocks.Navigable); ok {
					if row := navigationRowForLine(hit.local, n); row >= 0 {
						m.setBlockFocus(blockIndex(m.docked, hit.block), row)
					}
				}
				return m, c.OnClick(hit.local)
			}
		}
	}
	return m, nil
}

// hoverAt clears the prior target before giving the rendered line under the
// pointer to its owner. Header, navigator, dividers, padding, and inert block
// lines all clear hover; only a Hoverable block can accept it.
func (m *model) clearHover() {
	if m.hoverBlock != nil {
		m.hoverBlock.SetHoverLine(-1)
	}
	m.hoverBlock, m.hoverLine = nil, -1
}

func (m *model) hoverAt(y int) {
	m.clearHover()
	line := y - m.navFirstLine()
	if line < len(m.lineRow) {
		return
	}
	if i := line - len(m.lineRow); i >= 0 && i < len(m.blockLines) {
		hit := m.blockLines[i]
		if h, ok := hit.block.(blocks.Hoverable); ok && h.SetHoverLine(hit.local) {
			m.hoverBlock, m.hoverLine = h, hit.local
		}
	}
}

func (m *model) navFirstLine() int {
	line := headerLines
	if m.showHelp {
		line += m.helpLineCount()
	}
	if m.queryActive {
		line += queryLineCount
	}
	return line
}

// wheel scrolls the navigator's VIEWPORT by delta rows, dragging the cursor along
// only when it would otherwise leave the visible window.
//
// Two deliberate differences from j/k. It is position-scoped: a wheel event over
// the docked blocks or the header is ignored, where previously scrolling anywhere
// in the pane moved the navigator cursor -- including over the gauges, which hold
// no cursor at all. And it does NOT wrap: j/k wrapping is a keyboard convenience,
// but a wheel flick past the last row teleporting to the top reads as a glitch.
//
// The visible region comes from m.lineRow, the table the last frame recorded, for
// the same reason the click handler uses it: rows are variable-height, so the
// viewport's row span can't be derived from a line count arithmetically.
func (m *model) wheel(delta, y int) {
	top := m.navFirstLine()
	avail := len(m.lineRow)
	if y < top || y >= top+avail || len(m.navigatorRows()) == 0 {
		return
	}
	maxStart := m.maxScrollStart(avail)
	if maxStart == 0 {
		return // nothing is clipped; there is nowhere to scroll
	}
	start := m.vpStart + delta
	if start < 0 {
		start = 0
	}
	if start > maxStart {
		start = maxStart
	}
	m.vpStart = start
	if m.sel < start {
		m.sel = start
		m.rememberNavigatorSelection()
		return
	}
	if last := m.lastVisibleRow(start, avail); m.sel > last {
		m.sel = last
		m.rememberNavigatorSelection()
	}
}

// lastVisibleRow is the final row index that fits when rendering from start
// within avail lines. At least the start row always counts, even if it is taller
// than the viewport (it is then clipped, as View already does).
func (m *model) lastVisibleRow(start, avail int) int {
	rows := m.navigatorRows()
	used := 0
	last := start
	for i := start; i < len(rows); i++ {
		used += len(rows[i].Lines)
		if used > avail && i > start {
			break
		}
		last = i
	}
	return last
}

// maxScrollStart is the largest vpStart that still fills the viewport, so
// scrolling can't run past the end of the list into blank space. 0 means the
// whole list already fits.
func (m *model) maxScrollStart(avail int) int {
	rows := m.navigatorRows()
	used := 0
	for i := len(rows) - 1; i >= 0; i-- {
		used += len(rows[i].Lines)
		if used > avail {
			return i + 1
		}
	}
	return 0
}

func (m *model) move(delta int) {
	rows := m.navigatorRows()
	if len(rows) == 0 {
		m.sel = 0
		return
	}
	n := len(rows)
	m.sel = ((m.sel+delta)%n + n) % n // wraps, like the bash dispatcher
	m.rememberNavigatorSelection()
}

// visibleNavigableBlocks returns block indices in render order. layout() is the
// source of truth because short panes may have degraded the tail of docked.
func (m *model) visibleNavigableBlocks() []int {
	arr := m.currentArrangement()
	out := make([]int, 0, len(arr.blocks))
	for _, b := range arr.blocks {
		n, ok := b.(blocks.Navigable)
		if !ok || n.NavigationCount() == 0 {
			continue
		}
		if i := blockIndex(m.docked, b); i >= 0 {
			out = append(out, i)
		}
	}
	return out
}

func (m *model) currentArrangement() arrangement {
	usable := m.height - headerLines
	if m.showHelp {
		usable -= m.helpLineCount()
	}
	if m.queryActive {
		usable -= queryLineCount
	}
	if usable < 1 {
		usable = 1
	}
	return m.layout(usable)
}

func blockIndex(all []blocks.Block, target blocks.Block) int {
	for i, b := range all {
		if b.ID() == target.ID() {
			return i
		}
	}
	return -1
}

func navigationRowForLine(line int, n blocks.Navigable) int {
	return n.NavigationIndex(line)
}

func (m *model) setBlockFocus(index, row int) {
	if index < 0 || index >= len(m.docked) {
		return
	}
	n, ok := m.docked[index].(blocks.Navigable)
	if !ok || row < 0 || row >= n.NavigationCount() {
		return
	}
	m.rememberBlockSelection(index, row)
	m.focusRegion = focusBlock
	m.focusBlock = index
	m.focusRow = row
}

func (m *model) rememberBlockSelection(index, row int) {
	if m.blockSelections == nil {
		m.blockSelections = make(map[int]int)
	}
	m.blockSelections[index] = row
	if identifiable, ok := m.docked[index].(blocks.SelectionIdentifiable); ok {
		if m.blockSelectionIDs == nil {
			m.blockSelectionIDs = make(map[int]string)
		}
		m.blockSelectionIDs[index] = identifiable.NavigationID(row)
	}
}

// focusTarget identifies one visible keyboard-focus region. The navigator uses
// block -1; every other region is a visible non-empty blocks.Navigable.
type focusTarget struct{ block int }

const navigatorTarget = -1

// focusRegions is derived from the current arrangement, so informational blocks
// and blocks dropped by short-pane degradation never participate in rotation.
func (m *model) focusRegions() []focusTarget {
	return m.focusRegionsFor(m.currentArrangement())
}

func (m *model) focusRegionsFor(arr arrangement) []focusTarget {
	regions := make([]focusTarget, 0, len(arr.blocks)+1)
	if len(m.navigatorRows()) > 0 {
		regions = append(regions, focusTarget{block: navigatorTarget})
	}
	for _, b := range arr.blocks {
		n, ok := b.(blocks.Navigable)
		if !ok || n.NavigationCount() == 0 {
			continue
		}
		if index := blockIndex(m.docked, b); index >= 0 {
			regions = append(regions, focusTarget{block: index})
		}
	}
	return regions
}

func (m *model) activeFocusRegion(regions []focusTarget) int {
	for i, region := range regions {
		if region.block == navigatorTarget && m.focusRegion == focusNavigator {
			return i
		}
		if region.block == m.focusBlock && m.focusRegion == focusBlock {
			return i
		}
	}
	return -1
}

func (m *model) blockSelection(index, count int) int {
	if count < 1 {
		return -1
	}
	if identifiable, ok := m.docked[index].(blocks.SelectionIdentifiable); ok && m.blockSelectionIDs != nil {
		if id := m.blockSelectionIDs[index]; id != "" {
			if row := identifiable.NavigationIndexByID(id); row >= 0 {
				return row
			}
			// The selected row disappeared; do not retain its old numeric index,
			// which could now name a different agent.
			return 0
		}
	}
	row := 0
	if m.blockSelections != nil {
		if saved, ok := m.blockSelections[index]; ok {
			row = saved
		}
	}
	if m.focusRegion == focusBlock && m.focusBlock == index {
		row = m.focusRow
	}
	if row < 0 {
		return 0
	}
	if row >= count {
		return count - 1
	}
	return row
}

// setFocusTarget changes only the active region. The navigator cursor and each
// block cursor are retained independently, so region cycling is non-activating
// and returning to a region restores its prior selected row.
func (m *model) setFocusTarget(target focusTarget) bool {
	if target.block == navigatorTarget {
		if len(m.navigatorRows()) == 0 {
			return false
		}
		m.focusRegion = focusNavigator
		m.clampSel()
		return true
	}
	n, ok := m.dockedBlockNav(target.block)
	if !ok || n.NavigationCount() == 0 {
		return false
	}
	row := m.blockSelection(target.block, n.NavigationCount())
	m.rememberBlockSelection(target.block, row)
	m.focusRegion = focusBlock
	m.focusBlock = target.block
	m.focusRow = row
	return true
}

// moveWithinRegion wraps inside the active focus region only. Moving from the
// last navigator row no longer silently enters agents; J/K (or F13/F14) are the
// explicit region transitions.
func (m *model) moveWithinRegion(delta int) {
	if delta == 0 {
		return
	}
	regions := m.focusRegions()
	if len(regions) == 0 {
		m.focusRegion, m.sel = focusNavigator, 0
		return
	}
	pos := m.activeFocusRegion(regions)
	if pos < 0 {
		if delta > 0 {
			pos = 0
		} else {
			pos = len(regions) - 1
		}
		m.setFocusTarget(regions[pos])
	}
	region := regions[pos]
	if region.block == navigatorTarget {
		m.move(delta)
		return
	}
	n, _ := m.dockedBlockNav(region.block)
	row := m.blockSelection(region.block, n.NavigationCount())
	row = ((row+delta)%n.NavigationCount() + n.NavigationCount()) % n.NavigationCount()
	m.setBlockFocus(region.block, row)
}

// cycleFocusRegion rotates through visible non-empty regions while keeping each
// region's saved cursor untouched. It intentionally does not call act().
func (m *model) cycleFocusRegion(delta int) {
	if delta == 0 {
		return
	}
	regions := m.focusRegions()
	if len(regions) == 0 {
		return
	}
	pos := m.activeFocusRegion(regions)
	if pos < 0 {
		if delta > 0 {
			m.setFocusTarget(regions[0])
		} else {
			m.setFocusTarget(regions[len(regions)-1])
		}
		return
	}
	pos = ((pos+delta)%len(regions) + len(regions)) % len(regions)
	m.setFocusTarget(regions[pos])
}

func (m *model) focusFirst() {
	regions := m.focusRegions()
	if len(regions) == 0 {
		return
	}
	first := regions[0]
	if first.block == navigatorTarget {
		m.sel = 0
		m.rememberNavigatorSelection()
		m.setFocusTarget(first)
		return
	}
	if _, ok := m.dockedBlockNav(first.block); ok {
		m.setBlockFocus(first.block, 0)
	}
}

func (m *model) focusLast() {
	regions := m.focusRegions()
	if len(regions) == 0 {
		return
	}
	last := regions[len(regions)-1]
	if last.block == navigatorTarget {
		m.sel = len(m.navigatorRows()) - 1
		m.rememberNavigatorSelection()
	} else if n, ok := m.dockedBlockNav(last.block); ok {
		m.setBlockFocus(last.block, n.NavigationCount()-1)
		return
	}
	m.setFocusTarget(last)
}

// navigatorRows is the order-preserving inline-filter view. SearchText is the
// source-provided, unstyled search surface; display Lines stay solely for
// rendering and are never scraped back into application state.
func (m *model) navigatorRows() []nav.Row {
	if m.query == "" {
		return m.rows
	}
	needle := strings.ToLower(m.query)
	matchingHeading := make(map[string]bool)
	matchingChild := make(map[string]bool)
	for _, row := range m.rows {
		if row.GroupID == "" || !strings.Contains(strings.ToLower(row.SearchText), needle) {
			continue
		}
		if row.GroupHeading {
			matchingHeading[row.GroupID] = true
		} else {
			matchingChild[row.GroupID] = true
		}
	}
	out := make([]nav.Row, 0, len(m.rows))
	for _, row := range m.rows {
		matched := strings.Contains(strings.ToLower(row.SearchText), needle)
		// A matching child retains only its inert parent heading. A matching
		// heading/root retains the complete group so its worktrees stay visible.
		if matched || (row.GroupHeading && matchingChild[row.GroupID]) || (!row.GroupHeading && matchingHeading[row.GroupID]) {
			out = append(out, row)
		}
	}
	return out
}

// rememberNavigatorSelection records the current visible row's stable identity
// before a query or source refresh changes the view. Rows without an ID are
// tolerated for test stubs and third-party Sources, but cannot promise identity
// retention.
func (m *model) rememberNavigatorSelection() {
	rows := m.navigatorRows()
	if m.sel >= 0 && m.sel < len(rows) && rows[m.sel].ID != "" {
		m.selectionID = rows[m.sel].ID
	}
}

// clampSel restores a selection by ID whenever possible. A query that excludes
// the selected row intentionally starts at its first result; widening the query
// then returns to that current selection rather than an unrelated raw index.
func (m *model) clampSel() {
	rows := m.navigatorRows()
	if len(rows) == 0 {
		m.sel, m.vpStart = 0, 0
		return
	}
	if m.selectionID != "" {
		for i, row := range rows {
			if row.ID == m.selectionID {
				m.sel = i
				return
			}
		}
		m.sel = 0
		m.rememberNavigatorSelection()
		return
	}
	if m.sel >= len(rows) {
		m.sel = len(rows) - 1
	}
	if m.sel < 0 {
		m.sel = 0
	}
	m.rememberNavigatorSelection()
}

// syncFocus projects model focus into blocks after layout has decided which
// regions remain visible. If degradation removes the active region, its saved
// cursor remains in blockSelections and focus falls back to the first surviving
// region. Every non-active Navigable block receives -1 for rendering.
func (m *model) syncFocus(arr arrangement) {
	regions := m.focusRegionsFor(arr)
	if len(regions) == 0 {
		m.focusRegion, m.sel = focusNavigator, 0
	} else if m.activeFocusRegion(regions) < 0 {
		m.setFocusTarget(regions[0])
	} else if m.focusRegion == focusBlock {
		// Clamp a selected row after a refresh reduces the visible row count,
		// without discarding the block region just because its last rows vanished.
		m.setFocusTarget(focusTarget{block: m.focusBlock})
	}

	for i, b := range m.docked {
		if n, ok := b.(blocks.Navigable); ok {
			if i == m.focusBlock && m.focusRegion == focusBlock && m.activeFocusRegion(regions) >= 0 {
				n.SetNavigationIndex(m.focusRow)
			} else {
				n.SetNavigationIndex(-1)
			}
		}
	}
}

func (m *model) dockedBlockNav(index int) (blocks.Navigable, bool) {
	if index < 0 || index >= len(m.docked) {
		return nil, false
	}
	n, ok := m.docked[index].(blocks.Navigable)
	return n, ok
}

func (m *model) setSource(idx int) tea.Cmd {
	if idx == m.srcIdx || idx < 0 || idx >= len(nav.Sources) {
		return nil
	}
	m.srcIdx = idx
	m.sourceGeneration++
	m.sel = 0
	m.selectionID = ""
	m.queryActive, m.query = false, ""
	m.rows = nil
	m.lastFetchErr = ""
	m.syncSourceWatch()
	// Persist the tab OFF the input path. This used to call SetWinOpt inline --
	// a ~20ms tmux fork blocking the key loop on every 1-N / Tab / S-Tab press,
	// the last synchronous fork left on the keypress path. Nothing reads the
	// option back until the next Query, so there is no ordering requirement.
	return tea.Batch(m.persistSource(idx), m.refreshState(false))
}

// persistSource writes @sidebar_source in the background. Returns nil when the
// window target isn't known yet (no WindowSizeMsg / Query has landed).
// cycleSidebarWidth rotates compact/normal/wide presets for this window. The
// value is persisted in @sidebar_width and immediately resized, so no sidebar
// restart or lifecycle transition is required.
func (m *model) cycleSidebarWidth() tea.Cmd {
	const compact, normal, wide = 30, 36, 44
	presets := []int{compact, normal, wide}
	current := m.sidebarWidth
	if current == 0 {
		current = m.width
	}
	next := presets[0]
	for i, width := range presets {
		if current <= width {
			next = presets[(i+1)%len(presets)]
			break
		}
	}
	target := m.winTarget
	return func() tea.Msg {
		m.client.SetSidebarWidth(target, next)
		return sidebarWidthMsg(next)
	}
}

func (m *model) persistSource(idx int) tea.Cmd {
	if m.winTarget == "" {
		return nil
	}
	target, id := m.winTarget, nav.Sources[idx].ID()
	return func() tea.Msg {
		m.client.SetWinOpt(target, "@sidebar_source", id)
		return nil
	}
}

func (m *model) cycleTab(delta int) tea.Cmd {
	n := len(nav.Sources)
	return m.setSource(((m.srcIdx+delta)%n + n) % n)
}

// applySourceControl projects an optional source's key result into generic
// source state. There is intentionally no source ID or control-key branch here.
func (m *model) applySourceControl(control nav.SourceControl) tea.Cmd {
	if control.SetRoot {
		m.sourceRoot, m.sourceRootPane = control.Root, control.RootPane
	}
	if control.SetRootPinned {
		m.rootPinned = control.RootPinned
	}
	if control.SetShowHidden {
		m.showHidden = control.ShowHidden
	}
	if !control.Refresh {
		return nil
	}
	m.sel, m.selectionID = 0, ""
	m.syncSourceWatch()
	return m.refreshState(false)
}

// navCtx builds the Source context from current model state. refreshState builds
// its own copy inside the Cmd closure (it must not touch the model from another
// goroutine); this one serves the synchronous key path.
func (m *model) navCtx() nav.Ctx {
	return nav.Ctx{
		Theme: m.theme, Cwd: m.contentCwd, ContentPane: m.contentPane,
		Root: m.sourceRoot, RootPane: m.sourceRootPane, RootPinned: m.rootPinned,
		ShowHidden: m.showHidden,
	}
}

func (m *model) fetchAllBlocks() tea.Cmd {
	cmds := make([]tea.Cmd, 0, len(m.docked))
	for _, b := range m.docked {
		if m.shouldFetchBlock(b) {
			cmds = append(cmds, b.Fetch())
		}
	}
	return tea.Batch(cmds...)
}

// syncBlockVisibility publishes one layout decision to optional blocks. A block
// that becomes visible gets an immediate fetch; hidden blocks only keep fetching
// when they explicitly opt into background work. The registry stays the sole
// block list: this method depends only on optional interfaces.
func (m *model) syncBlockVisibility() tea.Cmd {
	if m.height <= 0 || m.width <= 0 {
		return nil
	}
	if m.blockVisible == nil {
		m.blockVisible = make(map[string]bool)
	}
	usable := m.height - headerLines
	if m.showHelp {
		usable -= m.helpLineCount()
	}
	if m.queryActive {
		usable -= queryLineCount
	}
	if usable < 1 {
		usable = 1
	}
	arr := m.layout(usable)
	visible := make(map[string]bool, len(arr.blocks))
	for _, b := range arr.blocks {
		visible[b.ID()] = true
	}
	cmds := make([]tea.Cmd, 0, len(m.docked))
	for _, b := range m.docked {
		now, was := visible[b.ID()], m.blockVisible[b.ID()]
		if aware, ok := b.(blocks.VisibilityAware); ok {
			aware.SetVisible(now)
		}
		m.blockVisible[b.ID()] = now
		if now && !was {
			cmds = append(cmds, b.Fetch())
		}
	}
	return tea.Batch(cmds...)
}

func (m *model) shouldFetchBlock(b blocks.Block) bool {
	if m.blockVisible[b.ID()] {
		return true
	}
	background, ok := b.(blocks.BackgroundFetcher)
	return !ok || background.FetchInBackground()
}

func (m *model) syncSourceWatch() {
	if m.fileWatch == nil || m.srcIdx < 0 || m.srcIdx >= len(nav.Sources) {
		m.watchRoot = ""
		return
	}
	if watchable, ok := nav.Sources[m.srcIdx].(nav.Watchable); ok {
		m.watchRoot = watchable.WatchRoot(m.navCtx())
		m.fileWatch.SetRoot(m.watchRoot)
		return
	}
	m.watchRoot = ""
	m.fileWatch.SetRoot("")
}

// act runs the selected row's action. ActionEditFile is special: it suspends the
// TUI so the editor gets this pane, then resumes -- the pane is the sidebar's,
// so there is nowhere else to put it.
func (m *model) act() tea.Cmd {
	if m.focusRegion == focusBlock {
		if m.focusBlock < 0 || m.focusBlock >= len(m.docked) {
			return nil
		}
		if n, ok := m.docked[m.focusBlock].(blocks.Navigable); ok {
			return n.ActivateNavigation(m.focusRow)
		}
		return nil
	}
	rows := m.navigatorRows()
	if len(rows) == 0 || m.sel < 0 || m.sel >= len(rows) {
		return nil
	}
	row := rows[m.sel]
	if row.Kind == nav.ActionEditFile {
		return m.editFile(row.Path)
	}
	content := m.contentRef
	return func() tea.Msg {
		if err := nav.Act(m.client, row, content); err != nil {
			return contextActionMsg{err: err}
		}
		return nil
	}
}

// quit is an explicit user dismissal: it hands the global persistence shutdown
// to tmux-sidebar-toggle, which closes every owner transactionally.
//
// This used to clear the options and select the content pane inline, which meant
// `q` skipped the ONE thing the script's close path does that this can't: replaying
// @sidebar_saved_layout to undo the pane squeeze the full-height split caused. So
// closing with M-Tab restored the window's geometry and closing with q silently
// didn't, and left the saved layout behind as a stale option. Duplicating that
// replay here would be a second copy of logic with a documented
// allowed-to-fail contract, so the script stays the single owner of it.
//
// `run-shell -b` is what makes this safe: it runs as a child of the tmux SERVER,
// not of this pane, so it survives the kill-pane it is about to issue. The script
// then owns global desired-state removal plus each local kill + select-layout +
// focus transaction. tea.Quit still follows, so the TUI releases the terminal
// even if the script never lands.
//
// @sidebar_source is deliberately left set (by the script), so re-opening the
// sidebar in this window restores the tab that was active.
func (m *model) quit() tea.Cmd {
	// Clear desired state while this pane is still alive. Otherwise pane-exited
	// can launch an ensure job that observed persistent mode before the async
	// dismiss script gets a server turn.
	m.client.RunQuiet("set-option", "-gu", "@sidebar_persistent")
	// Run synchronously while this pane is still alive. Bubble Tea may tear down
	// queued commands after a quit, but the final local kill must happen only
	// after every other owner has completed its close transaction.
	_ = exec.Command("/bin/sh", "-c", dismissScript(m.selfPane)).Run()
	return tea.Quit
}

// closeScript is tmux-sidebar-toggle's local failure/HUP --close invocation. run-shell's -t scopes
// tmux's command queue but does NOT export that target as TMUX_PANE to the child
// shell, so pass the immutable sidebar pane explicitly. Without this, q/Esc can
// close whichever window another attached client currently has active.
func closeScript(paneID string) string {
	path := filepath.Join(homeDir(), ".config", "tmux_scripts", "tmux-sidebar-toggle")
	// TMUX_PANE selects the window to clean up; EXPECTED_PANE proves that the
	// current window still owns this exact sidebar before --close can kill it.
	// OWNER_WINDOW lets a moved pane restore only its original window.
	command := "TMUX_PANE=" + shellQuote(paneID) + " MM_SIDEBAR_EXPECTED_PANE=" + shellQuote(paneID)
	if ownerWindow := os.Getenv("MM_SIDEBAR_OWNER_WINDOW"); ownerWindow != "" {
		command += " MM_SIDEBAR_EXPECTED_WINDOW=" + shellQuote(ownerWindow)
	}
	return command + " " + shellQuote(path) + " --close"
}

// dismissScript uses the same immutable owner context but intentionally clears
// global persistent mode before canonical close-all.
func dismissScript(paneID string) string {
	path := filepath.Join(homeDir(), ".config", "tmux_scripts", "tmux-sidebar-toggle")
	command := "TMUX_PANE=" + shellQuote(paneID) + " MM_SIDEBAR_EXPECTED_PANE=" + shellQuote(paneID)
	if ownerWindow := os.Getenv("MM_SIDEBAR_OWNER_WINDOW"); ownerWindow != "" {
		command += " MM_SIDEBAR_EXPECTED_WINDOW=" + shellQuote(ownerWindow)
	}
	return command + " " + shellQuote(path) + " --dismiss"
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

// ---- view -----------------------------------------------------------------

// View renders exactly m.height lines: header (+ help) -> navigator -> docked
// blocks. Bubble Tea's renderer diffs this against the previous frame, so there
// is no manual clear-to-end-of-line bookkeeping and no reserved scroll row.
func (m *model) View() string {
	if m.height <= 0 || m.width <= 0 {
		return ""
	}
	if m.diagnostics {
		return m.diagnosticsView()
	}
	if m.panePreview {
		return m.panePreviewView()
	}
	if m.actionPalette {
		return m.actionPaletteView()
	}
	lines := make([]string, 0, m.height)
	lines = append(lines, m.headerLines()...)
	if m.showHelp {
		lines = append(lines, m.helpLines()...)
	}
	if m.queryActive {
		lines = append(lines, m.queryLine())
	}

	usable := m.height - len(lines)
	if usable < 1 {
		usable = 1
	}

	arr := m.layout(usable)
	m.syncFocus(arr)
	if m.hoverBlock != nil {
		rendered := false
		for _, b := range arr.blocks {
			if h, ok := b.(blocks.Hoverable); ok && h == m.hoverBlock {
				rendered = true
				break
			}
		}
		if !rendered {
			m.clearHover()
		}
	}
	lines = append(lines, m.navLines(arr.navAvail)...)

	// Record which block owns each line as it is emitted, so a click can be
	// resolved without recomputing the arrangement (see blockLines' doc comment).
	m.blockLines = m.blockLines[:0]
	for _, b := range arr.blocks {
		lines = append(lines, m.dividerLine())
		m.blockLines = append(m.blockLines, blockHit{}) // the divider is inert
		body := splitLines(b.View(m.width), b.Height())
		for i := range body {
			lines = append(lines, body[i])
			m.blockLines = append(m.blockLines, blockHit{block: b, local: i})
		}
	}

	// Pad/clamp to exactly the pane height so the frame never scrolls.
	for len(lines) < m.height {
		lines = append(lines, "")
	}
	return joinLines(lines[:m.height])
}

func (m *model) headerLines() []string {
	strip := ""
	for i, s := range nav.Sources {
		if i > 0 {
			strip += " "
		}
		chip := strconv.Itoa(i+1) + s.Short()
		if i == m.srcIdx {
			strip += m.theme.ActiveTab.Render(chip)
		} else {
			strip += m.theme.Muted.Render(chip)
		}
	}
	return []string{
		clipLine(strip, m.width),
		clipLine(m.theme.Accent.Render("▸ "+nav.Sources[m.srcIdx].Title()), m.width),
	}
}

// diagnosticsView renders only cached model state. It deliberately calls no
// Client method: opening it must not turn a request for observability into a
// second tmux/Git/filesystem collection path.
func (m *model) diagnosticsView() string {
	m.lineRow = m.lineRow[:0]
	m.blockLines = m.blockLines[:0]
	name := "-"
	if m.srcIdx >= 0 && m.srcIdx < len(nav.Sources) {
		name = nav.Sources[m.srcIdx].ID()
	}
	root := m.sourceRoot
	if root == "" {
		root = "-"
	}
	watch := m.watchRoot
	if watch == "" {
		watch = "off"
	}
	filter := "off"
	if m.queryActive {
		filter = fmt.Sprintf("%q", m.query)
	}
	visible := make([]string, 0, len(m.docked))
	for _, b := range m.docked {
		if m.blockVisible[b.ID()] {
			visible = append(visible, b.ID())
		}
	}
	if len(visible) == 0 {
		visible = append(visible, "none")
	}
	fingerprint := m.worldFingerprint
	if fingerprint == "" {
		fingerprint = "-"
	}
	originClient := "-"
	if m.client != nil {
		originClient = valueOrDash(m.client.OriginClient())
	}
	lines := []string{
		"▸ diagnostics/help",
		"source: " + name + fmt.Sprintf(" (%d/%d)", m.srcIdx+1, len(nav.Sources)),
		"root: " + root + fmt.Sprintf("  pinned=%t hidden=%t", m.rootPinned, m.showHidden),
		"filter: " + filter + "  watch: " + watch,
		"visible: " + strings.Join(visible, ","),
		fmt.Sprintf("world: %d sessions, %d panes", len(m.world.Sessions()), len(m.world.Panes())),
		"fingerprint: " + fingerprint,
		fmt.Sprintf("refresh: applied=%d fetch=%d skip=%d last=%s", m.refreshApplied, m.sourceFetches, m.sourceSkips, m.lastRefresh.Round(time.Millisecond)),
		fmt.Sprintf("ids: pane=%s content=%s", valueOrDash(m.selfPane), valueOrDash(m.contentPane)),
		fmt.Sprintf("ids: client=%s window=%s session=%s", originClient, valueOrDash(m.lastSnapshot.WindowID), valueOrDash(m.lastSnapshot.SessionID)),
	}
	if m.lastStateErr != "" {
		lines = append(lines, "state error: "+m.lastStateErr)
	}
	if m.lastFetchErr != "" {
		lines = append(lines, "fetch error: "+m.lastFetchErr)
	}
	lines = append(lines, "actions:")
	for _, action := range m.registeredKeyActions() {
		lines = append(lines, "  "+action.Key+"  "+action.Summary)
	}
	lines = append(lines, "d/Esc close")
	out := make([]string, 0, m.height)
	for i, line := range lines {
		if i >= m.height {
			break
		}
		style := m.theme.Text
		if i == 0 || line == "actions:" {
			style = m.theme.Accent
		} else if strings.Contains(line, "error:") {
			style = m.theme.Urgent
		} else if strings.HasPrefix(line, "  ") || line == "d/Esc close" {
			style = m.theme.Muted
		}
		out = append(out, clipLine(style.Render(line), m.width))
	}
	for len(out) < m.height {
		out = append(out, "")
	}
	return strings.Join(out[:m.height], "\n")
}

func valueOrDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}

// actionPaletteView owns a modal frame while preserving View's exact-height
// contract. It clears the mouse hit maps because palette navigation is keyboard
// only; the underlying variable-height navigator remains untouched.
func (m *model) panePreviewView() string {
	m.lineRow = m.lineRow[:0]
	m.blockLines = m.blockLines[:0]
	lines := []string{clipLine(m.theme.Accent.Render("▸ "+m.previewTitle), m.width)}
	if m.previewErr != nil {
		lines = append(lines, clipLine(m.theme.Urgent.Render("preview unavailable: "+m.previewErr.Error()), m.width))
	} else if len(m.previewLines) == 0 {
		lines = append(lines, clipLine(m.theme.Muted.Render("(empty pane)"), m.width))
	} else {
		for _, line := range m.previewLines {
			if len(lines) >= m.height-1 {
				break
			}
			lines = append(lines, clipLine(m.theme.Text.Render(line), m.width))
		}
	}
	if len(lines) < m.height {
		lines = append(lines, clipLine(m.theme.Muted.Render("Esc close"), m.width))
	}
	for len(lines) < m.height {
		lines = append(lines, "")
	}
	return strings.Join(lines[:m.height], "\n")
}

// previewLines performs no ANSI interpretation. Captured terminal controls are
// made visibly inert before the sidebar applies its own styles.
func previewLines(body string) []string {
	if body == "" {
		return nil
	}
	lines := strings.Split(body, "\n")
	for i, line := range lines {
		lines[i] = display.Sanitize(line)
	}
	return lines
}

func (m *model) actionPaletteView() string {
	m.lineRow = m.lineRow[:0]
	m.blockLines = m.blockLines[:0]
	lines := []string{clipLine(m.theme.Accent.Render("▸ actions"), m.width)}
	if m.confirmAction != nil {
		lines = append(lines,
			clipLine(m.theme.Text.Render("confirm: ")+m.theme.Accent.Render(m.confirmAction.Label), m.width),
			clipLine(m.theme.Muted.Render("y/Enter confirm  n/Esc cancel"), m.width),
		)
	} else {
		for i, action := range m.paletteActions {
			prefix := "  "
			style := m.theme.Text
			if i == m.actionSel {
				prefix, style = "▶ ", m.theme.Accent
			}
			label := action.Label
			if action.Destructive {
				label += " (confirm)"
			}
			lines = append(lines, clipLine(style.Render(prefix+label), m.width))
		}
		lines = append(lines, clipLine(m.theme.Muted.Render("Enter act  Esc cancel"), m.width))
	}
	for len(lines) < m.height {
		lines = append(lines, "")
	}
	return strings.Join(lines[:m.height], "\n")
}

// helpLineCount derives the '?' overlay's exact height from its action
// registry. navFirstLine and View's line budget call the same method, so adding
// an optional source action grows the frame and cannot offset mouse mapping.
func helpLineCount(actions []nav.KeyAction) int {
	return (len(actions) + 1) / 2
}

func (m *model) helpLineCount() int { return helpLineCount(m.registeredKeyActions()) }

// queryLineCount stays explicit because navFirstLine and the vertical layout
// both depend on it. The filter is a one-line inline control, never an overlay.
const queryLineCount = 1

// globalKeyActions is the model's keyboard-action registry. The input switch is
// deliberately still direct (it owns ordering/modal precedence), but all help
// presentation comes from these descriptors rather than a second hardcoded map.
var globalKeyActions = []nav.KeyAction{
	{Key: "1-N / Tab", Summary: "switch tab"},
	{Key: "j/k / arrows", Summary: "move"},
	{Key: "J/K / F13/F14", Summary: "rotate focus"},
	{Key: "g/G / Enter", Summary: "first/last/act"},
	{Key: "/ / a/:", Summary: "filter / actions"},
	{Key: "r / w", Summary: "refresh / width"},
	{Key: "d", Summary: "diagnostics"},
	{Key: "? / q / Esc", Summary: "help / close"},
}

// registeredKeyActions combines global actions with the active source's
// optional ActionProvider. Adding a tab-local key therefore updates both help
// surfaces without teaching model.go that source's identity.
func (m *model) registeredKeyActions() []nav.KeyAction {
	actions := append([]nav.KeyAction(nil), globalKeyActions...)
	if m.srcIdx >= 0 && m.srcIdx < len(nav.Sources) {
		if provider, ok := nav.Sources[m.srcIdx].(nav.ActionProvider); ok {
			actions = append(actions, provider.KeyActions()...)
		}
	}
	return actions
}

// helpOverlay packs every registered action into two columns. Its dynamic
// height is consumed through helpLineCount, so optional source extensions are
// never silently omitted or allowed to desynchronize mouse geometry.
func helpOverlay(actions []nav.KeyAction) []string {
	lines := make([]string, 0, helpLineCount(actions))
	for i := 0; i < len(actions); i += 2 {
		line := actions[i].Key + " " + actions[i].Summary
		if i+1 < len(actions) {
			line += "    " + actions[i+1].Key + " " + actions[i+1].Summary
		}
		lines = append(lines, line)
	}
	return lines
}

func (m *model) queryLine() string {
	return clipLine(m.theme.Accent.Render("/")+" "+m.theme.Text.Render(m.query)+m.theme.Muted.Render("▏"), m.width)
}

func (m *model) helpLines() []string {
	lines := helpOverlay(m.registeredKeyActions())
	out := make([]string, 0, len(lines))
	for _, l := range lines {
		out = append(out, clipLine(m.theme.Muted.Render(l), m.width))
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

	rows := m.navigatorRows()
	if len(rows) == 0 {
		m.vpStart = 0
		label := "(empty)"
		if m.query != "" && len(m.rows) > 0 {
			label = "(no matches)"
		}
		out = append(out, clipLine(m.theme.Muted.Render(label), m.width))
		m.lineRow = append(m.lineRow, -1)
		return pad()
	}

	m.vpStart = m.scrollTo(avail)

	// 2 columns for the cursor prefix; continuation lines are indented under it.
	rowWidth := m.width - 2
	if rowWidth < 1 {
		rowWidth = 1
	}
	for i := m.vpStart; i < len(rows) && len(out) < avail; i++ {
		for j, line := range rows[i].Lines {
			if len(out) >= avail {
				break
			}
			prefix := "  "
			if j == 0 && i == m.sel && m.focusRegion == focusNavigator {
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
	rows := m.navigatorRows()
	total := 0
	for _, r := range rows {
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
			used += len(rows[i].Lines)
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
type agentResult struct {
	rows             []agents.Row
	worldFingerprint string
}

type agentFeed struct {
	ctx     context.Context
	request chan struct{}    // coalescing trigger (buffered 1)
	results chan agentResult // one versioned published sweep (buffered 1)
	mu      sync.RWMutex
	world   *tmuxio.World
	start   sync.Once
	close   sync.Once
	wg      sync.WaitGroup
	client  *tmuxio.Client
}

func newAgentFeed(ctx context.Context, client *tmuxio.Client) *agentFeed {
	return &agentFeed{
		ctx:     ctx,
		client:  client,
		request: make(chan struct{}, 1),
		results: make(chan agentResult, 1),
	}
}

// Start launches the resolver and its fsnotify watcher once Bubble Tea owns the
// model. Constructing models in unit tests therefore never leaves goroutines.
func (f *agentFeed) Start() {
	f.start.Do(func() {
		resolver := agents.NewResolverWithClient(f.client)
		f.wg.Add(2)
		go f.resolveLoop(resolver)
		go f.watchLoop(resolver.WatchDirs())
	})
}

func (f *agentFeed) resolveLoop(resolver *agents.Resolver) {
	defer f.wg.Done()
	for {
		select {
		case <-f.ctx.Done():
			return
		case <-f.request:
		}
		f.mu.RLock()
		if f.world == nil {
			f.mu.RUnlock()
			continue
		}
		world := *f.world
		f.mu.RUnlock()
		rows, err := resolver.ResolveWorld(world)
		if err != nil {
			continue
		}
		result := agentResult{rows: rows, worldFingerprint: world.Fingerprint()}
		select {
		case f.results <- result:
		case <-f.ctx.Done():
			return
		}
	}
}

// watchLoop turns agent on-disk state into pushes. The watcher is explicitly
// closed by context cancellation, then joined by Close; it cannot outlive a
// Bubble Tea program or a HUP-triggered shutdown.
func (f *agentFeed) watchLoop(dirs []string) {
	defer f.wg.Done()
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return // the periodic tick remains the legacy backstop
	}
	defer w.Close()
	for _, d := range dirs {
		_ = w.Add(d) // a missing dir (no permission prompts yet) is fine
	}
	for {
		select {
		case <-f.ctx.Done():
			return
		case _, ok := <-w.Events:
			if !ok {
				return
			}
			f.requestSweep()
		case _, ok := <-w.Errors:
			if !ok {
				return
			}
		}
	}
}

func (f *agentFeed) requestSweep() {
	select {
	case f.request <- struct{}{}:
	default:
	}
}

// setWorld publishes the model's immutable observation before nudging the
// resolver. Filesystem and block-timer requests reuse this latest World, so no
// agent path can run a second recurring list-panes query.
func (f *agentFeed) setWorld(world tmuxio.World) {
	f.mu.Lock()
	f.world = &world
	f.mu.Unlock()
	f.requestSweep()
}

// wait blocks in Bubble Tea's command goroutine until a sweep is published or
// the model shuts down. The cancellation arm prevents its command goroutine
// from leaking after Program.Run returns.
func (f *agentFeed) wait() tea.Cmd {
	return func() tea.Msg {
		select {
		case result := <-f.results:
			return blocks.AgentRowsMsg{Rows: result.rows, WorldFingerprint: result.worldFingerprint}
		case <-f.ctx.Done():
			return nil
		}
	}
}

func (f *agentFeed) Close() {
	f.close.Do(func() { f.wg.Wait() })
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

func homeDir() string {
	if h, err := os.UserHomeDir(); err == nil && h != "" {
		return h
	}
	if h := os.Getenv("HOME"); h != "" {
		return h
	}
	return "/"
}
