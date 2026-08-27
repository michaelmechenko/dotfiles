package blocks

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mm-sidebar/internal/agents"
	"mm-sidebar/internal/theme"
	"mm-sidebar/internal/tmuxio"
)

func testAgent(id, state, cwd string) agents.Row {
	return agents.Row{Agent: agents.AgentClaude, SessionID: "agent:" + id, PaneID: id, State: state, Cwd: cwd, PaneLabel: "build", WindowName: "work", SessionName: "m", TmuxSessionID: "$1", WindowID: "@1", WindowIndex: 1}
}

func TestActivitySeedsSilentlyAndRecordsRequiredAgentTransitions(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	now := time.Unix(1000, 0)
	b.now = func() time.Time { return now }
	b.Update(AgentRowsMsg{Rows: []agents.Row{testAgent("%1", agents.StateThinking, "/repo")}})
	if len(b.entries) != 0 || !b.seeded {
		t.Fatalf("initial agent snapshot must be silent: %#v", b.entries)
	}
	if len(b.activeAgents) != 0 {
		t.Fatalf("thinking agent became an active wait fact: %#v", b.activeAgents)
	}
	b.Update(AgentRowsMsg{Rows: []agents.Row{testAgent("%1", agents.StateAwaitingPermission, "/repo")}})
	b.Update(AgentRowsMsg{Rows: []agents.Row{testAgent("%1", agents.StateWaiting, "/repo")}})
	b.Update(AgentRowsMsg{Rows: []agents.Row{testAgent("%1", agents.StateThinking, "/repo")}})
	b.Update(AgentRowsMsg{Rows: []agents.Row{testAgent("%1", agents.StateIdle, "/repo")}})
	b.Update(AgentRowsMsg{})
	got := []string{}
	for _, e := range b.entries {
		got = append(got, e.Tag)
	}
	for _, want := range []string{"OUT", "OK", "!W", "!P"} {
		if !strings.Contains(strings.Join(got, ","), want) {
			t.Fatalf("activity tags %v missing %s", got, want)
		}
	}
}

func TestActivityInitialAgentRowsDoNotQueueGitBaselines(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	b.Update(AgentRowsMsg{Rows: []agents.Row{testAgent("%1", agents.StateThinking, "/repo")}})
	if len(b.pending) != 0 {
		t.Fatalf("initial AgentRows queued redundant Git baselines: %#v", b.pending)
	}
}

func TestActivityQueuesNewlyDiscoveredWaitingAgentGitProbe(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	thinking := testAgent("%1", agents.StateThinking, "/thinking")
	waiting := testAgent("%2", agents.StateWaiting, "/waiting")
	b.Update(AgentRowsMsg{Rows: []agents.Row{thinking}})
	b.Update(AgentRowsMsg{Rows: []agents.Row{thinking, waiting}})
	if _, ok := b.pending["/waiting"]; !ok {
		t.Fatalf("new waiting agent did not queue its cwd Git probe: %#v", b.pending)
	}
}

func TestHistoricalActivityAgentActionsRequireCurrentSession(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	old := testAgent("%1", agents.StateThinking, "/repo")
	b.Update(AgentRowsMsg{Rows: []agents.Row{old}})
	replacement := old
	replacement.SessionID = "agent:replacement"
	b.Update(AgentRowsMsg{Rows: []agents.Row{replacement}})

	oldIndex := -1
	for i, entry := range b.entries {
		if entry.Kind == activityAgent && entry.Agent.SessionID == old.SessionID {
			oldIndex = i
			break
		}
	}
	if oldIndex < 0 {
		t.Fatalf("replacement did not retain a historical old-agent event: %#v", b.entries)
	}
	actions := b.Actions(oldIndex)
	if len(actions) == 0 || actions[0].AgentSessionID != old.SessionID {
		t.Fatalf("historical focus action lost agent identity: %#v", actions)
	}
	if b.IsCurrentAgentAction(actions[0]) || b.currentAgent(old) {
		t.Fatal("historical action matched a replacement agent in the same pane")
	}
	if !b.currentAgent(replacement) {
		t.Fatal("latest accepted replacement agent was not current")
	}
}

func TestActivityTreatsSamePaneSessionReplacementAsExitAndStart(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	old := testAgent("%1", agents.StateThinking, "/repo")
	b.Update(AgentRowsMsg{Rows: []agents.Row{old}})

	replacement := old
	replacement.SessionID = "agent:replacement"
	replacement.State = agents.StateIdle
	b.Update(AgentRowsMsg{Rows: []agents.Row{replacement}})

	if len(b.entries) != 2 || b.entries[0].Tag != "IN" || b.entries[1].Tag != "OUT" {
		t.Fatalf("same-pane replacement events = %#v, want IN then OUT", b.entries)
	}
	if got := b.facts[replacement.IdentityKey()]; got.SessionID != replacement.SessionID {
		t.Fatalf("replacement fact = %#v", got)
	}
	if _, stale := b.facts[old.IdentityKey()]; stale {
		t.Fatal("replaced session remained a live fact")
	}
}

func TestActivityRetentionPrefersOldNonUrgentAndKeepsStableSelection(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	for i := 0; i < activityHistory+4; i++ {
		b.add("OK", "done", false, activityAgent, agents.Row{}, "", gitSnapshot{})
	}
	b.add("!W", "waiting", true, activityAgent, agents.Row{}, "", gitSnapshot{})
	if len(b.entries) != activityHistory {
		t.Fatalf("history = %d, want %d", len(b.entries), activityHistory)
	}
	id := b.NavigationID(0)
	if id == "" || b.NavigationIndexByID(id) != 0 {
		t.Fatalf("selection identity not stable: %q", id)
	}
	if b.NavigationIndex(0) != -1 || b.NavigationIndex(b.Height()-1) >= 0 {
		t.Fatal("label or more row became actionable")
	}
}

func TestActivityAgentTransitionsResolveUrgencyAndShareTimestamp(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	thinking := testAgent("%1", agents.StateThinking, "/repo")
	b.Update(AgentRowsMsg{Rows: []agents.Row{thinking}})

	calls := 0
	base := time.Unix(1000, 0)
	b.now = func() time.Time {
		calls++
		return base.Add(time.Duration(calls) * time.Second)
	}
	waiting := thinking
	waiting.State = agents.StateWaiting
	b.Update(AgentRowsMsg{Rows: []agents.Row{waiting}})
	if calls != 1 || len(b.entries) != 2 || b.entries[0].Tag != "!W" || b.entries[1].Tag != "OK" || !b.entries[0].At.Equal(b.entries[1].At) {
		t.Fatalf("thinking -> waiting = %#v, now calls=%d", b.entries, calls)
	}
	if strings.Contains(strings.Join([]string{b.entries[0].Text, b.entries[1].Text}, " "), "working") || len(b.activeAgents) != 1 {
		t.Fatalf("thinking -> waiting emitted working or lost live wait: %#v", b.entries)
	}

	b.Update(AgentRowsMsg{Rows: []agents.Row{thinking}})
	if len(b.activeAgents) != 0 || b.entries[0].Text != "waiting resolved · build · work · m" || b.entries[0].Urgent || b.entries[1].Urgent {
		t.Fatalf("waiting fact did not resolve: %#v", b.entries[:2])
	}
	permission := thinking
	permission.State = agents.StateAwaitingPermission
	b.Update(AgentRowsMsg{Rows: []agents.Row{permission}})
	b.Update(AgentRowsMsg{Rows: []agents.Row{thinking}})
	if len(b.activeAgents) != 0 || b.entries[0].Text != "permission resolved · build · work · m" || b.entries[0].Urgent || b.entries[1].Urgent {
		t.Fatalf("permission fact did not resolve: %#v", b.entries[:2])
	}
}

func acceptGit(b *Activity, cwd string, token uint64, snap gitSnapshot) {
	b.latest[cwd] = token
	b.Update(gitResultMsg{Cwd: cwd, Token: token, Snap: snap})
}

func TestActivityGitTransitionsDeduplicateAndResolveFacts(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	base := gitSnapshot{Root: "/repo", CommonDir: "/repo/.git", GitDir: "/repo/.git", Branch: "main"}
	b.latest["/cwd"] = 2
	b.Update(gitResultMsg{Cwd: "/cwd", Token: 1, Snap: gitSnapshot{Root: "/wrong"}})
	if len(b.gitSeen) != 0 {
		t.Fatal("stale git result was accepted")
	}
	acceptGit(b, "/cwd", 2, base)

	calls := 0
	baseTime := time.Unix(2000, 0)
	b.now = func() time.Time {
		calls++
		return baseTime.Add(time.Duration(calls) * time.Second)
	}
	active := base
	active.Branch, active.Dirty, active.Operation, active.Conflict = "next", true, "rebase", true
	acceptGit(b, "/cwd", 3, active)
	if calls != 1 || len(b.entries) != 4 || len(b.activeGit) != 1 {
		t.Fatalf("active Git facts = %#v, entries=%#v, now calls=%d", b.activeGit, b.entries, calls)
	}
	wantTags := map[string]bool{"GD": false, "GO": false, "G!": false, "GB": false}
	for _, e := range b.entries {
		if !e.At.Equal(b.entries[0].At) {
			t.Fatalf("compound Git transition has mismatched timestamps: %#v", b.entries)
		}
		if _, ok := wantTags[e.Tag]; ok {
			wantTags[e.Tag] = true
		}
		if e.Tag == "G!" && !e.Urgent {
			t.Fatalf("conflict event was not urgent: %#v", e)
		}
		if e.Tag != "G!" && e.Urgent {
			t.Fatalf("non-conflict Git event became urgent: %#v", e)
		}
	}
	for tag, found := range wantTags {
		if !found {
			t.Fatalf("compound Git transition missing %s: %#v", tag, b.entries)
		}
	}
	count := len(b.entries)
	acceptGit(b, "/cwd", 4, active)
	if len(b.entries) != count {
		t.Fatalf("duplicate Git observation added events: %#v", b.entries)
	}

	resolved := base
	resolved.Branch = "next"
	acceptGit(b, "/cwd", 5, resolved)
	if len(b.activeGit) != 0 {
		t.Fatalf("dirty/operation/conflict facts did not resolve: %#v", b.activeGit)
	}
	clean := false
	for _, e := range b.entries {
		if e.Tag == "GD" && strings.Contains(e.Text, "worktree clean") {
			clean = true
		}
		if e.Urgent {
			t.Fatalf("cleared Git fact remained urgent: %#v", e)
		}
	}
	if !clean {
		t.Fatalf("dirty fact did not emit a clean transition: %#v", b.entries)
	}
}

func TestActivityConflictAppearsAndClearsIndependently(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	base := gitSnapshot{Root: "/repo", CommonDir: "/repo/.git", GitDir: "/repo/.git", Branch: "main"}
	acceptGit(b, "/cwd", 1, base)
	conflicted := base
	conflicted.Conflict = true
	acceptGit(b, "/cwd", 2, conflicted)
	if len(b.entries) != 1 || b.entries[0].Tag != "G!" || !b.entries[0].Urgent || len(b.activeGit) != 1 {
		t.Fatalf("conflict appearance = %#v active=%#v", b.entries, b.activeGit)
	}
	acceptGit(b, "/cwd", 3, base)
	if len(b.entries) != 2 || b.entries[0].Tag != "G!" || b.entries[0].Urgent || b.entries[1].Urgent || !strings.Contains(b.entries[0].Text, "conflict cleared") || len(b.activeGit) != 0 {
		t.Fatalf("conflict clear = %#v active=%#v", b.entries, b.activeGit)
	}
}

func TestActivityGitOperationsAppearAndClearWithoutConflicts(t *testing.T) {
	for _, operation := range []string{"merge", "rebase", "cherry-pick", "bisect"} {
		t.Run(operation, func(t *testing.T) {
			b := NewActivity(theme.Theme{}, nil)
			base := gitSnapshot{Root: "/repo", CommonDir: "/repo/.git", GitDir: "/repo/.git", Branch: "main"}
			acceptGit(b, "/cwd", 1, base)
			started := base
			started.Operation = operation
			acceptGit(b, "/cwd", 2, started)
			if len(b.entries) != 1 || b.entries[0].Tag != "GO" || b.entries[0].Urgent || !strings.Contains(b.entries[0].Text, operation+" started") || started.Conflict {
				t.Fatalf("operation appearance = %#v", b.entries)
			}
			acceptGit(b, "/cwd", 3, base)
			if len(b.entries) != 2 || b.entries[0].Tag != "GO" || b.entries[0].Urgent || !strings.Contains(b.entries[0].Text, operation+" cleared") || len(b.activeGit) != 0 {
				t.Fatalf("operation clear = %#v active=%#v", b.entries, b.activeGit)
			}
		})
	}
}

func TestActivityBranchChangesOncePerWorktree(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	base := gitSnapshot{Root: "/repo", CommonDir: "/repo/.git", GitDir: "/repo/.git", Branch: "main"}
	acceptGit(b, "/first-cwd", 1, base)
	next := base
	next.Branch = "topic"
	acceptGit(b, "/second-cwd", 1, next)
	acceptGit(b, "/first-cwd", 2, next)
	branches := 0
	for _, e := range b.entries {
		if e.Tag == "GB" {
			branches++
		}
		if e.Tag == "G>" {
			t.Fatalf("legacy branch tag emitted: %#v", e)
		}
	}
	if branches != 1 {
		t.Fatalf("same-worktree branch changes = %d, want 1: %#v", branches, b.entries)
	}
}

func TestProbeGitUsesIdentityAndPorcelainV2(t *testing.T) {
	var calls [][]string
	runner := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		calls = append(calls, args)
		if args[0] == "rev-parse" {
			switch args[len(args)-1] {
			case "--show-toplevel":
				return []byte("/repo\n"), nil
			case "--git-common-dir", "--git-dir":
				return []byte("/repo/.git\n"), nil
			}
		}
		return []byte("# branch.head main\x001 M. N... 100644 100644 100644 abc def file\x00"), nil
	}
	s, err := probeGit(runner, "/cwd")
	if err != nil || !s.Dirty || s.Branch != "main" {
		t.Fatalf("probe = %#v, %v", s, err)
	}
	if len(calls) != 4 || !strings.Contains(strings.Join(calls[3], " "), "--porcelain=v2") {
		t.Fatalf("git calls = %#v", calls)
	}
}

func TestProbeGitDetectsOperationsWithoutConflicts(t *testing.T) {
	root := t.TempDir()
	gitDir := filepath.Join(root, ".git")
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		t.Fatal(err)
	}
	runner := func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if args[0] == "rev-parse" {
			switch args[len(args)-1] {
			case "--show-toplevel":
				return []byte(root + "\n"), nil
			case "--git-common-dir", "--git-dir":
				return []byte(gitDir + "\n"), nil
			}
		}
		return []byte("# branch.head main\x00"), nil
	}
	for sentinel, operation := range map[string]string{
		"MERGE_HEAD": "merge", "rebase-merge": "rebase", "rebase-apply": "rebase",
		"CHERRY_PICK_HEAD": "cherry-pick", "BISECT_LOG": "bisect",
	} {
		t.Run(operation+"-"+sentinel, func(t *testing.T) {
			path := filepath.Join(gitDir, sentinel)
			if sentinel == "rebase-merge" || sentinel == "rebase-apply" {
				if err := os.Mkdir(path, 0o755); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(path, nil, 0o644); err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(path)
			s, err := probeGit(runner, root)
			if err != nil || s.Operation != operation || s.Conflict {
				t.Fatalf("probe = %#v, %v", s, err)
			}
		})
	}
}

func TestProbeGitUsesAbsoluteIdentityForSpacedNestedCwd(t *testing.T) {
	root := filepath.Join(t.TempDir(), "repo with spaces\nand newline")
	cwd := filepath.Join(root, "nested", "dir")
	var calls [][]string
	runner := func(_ context.Context, dir string, args ...string) ([]byte, error) {
		calls = append(calls, append([]string{dir}, args...))
		if args[0] == "rev-parse" {
			switch args[len(args)-1] {
			case "--show-toplevel":
				return []byte(root + "\n"), nil
			case "--git-common-dir":
				return []byte(root + "/.git\n"), nil
			case "--git-dir":
				return []byte(root + "/.git/worktrees/nested\n"), nil
			}
		}
		return []byte("# branch.head topic\x00"), nil
	}
	s, err := probeGit(runner, cwd)
	if err != nil {
		t.Fatal(err)
	}
	if s.Root != root || s.CommonDir != filepath.Join(root, ".git") || s.GitDir != filepath.Join(root, ".git", "worktrees", "nested") {
		t.Fatalf("spaced nested identity = %#v", s)
	}
	if len(calls) != 4 || calls[0][0] != cwd || !strings.Contains(strings.Join(calls[0], " "), "--path-format=absolute") || calls[3][0] != root {
		t.Fatalf("Git calls did not probe cwd then canonical root: %#v", calls)
	}
}

func TestActivityRefreshOnlySchedulesKnownRoots(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	b.SetVisible(true)
	b.Update(WorldMsg{World: tmuxio.NewWorld(tmuxio.Snapshot{}, nil, []tmuxio.PaneRow{{PaneID: "%1", CurrentPath: "/one"}})})
	cmd := b.React(RefreshMsg{})
	if cmd == nil || len(b.latest) != 1 {
		t.Fatalf("refresh did not schedule known root: latest=%#v", b.latest)
	}
	if b.React(WorldMsg{}) != nil {
		t.Fatal("World message scheduled a polling probe")
	}
}

func TestActivityWorldDoesNotProbeAndHiddenRefreshDefers(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	world := tmuxio.NewWorld(tmuxio.Snapshot{}, nil, []tmuxio.PaneRow{
		{PaneID: "%1", CurrentPath: "/one"},
		{PaneID: "%2", CurrentPath: "/two/nested"},
		{PaneID: "%sidebar", CurrentPath: "/ignored", Sidebar: true},
	})
	b.Update(WorldMsg{World: world})
	if cmd := b.React(WorldMsg{}); cmd != nil || len(b.pending) != 0 {
		t.Fatalf("accepted World scheduled Git work: cmd=%T pending=%#v", cmd, b.pending)
	}
	if cmd := b.React(RefreshMsg{}); cmd != nil || len(b.pending) != 2 || len(b.latest) != 0 {
		t.Fatalf("hidden refresh was not deferred: cmd=%T pending=%#v latest=%#v", cmd, b.pending, b.latest)
	}
	b.SetVisible(true)
	if cmd := b.Fetch(); cmd == nil || len(b.latest) != 1 || len(b.pending) != 1 || !b.gitInFlight {
		t.Fatalf("visible fetch did not release one serialized probe: cmd=%T pending=%#v latest=%#v inFlight=%t", cmd, b.pending, b.latest, b.gitInFlight)
	}
}

func TestActivitySerializesCwdAliasesBeforeIdentityUpdates(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	b.SetVisible(true)
	b.queueRoot("/repo/sub-a")
	b.queueRoot("/repo/sub-b")
	first := b.React(WorldMsg{})
	if first == nil || !b.gitInFlight || len(b.pending) != 1 {
		t.Fatalf("first serialized probe: cmd=%T pending=%#v inFlight=%t", first, b.pending, b.gitInFlight)
	}
	if second := b.React(WorldMsg{}); second != nil {
		t.Fatal("second cwd probe started while the first was in flight")
	}
	var issuedCwd string
	for cwd := range b.latest {
		issuedCwd = cwd
	}
	b.Update(gitResultMsg{Cwd: issuedCwd, Token: b.latest[issuedCwd], Err: errors.New("baseline only")})
	if b.gitInFlight {
		t.Fatal("completed probe retained in-flight state")
	}
	if next := b.React(gitResultMsg{}); next == nil || !b.gitInFlight || len(b.pending) != 0 {
		t.Fatalf("queued alias did not start after completion: cmd=%T pending=%#v inFlight=%t", next, b.pending, b.gitInFlight)
	}
}

func TestRelativeAgeHasFixedWidth(t *testing.T) {
	for _, d := range []time.Duration{0, time.Minute, 59 * time.Minute, time.Hour, 99 * time.Hour, 7 * 24 * time.Hour} {
		if got := relativeAge(d); len(got) != 3 {
			t.Fatalf("relativeAge(%s) = %q, width %d", d, got, len(got))
		}
	}
}

func TestActivityEmptyMoreExpansionAndClipping(t *testing.T) {
	b := NewActivity(theme.Theme{}, nil)
	if !strings.Contains(b.View(36), "(none yet)") || b.NavigationCount() != 0 {
		t.Fatalf("empty activity is not inert: %q", b.View(36))
	}
	for i := 0; i < activityMax+2; i++ {
		b.add("G!", strings.Repeat("wide ", 20), true, activityGit, agents.Row{}, "/repo", gitSnapshot{})
	}
	before := b.Height()
	if !strings.Contains(b.View(36), "+2 more") || !fitsWidth(b.View(8), 8) {
		t.Fatalf("more row or clipping failed: %q", b.View(36))
	}
	if used := b.Expand(2); used <= 0 || b.Height() <= before || b.NavigationCount() != activityMax+2 {
		t.Fatalf("expand = %d, height=%d, rows=%d", used, b.Height(), b.NavigationCount())
	}
	if b.SetHoverLine(0) {
		t.Fatal("activity label accepted hover")
	}
	if !b.SetHoverLine(1) {
		t.Fatal("activity row rejected hover")
	}
}

func TestActivityWorktreeActionsUseExactPaths(t *testing.T) {
	dir := t.TempDir()
	b := NewActivity(theme.Theme{}, tmuxio.NewClient("", ""))
	b.world = tmuxio.NewWorld(tmuxio.Snapshot{ContentPane: "%content"}, nil, []tmuxio.PaneRow{{PaneID: "%content", SessionID: "$1", WindowID: "@1", WindowIndex: 1, CurrentPath: filepath.Dir(dir)}})
	b.add("G!", "dirty", true, activityGit, agents.Row{}, dir, gitSnapshot{})
	actions := b.Actions(0)
	if len(actions) == 0 || actions[0].Path == "" && actions[0].Kind != 0 {
		t.Fatalf("worktree actions missing exact path: %#v", actions)
	}
	if b.ActivateNavigation(0) == nil {
		t.Fatal("valid worktree event did not expose an action")
	}
}

func TestProbeGitPropagatesErrors(t *testing.T) {
	_, err := probeGit(func(context.Context, string, ...string) ([]byte, error) { return nil, errors.New("no repo") }, "/nope")
	if err == nil {
		t.Fatal("probe swallowed identity error")
	}
}
