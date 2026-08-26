package agents

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mm-sidebar/internal/tmuxio"
)

func TestResolveWorldConsumesSharedPaneStateWithoutClientQuery(t *testing.T) {
	panes := []tmuxio.PaneRow{{PanePID: 10, PaneID: "%10", SessionID: "$1"}}
	r := &Resolver{
		panePIDsKey: panePIDsKey(panes), piRegistryKey: "",
		piByPanePID: map[int]piProc{}, probedCmd: map[int]string{},
		cwdByPID: map[int]string{}, ppidByPID: map[int]int{}, transcript: map[string]string{},
		claudeSessDir: t.TempDir(), piStateDir: t.TempDir(),
	}
	rows, err := r.ResolveWorld(tmuxio.NewWorld(tmuxio.Snapshot{}, nil, panes))
	if err != nil || len(rows) != 0 {
		t.Fatalf("ResolveWorld = %#v, %v", rows, err)
	}
}

func TestTransientTranscriptMissRecoversWithoutResolverRebuild(t *testing.T) {
	projects := t.TempDir()
	r := &Resolver{claudeProjDir: projects, transcript: map[string]string{}}
	if got := r.claudeTranscript("late"); got != "" {
		t.Fatalf("first transcript lookup = %q, want miss", got)
	}
	path := filepath.Join(projects, "project", "late.jsonl")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if got := r.claudeTranscript("late"); got != path {
		t.Fatalf("cached transient miss did not recover: got %q want %q", got, path)
	}
}

func TestTransientCwdMissIsRetriedWithoutProcessSweep(t *testing.T) {
	r := &Resolver{piByPanePID: map[int]piProc{10: {pid: 11}}, cwdByPID: map[int]string{}}
	if !r.hasTransientCwdMiss() {
		t.Fatal("missing cached cwd did not request lsof-only retry")
	}
	r.cwdByPID[11] = "/cwd"
	if r.hasTransientCwdMiss() {
		t.Fatal("resolved cached cwd still requested retry")
	}
}

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

func TestTSVEscapesFramingControlsWithoutChangingSchema(t *testing.T) {
	r := Row{
		SessionID: "1", PaneID: "%1", Target: "$1:1", SessionName: "s\tname",
		State: StateIdle, Name: "line\nname", Transcript: "/tmp/a\x1fb", WindowName: "w\x1b",
		Agent: AgentPi, Cwd: "/cwd\r", PaneLabel: "label\t\n",
	}
	got := r.TSV()
	if strings.Count(got, "\t") != 10 || strings.ContainsAny(got, "\n\r\x1b\x1f") {
		t.Fatalf("hostile TSV broke 11-field framing: %q", got)
	}
	if !strings.Contains(got, `s\tname`) || !strings.Contains(got, `line\nname`) {
		t.Fatalf("hostile TSV controls were not visible escapes: %q", got)
	}
}

func TestAgentRowsCarryPaneLabelsAndAppendTSV(t *testing.T) {
	cwd := "/Users/mishka/.config"
	piFile := filepath.Join(t.TempDir(), "pi.jsonl")
	if err := os.WriteFile(piFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	r := &Resolver{
		ppidByPID:   map[int]int{10: 100},
		piByPanePID: map[int]piProc{200: {pid: 201, comm: AgentPi}},
		cwdByPID:    map[int]string{201: cwd},
		transcript:  map[string]string{},
	}
	claude := r.claudeRows([]claudeSession{{PID: 10, SessionID: "claude", Name: "c"}}, map[int]tmuxio.PaneRow{
		100: {PaneID: "%100", Target: "m:1.0", SessionName: "m", PaneLabel: "review"},
	})
	if len(claude) != 1 || claude[0].PaneLabel != "review" {
		t.Fatalf("Claude label = %#v, want review", claude)
	}
	pi := r.piRows([]tmuxio.PaneRow{{
		PanePID: 200, PaneID: "%200", Target: "m:1.1", SessionName: "m", Command: AgentPi, PaneLabel: "build",
	}}, map[int]piRecord{201: {PID: 201, SessionID: "pi", SessionFile: piFile, Cwd: cwd}})
	if len(pi) != 1 || pi[0].PaneLabel != "build" {
		t.Fatalf("pi label = %#v, want build", pi)
	}

	row := Row{SessionID: "1", PaneID: "%1", Target: "m:1.0", SessionName: "m", State: StateIdle, Name: "n", Transcript: "t", WindowName: "w", Agent: AgentPi, Cwd: "/cwd", PaneLabel: "p"}
	fields := strings.Split(row.TSV(), "\t")
	if len(fields) != 11 {
		t.Fatalf("TSV fields = %d, want 11: %q", len(fields), row.TSV())
	}
	if got, want := strings.Join(fields[:10], "\t"), "1\t%1\tm:1.0\tm\tidle\tn\tt\tw\tpi\t/cwd"; got != want {
		t.Fatalf("first 10 TSV fields changed: got %q, want %q", got, want)
	}
	if fields[10] != "p" {
		t.Fatalf("pane label field = %q, want p", fields[10])
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
