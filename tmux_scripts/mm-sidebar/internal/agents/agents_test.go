package agents

import (
	"os"
	"path/filepath"
	"testing"

	"mm-sidebar/internal/tmuxio"
)

func TestPiRowsPreferExactRegistryForSelfAndChild(t *testing.T) {
	dir := t.TempDir()
	selfFile := filepath.Join(dir, "self.jsonl")
	childFile := filepath.Join(dir, "child.jsonl")
	for _, file := range []string{selfFile, childFile} {
		if err := os.WriteFile(file, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	cwd := "/Users/mishka/.config"
	r := &Resolver{
		piByPanePID: map[int]piProc{
			100: {pid: 100, comm: AgentPi}, // exec-replaced pane
			200: {pid: 201, comm: AgentPi}, // pi remains a child of zsh
		},
		cwdByPID: map[int]string{100: cwd, 201: cwd},
	}
	panes := []tmuxio.PaneRow{
		{PanePID: 100, PaneID: "%100", Target: "m:1.0", SessionName: "m", Command: AgentPi},
		{PanePID: 200, PaneID: "%200", Target: "m:1.1", SessionName: "m", Command: AgentPi},
	}
	records := map[int]piRecord{
		100: {PID: 100, SessionID: "exact-self", SessionFile: selfFile, Cwd: cwd},
		201: {PID: 201, SessionID: "exact-child", SessionFile: childFile, Cwd: cwd},
	}
	rows := r.piRows(panes, records)
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	if rows[0].SessionID != "exact-self" || rows[0].Transcript != selfFile {
		t.Fatalf("self row = %#v", rows[0])
	}
	if rows[1].SessionID != "exact-child" || rows[1].Transcript != childFile {
		t.Fatalf("child row = %#v", rows[1])
	}
}

func TestReadPiRecordsRejectsInvalidFiles(t *testing.T) {
	stateDir := t.TempDir()
	sessionsDir := t.TempDir()
	valid := filepath.Join(sessionsDir, "valid.jsonl")
	if err := os.WriteFile(valid, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stateDir, "10.json"), []byte(`{"pid":10,"sessionId":"exact","sessionFile":"`+valid+`","cwd":"/cwd"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stateDir, "11.json"), []byte(`{"pid":10,"sessionId":"wrong-name","sessionFile":"`+valid+`","cwd":"/cwd"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stateDir, "12.json"), []byte(`{"pid":12,"sessionId":"outside","sessionFile":"/tmp/outside.jsonl","cwd":"/cwd"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	records := (&Resolver{piStateDir: stateDir, piSessDir: sessionsDir}).readPiRecords()
	if len(records) != 1 || records[10].SessionID != "exact" {
		t.Fatalf("records = %#v", records)
	}
}

func TestPiRowsRejectsMismatchedRegistryCwd(t *testing.T) {
	r := &Resolver{
		piByPanePID: map[int]piProc{100: {pid: 100, comm: AgentPi}},
		cwdByPID:    map[int]string{100: "/live"},
		piSessDir:   t.TempDir(),
	}
	rows := r.piRows([]tmuxio.PaneRow{{PanePID: 100, Command: AgentPi}}, map[int]piRecord{
		100: {PID: 100, SessionID: "stale", SessionFile: "/not-used.jsonl", Cwd: "/different"},
	})
	if len(rows) != 0 {
		t.Fatalf("stale record produced rows: %#v", rows)
	}
}
