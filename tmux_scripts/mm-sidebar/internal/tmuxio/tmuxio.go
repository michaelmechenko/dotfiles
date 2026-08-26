// Package tmuxio is the single place this binary talks to tmux.
//
// The bash dispatcher this replaces made several separate tmux forks for a
// repaint. Client batches renderer state into one explicitly-targeted
// display-message call and keeps command context immutable, so an inactive
// sidebar cannot inherit another attached client's active pane.
package tmuxio

import (
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// fieldSep frames tmux format arguments after each arbitrary value has been
// encoded with tmux 3.7's q/a modifier. q/a escapes this separator, newlines,
// and backslashes, so it cannot occur literally in an encoded argument.
const fieldSep = "\x1f"

// commandRunner is deliberately private. Package tests can replace it on a
// Client to assert exact tmux argv without making command execution a public
// dependency or a second production abstraction.
type commandRunner func(args ...string) (string, error)

func runTmux(args ...string) (string, error) {
	out, err := exec.Command("tmux", args...).Output()
	return strings.TrimRight(string(out), "\n"), err
}

// Client is the sidebar's immutable tmux context. paneID is the sidebar pane
// itself; originClient is the tmux client that invoked its binding. Every
// scope-sensitive operation targets paneID explicitly so a second attached
// client cannot redirect sidebar state or actions to its active pane.
type Client struct {
	paneID       string
	originClient string
	run          commandRunner
}

// NewClient constructs the production tmux context. Empty values are allowed
// for commands such as `mm-sidebar agents`, which need no sidebar scope.
func NewClient(paneID, originClient string) *Client {
	return &Client{paneID: paneID, originClient: originClient, run: runTmux}
}

// PaneID is the sidebar pane seeded from TMUX_PANE before Bubble Tea starts.
func (c *Client) PaneID() string { return c.paneID }

// OriginClient is the invoking tmux client captured by the sidebar binding.
func (c *Client) OriginClient() string { return c.originClient }

// PaneWindowID returns the immutable tmux window ID currently containing this
// client pane. The sidebar process compares it with its launch owner before it
// initializes, closing the last move-between-gate-check-and-exec race.
func (c *Client) PaneWindowID() (string, error) {
	return c.command("display-message", "-p", "-t", c.paneID, "#{window_id}")
}

func (c *Client) command(args ...string) (string, error) {
	if c == nil || c.run == nil {
		return runTmux(args...)
	}
	return c.run(args...)
}

// RunQuiet executes a best-effort tmux command.
func (c *Client) RunQuiet(args ...string) { _, _ = c.command(args...) }

// decodeArgument reverses tmux 3.7's q/a format modifier. q/a deliberately
// emits a command argument, not a fixed envelope: values may be bare, single-
// quoted, or double-quoted. Every form can contain tmux's backslash escapes:
// named C0 escapes, octal bytes, and shell-meta punctuation (for example \!,
// \[, and \$). An unset format expands to an empty bare field.
//
// This decoder intentionally accepts only the transport grammar q/a emits. In
// particular, raw controls, the framing separator, malformed quotes, and
// unknown escapes are errors; callers must then discard the complete response
// rather than risking a shifted action target.
// DecodeArgument decodes one value produced by tmux's q/a format modifier.
// It is exported for the legacy navigator adapter's sidebar-only encoded modes;
// all framing and validation still remains owned by this package.
func DecodeArgument(encoded string) (string, error) {
	if encoded == "" {
		return "", nil // unset tmux format value
	}

	body := encoded
	quoted := byte(0)
	if encoded[0] == '\'' || encoded[0] == '"' {
		quoted = encoded[0]
		if len(encoded) < 2 || encoded[len(encoded)-1] != quoted {
			return "", fmt.Errorf("unterminated quoted q/a argument")
		}
		body = encoded[1 : len(encoded)-1]
	} else if strings.ContainsAny(encoded, "\"'") {
		return "", fmt.Errorf("quote in bare q/a argument")
	}

	var out strings.Builder
	out.Grow(len(body))
	for i := 0; i < len(body); i++ {
		c := body[i]
		if c != '\\' {
			if c < 0x20 || c == 0x7f || c == fieldSep[0] {
				return "", fmt.Errorf("raw control byte in q/a argument")
			}
			if quoted != 0 && c == quoted {
				return "", fmt.Errorf("unescaped quote in q/a argument")
			}
			if quoted == 0 && c == ' ' {
				return "", fmt.Errorf("space in bare q/a argument")
			}
			out.WriteByte(c)
			continue
		}
		if i+1 >= len(body) {
			return "", fmt.Errorf("trailing backslash in q/a argument")
		}
		i++
		switch c = body[i]; c {
		case 'a':
			out.WriteByte('\a')
		case 'b':
			out.WriteByte('\b')
		case 'f':
			out.WriteByte('\f')
		case 'n':
			out.WriteByte('\n')
		case 'r':
			out.WriteByte('\r')
		case 't':
			out.WriteByte('\t')
		case 'v':
			out.WriteByte('\v')
		default:
			if c >= '0' && c <= '7' && i+2 < len(body) &&
				body[i+1] >= '0' && body[i+1] <= '7' && body[i+2] >= '0' && body[i+2] <= '7' {
				v := (c-'0')*64 + (body[i+1]-'0')*8 + (body[i+2] - '0')
				out.WriteByte(v)
				i += 2
				continue
			}
			if !isQAEscapedPunctuation(c) {
				return "", fmt.Errorf("invalid backslash escape in q/a argument")
			}
			out.WriteByte(c)
		}
	}
	return out.String(), nil
}

// tmux q/a backslash-quotes these shell-meta bytes when it does not choose a
// surrounding quote envelope. The set is deliberately narrow so \x cannot be
// mistaken for a valid transport escape.
func isQAEscapedPunctuation(c byte) bool {
	return strings.ContainsRune(`!"#$&'()*,-;<>?[]\\^`+"`"+`|{}`, rune(c))
}

func decodeFields(record string, want int) ([]string, error) {
	fields := strings.Split(record, fieldSep)
	if len(fields) != want {
		return nil, fmt.Errorf("tmuxio: q/a field count %d, want %d", len(fields), want)
	}
	for i := range fields {
		decoded, err := DecodeArgument(fields[i])
		if err != nil {
			return nil, fmt.Errorf("tmuxio: q/a field %d: %w", i+1, err)
		}
		fields[i] = decoded
	}
	return fields, nil
}

func parseInt(field, value string) (int, error) {
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, fmt.Errorf("tmuxio: invalid %s %q", field, value)
	}
	return n, nil
}

// Snapshot is everything the renderer needs about its own pane and window
// state, gathered in a single tmux call.
type Snapshot struct {
	WinTarget   string // stable @N window_id, for all window-scoped mutations
	WindowID    string
	SessionID   string
	WindowIndex int
	PaneID      string // this (sidebar) pane
	PaneLeft    int
	PaneWidth   int
	PaneHeight  int
	WindowPanes int

	// Window-scoped state options (empty string when unset).
	ContentPane  string
	Source       string
	SidebarWidth int // @sidebar_width; zero when unset

	// Fingerprint changes exactly when something the navigator renders changes.
	Fingerprint string
}

// Snapshot carries only local pane/window state. Global invalidation is derived
// once from World's ordered sessions and panes, avoiding a second full nested
// session/window expansion in this already-recurring query.
var snapshotTokens = []string{
	"#{q/a:session_id}",
	"#{q/a:window_index}",
	"#{q/a:pane_id}",
	"#{q/a:pane_left}",
	"#{q/a:pane_width}",
	"#{q/a:pane_height}",
	"#{q/a:window_panes}",
	"#{q/a:@sidebar_content_pane}",
	"#{q/a:@sidebar_source}",
	"#{q/a:@sidebar_width}",
	"#{q/a:window_id}",
}

// Query fetches the sidebar Snapshot in one tmux fork, explicitly scoped to
// this sidebar pane rather than whichever pane another client currently has.
func (c *Client) Query() (Snapshot, error) {
	var s Snapshot
	args := []string{"display-message", "-p"}
	if c.paneID != "" {
		args = append(args, "-t", c.paneID)
	}
	args = append(args, strings.Join(snapshotTokens, fieldSep))
	out, err := c.command(args...)
	if err != nil {
		return s, err
	}
	f := strings.Split(out, fieldSep)
	if len(f) != len(snapshotTokens) {
		return s, fmt.Errorf("tmuxio: snapshot: q/a field count %d, want %d", len(f), len(snapshotTokens))
	}
	for i := range f {
		f[i], err = DecodeArgument(f[i])
		if err != nil {
			return s, fmt.Errorf("tmuxio: snapshot field %d: %w", i+1, err)
		}
	}
	if s.PaneLeft, err = parseInt("pane_left", f[3]); err != nil {
		return s, err
	}
	if s.PaneWidth, err = parseInt("pane_width", f[4]); err != nil {
		return s, err
	}
	if s.PaneHeight, err = parseInt("pane_height", f[5]); err != nil {
		return s, err
	}
	if s.WindowPanes, err = parseInt("window_panes", f[6]); err != nil {
		return s, err
	}
	s.WindowID = f[10]
	s.WinTarget = s.WindowID
	s.SessionID = f[0]
	if s.WindowIndex, err = parseInt("window_index", f[1]); err != nil {
		return s, err
	}
	s.PaneID = f[2]
	s.ContentPane = f[7]
	s.Source = f[8]
	if f[9] != "" {
		if s.SidebarWidth, err = parseInt("@sidebar_width", f[9]); err != nil || s.SidebarWidth < 1 {
			return Snapshot{}, fmt.Errorf("tmuxio: invalid @sidebar_width %q", f[9])
		}
	}
	return s, nil
}

// SetWinOpt sets a window-scoped user option on the given window target.
func (c *Client) SetWinOpt(winTarget, name, value string) {
	c.RunQuiet("set-option", "-wt", winTarget, name, value)
}

// UnsetWinOpt clears a window-scoped user option, tolerating "not set".
func (c *Client) UnsetWinOpt(winTarget, name string) {
	c.RunQuiet("set-option", "-wqu", "-t", winTarget, name)
}

// SetSidebarWidth updates the window-owned source of truth and immediately
// applies it to the live sidebar pane. Resize hooks later read the same option.
func (c *Client) SetSidebarWidth(winTarget string, width int) {
	if winTarget == "" || width < 1 {
		return
	}
	c.RunQuiet("set-option", "-wt", winTarget, "@sidebar_width", strconv.Itoa(width))
	if c.paneID != "" {
		c.RunQuiet("resize-pane", "-x", strconv.Itoa(width), "-t", c.paneID)
	}
}

// FocusPane switches the originating client directly to paneID in one command.
// switch-client resolves cross-session targets and -Z preserves a destination
// window's zoom state. target remains in the signature for existing row payloads,
// but tmux no longer needs a separate window target or select-pane command.
func (c *Client) FocusPane(paneID, target string) {
	if paneID == "" {
		return
	}
	_ = target // compatibility: callers still carry session:window targets.
	if c.originClient != "" {
		c.RunQuiet("switch-client", "-c", c.originClient, "-Z", "-t", paneID)
	} else {
		c.RunQuiet("switch-client", "-Z", "-t", paneID)
	}
}

// CapturePane captures a pane only on explicit user action. -e retains escape
// bytes so callers can prove their renderer sanitizes all terminal controls.
// It is deliberately absent from World(), keeping the recurring poll bounded.
func (c *Client) CapturePane(ref PaneRef) (string, error) {
	if ref.PaneID == "" || ref.SessionID == "" || ref.WindowID == "" {
		return "", fmt.Errorf("tmuxio: incomplete preview pane identity")
	}
	// if-shell evaluates the full rendered identity and capture-pane in one tmux
	// server queue turn. A moved/stale pane takes the failing branch, whose
	// nonzero status is returned to the preview modal instead of capturing the
	// pane's new location.
	action := fmt.Sprintf("capture-pane -p -e -t %s", ref.PaneID)
	return c.command("if-shell", "-F", "-t", ref.PaneID, panePredicate(ref), action, "run-shell \"exit 1\"")
}

// FocusPaneRef is the context-palette variant: unlike ordinary Enter, it acts
// only if the pane is still in the rendered session/window when tmux executes.
func (c *Client) FocusPaneRef(ref PaneRef) {
	action := "switch-client"
	if c.originClient != "" {
		action += " -c " + commandQuote(c.originClient)
	}
	action += " -Z -t " + ref.PaneID
	c.paneGuard(ref, action)
}

// PaneMatches checks the rendered identity before an external action starts.
// The action itself must still use paneGuard to close the validation/action race.
func (c *Client) PaneMatches(ref PaneRef) bool {
	if ref.PaneID == "" || ref.SessionID == "" || ref.WindowIndex < 0 {
		return false
	}
	out, err := c.command("display-message", "-p", "-t", ref.PaneID, panePredicate(ref))
	return err == nil && strings.TrimSpace(out) == "1"
}

// ShowMessage reports a concise asynchronous action result to the attached
// client without taking over the sidebar TUI.
func (c *Client) ShowMessage(message string) {
	c.RunQuiet("display-message", "-d", "3000", message)
}

// SplitAt opens beside the rendered content pane only while it remains in the
// same session/window. The path is quoted as one tmux command argument.
func (c *Client) SplitAt(ref PaneRef, dir string) {
	action := "split-window -h -c " + commandQuote(dir) + " -t " + ref.PaneID
	c.paneGuard(ref, action)
}

// OpenFileAt runs the existing tmux-open-target helper only while the content
// pane still owns the rendered location. Both script and path stay shell data.
func (c *Client) OpenFileAt(ref PaneRef, script, path string) {
	shell := "TMUX_OPEN_PANE=" + commandQuote(ref.PaneID) + " " + commandQuote(script) + " " + commandQuote(path)
	c.paneGuard(ref, "run-shell "+commandQuote(shell))
}

// NewWindowAt opens a new window rooted at path. It deliberately targets the
// sidebar's immutable pane so the new window joins the correct session.
// RunScriptAtPane starts an existing dispatcher only if the selected pane still
// has its rendered identity. The pane ID is also passed explicitly so the script
// never falls back to an attached client's active pane.
func (c *Client) RunScriptAtPane(ref PaneRef, script string) {
	shell := commandQuote(script) + " " + commandQuote(ref.PaneID)
	c.paneGuard(ref, "run-shell "+commandQuote(shell))
}

func (c *Client) NewWindowAt(path string) {
	args := []string{"new-window", "-c", path}
	if c.paneID != "" {
		args = append(args, "-t", c.paneID)
	}
	c.RunQuiet(args...)
}

// paneGuard runs action only while the exact rendered pane is still in the
// recorded session/window. if-shell evaluates its predicate and command in one
// tmux server queue turn, closing the validation/action race for destructive
// operations and pane moves.
func panePredicate(ref PaneRef) string {
	window := fmt.Sprintf("#{==:#{window_index},%d}", ref.WindowIndex)
	if ref.WindowID != "" {
		window = fmt.Sprintf("#{&&:%s,#{==:#{window_id},%s}}", window, ref.WindowID)
	}
	return fmt.Sprintf("#{&&:#{==:#{pane_id},%s},#{&&:#{==:#{session_id},%s},%s}}", ref.PaneID, ref.SessionID, window)
}

func commandQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'"
}

func (c *Client) paneGuard(ref PaneRef, action string) {
	if ref.PaneID == "" || ref.SessionID == "" || ref.WindowIndex < 0 {
		return
	}
	c.RunQuiet("if-shell", "-F", "-t", ref.PaneID, panePredicate(ref), action, "")
}

func (c *Client) commandPrompt(prompt, template string) {
	args := []string{"command-prompt", "-b"}
	if c.originClient != "" {
		args = append(args, "-t", c.originClient)
	}
	args = append(args, "-l", "-p", prompt, template)
	c.RunQuiet(args...)
}

// PromptPaneLabel opens tmux's native command prompt for the exact pane.
func promptPaneID(paneID string) string {
	if strings.HasPrefix(paneID, "%") {
		return "%0" + strings.TrimPrefix(paneID, "%")
	}
	return paneID
}

func (c *Client) PromptPaneLabel(ref PaneRef) {
	pane := promptPaneID(ref.PaneID)
	template := fmt.Sprintf("set-option -p -t %s @pane-label \"%%%%%%\"", pane)
	c.commandPrompt("Pane label:", template)
}

func (c *Client) PromptRenameWindow(ref PaneRef) {
	if ref.WindowID == "" {
		return
	}
	template := fmt.Sprintf("rename-window -t %s \"%%%%%%\"", ref.WindowID)
	c.commandPrompt("Window name:", template)
}

func (c *Client) TogglePaneZoom(ref PaneRef) {
	c.paneGuard(ref, fmt.Sprintf("resize-pane -Z -t %s", ref.PaneID))
}

// KillPane is destructive. paneGuard revalidates the stable pane/session/window
// identity immediately before issuing kill-pane, rather than trusting a stale
// rendered row.
func (c *Client) KillPane(ref PaneRef) {
	c.paneGuard(ref, fmt.Sprintf("kill-pane -t %s", ref.PaneID))
}

// PromptRenameSession targets the session ID rather than a display name, so a
// renamed session cannot redirect the prompt to another session.
func (c *Client) PromptRenameSession(sessionID string) {
	if sessionID == "" {
		return
	}
	template := fmt.Sprintf("rename-session -t %s \"%%%%%%\"", sessionID)
	c.commandPrompt("Session name:", template)
}

// KillSession is destructive and uses the stable session ID as both predicate
// and target. A stale session produces an inert false branch.
func (c *Client) KillSession(sessionID string) {
	if sessionID == "" {
		return
	}
	c.RunQuiet("if-shell", "-F", "-t", sessionID, fmt.Sprintf("#{==:#{session_id},%s}", sessionID), fmt.Sprintf("kill-session -t %s", sessionID), "")
}

// PaneRow is one row of `list-panes -a`, used by the agent join. Fields remain
// append-only because shell consumers parse the original TSV prefix.
type PaneRow struct {
	PanePID      int
	PaneID       string
	Target       string // session:window.pane, human-facing
	SessionID    string
	SessionName  string
	WindowIndex  int
	WindowID     string
	PaneIndex    int
	PaneLeft     int
	WindowName   string
	PaneActive   bool
	WindowActive bool
	Activity     bool   // window_activity_flag
	Bell         bool   // window_bell_flag
	Silence      bool   // window_silence_flag
	Command      string // pane_current_command
	CurrentPath  string // pane_current_path
	PaneLabel    string // @pane-label (empty when unset)
	Sidebar      bool   // @sidebar_pane, lifecycle infrastructure not navigation data
}

// PaneRef is a stable pane identity captured in a rendered World. Operations
// revalidate it inside tmux immediately before acting; pane IDs alone survive a
// move between sessions, which is not sufficient for destructive commands.
type PaneRef struct {
	PaneID      string
	SessionID   string
	WindowID    string
	WindowIndex int
}

func (p PaneRow) Ref() PaneRef {
	return PaneRef{PaneID: p.PaneID, SessionID: p.SessionID, WindowID: p.WindowID, WindowIndex: p.WindowIndex}
}

// Every tmux-controlled value is q/a encoded before fieldSep framing. Target is
// constructed after decoding instead of embedding session_name in an unframed
// composite format token.
var paneRowTokens = []string{
	"#{q/a:pane_pid}",
	"#{q/a:pane_id}",
	"#{q/a:session_id}",
	"#{q/a:session_name}",
	"#{q/a:window_index}",
	"#{q/a:pane_index}",
	"#{q/a:pane_left}",
	"#{q/a:window_name}",
	"#{q/a:#{?pane_active,1,0}}",
	"#{q/a:#{?window_active,1,0}}",
	"#{q/a:#{?window_activity_flag,1,0}}",
	"#{q/a:#{?window_bell_flag,1,0}}",
	"#{q/a:#{?window_silence_flag,1,0}}",
	"#{q/a:pane_current_command}",
	"#{q/a:pane_current_path}",
	"#{q/a:@pane-label}",
	"#{q/a:window_id}",
	"#{q/a:#{?@sidebar_pane,1,0}}",
}

// PaneSet indexes one ListPanes result so callers answer pane liveness and cwd
// without adding per-pane display-message forks to every poll.
type PaneSet map[string]PaneRow

func NewPaneSet(rows []PaneRow) PaneSet {
	m := make(PaneSet, len(rows))
	for _, r := range rows {
		m[r.PaneID] = r
	}
	return m
}

func (p PaneSet) Alive(paneID string) bool {
	if paneID == "" {
		return false
	}
	_, ok := p[paneID]
	return ok
}

func (p PaneSet) CurrentPath(paneID string) string { return p[paneID].CurrentPath }

// Session is the minimal global session metadata navigator rows need. World
// keeps the ordering float-first then creation-order, matching every tmux
// session surface in this config.
type Session struct {
	ID       string
	Name     string
	Windows  int
	Attached bool
	Activity bool
	Bell     bool
	Silence  bool
}

var sessionTokens = []string{
	"#{q/a:session_id}",
	"#{q/a:session_name}",
	"#{q/a:session_windows}",
	"#{q/a:session_attached}",
}

// ListSessions returns only metadata not already carried by list-panes. The two
// stable groups preserve tmux creation order while forcing float first.
func (c *Client) ListSessions() ([]Session, error) {
	out, err := c.command("list-sessions", "-O", "creation", "-F", strings.Join(sessionTokens, fieldSep))
	if err != nil {
		return nil, err
	}
	float, other := []Session{}, []Session{}
	for lineNo, line := range strings.Split(out, "\n") {
		if line == "" {
			continue
		}
		f, err := decodeFields(line, len(sessionTokens))
		if err != nil {
			return nil, fmt.Errorf("tmuxio: list-sessions row %d: %w", lineNo+1, err)
		}
		windows, err := parseInt("session_windows", f[2])
		if err != nil {
			return nil, fmt.Errorf("tmuxio: list-sessions row %d: %w", lineNo+1, err)
		}
		s := Session{ID: f[0], Name: f[1], Windows: windows, Attached: f[3] == "1"}
		if strings.HasPrefix(s.Name, "float") {
			float = append(float, s)
		} else {
			other = append(other, s)
		}
	}
	return append(float, other...), nil
}

// World is one immutable tmux observation shared by navigator and agent
// resolution. It deliberately owns the only recurring global list-panes -a;
// consumers receive copies so they cannot mutate another consumer's view.
type World struct {
	Snapshot    Snapshot
	sessions    []Session
	panes       []PaneRow
	paneSet     PaneSet
	fingerprint string
}

func (w World) Sessions() []Session { return append([]Session(nil), w.sessions...) }
func (w World) Panes() []PaneRow    { return append([]PaneRow(nil), w.panes...) }
func (w World) PaneSet() PaneSet {
	out := make(PaneSet, len(w.paneSet))
	for id, row := range w.paneSet {
		out[id] = row
	}
	return out
}
func (w World) Fingerprint() string { return w.fingerprint }

// World reads snapshot state, minimal ordered session metadata, and every pane.
// It is the sole recurring tmux collection path for the sidebar.
func (c *Client) World() (World, error) {
	var w World
	snap, err := c.Query()
	if err != nil {
		return w, err
	}
	sessions, err := c.ListSessions()
	if err != nil {
		return w, err
	}
	panes, err := c.ListPanes()
	if err != nil {
		return w, err
	}
	return NewWorld(snap, sessions, panes), nil
}

// NewWorld snapshots already-collected tmux values. It is primarily useful for
// tests and for integrations that have one authoritative collection pass.
func NewWorld(snap Snapshot, sessions []Session, panes []PaneRow) World {
	w := World{Snapshot: snap, sessions: append([]Session(nil), sessions...), panes: append([]PaneRow(nil), panes...)}
	// tmux exposes alert flags on windows. A session badge is the aggregate of
	// its panes/windows, so it costs no second recurring query.
	for i := range w.sessions {
		for _, pane := range w.panes {
			if pane.SessionID != w.sessions[i].ID {
				continue
			}
			w.sessions[i].Activity = w.sessions[i].Activity || pane.Activity
			w.sessions[i].Bell = w.sessions[i].Bell || pane.Bell
			w.sessions[i].Silence = w.sessions[i].Silence || pane.Silence
		}
	}
	w.paneSet = NewPaneSet(w.panes)
	w.fingerprint = worldFingerprint(snap, w.sessions, w.panes)
	w.Snapshot.Fingerprint = w.fingerprint
	return w
}

func fingerprintPart(b *strings.Builder, s string) { fmt.Fprintf(b, "%d:%s|", len(s), s) }

func worldFingerprint(s Snapshot, sessions []Session, panes []PaneRow) string {
	var b strings.Builder
	fingerprintPart(&b, s.SessionID)
	fingerprintPart(&b, s.WindowID)
	fmt.Fprintf(&b, "%d|", s.WindowIndex)
	for _, session := range sessions {
		fingerprintPart(&b, session.ID)
		fingerprintPart(&b, session.Name)
		fmt.Fprintf(&b, "%d:%t:%t:%t:%t|", session.Windows, session.Attached, session.Activity, session.Bell, session.Silence)
	}
	for _, pane := range panes {
		fingerprintPart(&b, pane.PaneID)
		fingerprintPart(&b, pane.SessionID)
		fingerprintPart(&b, pane.SessionName)
		fingerprintPart(&b, pane.WindowName)
		fingerprintPart(&b, pane.Command)
		fingerprintPart(&b, pane.CurrentPath)
		fingerprintPart(&b, pane.PaneLabel)
		fmt.Fprintf(&b, "%d:%d:%d:%d:%t:%t:%t:%t:%t:%t|", pane.PanePID, pane.WindowIndex, pane.PaneIndex, pane.PaneLeft, pane.PaneActive, pane.WindowActive, pane.Activity, pane.Bell, pane.Silence, pane.Sidebar)
	}
	return b.String()
}

// ListPanes returns all panes. It is intentionally global: the agent resolver
// joins every session, but it still uses this Client's injected runner.
func (c *Client) ListPanes() ([]PaneRow, error) {
	out, err := c.command("list-panes", "-a", "-F", strings.Join(paneRowTokens, fieldSep))
	if err != nil {
		return nil, err
	}
	var rows []PaneRow
	for lineNo, line := range strings.Split(out, "\n") {
		if line == "" {
			continue
		}
		f, err := decodeFields(line, len(paneRowTokens))
		if err != nil {
			return nil, fmt.Errorf("tmuxio: list-panes row %d: %w", lineNo+1, err)
		}
		pid, err := parseInt("pane_pid", f[0])
		if err != nil {
			return nil, fmt.Errorf("tmuxio: list-panes row %d: %w", lineNo+1, err)
		}
		windowIndex, err := parseInt("window_index", f[4])
		if err != nil {
			return nil, fmt.Errorf("tmuxio: list-panes row %d: %w", lineNo+1, err)
		}
		paneIndex, err := parseInt("pane_index", f[5])
		if err != nil {
			return nil, fmt.Errorf("tmuxio: list-panes row %d: %w", lineNo+1, err)
		}
		paneLeft, err := parseInt("pane_left", f[6])
		if err != nil {
			return nil, fmt.Errorf("tmuxio: list-panes row %d: %w", lineNo+1, err)
		}
		rows = append(rows, PaneRow{
			PanePID: pid, PaneID: f[1], SessionID: f[2], SessionName: f[3],
			WindowIndex: windowIndex, PaneIndex: paneIndex, PaneLeft: paneLeft,
			Target: f[2] + ":" + f[4] + "." + f[5], WindowName: f[7],
			PaneActive: f[8] == "1", WindowActive: f[9] == "1",
			Activity: f[10] == "1", Bell: f[11] == "1", Silence: f[12] == "1",
			Command: f[13], CurrentPath: f[14], PaneLabel: f[15], WindowID: f[16], Sidebar: f[17] == "1",
		})
	}
	return rows, nil
}

// Opts reads user options in one fork, explicitly scoped to this sidebar pane
// so window-scoped values cannot leak from an unrelated attached client. The
// prior one-show-option-per-role implementation cost roughly 110ms at startup;
// the batched format keeps palette loading to one tmux process.
func (c *Client) Opts(names ...string) (map[string]string, error) {
	vals := make(map[string]string, len(names))
	if len(names) == 0 {
		return vals, nil
	}
	tokens := make([]string, 0, len(names))
	for _, n := range names {
		tokens = append(tokens, "#{q/a:"+n+"}")
	}
	out, err := c.command("display-message", "-p", "-t", c.paneID, strings.Join(tokens, fieldSep))
	if err != nil {
		return vals, err
	}
	f, err := decodeFields(out, len(names))
	if err != nil {
		return vals, fmt.Errorf("tmuxio: options: %w", err)
	}
	for i, n := range names {
		vals[n] = f[i]
	}
	return vals, nil
}

// RightOfPane finds the pane immediately right of paneLeft, scoped to the
// sidebar's window with an explicit pane target.
func (c *Client) RightOfPane(paneLeft int) (string, error) {
	format := "#{q/a:pane_left}" + fieldSep + "#{q/a:pane_id}"
	out, err := c.command("list-panes", "-t", c.paneID, "-F", format)
	if err != nil {
		return "", err
	}
	best := -1
	bestID := ""
	for lineNo, line := range strings.Split(out, "\n") {
		if line == "" {
			continue
		}
		f, err := decodeFields(line, 2)
		if err != nil {
			return "", fmt.Errorf("tmuxio: pane geometry row %d: %w", lineNo+1, err)
		}
		left, err := parseInt("pane_left", f[0])
		if err != nil {
			return "", fmt.Errorf("tmuxio: pane geometry row %d: %w", lineNo+1, err)
		}
		if left > paneLeft && (best == -1 || left < best) {
			best, bestID = left, f[1]
		}
	}
	return bestID, nil
}
