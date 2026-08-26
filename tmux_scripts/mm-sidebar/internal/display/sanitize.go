// Package display makes externally supplied text safe to render in the sidebar.
package display

import (
	"fmt"
	"strings"
)

// Sanitize replaces terminal control code points with visible ASCII escapes.
// It leaves ordinary Unicode untouched, including combining marks and wide
// glyphs, so width-aware rendering still reflects the user's actual text.
//
// This must run before Lip Gloss styles are applied. Escaping styled output
// would also escape the ANSI styling the sidebar intentionally emits.
func Sanitize(s string) string {
	var out strings.Builder
	out.Grow(len(s))
	for _, r := range s {
		switch r {
		case '\a':
			out.WriteString(`\a`)
		case '\b':
			out.WriteString(`\b`)
		case '\t':
			out.WriteString(`\t`)
		case '\n':
			out.WriteString(`\n`)
		case '\v':
			out.WriteString(`\v`)
		case '\f':
			out.WriteString(`\f`)
		case '\r':
			out.WriteString(`\r`)
		case 0x1b:
			out.WriteString(`\x1b`)
		default:
			switch {
			case r < 0x20 || r == 0x7f:
				fmt.Fprintf(&out, `\x%02x`, r)
			case r >= 0x80 && r <= 0x9f:
				fmt.Fprintf(&out, `\u%04x`, r)
			default:
				out.WriteRune(r)
			}
		}
	}
	return out.String()
}
