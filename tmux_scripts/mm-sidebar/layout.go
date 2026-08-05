package main

import "mm-sidebar/internal/blocks"

// This file owns the sidebar's vertical arrangement: how the post-header space is
// divided between the navigator and the docked blocks, and which blocks survive a
// short pane. It is deliberately the only place that math lives, so an
// alternative arrangement has one obvious home.

const (
	// navMinHeight: the navigator never shrinks below this. When it would,
	// docked blocks are dropped from the end of the block list instead.
	navMinHeight = 3
)

// arrangement is one frame's decision: which blocks render, and how many lines
// the navigator gets.
type arrangement struct {
	blocks   []blocks.Block
	navAvail int
}

// layout sizes the navigator to its ACTUAL content and lets the blocks float up
// directly beneath it, so everything the sidebar knows sits in one compact stack
// at the top of the pane and the unused space collects at the bottom.
//
// Two earlier versions both failed the same way, from opposite directions:
// giving the navigator all the leftover space, and giving it a fixed 60% share.
// A tall pane is much taller than the content -- on a 55-row pane a 3-session
// list left a 33-row void in the MIDDLE either way, between the last row and
// "▸ agents". There is no share of a 55-row pane that three sessions fill; the
// only fix is to stop reserving space the navigator cannot use.
//
// Leftover space is then offered to blocks that can show more of what they
// already hold (agents_glance drops its "+N more" and lists everything), because
// a "+1 more" above 30 blank rows is the same information-density failure in
// miniature.
func (m *model) layout(usable int) arrangement {
	for _, b := range m.docked {
		if e, ok := b.(blocks.Expandable); ok {
			e.SetExtra(0) // recomputed below; layout runs every frame
		}
	}

	// Drop blocks from the END of the list (lowest priority first, system_stats
	// before agents_glance) until they fit alongside a minimal navigator.
	active := m.docked
	for len(active) > 0 && dockCost(active) > usable-navMinHeight {
		active = active[:len(active)-1]
	}

	navAvail := m.navContentLines()
	if room := usable - dockCost(active); navAvail > room {
		navAvail = room // a long list is viewport-clipped instead
	}
	if navAvail < navMinHeight {
		navAvail = navMinHeight
	}

	for slack := usable - navAvail - dockCost(active); slack > 0; {
		grew := false
		for _, b := range active {
			e, ok := b.(blocks.Expandable)
			if !ok {
				continue
			}
			if used := e.Expand(slack); used > 0 {
				slack -= used
				grew = true
			}
		}
		if !grew {
			break
		}
	}
	return arrangement{blocks: active, navAvail: navAvail}
}

// dockCost is the lines the given blocks occupy, including one divider row each.
func dockCost(bs []blocks.Block) int {
	total := 0
	for _, b := range bs {
		total += b.Height() + 1
	}
	return total
}

// navContentLines is how many lines the current rows actually need. Rows are
// variable-height, so this is a sum, not a count.
func (m *model) navContentLines() int {
	if len(m.rows) == 0 {
		return 1 // the "(empty)" placeholder
	}
	total := 0
	for _, r := range m.rows {
		total += len(r.Lines)
	}
	return total
}
