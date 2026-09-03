package main

import "mm-sidebar/internal/blocks"

const navMinHeight = 1

type arrangement struct {
	blocks   []blocks.Block
	navAvail int
}

// layout is deterministic for one model surface. The main surface reserves only
// the navigator and the blocker-only attention summary. Explicit views own the
// full post-header pane and may expand their single list into available space.
// Unused space intentionally stays blank.
func (m *model) layout(usable int) arrangement {
	if usable < 1 {
		usable = 1
	}
	for _, block := range m.docked {
		if sized, ok := block.(blocks.ViewportSized); ok {
			sized.SetViewportHeight(0)
		}
		if expandable, ok := block.(blocks.Expandable); ok {
			expandable.SetExtra(0)
		}
	}

	if m.surface != surfaceMain {
		block, _ := m.surfaceBlock()
		if block == nil {
			return arrangement{navAvail: usable}
		}
		if sized, ok := block.(blocks.ViewportSized); ok {
			sized.SetViewportHeight(usable)
		}
		if expandable, ok := block.(blocks.Expandable); ok {
			expandable.Expand(usable - block.Height())
		}
		return arrangement{blocks: []blocks.Block{block}}
	}

	var active []blocks.Block
	if block := m.agentsBlock(); block != nil && block.Height() > 0 {
		active = []blocks.Block{block}
	}
	if len(active) > 0 && dockCost(active) > usable-navMinHeight {
		active = nil
	}

	navAvail := m.navContentLines()
	room := usable - dockCost(active)
	if navAvail > room {
		navAvail = room
	}
	if navAvail < navMinHeight {
		navAvail = navMinHeight
	}
	if navAvail > usable {
		navAvail = usable
	}
	return arrangement{blocks: active, navAvail: navAvail}
}

func dockCost(items []blocks.Block) int {
	total := 0
	for _, block := range items {
		total += block.Height()
	}
	return total
}

func (m *model) navContentLines() int {
	rows := m.navigatorRows()
	if len(rows) == 0 {
		return 1
	}
	total := 0
	for _, row := range rows {
		total += len(row.Lines)
	}
	return total
}
