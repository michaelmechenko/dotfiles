package agentdetail

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"

	"mm-sidebar/internal/agents"
)

func writeFile(t *testing.T, path, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
}

func transcriptPath(config, agent, name string) string {
	if agent == agents.AgentClaude {
		return filepath.Join(config, "claude", "projects", "project", name)
	}
	return filepath.Join(config, "pi-config", "agent", "sessions", "--project--", name)
}

func TestCollectParsesBoundedClaudeTailPlanAndGit(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "config")
	transcript := transcriptPath(config, agents.AgentClaude, "claude.jsonl")
	plan := filepath.Join(config, "claude", "plans", "inspect-agent.md")
	writeFile(t, plan, "# Inspect agent\nmore details\n")
	writeFile(t, transcript, strings.Repeat("x", maxTailBytes+100)+"\n"+strings.Join([]string{
		`{"type":"user","message":{"content":"older prompt"}}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"done; see claude/plans/inspect-agent.md\nnext"}]}}`,
		`{"type":"user","message":{"content":[{"type":"text","text":"latest prompt"}]}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","input":"ignored"}]}}`,
		`{"type":"assistant","message":{"content":[{"type":"tool_use","input":"ignored"}]}}`,
	}, "\n"))

	calls := 0
	now := time.Unix(100, 0)
	c := New(Config{
		ConfigDir: config,
		Now:       func() time.Time { return now },
		GitStatus: func(context.Context, string) ([]byte, error) {
			calls++
			return []byte("# branch.head main\n1 M. N... 100644 100644 100644 abc def file\n? new\n"), nil
		},
		GitRoot: func(context.Context, string) ([]byte, error) { return []byte("/worktrees/sidebar\n"), nil },
	})
	row := agents.Row{Agent: agents.AgentClaude, PaneID: "%1", SessionID: "s", Transcript: transcript, Cwd: dir}
	got, err := c.Collect(row)
	if err != nil {
		t.Fatal(err)
	}
	if got.Prompt != "latest prompt" {
		t.Fatalf("prompt = %q", got.Prompt)
	}
	if got.Response != "done; see claude/plans/inspect-agent.md next" {
		t.Fatalf("response = %q", got.Response)
	}
	if got.Plan != "Inspect agent" {
		t.Fatalf("plan = %q", got.Plan)
	}
	if got.Worktree != "/worktrees/sidebar" || got.Git != "main +1 ?1" {
		t.Fatalf("worktree/git = %q / %q", got.Worktree, got.Git)
	}
	if _, err := c.Collect(row); err != nil || calls != 1 {
		t.Fatalf("same key missed cache: calls=%d err=%v", calls, err)
	}
	now = now.Add(cacheTTL + time.Nanosecond)
	if _, err := c.Collect(row); err != nil || calls != 2 {
		t.Fatalf("expired cache did not refresh: calls=%d err=%v", calls, err)
	}
}

func TestCollectParsesPiTailOnly(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "config")
	transcript := transcriptPath(config, agents.AgentPi, "pi.jsonl")
	prefix := strings.Repeat("x", maxTailBytes+100)
	writeFile(t, transcript, prefix+"\n"+`{"type":"message","message":{"role":"user","content":[{"type":"text","text":"pi prompt"}]}}`+"\n"+`{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"pi final"}]}}`+"\n")
	c := New(Config{ConfigDir: config, GitStatus: func(context.Context, string) ([]byte, error) {
		return nil, errors.New("not a repo")
	}})
	got, err := c.Collect(agents.Row{Agent: agents.AgentPi, PaneID: "%2", SessionID: "pi", Transcript: transcript, Cwd: dir})
	if err != nil {
		t.Fatal(err)
	}
	if got.Prompt != "pi prompt" || got.Response != "pi final" || got.Plan != "" || got.Git != "" {
		t.Fatalf("data = %#v", got)
	}
}

func TestClaudePlanRejectsSubagentRefsAndKeepsPrimaryRef(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "config")
	c := New(Config{ConfigDir: config})
	primary := "claude/plans/sidebar-inspector.md"
	subagent := "claude/plans/sidebar-inspector-agent-worker.md"
	writeFile(t, filepath.Join(config, filepath.FromSlash(primary)), "# Primary plan\n")
	writeFile(t, filepath.Join(config, filepath.FromSlash(subagent)), "# Subagent plan\n")

	if got, _, err := c.claudePlan(agents.AgentClaude, subagent); err != nil || got != "" {
		t.Fatalf("subagent plan = %q, %v", got, err)
	}
	_, _, ref := latestTranscriptText(agents.AgentClaude, []byte(strings.Join([]string{
		`{"type":"user","message":{"content":"prompt"}}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"see claude/plans/sidebar-inspector.md then claude/plans/sidebar-inspector-agent-worker.md"}]}}`,
	}, "\n")))
	if ref != primary {
		t.Fatalf("plan ref = %q, want primary %q", ref, primary)
	}
}

func TestClaudePlanRejectsTraversalAndSymlink(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "config")
	c := New(Config{ConfigDir: config})
	if got, _, err := c.claudePlan(agents.AgentClaude, "claude/plans/../secret.md"); err != nil || got != "" {
		t.Fatalf("traversal plan = %q, %v", got, err)
	}
	path := filepath.Join(config, "claude", "plans", "linked.md")
	writeFile(t, filepath.Join(dir, "secret.md"), "secret")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(dir, "secret.md"), path); err != nil {
		t.Fatal(err)
	}
	if got, _, err := c.claudePlan(agents.AgentClaude, "claude/plans/linked.md"); err != nil || got != "" {
		t.Fatalf("symlink plan = %q, %v", got, err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(config, "claude", "plans")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(dir, filepath.Join(config, "claude", "plans")); err != nil {
		t.Fatal(err)
	}
	if got, _, err := c.claudePlan(agents.AgentClaude, "claude/plans/secret.md"); err != nil || got != "" {
		t.Fatalf("parent symlink plan = %q, %v", got, err)
	}
}

func TestCollectSanitizesExternalText(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "config")
	transcript := transcriptPath(config, agents.AgentPi, "session.jsonl")
	writeFile(t, transcript, `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"ok\u001b[31m\nnext"}]}}`+"\n")
	c := New(Config{ConfigDir: config, GitStatus: func(context.Context, string) ([]byte, error) {
		return []byte("# branch.head feature\x1b\n"), nil
	}})
	got, err := c.Collect(agents.Row{Agent: agents.AgentPi, Transcript: transcript, Cwd: dir})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(got.Response, "\x1b") || !strings.Contains(got.Response, `\x1b[31m`) {
		t.Fatalf("response was not sanitized: %q", got.Response)
	}
	if strings.Contains(got.Git, "\x1b") || !strings.Contains(got.Git, `\x1b`) {
		t.Fatalf("git was not sanitized: %q", got.Git)
	}
}

func TestParseGitStatus(t *testing.T) {
	got := parseGitStatus([]byte("# branch.head (detached)\n1 M. x\n2 .M x\nu UU x\n? x\n"))
	if got != "(detached) +1 ~1 ?1 !1" {
		t.Fatalf("status = %q", got)
	}
}

func TestTranscriptTailRejectsOutsideSymlinkAndFIFO(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "config")
	root := filepath.Join(config, "pi-config", "agent", "sessions", "--project--")
	regular := filepath.Join(root, "session.jsonl")
	writeFile(t, regular, `{"type":"message","message":{"role":"assistant","content":"ok"}}`)
	c := New(Config{ConfigDir: config})
	if _, _, err := c.transcriptTail(agents.AgentPi, regular); err != nil {
		t.Fatalf("regular transcript rejected: %v", err)
	}

	outside := filepath.Join(dir, "outside.jsonl")
	writeFile(t, outside, "outside")
	if _, _, err := c.transcriptTail(agents.AgentPi, outside); err == nil {
		t.Fatal("outside transcript was accepted")
	}
	linked := filepath.Join(root, "linked.jsonl")
	if err := os.Symlink(outside, linked); err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.transcriptTail(agents.AgentPi, linked); err == nil {
		t.Fatal("symlink transcript was accepted")
	}
	parentLink := filepath.Join(root, "linked-dir")
	if err := os.Symlink(filepath.Dir(outside), parentLink); err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.transcriptTail(agents.AgentPi, filepath.Join(parentLink, filepath.Base(outside))); err == nil {
		t.Fatal("transcript under symlinked parent was accepted")
	}
	fifo := filepath.Join(root, "session.fifo")
	if err := unix.Mkfifo(fifo, 0o600); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	if _, _, err := c.transcriptTail(agents.AgentPi, fifo); err == nil {
		t.Fatal("FIFO transcript was accepted")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("FIFO validation blocked for %v", elapsed)
	}
}

func TestCollectFreshBypassesCache(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "config")
	transcript := transcriptPath(config, agents.AgentPi, "session.jsonl")
	writeFile(t, transcript, `{"type":"message","message":{"role":"assistant","content":"ok"}}`)
	calls := 0
	c := New(Config{ConfigDir: config, GitStatus: func(context.Context, string) ([]byte, error) {
		calls++
		return []byte("# branch.head main\n"), nil
	}})
	row := agents.Row{Agent: agents.AgentPi, Transcript: transcript, Cwd: dir}
	if _, err := c.Collect(row); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Collect(row); err != nil {
		t.Fatal(err)
	}
	if _, err := c.CollectFresh(row); err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("git calls = %d, want 2 (normal cache hit plus fresh refresh)", calls)
	}
}

func TestAgentdetailHelperProcess(t *testing.T) {
	mode := os.Getenv("MMS_AGENTDETAIL_HELPER")
	if mode == "" {
		return
	}
	if os.Getenv("MMS_AGENTDETAIL_HELPER_CHILD") == "1" {
		select {}
	}
	if mode == "overflow-child" {
		child := exec.Command(os.Args[0], "-test.run=^TestAgentdetailHelperProcess$")
		child.Env = append(os.Environ(), "MMS_AGENTDETAIL_HELPER_CHILD=1")
		child.Stdout, child.Stderr = os.Stdout, os.Stderr
		if err := child.Start(); err != nil {
			os.Exit(2)
		}
	}
	for {
		_, _ = fmt.Fprint(os.Stdout, strings.Repeat("x", 1024))
	}
}

func TestRunBoundedOutputCleansUpOverflow(t *testing.T) {
	t.Setenv("MMS_AGENTDETAIL_HELPER", "overflow-child")
	start := time.Now()
	_, err := runBoundedOutput(context.Background(), "", os.Args[0], "-test.run=^TestAgentdetailHelperProcess$")
	if !errors.Is(err, errGitOutputTooLarge) {
		t.Fatalf("overflow error = %v", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("overflow process cleanup took %v", elapsed)
	}
}

func TestRunBoundedOutputCleansUpTimeout(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := runBoundedOutput(ctx, "", "/bin/sh", "-c", "sleep 10")
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout error = %v", err)
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("timeout process cleanup took %v", elapsed)
	}
}
