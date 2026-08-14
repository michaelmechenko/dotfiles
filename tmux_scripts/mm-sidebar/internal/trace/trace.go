// Package trace is the sidebar's per-phase timing instrument, enabled with
// MMS_TRACE=1 and written to stderr.
//
// It used to live inside internal/agents, which is exactly why the navigator's
// own cost went unnoticed for so long: the agent sweep was the only thing that
// could be measured, so it was the only thing anyone looked at -- while
// refreshState quietly shelled tmux-fzf-nav (itself ~4 more processes) every
// two seconds regardless of whether anything had changed. Instrument-the-part-
// you-suspect is how you keep missing the part you don't.
//
// It also exists because a resolve was once observed taking far longer than its
// parts should (a 1.3s outlier in 8 runs, and one unreproducible 62s on a
// heavily loaded machine). Sweeps are off the input path, so an outlier costs
// freshness rather than responsiveness -- but "which of tmux / ps / lsof
// stalled" should be an observation, not a guess.
//
// Use it before theorizing about a slow anything.
package trace

import (
	"fmt"
	"os"
	"time"
)

// Enabled reports whether MMS_TRACE=1 was set. Callers check it before building
// any string a disabled trace would throw away.
var Enabled = os.Getenv("MMS_TRACE") == "1"

// Phase logs how long has elapsed since start, as "mms-trace <phase> <ms>".
// Call it as `defer trace.Phase("name", time.Now())` for a whole function, or
// inline against a saved start time for a single step. Nested phases are
// conventionally indented two spaces in their name.
func Phase(phase string, start time.Time) {
	if !Enabled {
		return
	}
	fmt.Fprintf(os.Stderr, "mms-trace %-16s %6.1fms\n",
		phase, float64(time.Since(start).Microseconds())/1000)
}
