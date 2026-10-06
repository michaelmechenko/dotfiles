package tmuxio

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestPreviewPopupGeometryIsClientRelativeAndAdjacent(t *testing.T) {
	for _, tc := range []struct {
		name                   string
		status                 int
		position               string
		want                   PopupGeometry
	}{
		{"top status", 2, "top", PopupGeometry{X: 24, Y: 2, Width: 100, Height: 48}},
		{"bottom status", 2, "bottom", PopupGeometry{X: 24, Y: 0, Width: 100, Height: 48}},
		{"status off", 0, "top", PopupGeometry{X: 24, Y: 0, Width: 100, Height: 50}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := PreviewPopupGeometry(160, 50, tc.status, tc.position, 124, 36, false)
			if !ok || got != tc.want {
				t.Fatalf("geometry = %#v, %t; want %#v, true", got, ok, tc.want)
			}
		})
	}
	for _, input := range []struct {
		name                                             string
		clientWidth, clientHeight, status, left, sidebar int
		zoom                                             bool
	}{
		{"narrow", 80, 30, 1, 31, 36, false},
		{"sidebar outside client", 80, 30, 1, 50, 36, false},
		{"zoomed", 160, 50, 1, 124, 36, true},
		{"short", 160, 8, 1, 124, 36, false},
	} {
		t.Run(input.name, func(t *testing.T) {
			if _, ok := PreviewPopupGeometry(input.clientWidth, input.clientHeight, input.status, "top", input.left, input.sidebar, input.zoom); ok {
				t.Fatal("unsafe popup geometry was accepted")
			}
		})
	}
}

func popupClient(t *testing.T, calls *[][]string, state []string) *Client {
	t.Helper()
	return &Client{paneID: "%sidebar", originClient: "/dev/ttys007", run: func(args ...string) (string, error) {
		*calls = append(*calls, append([]string(nil), args...))
		switch args[0] {
		case "display-message":
			if hasTarget(args, "%sidebar") {
				return strings.Join([]string{"@owner", "124", "36"}, fieldSep), nil
			}
			return strings.Join(state, fieldSep), nil
		case "display-popup":
			return "", nil
		default:
			return "", errors.New("unexpected command")
		}
	}}
}

func TestParseStatusAcceptsTmuxOptionFormat(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  int
	}{
		{"on", 1}, {"off", 0}, {"", 0}, {"1", 1}, {"0", 0},
	} {
		got, err := parseStatus(tc.input)
		if err != nil || got != tc.want {
			t.Errorf("parseStatus(%q) = %d, %v; want %d, nil", tc.input, got, err, tc.want)
		}
	}
	if _, err := parseStatus("maybe"); err == nil {
		t.Fatal("parseStatus accepted an invalid option")
	}
}

func TestPathPreviewPreflightThenLaunchUsesCurrentSidebarGeometry(t *testing.T) {
	var calls [][]string
	client := popupClient(t, &calls, []string{"@owner", "0", "160", "50", "2", "top", "0"})
	req := PreviewPopupRequest{OwnerWindow: "@owner", Binary: "/opt/mm-sidebar", Path: "/odd path;$(not-shell).go"}
	plan, result, err := client.PreparePathPreview(context.Background(), req)
	if err != nil || result.Fallback {
		t.Fatalf("prepare result = %#v, %v", result, err)
	}
	if got, want := len(calls), 2; got != want {
		t.Fatalf("preflight calls = %#v", calls)
	}
	if got, want := calls[0], []string{"display-message", "-p", "-t", "%sidebar", strings.Join(popupPaneTokens, fieldSep)}; !reflect.DeepEqual(got, want) {
		t.Fatalf("pane preflight = %#v, want %#v", got, want)
	}
	if _, err := client.LaunchPathPreview(context.Background(), plan); err != nil {
		t.Fatal(err)
	}
	if got, want := len(calls), 5; got != want {
		t.Fatalf("launch calls = %#v", calls)
	}
	popup := calls[4]
	if got := strings.Join(popup, " "); !strings.Contains(got, "display-popup -c /dev/ttys007 -t %sidebar -E") || strings.Contains(got, " -C ") {
		t.Fatalf("popup scope = %q", got)
	}
	if got := indexOf(popup, "-e"); got < 0 || popup[got+1] != "MM_SIDEBAR_PREVIEW_PATH=/odd path;$(not-shell).go" {
		t.Fatalf("path transport = %#v", popup)
	}
	if got, want := popup[len(popup)-2:], []string{"/opt/mm-sidebar", "preview"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("popup command = %#v, want %#v", popup, want)
	}
}

func TestPathPreviewRefusesExistingPopupAndStaleClient(t *testing.T) {
	for _, tc := range []struct {
		name         string
		state        []string
		wantFallback bool
		wantErr      bool
	}{
		{"existing popup", []string{"@owner", "80", "160", "50", "1", "top", "0"}, false, true},
		{"client changed window", []string{"@other", "0", "160", "50", "1", "top", "0"}, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls [][]string
			client := popupClient(t, &calls, tc.state)
			_, result, err := client.PreparePathPreview(context.Background(), PreviewPopupRequest{OwnerWindow: "@owner", Binary: "/opt/mm-sidebar", Path: "/tmp/file"})
			if (err != nil) != tc.wantErr || result.Fallback != tc.wantFallback || len(calls) == 3 {
				t.Fatalf("result=%#v err=%v calls=%#v", result, err, calls)
			}
		})
	}
}

func TestCancelledPreviewNeverStartsPopup(t *testing.T) {
	var calls [][]string
	client := popupClient(t, &calls, []string{"@owner", "0", "160", "50", "1", "top", "0"})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := client.PreparePathPreview(ctx, PreviewPopupRequest{OwnerWindow: "@owner", Binary: "/opt/mm-sidebar", Path: "/tmp/file"}); !errors.Is(err, context.Canceled) || len(calls) != 0 {
		t.Fatalf("cancelled preflight err=%v calls=%#v", err, calls)
	}
}

func indexOf(values []string, want string) int {
	for i, value := range values {
		if value == want {
			return i
		}
	}
	return -1
}
