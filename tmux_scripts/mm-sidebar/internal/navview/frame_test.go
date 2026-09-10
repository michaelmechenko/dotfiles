package navview

import (
	"testing"

	"mm-sidebar/internal/nav"
	"mm-sidebar/internal/theme"
)

func TestAllocateAdaptiveCockpitBranches(t *testing.T) {
	tests := []struct {
		name string
		in   AllocationInput
		want Allocation
	}{
		{
			name: "short keeps navigator and urgent only",
			in:   AllocationInput{Height: 5, Rows: 8, MinNavigator: 3, Urgent: 2, Detail: 6, Working: 3, Activity: 4},
			want: Allocation{Navigator: 3, Urgent: 2},
		},
		{
			name: "medium adds compact detail but no ambient",
			in:   AllocationInput{Height: 12, Rows: 20, MinNavigator: 3, Urgent: 0, Detail: 6, Working: 3, Activity: 4},
			want: Allocation{Navigator: 9, Detail: 3},
		},
		{
			name: "tall sparse view uses meaningful slack",
			in:   AllocationInput{Height: 24, Rows: 4, MinNavigator: 3, Urgent: 0, Detail: 6, Working: 3, Activity: 5},
			want: Allocation{Navigator: 4, Detail: 6, Working: 3, Activity: 5},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Allocate(tt.in); got != tt.want {
				t.Fatalf("Allocate(%+v) = %+v, want %+v", tt.in, got, tt.want)
			}
		})
	}
}

func TestLegacyMultilineFallbackKeepsSelectionVisible(t *testing.T) {
	rows := []nav.Row{
		{ID: "one", Lines: []string{"one", "one detail"}},
		{ID: "two", Lines: []string{"two", "two detail"}},
		{ID: "three", Lines: []string{"three", "three detail"}},
	}
	frame := RenderList(rows, 30, 3, 2, 0, true, theme.Theme{})
	if frame.Start != 2 || frame.Hits[0] != 2 {
		t.Fatalf("legacy viewport start=%d hits=%v lines=%v", frame.Start, frame.Hits, frame.Lines)
	}
}

func TestAllocateNeverAddsAmbientUntilNavigatorFits(t *testing.T) {
	got := Allocate(AllocationInput{Height: 24, Rows: 30, MinNavigator: 3, Detail: 6, Working: 4, Activity: 6})
	if got.Navigator != 18 || got.Detail != 6 || got.Working != 0 || got.Activity != 0 {
		t.Fatalf("dense allocation = %+v", got)
	}
}
