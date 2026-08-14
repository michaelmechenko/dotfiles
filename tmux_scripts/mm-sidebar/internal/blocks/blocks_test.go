package blocks

import (
	"strings"
	"testing"

	"mm-sidebar/internal/theme"
)

// newTestBlocks builds every registered block with an inert theme and a
// buffered trigger channel, so a block whose Fetch does a non-blocking send has
// somewhere to send.
func newTestBlocks() []Block {
	return Build(Deps{
		Theme:  theme.Theme{},
		Agents: make(chan struct{}, 1),
	})
}

func lineCount(s string) int {
	if s == "" {
		return 1
	}
	return strings.Count(s, "\n") + 1
}

// TestViewEmitsExactlyHeightLines is the invariant the whole layout rests on:
// layout.go budgets space using Height() while View() supplies the actual rows,
// so any disagreement either shifts the frame or silently truncates a block.
//
// It runs over blocks.Factories rather than a hand-listed set, so a block added
// later is covered without touching this file.
func TestViewEmitsExactlyHeightLines(t *testing.T) {
	for _, b := range newTestBlocks() {
		for _, width := range []int{1, 10, 28, 36, 80, 200} {
			h, got := b.Height(), lineCount(b.View(width))
			if got != h {
				t.Errorf("%s.View(%d) emitted %d lines, Height() says %d",
					b.ID(), width, got, h)
			}
		}
	}
}

// TestHeightDoesNotFetch: layout calls Height() several times per frame, so it
// must read cached state only. A Height() that shelled out would make every
// render fork. Proxy check -- Height must be stable and instant across repeated
// calls with no intervening Update.
func TestHeightIsStableWithoutUpdate(t *testing.T) {
	for _, b := range newTestBlocks() {
		first := b.Height()
		for i := 0; i < 100; i++ {
			if got := b.Height(); got != first {
				t.Fatalf("%s.Height() unstable without an Update: %d then %d",
					b.ID(), first, got)
			}
		}
	}
}

// TestBlockIDsAreUnique: the tick router matches a tickMsg to its block by ID,
// so a duplicate would send one block's refresh to another and leave the twin
// permanently stale.
func TestBlockIDsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for _, b := range newTestBlocks() {
		if seen[b.ID()] {
			t.Errorf("duplicate block ID %q -- tickMsg routing is by ID", b.ID())
		}
		seen[b.ID()] = true
	}
}

// TestEveryBlockDeclaresAnInterval guards against a zero Interval, which would
// make tea.Tick reschedule in a tight loop.
func TestEveryBlockDeclaresAnInterval(t *testing.T) {
	for _, b := range newTestBlocks() {
		if b.Interval() <= 0 {
			t.Errorf("%s.Interval() is %v; a non-positive tick spins", b.ID(), b.Interval())
		}
	}
}

// ---- 2.2: the sysctl values are machine constants, cached once -------------

// TestMachineConstantsAreCached documents why cpuThreads/memTotal exist: they
// replaced two sysctl forks that ran on every 5s sample, forever, for values
// that cannot change while the process lives.
func TestMachineConstantsAreCached(t *testing.T) {
	threads, total := cpuThreads(), memTotal()
	if threads < 1 {
		t.Fatalf("cpuThreads() = %d, want >= 1 (it must fall back to 1)", threads)
	}
	for i := 0; i < 50; i++ {
		if cpuThreads() != threads || memTotal() != total {
			t.Fatal("machine constants changed between calls; the sync.Once cache is broken")
		}
	}
	t.Logf("cached: threads=%d memTotal=%d bytes", threads, total)
}

// TestGaugeNeverExceedsTrack: fill is derived from a percentage that sampleCPU
// can briefly report above 100, so the bar must clamp rather than build a
// negative-length track (which would panic in strings.Repeat).
func TestGaugeHandlesOutOfRangeValues(t *testing.T) {
	b := NewSystemStats(theme.Theme{})
	for _, v := range []int{-50, -1, 0, 1, 50, 99, 100, 101, 1000} {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("gauge(%d) panicked: %v", v, r)
				}
			}()
			b.gauge("cpu", clampPct(v), false)
		}()
	}
}
