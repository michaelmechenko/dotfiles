package navview

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"

	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/theme"
)

// ListFrame is the rendered navigator viewport and its stable row hit map.
type ListFrame struct {
	Lines []string
	Hits  []int
	Start int
}

// RenderList renders semantic rows when present and retains a narrow legacy
// fallback for rows not yet migrated. It scrolls in row units and pads to the
// exact granted height.
func RenderList(rows []nav.Row, width, height, selected, start int, focused bool, th theme.Theme) ListFrame {
	if height < 1 {
		height = 1
	}
	if start < 0 {
		start = 0
	}
	if start > selected {
		start = selected
	}
	for start < selected {
		used := 0
		for i := start; i <= selected; i++ {
			used += rowHeight(rows[i])
		}
		if used <= height {
			break
		}
		start++
	}
	maxStart := 0
	used := 0
	for i := len(rows) - 1; i >= 0; i-- {
		used += rowHeight(rows[i])
		if used > height {
			maxStart = i + 1
			break
		}
	}
	if start > maxStart {
		start = maxStart
	}
	out := ListFrame{Lines: make([]string, 0, height), Hits: make([]int, 0, height), Start: start}
	for i := start; i < len(rows) && len(out.Lines) < height; i++ {
		row := rows[i]
		if row.Presentation.Label != "" {
			out.Lines = append(out.Lines, renderSemanticRow(row, width, i == selected && focused, th))
			out.Hits = append(out.Hits, i)
			continue
		}
		for j, line := range row.Lines {
			if len(out.Lines) >= height {
				break
			}
			prefix := "  "
			if j == 0 && i == selected && focused {
				prefix = th.Accent.Render("▶") + " "
			}
			out.Lines = append(out.Lines, prefix+clip(line, width-2))
			out.Hits = append(out.Hits, i)
		}
	}
	for len(out.Lines) < height {
		out.Lines = append(out.Lines, "")
		out.Hits = append(out.Hits, -1)
	}
	return out
}

func rowHeight(row nav.Row) int {
	if row.Presentation.Label != "" {
		return 1
	}
	if len(row.Lines) > 0 {
		return len(row.Lines)
	}
	return 1
}

func renderSemanticRow(row nav.Row, width int, selected bool, th theme.Theme) string {
	if width <= 0 {
		return ""
	}
	p := row.Presentation
	marker := p.Marker
	if row.Collapsible {
		if row.Expanded {
			marker = "▾"
		} else {
			marker = "▸"
		}
	}
	indent := strings.Repeat("│ ", p.Depth)
	plain := indent
	if marker != "" {
		plain += marker + " "
	}
	plain += p.Label
	for _, fact := range p.Facts {
		if fact.Text != "" {
			plain += " · " + fact.Text
		}
	}
	if selected {
		line := ansi.Truncate(plain, width-1, "…")
		line = " " + line
		if pad := width - ansi.StringWidth(line); pad > 0 {
			line += strings.Repeat(" ", pad)
		}
		return th.Selected.Render(line)
	}

	line := indent
	if marker != "" {
		line += th.Accent.Render(marker) + " "
	}
	line += styleFor(th, p.Tone).Render(p.Label)
	for _, fact := range p.Facts {
		if fact.Text == "" {
			continue
		}
		candidate := line + th.Divider.Render(" · ") + styleFor(th, fact.Tone).Render(fact.Text)
		if ansi.StringWidth(candidate) > width {
			break
		}
		line = candidate
	}
	return clip(line, width)
}

// RenderDetail renders source-owned cached selection context within its granted
// height. The first line is an integrated divider/title; hints are packed only
// when they fit and otherwise occupy one line each.
func RenderDetail(detail nav.Detail, width, height int, th theme.Theme) []string {
	if height <= 0 || detail.Title == "" {
		return nil
	}
	lines := []string{detailLabel(detail.Title, width, th)}
	for _, item := range detail.Lines {
		if len(lines) >= height {
			break
		}
		text := item.Text
		if item.TruncateLeft && ansi.StringWidth(text) > width {
			text = ansi.TruncateLeft(text, width, "…")
		}
		lines = append(lines, clip(styleFor(th, item.Tone).Render(text), width))
	}
	for _, hint := range detail.Hints {
		if len(lines) >= height {
			break
		}
		text := hint.Key + " " + hint.Summary
		lines = append(lines, clip(th.Muted.Render(text), width))
	}
	return lines
}

func detailLabel(title string, width int, th theme.Theme) string {
	text := " " + title + " "
	remain := width - ansi.StringWidth(text) - 1
	if remain < 0 {
		remain = 0
	}
	return clip(th.Divider.Render("─")+th.Accent.Render(text)+th.Divider.Render(strings.Repeat("─", remain)), width)
}

func styleFor(th theme.Theme, tone nav.Tone) lipgloss.Style {
	switch tone {
	case nav.ToneMuted:
		return th.Muted
	case nav.ToneAccent:
		return th.Accent
	case nav.ToneUrgent:
		return th.Urgent
	case nav.ToneBusy:
		return th.Busy
	default:
		return th.Text
	}
}

func clip(s string, width int) string {
	if width <= 0 {
		return ""
	}
	if ansi.StringWidth(s) <= width {
		return s
	}
	return ansi.Truncate(s, width, "…")
}
