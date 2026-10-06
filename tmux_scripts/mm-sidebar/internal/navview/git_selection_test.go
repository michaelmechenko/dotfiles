package navview

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	"github.com/muesli/termenv"

	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/theme"
)

func TestGitRowRenderingPreservesStateAtSelectedAndNarrowWidths(t *testing.T) {
	lipgloss.SetColorProfile(termenv.TrueColor)
	t.Cleanup(func() { lipgloss.SetColorProfile(termenv.Ascii) })
	th := theme.Theme{
		Text:     lipgloss.NewStyle().Foreground(lipgloss.Color("#bebedb")),
		Accent:   lipgloss.NewStyle().Foreground(lipgloss.Color("#aeaed1")),
		Changed:  lipgloss.NewStyle().Foreground(lipgloss.Color("#f3be7c")),
		Urgent:   lipgloss.NewStyle().Foreground(lipgloss.Color("#d8647e")),
		Divider:  lipgloss.NewStyle().Foreground(lipgloss.Color("#383848")),
		Selected: lipgloss.NewStyle().Foreground(lipgloss.Color("#9094a0")).Background(lipgloss.Color("#2a2a35")),
	}
	row := nav.Row{Presentation: nav.Presentation{Label: "changed-file.go", Tone: nav.ToneChanged, Facts: []nav.Fact{{Text: "conflict", Tone: nav.ToneUrgent}}}}
	for _, tc := range []struct {
		name     string
		width    int
		selected int
		focused  bool
	}{
		{"selected wide", 36, 0, true},
		{"unselected wide", 36, 0, false},
		{"selected narrow", 12, 0, true},
		{"unselected narrow", 12, 0, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			line := RenderList([]nav.Row{row}, tc.width, 1, tc.selected, 0, tc.focused, th).Lines[0]
			if got := ansi.StringWidth(line); got > tc.width {
				t.Fatalf("rendered width = %d; want <= %d: %q", got, tc.width, line)
			}
			if !strings.Contains(line, "38;2;243;190;124") {
				t.Fatalf("Git changed color missing: %q", line)
			}
			if tc.focused && !strings.Contains(line, "48;2;42;42;52") {
				t.Fatalf("selected background missing: %q", line)
			}
			if tc.width >= 36 && !strings.Contains(line, "38;2;216;100;126") {
				t.Fatalf("wide Git fact color missing: %q", line)
			}
		})
	}
}

func TestSelectedGitRowKeepsSemanticForegrounds(t *testing.T) {
	lipgloss.SetColorProfile(termenv.TrueColor)
	t.Cleanup(func() { lipgloss.SetColorProfile(termenv.Ascii) })
	th := theme.Theme{
		Text:     lipgloss.NewStyle().Foreground(lipgloss.Color("#bebedb")),
		Accent:   lipgloss.NewStyle().Foreground(lipgloss.Color("#aeaed1")),
		Changed:  lipgloss.NewStyle().Foreground(lipgloss.Color("#f3be7c")),
		Urgent:   lipgloss.NewStyle().Foreground(lipgloss.Color("#d8647e")),
		Divider:  lipgloss.NewStyle().Foreground(lipgloss.Color("#383848")),
		Selected: lipgloss.NewStyle().Foreground(lipgloss.Color("#9094a0")).Background(lipgloss.Color("#2a2a35")),
	}
	row := nav.Row{Presentation: nav.Presentation{Label: "changed", Tone: nav.ToneChanged, Facts: []nav.Fact{{Text: "conflict", Tone: nav.ToneUrgent}}}}
	line := RenderList([]nav.Row{row}, 36, 1, 0, 0, true, th).Lines[0]
	for _, color := range []string{"38;2;243;190;124", "38;2;216;100;126", "48;2;"} {
		if !strings.Contains(line, color) {
			t.Fatalf("selected Git line lost %q: %q", color, line)
		}
	}
}
