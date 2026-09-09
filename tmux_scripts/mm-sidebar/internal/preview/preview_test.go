package preview

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestPathPreviewBoundsAndSanitizesText(t *testing.T) {
	path := filepath.Join(t.TempDir(), "text.txt")
	body := "one\n\x1b[31mtwo\x1b[0m\nthree\nfour\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := Render(path, Limits{Bytes: 64, Lines: 3, Entries: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Lines) != 3 || !result.Truncated || strings.Contains(strings.Join(result.Lines, ""), "\x1b") {
		t.Fatalf("bounded text result = %#v", result)
	}
	if !strings.Contains(result.Lines[1], `\x1b[31mtwo\x1b[0m`) {
		t.Fatalf("controls were not rendered inert: %#v", result.Lines)
	}
}

func TestPathPreviewBoundsDirectoryEntries(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"a", "b", "c"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	result, err := Render(root, Limits{Bytes: 64, Lines: 10, Entries: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Lines) != 2 || result.Lines[0] > result.Lines[1] || !result.Truncated {
		t.Fatalf("bounded directory result = %#v", result)
	}
}

func TestPathPreviewHandlesSymlinksBinaryInvalidUTF8AndVanishedPaths(t *testing.T) {
	root := t.TempDir()
	text := filepath.Join(root, "text")
	if err := os.WriteFile(text, []byte{'o', 'k', '\n', 0xff}, 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(text, link); err != nil {
		t.Fatal(err)
	}
	result, err := Render(link, Limits{})
	if err != nil || len(result.Lines) == 0 || !strings.Contains(result.Lines[1], "�") {
		t.Fatalf("symlink/invalid UTF-8 result = %#v, %v", result, err)
	}
	binary := filepath.Join(root, "binary")
	if err := os.WriteFile(binary, []byte{'a', 0, 'b'}, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Render(binary, Limits{}); err == nil || !strings.Contains(err.Error(), "binary") {
		t.Fatalf("binary error = %v", err)
	}
	if _, err := Render(filepath.Join(root, "gone"), Limits{}); err == nil {
		t.Fatal("vanished path was accepted")
	}
}

func TestPathPreviewRejectsSpecialFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pipe")
	if err := syscall.Mkfifo(path, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Render(path, Limits{}); err == nil || !strings.Contains(err.Error(), "special") {
		t.Fatalf("special-file error = %v", err)
	}
}

func TestPathPreviewCapsBytes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "large")
	if err := os.WriteFile(path, []byte(strings.Repeat("x", 100)), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := Render(path, Limits{Bytes: 8, Lines: 10, Entries: 10})
	if err != nil || !result.Truncated || len(result.Lines) != 1 || len(result.Lines[0]) > 8 {
		t.Fatalf("byte-capped result = %#v, %v", result, err)
	}
}
