package tmuxio

import "testing"

func TestPaneFormatAppendsPaneLabel(t *testing.T) {
	if got, want := len(paneRowTokens), 8; got != want {
		t.Fatalf("pane format fields = %d, want %d", got, want)
	}
	if got, want := paneRowTokens[len(paneRowTokens)-1], "#{@pane-label}"; got != want {
		t.Fatalf("last pane format token = %q, want %q", got, want)
	}
	if got, want := paneRowTokens[:7], []string{
		"#{pane_pid}", "#{pane_id}", "#{session_name}:#{window_index}.#{pane_index}",
		"#{session_name}", "#{window_name}", "#{pane_current_command}", "#{pane_current_path}",
	}; !sameStrings(got, want) {
		t.Fatalf("existing pane format fields changed: got %#v, want %#v", got, want)
	}
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
