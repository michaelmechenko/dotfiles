package tmuxio

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
)

// TestRealTmuxHostileQAFormat exercises tmux 3.7's actual q/a formatter rather
// than only the decoder's fixtures. User options and pane labels accept the
// control bytes that tmux rejects in targets/session names, so they validate the
// framing boundary without relying on an invalid tmux target.
func TestRealTmuxKillPaneGuardRejectsStaleIdentity(t *testing.T) {
	tmux, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux is not installed")
	}
	socket := "mm-sidebar-guard-" + strconv.Itoa(os.Getpid())
	run := func(args ...string) (string, error) {
		out, err := exec.Command(tmux, append([]string{"-L", socket}, args...)...).Output()
		return strings.TrimRight(string(out), "\n"), err
	}
	command := func(args ...string) {
		t.Helper()
		if _, err := run(args...); err != nil {
			t.Fatalf("tmux %s: %v", strings.Join(args, " "), err)
		}
	}
	command("-f", "/dev/null", "new-session", "-d", "-s", "test", "sleep 30")
	t.Cleanup(func() { _, _ = run("kill-server") })
	command("split-window", "-t", "test", "sleep 30")
	pane, err := run("display-message", "-p", "-t", "test", "#{pane_id}")
	if err != nil {
		t.Fatal(err)
	}
	sid, err := run("display-message", "-p", "-t", pane, "#{session_id}")
	if err != nil {
		t.Fatal(err)
	}
	client := NewClient(pane, "")
	client.run = run
	client.KillPane(PaneRef{PaneID: pane, SessionID: "$stale", WindowIndex: 0})
	count, err := run("list-panes", "-t", "test", "-F", "#{pane_id}")
	if err != nil || len(strings.Split(count, "\n")) != 2 {
		t.Fatalf("stale guard changed panes: %q, %v", count, err)
	}
	client.KillPane(PaneRef{PaneID: pane, SessionID: sid, WindowIndex: 0})
	count, err = run("list-panes", "-t", "test", "-F", "#{pane_id}")
	if err != nil || len(strings.Split(count, "\n")) != 1 {
		t.Fatalf("valid guarded kill did not run: %q, %v", count, err)
	}
}

func TestRealTmuxHostileQAFormat(t *testing.T) {
	tmux, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux is not installed")
	}

	const hostile = "unit\x1f newline\nquote\"' slash\\ tab\t中é"
	socket := "mm-sidebar-qa-" + strings.ReplaceAll(t.Name(), "/", "-") + "-" + strconv.Itoa(os.Getpid())
	run := func(args ...string) (string, error) {
		out, err := exec.Command(tmux, append([]string{"-L", socket}, args...)...).Output()
		return strings.TrimRight(string(out), "\n"), err
	}
	command := func(args ...string) {
		t.Helper()
		if _, err := run(args...); err != nil {
			t.Fatalf("tmux %s: %v", strings.Join(args, " "), err)
		}
	}
	command("-f", "/dev/null", "new-session", "-d", "-s", "test", "sleep 30")
	t.Cleanup(func() { command("kill-server") })

	pane, err := run("display-message", "-p", "-t", "test", "#{pane_id}")
	if err != nil {
		t.Fatal(err)
	}
	command("rename-window", "-t", pane, "win-'\"\\中")
	command("set-option", "-t", pane, "@sidebar_content_pane", hostile)
	command("set-option", "-t", pane, "@pane-label", hostile)
	command("set-option", "-p", "-t", pane, "@sidebar_pane", "1")

	client := NewClient(pane, "")
	client.run = run
	snap, err := client.Query()
	if err != nil {
		t.Fatal(err)
	}
	if snap.ContentPane != hostile {
		t.Fatalf("option round trip = %q, want %q", snap.ContentPane, hostile)
	}
	values, err := client.Opts("@sidebar_content_pane", "@pane-label")
	if err != nil || values["@sidebar_content_pane"] != hostile || values["@pane-label"] != hostile {
		t.Fatalf("options = %#v, %v", values, err)
	}
	rows, err := client.ListPanes()
	if err != nil || len(rows) != 1 {
		t.Fatalf("list-panes = %#v, %v", rows, err)
	}
	row := rows[0]
	if row.PaneLabel != hostile || !row.Sidebar {
		t.Fatalf("hostile pane fields/sidebar marker = %#v", row)
	}
	if row.SessionName != "test" || !strings.Contains(row.WindowName, "win-") {
		t.Fatalf("session/window names lost hostile printable text: %#v", row)
	}
}
