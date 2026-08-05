package blocks

import "mm-sidebar/internal/theme"

// Deps is everything a block constructor may need. A new block that needs some
// other shared resource adds a field here rather than reaching for it directly,
// so the model stays the single owner of the resolver goroutine and the palette.
type Deps struct {
	Theme theme.Theme
	// Agents is the resolver goroutine's coalescing trigger. Buffered and
	// non-blocking: a nudge, not a queue.
	Agents chan<- struct{}
}

// Factory builds one block from the shared dependencies.
type Factory func(Deps) Block

// Factories is every docked block, in render order.
//
// That order is ALSO the degradation priority: on a short pane the layout drops
// blocks from the END of this slice first, protecting the navigator instead of
// squeezing everything unusably thin. Put a more important block earlier.
//
// ADDING A BLOCK IS ONE TYPE PLUS ONE ENTRY HERE -- no model.go edit. See
// mm-sidebar.md's "Extending" section for the recipe.
//
// The entries are wrapper closures rather than bare constructors because the
// constructors take different arguments (agents_glance needs the trigger channel,
// system_stats doesn't), so they aren't assignable to Factory directly.
var Factories = []Factory{
	func(d Deps) Block { return NewAgentsGlance(d.Theme, d.Agents) },
	func(d Deps) Block { return NewSystemStats(d.Theme) },
}

// Build instantiates every registered block, in order.
func Build(d Deps) []Block {
	out := make([]Block, 0, len(Factories))
	for _, f := range Factories {
		out = append(out, f(d))
	}
	return out
}
