// Package navview owns the pure, exact-height presentation policy for the
// sidebar navigator. It receives only already-collected semantic data; it never
// imports tmux, Git, Worktrunk, filesystem, or command execution packages.
package navview

// AllocationInput describes the post-chrome lines available to the main
// cockpit. Rows counts navigator lines; the remaining fields are desired line
// counts for already-renderable cached regions.
type AllocationInput struct {
	Height         int
	ViewportHeight int // full pane height; zero falls back to Height
	Rows           int
	MinNavigator   int
	Urgent         int
	Detail         int
	Working        int
	Activity       int
}

// Allocation is the exact number of lines granted to each main-surface region.
type Allocation struct {
	Navigator int
	Detail    int
	Urgent    int
	Working   int
	Activity  int
}

// Allocate applies the cockpit degradation order. Urgent blockers survive once
// the minimum navigator fits. Selected detail appears at medium heights, while
// ambient working/activity rows consume only slack left after the full
// navigator fits.
func Allocate(in AllocationInput) Allocation {
	if in.Height <= 0 {
		return Allocation{}
	}
	minimum := in.MinNavigator
	if minimum < 1 {
		minimum = 1
	}
	if in.Rows < minimum {
		minimum = in.Rows
	}
	if minimum < 1 {
		minimum = 1
	}

	out := Allocation{}
	remaining := in.Height
	if in.Urgent > 0 && remaining-in.Urgent >= minimum {
		out.Urgent = min(in.Urgent, remaining-minimum)
		remaining -= out.Urgent
	}

	viewportHeight := in.ViewportHeight
	if viewportHeight <= 0 {
		viewportHeight = in.Height
	}
	detailCap := 0
	switch {
	case viewportHeight >= 16:
		detailCap = min(in.Detail, 8)
	case viewportHeight >= 8:
		detailCap = min(in.Detail, 3)
	}
	if detailCap > 0 && remaining-detailCap >= minimum {
		out.Detail = detailCap
		remaining -= out.Detail
	}

	out.Navigator = min(in.Rows, remaining)
	if out.Navigator < 1 {
		out.Navigator = 1
	}
	remaining -= out.Navigator
	if remaining < 0 {
		remaining = 0
	}

	// Ambient sections are useful only when every navigator row fits. Dense
	// sources keep all remaining lines for navigation.
	if out.Navigator >= in.Rows {
		out.Working = min(in.Working, remaining)
		remaining -= out.Working
		out.Activity = min(in.Activity, remaining)
	}
	return out
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
