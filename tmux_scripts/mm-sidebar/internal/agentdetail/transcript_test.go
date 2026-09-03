package agentdetail

import (
	"context"
	"strings"
	"testing"

	"mm-sidebar/internal/agents"
)

func TestLatestTranscriptTextSkipsMalformedPartialAndToolOnlyRecords(t *testing.T) {
	tests := []struct {
		name     string
		agent    string
		lines    []string
		prompt   string
		response string
	}{
		{
			name:  "claude",
			agent: agents.AgentClaude,
			lines: []string{
				`{"type":"user","message":{"content":"claude prompt"}}`,
				`{"type":"assistant","message":{"content":[{"type":"text","text":"claude response"}]}}`,
				`{"type":"assistant","message":{"content":[{"type":"tool_use","input":"secret"}]}}`,
				`{"type":"user","message":`,
			},
			prompt: "claude prompt", response: "claude response",
		},
		{
			name:  "pi",
			agent: agents.AgentPi,
			lines: []string{
				`{"type":"message","message":{"role":"user","content":[{"type":"text","text":"pi prompt"}]}}`,
				`{"type":"message","message":{"role":"assistant","content":"pi response"}}`,
				`{"type":"message","message":{"role":"tool","content":"ignore"}}`,
				`{"type":"message","message":{"role":"user"`,
			},
			prompt: "pi prompt", response: "pi response",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			prompt, response, plan := latestTranscriptText(tt.agent, []byte(strings.Join(tt.lines, "\n")))
			if prompt != tt.prompt || response != tt.response || plan != "" {
				t.Fatalf("prompt/response/plan = %q / %q / %q", prompt, response, plan)
			}
		})
	}
}

func TestCollectPreservesMissingPromptAndResponse(t *testing.T) {
	dir := t.TempDir()
	config := dir + "/config"
	transcript := transcriptPath(config, agents.AgentPi, "empty.jsonl")
	writeFile(t, transcript, `{"type":"message","message":{"role":"assistant","content":[{"type":"tool_use"}]}}`+"\n")
	got, err := New(Config{ConfigDir: config}).Collect(agents.Row{Agent: agents.AgentPi, Transcript: transcript})
	if err != nil {
		t.Fatal(err)
	}
	if got.Prompt != "" || got.Response != "" {
		t.Fatalf("fallback data = %#v", got)
	}
}

func TestCollectRetainsRepositoryContextWhenTranscriptIsUnavailable(t *testing.T) {
	c := New(Config{
		ConfigDir: t.TempDir(),
		GitRoot:   func(context.Context, string) ([]byte, error) { return []byte("/worktrees/sidebar\n"), nil },
		GitStatus: func(context.Context, string) ([]byte, error) { return []byte("# branch.head main\n? new\n"), nil },
	})
	got, err := c.Collect(agents.Row{
		Agent: agents.AgentPi, Transcript: "/missing/session.jsonl", Cwd: "/worktrees/sidebar/subdir",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Prompt != "" || got.Response != "" ||
		got.Cwd != "/worktrees/sidebar/subdir" || got.Worktree != "/worktrees/sidebar" || got.Git != "main ?1" {
		t.Fatalf("unavailable transcript context = %#v", got)
	}
}
