package agents

import (
	"os"
	"path/filepath"
	"testing"

	"mm-sidebar/internal/tmuxio"
)

// The exact-registry pi path and the legacy cwd->newest path build Row
// separately, so each needs its own Cwd assertion: the registry path was added
// after Cwd existed and silently shipped without it once (it compiles fine and
// git flags no conflict, the row just carries an empty cwd). Cwd must be the
// PANE's cwd on both paths -- never the pi process's own cwd -- so it means the
// same thing as Claude's, which is all the repo join has.
func TestRegistryPiRowCarriesPaneCwd(t *testing.T) {
	dir := t.TempDir()
	f := filepath.Join(dir, "s.jsonl")
	if err := os.WriteFile(f, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	procCwd := "/proc/own/cwd"
	paneCwd := "/Users/mishka/.config"
	r := &Resolver{
		piByPanePID: map[int]piProc{100: {pid: 100, comm: AgentPi}},
		cwdByPID:    map[int]string{100: procCwd},
	}
	panes := []tmuxio.PaneRow{
		{PanePID: 100, PaneID: "%100", Target: "m:1.0", SessionName: "m",
			Command: AgentPi, CurrentPath: paneCwd},
	}
	records := map[int]piRecord{
		100: {PID: 100, SessionID: "exact", SessionFile: f, Cwd: procCwd},
	}
	rows := r.piRows(panes, records)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0].SessionID != "exact" {
		t.Fatalf("took the legacy path, not the registry path: %#v", rows[0])
	}
	if rows[0].Cwd != paneCwd {
		t.Fatalf("Cwd = %q, want the PANE cwd %q", rows[0].Cwd, paneCwd)
	}
}
