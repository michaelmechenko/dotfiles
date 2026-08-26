package display

import "testing"

func TestSanitizeControlsPreservesUnicode(t *testing.T) {
	in := "a\x00\a\b\t\n\v\f\r\x1b\x1f\x7f\u0080\u009f中é"
	want := `a\x00\a\b\t\n\v\f\r\x1b\x1f\x7f\u0080\u009f中é`
	if got := Sanitize(in); got != want {
		t.Fatalf("Sanitize(%q) = %q, want %q", in, got, want)
	}
}

func TestSanitizeOrdinaryTextIsUnchanged(t *testing.T) {
	in := "plain 中 wide é combining"
	if got := Sanitize(in); got != in {
		t.Fatalf("Sanitize(%q) = %q", in, got)
	}
}
