package tmuxio

import (
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestPaneFormatUsesQAForEveryExternalField(t *testing.T) {
	if got, want := len(paneRowTokens), 18; got != want {
		t.Fatalf("pane format fields = %d, want %d", got, want)
	}
	for i, token := range paneRowTokens {
		if !strings.HasPrefix(token, "#{q/a:") || !strings.HasSuffix(token, "}") {
			t.Fatalf("pane field %d is not q/a encoded: %q", i+1, token)
		}
	}
	if got, want := paneRowTokens[len(paneRowTokens)-3], "#{q/a:@pane-label}"; got != want {
		t.Fatalf("pane label format token = %q, want %q", got, want)
	}
	if got, want := paneRowTokens[len(paneRowTokens)-2], "#{q/a:window_id}"; got != want {
		t.Fatalf("window id format token = %q, want %q", got, want)
	}
	if got, want := paneRowTokens[len(paneRowTokens)-1], "#{q/a:#{?@sidebar_pane,1,0}}"; got != want {
		t.Fatalf("sidebar marker format token = %q, want %q", got, want)
	}
}

func TestClientScopesSnapshotOptionsAndGeometryToSidebarPane(t *testing.T) {
	var calls [][]string
	client := &Client{
		paneID:       "%sidebar",
		originClient: "/dev/ttys001",
		run: func(args ...string) (string, error) {
			calls = append(calls, append([]string(nil), args...))
			switch args[0] {
			case "display-message":
				format := args[len(args)-1]
				if strings.Contains(format, "@color-canvas") {
					return "canvas" + fieldSep + "sessions", nil
				}
				return "$0" + fieldSep + "0" + fieldSep + "%sidebar" + fieldSep + "0" + fieldSep + "36" + fieldSep + "50" + fieldSep + "2" + fieldSep + "%content" + fieldSep + "sessions" + fieldSep + fieldSep + "@0", nil
			case "list-panes":
				return "0" + fieldSep + "%sidebar\n36" + fieldSep + "%content", nil
			}
			return "", nil
		},
	}

	snap, err := client.Query()
	if err != nil {
		t.Fatal(err)
	}
	if snap.WinTarget != "@0" || snap.WindowID != "@0" {
		t.Fatalf("window mutation target = %q/%q, want stable @0", snap.WinTarget, snap.WindowID)
	}

	if got, err := client.Opts("@color-canvas", "@sidebar_source"); err != nil || len(got) != 2 {
		t.Fatalf("option result = %#v, %v", got, err)
	}
	if got, err := client.RightOfPane(0); err != nil || got != "%content" {
		t.Fatalf("right pane = %q, %v; want %%content", got, err)
	}

	for _, call := range calls {
		if call[0] != "display-message" && call[0] != "list-panes" {
			continue
		}
		if !hasTarget(call, "%sidebar") {
			t.Fatalf("scope-sensitive call lacks sidebar target: %#v", call)
		}
	}
}

func TestWorldUsesOneGlobalPaneQueryAndOrdersSessions(t *testing.T) {
	var paneCalls int
	client := &Client{paneID: "%sidebar", run: func(args ...string) (string, error) {
		switch args[0] {
		case "display-message":
			return "$2" + fieldSep + "3" + fieldSep + "%sidebar" + fieldSep + "0" + fieldSep + "36" + fieldSep + "50" + fieldSep + "2" + fieldSep + "%content" + fieldSep + "sessions" + fieldSep + fieldSep + "@2", nil
		case "list-sessions":
			// tmux creation order is work, float; World must render float first.
			return "$1" + fieldSep + "work" + fieldSep + "2" + fieldSep + "0\n" + "$2" + fieldSep + "float" + fieldSep + "1" + fieldSep + "1", nil
		case "list-panes":
			paneCalls++
			return "100" + fieldSep + "%content" + fieldSep + "$2" + fieldSep + "float" + fieldSep + "3" + fieldSep + "0" + fieldSep + "36" + fieldSep + "main" + fieldSep + "1" + fieldSep + "1" + fieldSep + "0" + fieldSep + "0" + fieldSep + "0" + fieldSep + "zsh" + fieldSep + "/cwd" + fieldSep + "" + fieldSep + "@2" + fieldSep + "0", nil
		}
		return "", nil
	}}
	world, err := client.World()
	if err != nil {
		t.Fatal(err)
	}
	if paneCalls != 1 {
		t.Fatalf("list-panes calls = %d, want 1", paneCalls)
	}
	sessions := world.Sessions()
	if len(sessions) != 2 || sessions[0].Name != "float" || sessions[1].Name != "work" {
		t.Fatalf("session order = %#v, want float then work", sessions)
	}
	if world.Snapshot.SessionID != "$2" || world.Snapshot.WindowIndex != 3 || !world.PaneSet().Alive("%content") {
		t.Fatalf("world lost snapshot/pane state: %#v %#v", world.Snapshot, world.PaneSet())
	}
}

func TestWorldFingerprintIncludesNavigatorPaneFields(t *testing.T) {
	snap := Snapshot{SessionID: "$1", WindowIndex: 1}
	sessions := []Session{{ID: "$1", Name: "work", Windows: 1}}
	base := []PaneRow{{PanePID: 1, PaneID: "%1", SessionID: "$1", SessionName: "work", WindowIndex: 1, Command: "zsh", CurrentPath: "/one"}}
	first := NewWorld(snap, sessions, base)
	changed := append([]PaneRow(nil), base...)
	changed[0].Command, changed[0].CurrentPath, changed[0].PaneLabel, changed[0].Activity, changed[0].Sidebar = "nvim", "/two", "review", true, true
	second := NewWorld(snap, sessions, changed)
	if first.Fingerprint() == second.Fingerprint() {
		t.Fatal("world fingerprint ignored command/path/label/sidebar change")
	}
}

func TestPaneWindowIDUsesExplicitSidebarTarget(t *testing.T) {
	var call []string
	client := &Client{paneID: "%sidebar", run: func(args ...string) (string, error) {
		call = append([]string(nil), args...)
		return "@owner", nil
	}}
	got, err := client.PaneWindowID()
	if err != nil || got != "@owner" {
		t.Fatalf("window id = %q, %v", got, err)
	}
	want := []string{"display-message", "-p", "-t", "%sidebar", "#{window_id}"}
	if !reflect.DeepEqual(call, want) {
		t.Fatalf("window lookup = %#v, want %#v", call, want)
	}
}

func TestGuardedPaneActionsUseExactIdentityAndOneTmuxCommand(t *testing.T) {
	var calls [][]string
	client := &Client{originClient: "/dev/ttys007", run: func(args ...string) (string, error) {

		calls = append(calls, append([]string(nil), args...))
		return "", nil
	}}
	ref := PaneRef{PaneID: "%7", SessionID: "$4", WindowIndex: 2}
	client.KillPane(ref)
	if len(calls) != 1 || calls[0][0] != "if-shell" || !strings.Contains(strings.Join(calls[0], " "), "#{==:#{session_id},$4}") || !strings.Contains(strings.Join(calls[0], " "), "kill-pane -t %7") {
		t.Fatalf("kill pane was not guarded by rendered identity: %#v", calls)
	}
	calls = nil
	client.PromptPaneLabel(ref)
	if len(calls) != 1 {
		t.Fatalf("label prompt calls = %#v", calls)
	}
	joined := strings.Join(calls[0], " ")
	for _, want := range []string{"command-prompt -b -t /dev/ttys007", `set-option -p -t %07 @pane-label "%%%"`} {
		if !strings.Contains(joined, want) {
			t.Fatalf("label prompt lacks %q: %#v", want, calls)
		}
	}
}

func TestCapturePaneAtomicallyRevalidatesCompleteIdentity(t *testing.T) {
	var call []string
	client := &Client{run: func(args ...string) (string, error) {
		call = append([]string(nil), args...)
		return "captured", nil
	}}
	ref := PaneRef{PaneID: "%7", SessionID: "$4", WindowID: "@9", WindowIndex: 2}
	got, err := client.CapturePane(ref)
	if err != nil || got != "captured" {
		t.Fatalf("capture = %q, %v", got, err)
	}
	joined := strings.Join(call, " ")
	for _, want := range []string{"if-shell -F -t %7", "#{==:#{session_id},$4}", "#{==:#{window_id},@9}", "#{==:#{window_index},2}", "capture-pane -p -e -t %7", "exit 1"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("capture lacks %q: %#v", want, call)
		}
	}
}

func TestContentActionsAreIdentityGuardedAndQuotePaths(t *testing.T) {
	var calls [][]string
	client := &Client{run: func(args ...string) (string, error) {
		calls = append(calls, append([]string(nil), args...))
		return "", nil
	}}
	ref := PaneRef{PaneID: "%7", SessionID: "$4", WindowID: "@9", WindowIndex: 2}
	client.SplitAt(ref, "/tmp/a' b;touch PWN")
	client.OpenFileAt(ref, "/tmp/open helper", "/tmp/a' b;touch PWN")
	if len(calls) != 2 {
		t.Fatalf("content action calls = %#v", calls)
	}
	for _, call := range calls {
		joined := strings.Join(call, " ")
		for _, want := range []string{"if-shell -F -t %7", "#{==:#{session_id},$4}", "#{==:#{window_id},@9}"} {
			if !strings.Contains(joined, want) {
				t.Fatalf("guarded content action lacks %q: %#v", want, call)
			}
		}
	}
	if !strings.Contains(strings.Join(calls[0], " "), `'"'"'`) {
		t.Fatalf("split path was not one quoted argument: %#v", calls[0])
	}
}

func TestProjectLaunchersAreGuardedAndAgentAllowlisted(t *testing.T) {
	var calls [][]string
	client := &Client{originClient: "/dev/tty 7", run: func(args ...string) (string, error) {
		calls = append(calls, append([]string(nil), args...))
		return "", nil
	}}
	ref := PaneRef{PaneID: "%7", SessionID: "$4", WindowID: "@9", WindowIndex: 2}
	path := "/tmp/worktree ' ; touch PWN"
	client.NewWindowAt(ref, path)
	client.OpenAgentAt(ref, path, "pi")
	client.OpenAgentAt(ref, path, "claude")
	client.OpenAgentAt(ref, path, "sh -c PWN")
	client.OpenLazygitAt(ref, path)
	if len(calls) != 4 {
		t.Fatalf("launcher calls = %#v, want guarded new-window, pi, claude, lazygit", calls)
	}
	for _, call := range calls {
		joined := strings.Join(call, " ")
		for _, want := range []string{"if-shell -F -t %7", "#{==:#{session_id},$4}", "#{==:#{window_id},@9}"} {
			if !strings.Contains(joined, want) {
				t.Fatalf("unguarded launcher lacks %q: %#v", want, call)
			}
		}
	}
	if got := strings.Join(calls[0], " "); !strings.Contains(got, "new-window -c") || !strings.Contains(got, `'"'"'`) {
		t.Fatalf("new window did not preserve one quoted cwd: %#v", calls[0])
	}
	if got := strings.Join(calls[1], " "); !strings.Contains(got, "new-window -c") || !strings.Contains(got, "exec pi") {
		t.Fatalf("pi launcher = %#v", calls[1])
	}
	if got := strings.Join(calls[2], " "); !strings.Contains(got, "new-window -c") || !strings.Contains(got, "exec claude") {
		t.Fatalf("Claude launcher = %#v", calls[2])
	}
	if got := strings.Join(calls[3], " "); !strings.Contains(got, "tmux-lazygit-popup") || !strings.Contains(got, "/dev/tty 7") {
		t.Fatalf("lazygit launcher lost argv-safe cwd/client: %#v", calls[3])
	}
}

func TestSidebarWidthPersistsBeforeLiveResize(t *testing.T) {
	var calls [][]string
	client := &Client{paneID: "%sidebar", run: func(args ...string) (string, error) {
		calls = append(calls, append([]string(nil), args...))
		return "", nil
	}}
	client.SetSidebarWidth("$1:2", 44)
	want := [][]string{{"set-option", "-wt", "$1:2", "@sidebar_width", "44"}, {"resize-pane", "-x", "44", "-t", "%sidebar"}}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("width calls = %#v, want %#v", calls, want)
	}
}

func TestFocusPaneUsesOneOriginClientSwitch(t *testing.T) {
	var calls [][]string
	client := &Client{
		paneID:       "%sidebar",
		originClient: "/dev/ttys001",
		run: func(args ...string) (string, error) {
			calls = append(calls, append([]string(nil), args...))
			return "", nil
		},
	}

	client.FocusPane("%agent", "work:2")
	want := [][]string{{"switch-client", "-c", "/dev/ttys001", "-Z", "-t", "%agent"}}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("focus calls = %#v, want %#v", calls, want)
	}
}

func TestFocusPaneIgnoresCompatibilityTargetWithoutOriginClient(t *testing.T) {
	var calls [][]string
	client := &Client{
		paneID: "%sidebar",
		run: func(args ...string) (string, error) {
			calls = append(calls, append([]string(nil), args...))
			return "", nil
		},
	}

	client.FocusPane("%agent", "work:2")
	want := [][]string{{"switch-client", "-Z", "-t", "%agent"}}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("focus calls = %#v, want %#v", calls, want)
	}
}

func TestUnscopedQuerySupportsStandaloneWorldConsumers(t *testing.T) {
	var call []string
	client := &Client{run: func(args ...string) (string, error) {
		call = append([]string(nil), args...)
		return "$1" + fieldSep + "0" + fieldSep + "%1" + fieldSep + "0" + fieldSep + "36" + fieldSep + "50" + fieldSep + "1" + fieldSep + fieldSep + fieldSep + fieldSep + "@1", nil
	}}
	if _, err := client.Query(); err != nil {
		t.Fatal(err)
	}
	for _, arg := range call {
		if arg == "-t" {
			t.Fatalf("unscoped query used an empty target: %#v", call)
		}
	}
}

func TestQueryReturnsRunnerError(t *testing.T) {
	client := &Client{paneID: "%sidebar", run: func(...string) (string, error) { return "", errors.New("no tmux") }}
	if _, err := client.Query(); err == nil {
		t.Fatal("Query succeeded after runner failure")
	}
}

func TestDecodeQAArguments(t *testing.T) {
	tests := []struct {
		encoded string
		want    string
	}{
		{"", ""}, // an unset tmux format is an empty bare field
		{"plain", "plain"},
		{"''", ""},
		{`"has space"`, "has space"},
		{`'a"b\nc\\d'`, "a\"b\nc\\d"},
		{`"a'b"`, "a'b"},
		{`a\037b\nc\\d\te`, "a\x1fb\nc\\d\te"},
		{`a\!b\&c\(d\)e\*f\,g\<h\>i\?j\[k\]l\^m\` + "`" + `n\|o`, "a!b&c(d)e*f,g<h>i?j[k]l^m`n|o"},
		{`"quote\" and dollar\$"`, "quote\" and dollar$"},
		{`x\200y`, "x\x80y"},
	}
	for _, tt := range tests {
		got, err := DecodeArgument(tt.encoded)
		if err != nil || got != tt.want {
			t.Errorf("DecodeArgument(%q) = %q, %v; want %q", tt.encoded, got, err, tt.want)
		}
	}
}

func TestDecodeQARejectsMalformedArguments(t *testing.T) {
	for _, encoded := range []string{
		"'unterminated", `"unterminated`, "trail\\", "bad\\x", "bad\\12", `bare"quote`,
		"bare value", "line\nbreak", "unit\x1fseparator", `'embedded'quote'`,
	} {
		if _, err := DecodeArgument(encoded); err == nil {
			t.Errorf("DecodeArgument(%q) succeeded", encoded)
		}
	}
}

func TestUnsetTMuxFieldsRemainEmptyWithoutBreakingFraming(t *testing.T) {
	client := &Client{paneID: "%sidebar", run: func(args ...string) (string, error) {
		switch args[0] {
		case "display-message":
			return "$0" + fieldSep + "0" + fieldSep + "%sidebar" + fieldSep + "0" + fieldSep + "36" + fieldSep + "50" + fieldSep + "2" + fieldSep + fieldSep + fieldSep + fieldSep + "@0", nil
		case "list-panes":
			return "123" + fieldSep + "%1" + fieldSep + "$1" + fieldSep + "session" + fieldSep + "2" + fieldSep + "3" + fieldSep + "0" + fieldSep + "window" + fieldSep + "0" + fieldSep + "0" + fieldSep + "0" + fieldSep + "0" + fieldSep + "0" + fieldSep + "zsh" + fieldSep + "/cwd" + fieldSep + fieldSep + "@1" + fieldSep + "0", nil
		}
		return "", nil
	}}

	snap, err := client.Query()
	if err != nil || snap.ContentPane != "" || snap.Source != "" {
		t.Fatalf("unset snapshot fields = %#v, %v", snap, err)
	}
	rows, err := client.ListPanes()
	if err != nil || len(rows) != 1 || rows[0].PaneLabel != "" {
		t.Fatalf("unset pane label = %#v, %v", rows, err)
	}
}

func TestHostileTransportPreservesFieldsAndTargets(t *testing.T) {
	const hostile = `"unit\037newline\nquote\"' slash\\ tab\t中é"`
	client := &Client{paneID: "%sidebar", run: func(args ...string) (string, error) {
		switch args[0] {
		case "display-message":
			format := args[len(args)-1]
			if strings.Contains(format, "@probe") {
				return hostile + fieldSep + "plain", nil
			}
			return "$0" + fieldSep + "0" + fieldSep + "%sidebar" + fieldSep + "0" + fieldSep + "36" + fieldSep + "50" + fieldSep + "2" + fieldSep + hostile + fieldSep + "sessions" + fieldSep + fieldSep + "@0", nil
		case "list-panes":
			if strings.Contains(args[len(args)-1], "pane_current_command") {
				return "123" + fieldSep + "%1" + fieldSep + hostile + fieldSep + hostile + fieldSep + "2" + fieldSep + "3" + fieldSep + "0" + fieldSep + hostile + fieldSep + "1" + fieldSep + "1" + fieldSep + "0" + fieldSep + "0" + fieldSep + "0" + fieldSep + hostile + fieldSep + hostile + fieldSep + hostile + fieldSep + "@1" + fieldSep + "0", nil
			}
			return "0" + fieldSep + "%sidebar", nil
		}
		return "", nil
	}}

	snap, err := client.Query()
	if err != nil || snap.ContentPane != "unit\x1fnewline\nquote\"' slash\\ tab\t中é" {
		t.Fatalf("snapshot hostile field = %#v, %v", snap, err)
	}
	if got, err := client.Opts("@probe", "@other"); err != nil || got["@probe"] != snap.ContentPane {
		t.Fatalf("hostile option = %#v, %v", got, err)
	}
	rows, err := client.ListPanes()
	if err != nil || len(rows) != 1 {
		t.Fatalf("hostile panes = %#v, %v", rows, err)
	}
	if got, want := rows[0].Target, snap.ContentPane+":2.3"; got != want {
		t.Fatalf("target shifted by hostile session name: %q, want %q", got, want)
	}
	if got := rows[0].PaneLabel; got != snap.ContentPane {
		t.Fatalf("pane label = %q, want hostile value", got)
	}
}

func TestMalformedTransportReturnsErrorsInsteadOfShifting(t *testing.T) {
	client := &Client{paneID: "%sidebar", run: func(args ...string) (string, error) {
		switch args[0] {
		case "display-message":
			return "$0" + fieldSep + "0", nil
		case "list-panes":
			return "1" + fieldSep + "%1" + fieldSep + "bad\\x", nil
		}
		return "", nil
	}}
	if _, err := client.Query(); err == nil {
		t.Fatal("malformed snapshot succeeded")
	}
	if _, err := client.ListPanes(); err == nil {
		t.Fatal("malformed list-panes row succeeded")
	}
	if _, err := client.RightOfPane(0); err == nil {
		t.Fatal("malformed geometry row succeeded")
	}
}

func TestPaneMatchesUsesFullRenderedIdentity(t *testing.T) {
	ref := PaneRef{PaneID: "%7", SessionID: "$2", WindowID: "@4", WindowIndex: 3}
	var got []string
	client := &Client{run: func(args ...string) (string, error) {
		got = append([]string(nil), args...)
		return "1", nil
	}}
	if !client.PaneMatches(ref) {
		t.Fatal("matching pane rejected")
	}
	want := []string{"display-message", "-p", "-t", "%7", panePredicate(ref)}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args = %#v, want %#v", got, want)
	}
}

func TestPaneMatchesRejectsMovedOrIncompletePane(t *testing.T) {
	client := &Client{run: func(...string) (string, error) { return "0", nil }}
	if client.PaneMatches(PaneRef{PaneID: "%7", SessionID: "$2", WindowID: "@4", WindowIndex: 3}) {
		t.Fatal("moved pane accepted")
	}
	if client.PaneMatches(PaneRef{PaneID: "%7"}) {
		t.Fatal("incomplete pane accepted")
	}
}

func TestShowMessagePassesTextAsOneArgument(t *testing.T) {
	var got []string
	client := &Client{run: func(args ...string) (string, error) {
		got = append([]string(nil), args...)
		return "", nil
	}}
	client.ShowMessage("approval required; don't bypass")
	want := []string{"display-message", "-d", "3000", "approval required; don't bypass"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args = %#v, want %#v", got, want)
	}
}

func hasTarget(args []string, target string) bool {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == "-t" && args[i+1] == target {
			return true
		}
	}
	return false
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
