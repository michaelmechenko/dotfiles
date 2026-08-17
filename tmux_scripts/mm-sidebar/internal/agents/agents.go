// Package agents resolves one row per live AI-agent pane (Claude Code + pi).
//
// This is a native port of tmux-agent-ls's join, written because the shell
// version cost 1.26s wall on a 20-pane machine: it forked tmux-pi-session once
// per pane, and each probe forked pgrep + ps x2 + lsof + sed + ls + basename.
// The pi loop alone was ~1.05s of that, and because the bash dispatcher's key
// loop was a single blocking read, a keypress landing inside a sweep waited on
// the whole thing.
//
// Claude's recipe is ported. pi now prefers its authoritative PID-keyed runtime
// registry, retaining the former cwd/newest recipe only for compatibility:
//
//   - Claude: a `claude` process's ppid IS its owning tmux pane's pane_pid.
//     cwd is NOT a usable key (many sessions share one cwd). Live status comes
//     from claude/sessions/<pid>.json; awaiting-permission comes from the
//     Notification-hook state file /tmp/claude-session-state/<sessionId>.
//     Transcripts are located by sessionId (the projects/<slug> dir name
//     collapses /, . and _ all to '-', so deriving the slug from a cwd is
//     unreliable across path types).
//   - pi: /tmp/pi-session-state/<pid>.json supplies the exact session ID and
//     transcript. The process may be pane_pid after exec or a direct child. A
//     validated cwd -> newest-transcript lookup remains only as fallback.
//
// What changed is the cost model. Per Resolve() in steady state:
//
//	1 fork  tmux list-panes -a          (~15ms)
//	0 forks Claude state                (direct JSON reads)
//	0 forks transcripts                 (cached; dir scan on miss)
//
// The process table (`ps -eww -o pid=,ppid=,args=`, one fork, ~90ms) and the
// batched cwd lookup (`lsof -a -d cwd -Fn -p <csv>`, one fork) run only when
// the pane set changes or an agent identity is not yet cached -- i.e. when a
// pane or agent actually appears or disappears, not every tick. pi processes
// don't chdir, so pid->cwd is cached for the process lifetime.
package agents

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"mm-sidebar/internal/tmuxio"
	"mm-sidebar/internal/trace"
)

// Agent kinds, used as the 9th field of the TSV schema.
const (
	AgentClaude = "claude"
	AgentPi     = "pi"
)

// States, in urgency order (see StateRank).
const (
	StateAwaitingPermission = "awaiting-permission"
	StateWaiting            = "waiting"
	StateThinking           = "thinking"
	StateIdle               = "idle"
)

// Row is one agent pane. Field order matches the 10-field TSV schema that
// tmux-agent-ls emits and that every consumer parses:
//
//	sessionId pane_id target session_name state name transcript window_name agent cwd
//
// cwd is field 10 and was APPENDED, never inserted -- fields 1-9 are a contract
// with existing shell consumers and must stay byte-identical.
//
// No field is ever emitted empty -- a genuinely empty field silently collapses
// in bash's tab-delimited `read` (tab counts as IFS whitespace no matter what
// IFS is set to, so consecutive tabs merge and every later field shifts left by
// one). "-" is the placeholder, matching jq's `(.name // "-")` convention in
// tmux-claude-ls. See TSV() below.
type Row struct {
	SessionID   string
	PaneID      string
	Target      string
	SessionName string
	State       string
	Name        string
	Transcript  string
	WindowName  string
	Agent       string
	// Cwd is the owning pane's pane_current_path. It rides along on the batched
	// ListPanes read (zero extra forks) and is the join key for repo-aware
	// surfaces: agent -> cwd -> repo root -> worktree/branch/diff.
	Cwd string
}

// StateRank orders rows by how much they need attention: blocked on the user
// first, working next, idle last. agents_glance sorts on this so the rows that
// matter survive truncation.
func StateRank(state string) int {
	switch state {
	case StateAwaitingPermission, StateWaiting:
		return 0
	case StateThinking:
		return 1
	default:
		return 2
	}
}

// TSV renders the row in the 10-field schema, substituting "-" for any empty
// field (see the Row doc comment for why empty fields are forbidden).
func (r Row) TSV() string {
	f := []string{
		r.SessionID, r.PaneID, r.Target, r.SessionName,
		r.State, r.Name, r.Transcript, r.WindowName, r.Agent, r.Cwd,
	}
	for i, v := range f {
		if v == "" {
			f[i] = "-"
		}
	}
	return strings.Join(f, "\t")
}

// Resolver holds the caches that keep Resolve cheap between structural changes.
// Not safe for concurrent use; the sidebar owns exactly one and calls Resolve
// from a single background goroutine.
type Resolver struct {
	claudeSessDir  string
	claudeProjDir  string
	claudeStateDir string
	piSessDir      string
	piStateDir     string

	panePIDsKey   string            // fingerprint of the current pane->pid set
	piRegistryKey string            // fingerprint of valid on-disk pi records
	piByPanePID   map[int]piProc    // pane_pid -> resolved pi process (absent = probed, not pi)
	probedCmd     map[int]string    // pane_pid -> pane_current_command as of the last sweep
	cwdByPID      map[int]string    // pi pid -> cwd (stable for the process lifetime)
	ppidByPID     map[int]int       // agent pid -> ppid (stable for the process lifetime)
	transcript    map[string]string // claude sessionId -> transcript path
}

// nodeComm is what pi's process reports on releases that don't set their own
// process name (it is a Node CLI), which is also why a pi pane's tmux window
// auto-names itself `node`.
const nodeComm = "node"

type piProc struct {
	pid  int
	comm string // argv[0] basename: "pi" on recent releases, "node" on older ones
}

type piRecord struct {
	PID         int    `json:"pid"`
	SessionID   string `json:"sessionId"`
	SessionFile string `json:"sessionFile"`
	Cwd         string `json:"cwd"`
}

// NewResolver builds a Resolver rooted at the standard config locations.
func NewResolver() *Resolver {
	home, err := os.UserHomeDir()
	if err != nil {
		home = os.Getenv("HOME")
	}
	cfg := filepath.Join(home, ".config")
	return &Resolver{
		claudeSessDir:  filepath.Join(cfg, "claude", "sessions"),
		claudeProjDir:  filepath.Join(cfg, "claude", "projects"),
		claudeStateDir: "/tmp/claude-session-state",
		piSessDir:      filepath.Join(cfg, "pi-config", "agent", "sessions"),
		piStateDir:     "/tmp/pi-session-state",
		piByPanePID:    map[int]piProc{},
		probedCmd:      map[int]string{},
		cwdByPID:       map[int]string{},
		ppidByPID:      map[int]int{},
		transcript:     map[string]string{},
	}
}

// WatchDirs returns the directories whose changes should trigger a re-resolve.
// Claude writes live status into sessions/<pid>.json and the Notification hook
// writes/clears the permission-state files, so an fsnotify watch on both turns
// agent-state updates into pushes instead of poll hits.
func (r *Resolver) WatchDirs() []string {
	return []string{r.claudeSessDir, r.claudeStateDir, r.piStateDir}
}

// Resolve returns the current agent rows: Claude rows first (in sessions-dir
// order, matching tmux-claude-ls), then pi rows.
func (r *Resolver) Resolve() ([]Row, error) {
	if trace.Enabled {
		defer trace.Phase("resolve-total", time.Now())
	}

	t := time.Now()
	panes, err := tmuxio.ListPanes()
	trace.Phase("tmux-list-panes", t)
	if err != nil {
		return nil, err
	}

	t = time.Now()
	claudeSessions := r.readClaudeSessions()
	trace.Phase("claude-sessions", t)
	piRecords := r.readPiRecords()
	registryKey := piRecordsKey(piRecords)

	// Decide whether the process table is needed this round. It is the single
	// priciest call here (~90ms, and 260ms on a loaded machine), so it only runs
	// on an actual structural change.
	key := panePIDsKey(panes)
	needPS := key != r.panePIDsKey || registryKey != r.piRegistryKey
	for _, s := range claudeSessions {
		if _, ok := r.ppidByPID[s.PID]; !ok {
			needPS = true
			break
		}
	}
	if !needPS {
		needPS = r.piSetChanged(panes)
	}
	if needPS {
		t = time.Now()
		r.refreshProcessTable(panes, claudeSessions)
		trace.Phase("process-table", t)
		r.panePIDsKey = key
		r.piRegistryKey = registryKey
	}

	byPanePID := make(map[int]tmuxio.PaneRow, len(panes))
	for _, p := range panes {
		byPanePID[p.PanePID] = p
	}

	rows := make([]Row, 0, len(claudeSessions)+len(r.piByPanePID))
	rows = append(rows, r.claudeRows(claudeSessions, byPanePID)...)
	rows = append(rows, r.piRows(panes, piRecords)...)
	return rows, nil
}

// piSetChanged reports whether the set of pi processes may have changed without
// the pane set changing -- the one structural event panePIDsKey cannot see.
//
// Registry changes now force a sweep for exact pi identity, but this remains the
// no-registry backstop. A pane's pane_pid can remain its shell while pi starts
// as a child, so its process may change without the pane-set fingerprint moving.
//
// Both directions are detected without a fork:
//
//   - APPEARED: a pane whose foreground command could be pi (`pi`, or `node`
//     since pi is a Node CLI whose comm is node on releases that don't set their
//     process name -- the same fact piState documents) that isn't already a known
//     pi pane and whose command has CHANGED since the last sweep probed it.
//     Both extra conditions are load-bearing: without the pi-ish test, every
//     command run in any pane in any session would force a ps sweep; without the
//     changed-since-probed test, a pane running plain node (not pi) would force
//     one every single tick forever, which is worse than the bug being fixed.
//   - GONE: a cached pi pid that no longer exists. kill(pid, 0) is a syscall,
//     not a process, so probing every known pi pane costs nothing measurable.
func (r *Resolver) piSetChanged(panes []tmuxio.PaneRow) bool {
	for _, p := range panes {
		if _, known := r.piByPanePID[p.PanePID]; known {
			continue
		}
		if p.Command != AgentPi && p.Command != nodeComm {
			continue
		}
		if r.probedCmd[p.PanePID] != p.Command {
			return true
		}
	}
	for _, proc := range r.piByPanePID {
		if syscall.Kill(proc.pid, 0) != nil {
			return true
		}
	}
	return false
}

// ---- Claude ---------------------------------------------------------------

type claudeSession struct {
	PID       int    `json:"pid"`
	SessionID string `json:"sessionId"`
	Status    string `json:"status"`
	Name      string `json:"name"`
}

// readClaudeSessions reads every claude/sessions/<pid>.json. os.ReadDir is
// sorted by filename, which reproduces the shell glob order tmux-claude-ls
// emitted rows in. Replaces one `jq` fork per session file with an in-process
// unmarshal.
func (r *Resolver) readClaudeSessions() []claudeSession {
	entries, err := os.ReadDir(r.claudeSessDir)
	if err != nil {
		return nil
	}
	var out []claudeSession
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(r.claudeSessDir, e.Name()))
		if err != nil {
			continue
		}
		var s claudeSession
		if err := json.Unmarshal(b, &s); err != nil || s.PID == 0 {
			continue
		}
		out = append(out, s)
	}
	return out
}

func (r *Resolver) claudeRows(sessions []claudeSession, byPanePID map[int]tmuxio.PaneRow) []Row {
	var rows []Row
	for _, s := range sessions {
		ppid, ok := r.ppidByPID[s.PID]
		if !ok {
			continue // process gone since the last table refresh
		}
		pane, ok := byPanePID[ppid]
		if !ok {
			continue // session not owned by any live tmux pane
		}
		name := s.Name
		if name == "" {
			name = "-"
		}
		rows = append(rows, Row{
			SessionID:   s.SessionID,
			PaneID:      pane.PaneID,
			Target:      pane.Target,
			SessionName: pane.SessionName,
			State:       r.claudeState(s),
			Name:        name,
			Transcript:  r.claudeTranscript(s.SessionID),
			WindowName:  pane.WindowName,
			Agent:       AgentClaude,
			Cwd:         pane.CurrentPath,
		})
	}
	return rows
}

// claudeState mirrors tmux-claude-ls: the Notification-hook state file wins
// (it is the only signal that distinguishes a permission prompt from an
// ordinary question), then Claude's own live status field.
func (r *Resolver) claudeState(s claudeSession) string {
	if s.SessionID != "" {
		if _, err := os.Stat(filepath.Join(r.claudeStateDir, s.SessionID)); err == nil {
			return StateAwaitingPermission
		}
	}
	switch s.Status {
	case "busy":
		return StateThinking
	case "waiting":
		return StateWaiting
	default:
		return StateIdle
	}
}

// claudeTranscript resolves sessionId -> projects/<slug>/<sessionId>.jsonl,
// cached because transcript paths don't move. The slug is NOT derived from the
// cwd: projects/<slug> collapses '/', '.' and '_' all to '-', so the mapping
// isn't reversible across path types -- the file is found by name instead.
func (r *Resolver) claudeTranscript(sessionID string) string {
	if sessionID == "" {
		return ""
	}
	if p, ok := r.transcript[sessionID]; ok {
		return p
	}
	matches, err := filepath.Glob(filepath.Join(r.claudeProjDir, "*", sessionID+".jsonl"))
	path := ""
	if err == nil && len(matches) > 0 {
		path = matches[0]
	}
	// Cache misses too: a session with no transcript yet stays cheap. It gets
	// re-looked-up the next time the resolver is rebuilt (sidebar re-open).
	r.transcript[sessionID] = path
	return path
}

// ---- pi -------------------------------------------------------------------

func (r *Resolver) piRows(panes []tmuxio.PaneRow, records map[int]piRecord) []Row {
	var rows []Row
	exactPanes := map[int]bool{}
	for _, p := range panes {
		proc, ok := r.piByPanePID[p.PanePID]
		if !ok {
			continue
		}
		record, exact := records[proc.pid]
		if exact && r.cwdByPID[proc.pid] == record.Cwd {
			rows = append(rows, Row{
				SessionID: record.SessionID, PaneID: p.PaneID, Target: p.Target,
				SessionName: p.SessionName, State: piState(p.Command, proc.comm),
				Name: "-", Transcript: record.SessionFile, WindowName: p.WindowName,
				Agent: AgentPi,
				// The PANE's cwd, matching the legacy path below and Claude's
				// rows -- NOT record.Cwd (the pi process's own cwd). Both
				// agents' Cwd must mean the same thing for the repo join.
				Cwd: p.CurrentPath,
			})
			exactPanes[p.PanePID] = true
		}
	}
	for _, p := range panes {
		if exactPanes[p.PanePID] {
			continue
		}
		proc, ok := r.piByPanePID[p.PanePID]
		if !ok {
			continue
		}
		cwd := r.cwdByPID[proc.pid]
		transcript := r.piTranscript(cwd)
		if cwd == "" || transcript == "" {
			continue
		}
		rows = append(rows, Row{
			// Legacy fallback: no registry record for this process, so the pid
			// stands in for a session id -- same convention as tmux-agent-ls.
			SessionID:   "pi:" + strconv.Itoa(proc.pid),
			PaneID:      p.PaneID,
			Target:      p.Target,
			SessionName: p.SessionName,
			State:       piState(p.Command, proc.comm),
			Name:        "-",
			Transcript:  transcript,
			WindowName:  p.WindowName,
			Agent:       AgentPi,
			// The PANE's cwd, deliberately, not the pi process's own cwd
			// (which piTranscript above uses to find the session dir). Both
			// agents' Cwd must mean the same thing for the repo join, and for
			// Claude only the pane's is available.
			Cwd: p.CurrentPath,
		})
	}
	return rows
}

// readPiRecords is direct filesystem I/O only. Process identity and cwd are
// verified later against the batched process/lsof caches before a row is shown.
func (r *Resolver) readPiRecords() map[int]piRecord {
	entries, err := os.ReadDir(r.piStateDir)
	if err != nil {
		return nil
	}
	records := map[int]piRecord{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(r.piStateDir, entry.Name()))
		if err != nil {
			continue
		}
		var record piRecord
		if json.Unmarshal(data, &record) != nil || record.PID <= 0 || record.SessionID == "" || record.Cwd == "" || record.SessionFile == "" {
			continue
		}
		if entry.Name() != strconv.Itoa(record.PID)+".json" || !strings.HasPrefix(record.SessionFile, r.piSessDir+string(filepath.Separator)) {
			continue
		}
		if info, err := os.Stat(record.SessionFile); err != nil || info.IsDir() {
			continue
		}
		records[record.PID] = record
	}
	return records
}

func piRecordsKey(records map[int]piRecord) string {
	keys := make([]int, 0, len(records))
	for pid := range records {
		keys = append(keys, pid)
	}
	sort.Ints(keys)
	var b strings.Builder
	for _, pid := range keys {
		r := records[pid]
		fmt.Fprintf(&b, "%d:%s:%s:%s\n", pid, r.SessionID, r.SessionFile, r.Cwd)
	}
	return b.String()
}

// piState infers activity. The registry carries identity, not activity, so the
// pane's foreground command being pi's own executable
// means pi is sitting at its prompt; anything else means pi has spawned a child
// that is currently in the foreground.
//
// The comparison is against the resolved process's own argv[0] basename, not
// the literal string "pi": pi is a Node CLI whose comm is `node` on the
// releases that don't set their process name, which is also why a pi pane's
// tmux window auto-names itself `node`. Comparing to a hardcoded "pi" reported
// every such pane as permanently "thinking".
func piState(paneCommand, procComm string) string {
	if paneCommand == procComm || paneCommand == AgentPi {
		return StateIdle
	}
	return StateThinking
}

// piTranscript maps a pi process cwd to its newest transcript. pi's session
// directory name is the cwd with its leading slash removed and remaining
// slashes turned into dashes, wrapped in double dashes; dots stay literal.
func (r *Resolver) piTranscript(cwd string) string {
	slug := "--" + strings.ReplaceAll(strings.TrimPrefix(cwd, "/"), "/", "-") + "--"
	dir := filepath.Join(r.piSessDir, slug)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	newest, newestTime := "", int64(-1)
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if ts := info.ModTime().UnixNano(); ts > newestTime {
			newest, newestTime = filepath.Join(dir, e.Name()), ts
		}
	}
	return newest
}

// ---- process table --------------------------------------------------------

// refreshProcessTable does the one expensive sweep, replacing the shell
// version's per-pane pgrep + ps x2 + lsof with a single `ps` and a single
// batched `lsof`. It rebuilds the pi identity map (so panes that stopped
// running pi drop out) and fills in any missing agent pid -> ppid entries.
func (r *Resolver) refreshProcessTable(panes []tmuxio.PaneRow, sessions []claudeSession) {
	// -eww: every process, wide output. Without -ww, `args` is truncated to the
	// terminal width and the /pi-coding-agent/dist/cli.js match silently fails
	// on long command lines.
	t := time.Now()
	out, err := exec.Command("ps", "-eww", "-o", "pid=,ppid=,args=").Output()
	trace.Phase("  ps-eww", t)
	if err != nil {
		return
	}

	type proc struct {
		ppid int
		comm string
		args string
	}
	procs := map[int]proc{}
	for _, line := range strings.Split(string(out), "\n") {
		pid, ppid, args, ok := parsePSLine(line)
		if !ok {
			continue
		}
		procs[pid] = proc{ppid: ppid, comm: argv0Base(args), args: args}
	}

	// ppid for every Claude session pid we still care about.
	next := make(map[int]int, len(sessions))
	for _, s := range sessions {
		if p, ok := procs[s.PID]; ok {
			next[s.PID] = p.ppid
		} else if old, ok := r.ppidByPID[s.PID]; ok {
			next[s.PID] = old // process table raced; keep the last known value
		}
	}
	r.ppidByPID = next

	// pi identity per pane: pi may be pane_pid itself after exec, or a direct
	// child while the pane's shell remains alive.
	panePIDs := make(map[int]bool, len(panes))
	for _, p := range panes {
		panePIDs[p.PanePID] = true
	}
	nextPi := map[int]piProc{}
	for pid, p := range procs {
		if !isPiProcess(p.comm, p.args) {
			continue
		}
		if panePIDs[pid] {
			nextPi[pid] = piProc{pid: pid, comm: p.comm}
		} else if panePIDs[p.ppid] {
			nextPi[p.ppid] = piProc{pid: pid, comm: p.comm}
		}
	}
	r.piByPanePID = nextPi

	// Record what each pane's foreground command was when this sweep probed it, so
	// piSetChanged can tell "a pane just became pi-ish" from "a pane has been
	// running plain node all along". Rebuilt (not merged) so dead panes drop out.
	probed := make(map[int]string, len(panes))
	for _, p := range panes {
		probed[p.PanePID] = p.Command
	}
	r.probedCmd = probed

	r.refreshPiCwds()
}

// isPiProcess mirrors tmux-pi-session's match: recent pi releases set their
// process name to `pi`; older/current Node launches keep `node`, so the CLI is
// also identified by its package path in argv.
func isPiProcess(comm, args string) bool {
	return comm == AgentPi || strings.Contains(args, "/pi-coding-agent/dist/cli.js")
}

// refreshPiCwds fills cwdByPID for any pi pid it doesn't already know, in a
// single batched lsof call. pi doesn't chdir, so an entry is valid for the
// process's lifetime; entries for dead pids are dropped.
func (r *Resolver) refreshPiCwds() {
	var missing []string
	live := map[int]bool{}
	for _, proc := range r.piByPanePID {
		live[proc.pid] = true
		if _, ok := r.cwdByPID[proc.pid]; !ok {
			missing = append(missing, strconv.Itoa(proc.pid))
		}
	}
	for pid := range r.cwdByPID {
		if !live[pid] {
			delete(r.cwdByPID, pid)
		}
	}
	if len(missing) == 0 {
		return
	}
	sort.Strings(missing)
	// -Fn output is a record stream: "p<pid>" starts a process, "n<path>" is
	// that process's cwd (with -d cwd selecting only the cwd descriptor).
	t := time.Now()
	out, err := exec.Command("lsof", "-a", "-d", "cwd", "-Fn", "-p", strings.Join(missing, ",")).Output()
	trace.Phase("  lsof-cwd", t)
	if err != nil && len(out) == 0 {
		return
	}
	cur := 0
	for _, line := range strings.Split(string(out), "\n") {
		if len(line) < 2 {
			continue
		}
		switch line[0] {
		case 'p':
			cur, _ = strconv.Atoi(line[1:])
		case 'n':
			if cur != 0 {
				r.cwdByPID[cur] = line[1:]
			}
		}
	}
}

// parsePSLine splits "  <pid> <ppid> <args...>" from `ps -o pid=,ppid=,args=`.
// args is taken as the whole remainder, so command lines containing spaces
// survive intact.
func parsePSLine(line string) (pid, ppid int, args string, ok bool) {
	s := strings.TrimLeft(line, " ")
	if s == "" {
		return 0, 0, "", false
	}
	i := strings.IndexByte(s, ' ')
	if i < 0 {
		return 0, 0, "", false
	}
	pid, err := strconv.Atoi(s[:i])
	if err != nil {
		return 0, 0, "", false
	}
	s = strings.TrimLeft(s[i:], " ")
	i = strings.IndexByte(s, ' ')
	if i < 0 {
		return 0, 0, "", false
	}
	ppid, err = strconv.Atoi(s[:i])
	if err != nil {
		return 0, 0, "", false
	}
	return pid, ppid, strings.TrimLeft(s[i:], " "), true
}

// argv0Base is the basename of argv[0] -- `ps -o args=` prints an absolute path
// for some processes and a bare name for others, so both must reduce to the
// same comparable token.
func argv0Base(args string) string {
	first := args
	if i := strings.IndexByte(args, ' '); i >= 0 {
		first = args[:i]
	}
	return filepath.Base(first)
}

// panePIDsKey fingerprints the pane -> pid set so Resolve can tell a structural
// change (pane opened/closed, shell replaced) from an ordinary tick.
func panePIDsKey(panes []tmuxio.PaneRow) string {
	parts := make([]string, 0, len(panes))
	for _, p := range panes {
		parts = append(parts, strconv.Itoa(p.PanePID))
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
}
