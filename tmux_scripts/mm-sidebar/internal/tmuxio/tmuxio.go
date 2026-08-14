// Package tmuxio is the single place this binary talks to tmux.
//
// The bash dispatcher this replaces made ~5 separate `tmux` forks for even a
// cheap repaint (win_target + get_opt + pane_width + pane_height, each its own
// process). Everything the renderer needs per tick is instead fetched in ONE
// `display-message -p` call with a multi-token format string -- `#{@user_opt}`
// resolves window-scoped user options with normal option-scope fallback and
// yields an empty field when unset, so the window-scoped state contract
// (@sidebar_pane_id / @sidebar_content_pane / @sidebar_source) needs no
// separate show-options calls.
package tmuxio

import (
	"os/exec"
	"strconv"
	"strings"
)

// fieldSep separates tokens inside a single batched display-message format.
// Unit separator: cannot appear in a pane path, session name, or option value.
const fieldSep = "\x1f"

// Run executes tmux with args and returns trimmed stdout.
func Run(args ...string) (string, error) {
	out, err := exec.Command("tmux", args...).Output()
	return strings.TrimRight(string(out), "\n"), err
}

// RunQuiet executes tmux and discards any error (for fire-and-forget commands
// where a dead pane/session just means "nothing to do").
func RunQuiet(args ...string) {
	_ = exec.Command("tmux", args...).Run()
}

// Snapshot is everything the renderer needs about its own pane and window
// state, gathered in a single tmux call.
type Snapshot struct {
	WinTarget   string // "$0:2" -- session_id:window_index, for -t on window options
	PaneID      string // this (sidebar) pane
	PaneLeft    int
	PaneWidth   int
	PaneHeight  int
	WindowPanes int

	// Window-scoped state options (empty string when unset).
	//
	// @sidebar_pane_id is deliberately NOT read here. It is the toggle script's
	// liveness flag, and inside a running sidebar it is by definition this pane
	// -- PaneID above already answers that. It used to be parsed into a field
	// nothing ever consumed.
	ContentPane string
	Source      string

	// Fingerprint changes exactly when something the navigator renders changes:
	// the set of sessions, their attach state, and every window's index, name,
	// pane count, foreground command and cwd. Callers compare it between polls
	// to decide whether a source needs re-fetching at all.
	Fingerprint string
}

// fingerprintToken is a nested #{S:...#{W:...}} loop over every session and
// window. It rides along in Query's existing fork, so it costs nothing.
//
// TWO THINGS ABOUT IT ARE LOAD-BEARING AND BOTH HAVE BITTEN:
//
//   - NO TRAILING COMMA inside #{W:...}. tmux loop formats take a SECOND
//     argument that is the format used for the CURRENT session/window -- it is
//     not a separator. `#{W:>...,}` therefore renders the current window as the
//     empty string, silently omitting one window per session from the
//     fingerprint. That is precisely the window whose command or pane count you
//     are most likely to be changing, so the gate would never fire for it.
//     Measured: with the comma, 5 of 7 windows appeared; without it, all 7.
//   - Separators must stay ':' / ';' / '>'. A '.'-separated variant was tried
//     and silently dropped a whole session.
const fingerprintToken = "#{S:#{session_id}#{session_attached}" +
	"#{W:>#{window_index}#{window_name}#{window_panes}" +
	"#{pane_current_command}#{pane_current_path}};}"

// snapshotTokens must stay in lockstep with the field order in Query below.
var snapshotTokens = []string{
	"#{session_id}:#{window_index}",
	"#{pane_id}",
	"#{pane_left}",
	"#{pane_width}",
	"#{pane_height}",
	"#{window_panes}",
	"#{@sidebar_content_pane}",
	"#{@sidebar_source}",
	fingerprintToken,
}

// Query fetches a Snapshot in one tmux fork.
func Query() (Snapshot, error) {
	var s Snapshot
	out, err := Run("display-message", "-p", strings.Join(snapshotTokens, fieldSep))
	if err != nil {
		return s, err
	}
	f := strings.Split(out, fieldSep)
	if len(f) < len(snapshotTokens) {
		return s, errShortRead
	}
	s.WinTarget = f[0]
	s.PaneID = f[1]
	s.PaneLeft = atoi(f[2])
	s.PaneWidth = atoi(f[3])
	s.PaneHeight = atoi(f[4])
	s.WindowPanes = atoi(f[5])
	s.ContentPane = f[6]
	s.Source = f[7]
	s.Fingerprint = f[8]
	return s, nil
}

type shortReadError struct{}

func (shortReadError) Error() string { return "tmuxio: short display-message read" }

var errShortRead = shortReadError{}

// SetWinOpt sets a window-scoped user option on the given window target.
func SetWinOpt(winTarget, name, value string) {
	RunQuiet("set-option", "-wt", winTarget, name, value)
}

// UnsetWinOpt clears a window-scoped user option, tolerating "not set".
func UnsetWinOpt(winTarget, name string) {
	RunQuiet("set-option", "-wqu", "-t", winTarget, name)
}

// NOTE: there is deliberately no PaneAlive/PaneCurrentPath here. Both were
// per-pane display-message forks paid on EVERY poll; both questions are now
// answered from PaneSet, off the single batched ListPanes call. Don't add them
// back -- reach for ListPanes/NewPaneSet instead.

// PaneTarget resolves a pane id to a "session_id:window_index" target, used by
// FocusPane to switch the client before selecting the pane.
func PaneTarget(paneID string) string {
	out, err := Run("display-message", "-p", "-t", paneID, "#{session_id}:#{window_index}")
	if err != nil {
		return ""
	}
	return out
}

// FocusPane mirrors tmux-fzf-nav's focus_pane: switch the client to the pane's
// window, then select the pane. Both are best-effort -- a session/pane that
// died between listing and acting must not take the sidebar down with it.
func FocusPane(paneID, target string) {
	if paneID == "" {
		return
	}
	if target == "" {
		target = PaneTarget(paneID)
	}
	if target == "" {
		return
	}
	RunQuiet("switch-client", "-t", target)
	RunQuiet("select-pane", "-t", paneID)
}

// SplitAt opens a new horizontal split in dir, targeting the content pane, and
// leaves focus there -- the filetree's Enter-on-a-directory action.
func SplitAt(targetPane, dir string) {
	RunQuiet("split-window", "-h", "-c", dir, "-t", targetPane)
}

// PaneRow is one row of `list-panes -a`, used by the agent join. Kept here so
// the single expensive list-panes format lives next to every other tmux call.
type PaneRow struct {
	PanePID     int
	PaneID      string
	Target      string // session:window.pane, human-facing
	SessionName string
	WindowName  string
	Command     string // pane_current_command
	CurrentPath string // pane_current_path
}

var paneRowTokens = []string{
	"#{pane_pid}",
	"#{pane_id}",
	"#{session_name}:#{window_index}.#{pane_index}",
	"#{session_name}",
	"#{window_name}",
	"#{pane_current_command}",
	"#{pane_current_path}",
}

// PaneSet indexes a ListPanes result by pane id so callers can answer "is this
// pane alive" and "what is its cwd" from the ONE batched fork, instead of the
// two extra per-tick display-message forks those questions used to cost.
type PaneSet map[string]PaneRow

// NewPaneSet indexes rows by pane id.
func NewPaneSet(rows []PaneRow) PaneSet {
	m := make(PaneSet, len(rows))
	for _, r := range rows {
		m[r.PaneID] = r
	}
	return m
}

// Alive reports whether a pane id is still present. A pane that list-panes -a
// does not report does not exist -- that is the same question PaneAlive forked
// to ask.
func (p PaneSet) Alive(paneID string) bool {
	if paneID == "" {
		return false
	}
	_, ok := p[paneID]
	return ok
}

// CurrentPath returns a pane's cwd, or "" when the pane is gone.
func (p PaneSet) CurrentPath(paneID string) string {
	return p[paneID].CurrentPath
}

// ListPanes returns every pane in every session in one tmux fork. This is the
// only per-tick cost of the agent join once identities are cached.
func ListPanes() ([]PaneRow, error) {
	out, err := Run("list-panes", "-a", "-F", strings.Join(paneRowTokens, fieldSep))
	if err != nil {
		return nil, err
	}
	var rows []PaneRow
	for _, line := range strings.Split(out, "\n") {
		if line == "" {
			continue
		}
		f := strings.Split(line, fieldSep)
		if len(f) < len(paneRowTokens) {
			continue
		}
		rows = append(rows, PaneRow{
			PanePID:     atoi(f[0]),
			PaneID:      f[1],
			Target:      f[2],
			SessionName: f[3],
			WindowName:  f[4],
			Command:     f[5],
			CurrentPath: f[6],
		})
	}
	return rows, nil
}

// GlobalOpts reads several user options in ONE tmux fork, returning name ->
// value with an empty string for anything unset.
//
// The obvious version -- one `show -gqv` per option -- cost 20ms per fork here,
// so theme.Load's seven palette roles were 110ms of blank pane on every M-Tab
// open, paid before Bubble Tea even starts. That is the same gesture whose
// respawn cost justified splitting M-S-Tab out, so it was the wrong place to
// spend seven forks. Batched via the same #{@user_option} token/fieldSep pattern
// Query uses: that format resolves user options with normal scope fallback and
// yields an empty field when unset.
//
// Names must be user options (@-prefixed); a non-@ option name is not a valid
// format token and would come back as literal text.
func GlobalOpts(names ...string) map[string]string {
	vals := make(map[string]string, len(names))
	if len(names) == 0 {
		return vals
	}
	tokens := make([]string, 0, len(names))
	for _, n := range names {
		tokens = append(tokens, "#{"+n+"}")
	}
	out, err := Run("display-message", "-p", strings.Join(tokens, fieldSep))
	if err != nil {
		return vals // outside a tmux server: every caller falls back
	}
	f := strings.Split(out, fieldSep)
	for i, n := range names {
		if i < len(f) {
			vals[n] = f[i]
		}
	}
	return vals
}

// RightOfPane finds the pane immediately to the right of paneLeft by geometry.
// The content-pane fallback: if @sidebar_content_pane points at a dead pane,
// the pane just right of the sidebar is the content area by construction (the
// sidebar is always leftmost and full height).
func RightOfPane(paneLeft int) string {
	out, err := Run("list-panes", "-F", "#{pane_left}"+fieldSep+"#{pane_id}")
	if err != nil {
		return ""
	}
	best := -1
	bestID := ""
	for _, line := range strings.Split(out, "\n") {
		f := strings.Split(line, fieldSep)
		if len(f) < 2 {
			continue
		}
		l := atoi(f[0])
		if l > paneLeft && (best == -1 || l < best) {
			best, bestID = l, f[1]
		}
	}
	return bestID
}

func atoi(s string) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0
	}
	return n
}
