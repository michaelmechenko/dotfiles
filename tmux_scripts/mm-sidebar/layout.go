package main

import (
	"mm-sidebar/internal/blocks"
	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/navview"
)

const navMinHeight = 3

type arrangement struct {
	blocks        []blocks.Block
	navAvail      int
	detailAvail   int
	workingLines  []string
	activityLines []string
}

// layout is deterministic for one model surface. Main mode follows the cockpit
// degradation order through navview.Allocate; explicit views retain their full
// post-header viewport. Every input is already cached and every call is pure.
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

	var urgent []blocks.Block
	if block := m.agentsBlock(); block != nil {
		if capacity := usable - navMinHeight; capacity >= 2 {
			block.SetViewportHeight(capacity)
			if block.Height() > 0 {
				urgent = []blocks.Block{block}
			}
		}
	}
	working := m.workingAmbientLines(4)
	activity := m.activityAmbientLines(6)
	allocation := navview.Allocate(navview.AllocationInput{
		Height: usable, ViewportHeight: m.height, Rows: m.navContentLines(), MinNavigator: navMinHeight,
		Urgent: dockCost(urgent), Detail: m.selectedDetailLineCount(),
		Working: len(working), Activity: len(activity),
	})
	if allocation.Urgent == 0 {
		urgent = nil
	}
	if allocation.Working < len(working) {
		working = working[:allocation.Working]
	}
	if allocation.Activity < len(activity) {
		activity = activity[:allocation.Activity]
	}
	return arrangement{
		blocks: urgent, navAvail: allocation.Navigator, detailAvail: allocation.Detail,
		workingLines: working, activityLines: activity,
	}
}

func dockCost(items []blocks.Block) int {
	total := 0
	for _, block := range items {
		total += block.Height()
	}
	return total
}

func navigatorRowHeight(row nav.Row) int {
	if row.Presentation.Label != "" {
		return 1
	}
	if len(row.Lines) > 0 {
		return len(row.Lines)
	}
	return 1
}

func (m *model) navContentLines() int {
	rows := m.navigatorRows()
	if len(rows) == 0 {
		return 1
	}
	total := 0
	for _, row := range rows {
		total += navigatorRowHeight(row)
	}
	return total
}

func (m *model) selectedDetailLineCount() int {
	rows := m.navigatorRows()
	if m.sel < 0 || m.sel >= len(rows) {
		return 0
	}
	detail := rows[m.sel].Presentation.Detail
	if detail.Title == "" {
		return 0
	}
	return 1 + len(detail.Lines) + len(detail.Hints)
}

func (m *model) workingAmbientLines(max int) []string {
	if block := m.agentsBlock(); block != nil {
		return block.WorkingLines(m.width, max)
	}
	return nil
}

func (m *model) activityAmbientLines(max int) []string {
	block, _ := m.blockByID("activity")
	if activity, ok := block.(*blocks.Activity); ok {
		return activity.AmbientLines(m.width, max)
	}
	return nil
}
