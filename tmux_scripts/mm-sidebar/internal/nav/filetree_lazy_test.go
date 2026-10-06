package nav

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFiletreeExpandsOneMaterializedDirectoryAtATime(t *testing.T) {
	root := t.TempDir()
	a := filepath.Join(root, "a")
	b := filepath.Join(a, "b")
	if err := os.MkdirAll(b, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(b, "leaf.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	tree := NewFiletree()
	ctx := Ctx{Root: root}
	rows, err := tree.Fetch(ctx)
	if err != nil || len(rows) != 1 || rows[0].Path != a {
		t.Fatalf("initial rows=%#v err=%v", rows, err)
	}
	if control, ok := tree.HandleRowKey("right", rows[0], ctx); !ok || !control.Refresh || !control.Loading || control.SelectFirstChildOf != rows[0].ID {
		t.Fatalf("right control=%#v handled=%t", control, ok)
	}
	rows, err = tree.Fetch(ctx)
	if err != nil || len(rows) != 2 || rows[1].Path != b || rows[1].ParentID != rows[0].ID {
		t.Fatalf("first expansion=%#v err=%v", rows, err)
	}
	for _, row := range rows {
		if strings.Contains(row.Path, "leaf.txt") {
			t.Fatalf("collapsed grandchild was read: %#v", rows)
		}
	}
	if _, ok := tree.HandleRowKey("space", rows[1], ctx); !ok {
		t.Fatal("Space did not toggle nested directory")
	}
	rows, err = tree.Fetch(ctx)
	if err != nil || len(rows) != 3 || filepath.Base(rows[2].Path) != "leaf.txt" || rows[2].ParentID != rows[1].ID {
		t.Fatalf("nested expansion=%#v err=%v", rows, err)
	}
	if control, ok := tree.HandleRowKey("left", rows[2], ctx); !ok || control.SelectID != rows[1].ID {
		t.Fatalf("file left control=%#v handled=%t", control, ok)
	}
}

func TestFiletreeCollapseDropsDescendantWorkAndWatches(t *testing.T) {
	root := t.TempDir()
	a := filepath.Join(root, "a")
	b := filepath.Join(a, "b")
	if err := os.MkdirAll(b, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(b, "leaf.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	tree := NewFiletree()
	ctx := Ctx{Root: root}
	rows, err := tree.Fetch(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = tree.HandleRowKey("space", rows[0], ctx)
	rows, err = tree.Fetch(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = tree.HandleRowKey("space", rows[1], ctx)
	if _, err = tree.Fetch(ctx); err != nil {
		t.Fatal(err)
	}
	// Collapsing a must drop b's open key rather than leaving an invisible
	// descendant eligible for later invalidation reads or fsnotify watches.
	_, _ = tree.HandleRowKey("left", rows[0], ctx)
	tree.state.mu.Lock()
	_, aOpen := tree.state.expanded[a]
	_, bOpen := tree.state.expanded[b]
	tree.state.mu.Unlock()
	if aOpen || bOpen {
		t.Fatalf("collapsed branch retained expansion keys: a=%t b=%t", aOpen, bOpen)
	}
	for _, path := range tree.WatchPaths(ctx) {
		if path == a || path == b {
			t.Fatalf("collapsed branch remains watched: %#v", tree.WatchPaths(ctx))
		}
	}
	tree.Invalidate()
	if _, err := tree.Fetch(ctx); err != nil {
		t.Fatal(err)
	}
	tree.state.mu.Lock()
	_, bLoaded := tree.state.nodes[b]
	tree.state.mu.Unlock()
	if bLoaded {
		t.Fatal("collapsed descendant was re-read after invalidation")
	}
}

func TestFiletreeFilterRevealsCachedCollapsedDescendants(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "parent")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "needle.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	tree := NewFiletree()
	ctx := Ctx{Root: root}
	rows, err := tree.Fetch(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := tree.HandleRowKey("space", rows[0], ctx); !ok {
		t.Fatal("expand parent")
	}
	rows, err = tree.Fetch(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := tree.HandleRowKey("space", rows[0], ctx); !ok {
		t.Fatal("collapse parent")
	}
	rows, err = tree.Fetch(ctx)
	if err != nil || len(rows) != 1 || rows[0].Path != dir {
		t.Fatalf("collapsed rows=%#v err=%v", rows, err)
	}
	if watched := tree.WatchPaths(ctx); len(watched) != 1 || watched[0] != root {
		t.Fatalf("collapsed tree watches=%#v, want only root", watched)
	}

	got := tree.FilterRows(rows, "needle")
	if len(got) != 2 || got[0].ID != rows[0].ID || filepath.Base(got[1].Path) != "needle.txt" {
		t.Fatalf("filtered rows=%#v, want collapsed parent and cached matching child", got)
	}
	if restored := tree.FilterRows(rows, ""); len(restored) != 1 || restored[0].ID != rows[0].ID {
		t.Fatalf("cleared filter did not restore collapsed rows: %#v", restored)
	}
}

func TestFiletreeBlocksSymlinkAncestorCycle(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "dir")
	if err := os.Mkdir(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	loop := filepath.Join(dir, "loop")
	if err := os.Symlink(root, loop); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	tree := NewFiletree()
	ctx := Ctx{Root: root}
	rows, err := tree.Fetch(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = tree.HandleRowKey("space", rows[0], ctx)
	rows, err = tree.Fetch(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || !rows[1].TreeCycle {
		t.Fatalf("cycle row=%#v", rows)
	}
	if control, ok := tree.HandleRowKey("right", rows[1], ctx); !ok || control.Refresh {
		t.Fatalf("cycle expansion control=%#v handled=%t", control, ok)
	}
}

func TestFiletreeStopsAtDepthLimitWithoutReadingDeeperDescendants(t *testing.T) {
	root := t.TempDir()
	path := root
	for i := 0; i < filetreeDepthLimit+2; i++ {
		path = filepath.Join(path, fmt.Sprintf("d%02d", i))
		if err := os.Mkdir(path, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	tree := NewFiletree()
	ctx := Ctx{Root: root}
	rows, err := tree.Fetch(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i <= filetreeDepthLimit; i++ {
		row := rows[len(rows)-1]
		if _, ok := tree.HandleRowKey("space", row, ctx); !ok {
			t.Fatalf("depth %d row was not expandable: %#v", i, row)
		}
		rows, err = tree.Fetch(ctx)
		if err != nil {
			t.Fatal(err)
		}
	}
	last := rows[len(rows)-1]
	if !strings.Contains(last.SearchText, "depth limit reached") {
		t.Fatalf("depth limit row missing: %#v", last)
	}
	tree.state.mu.Lock()
	_, loaded := tree.state.nodes[path]
	tree.state.mu.Unlock()
	if loaded {
		t.Fatalf("node below depth limit was read: %s", path)
	}
}

func TestFiletreeReportsEntryLimit(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < filetreeEntryLimit+1; i++ {
		if err := os.WriteFile(filepath.Join(root, "f"+fmt.Sprintf("%03d", i)), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := NewFiletree().Fetch(Ctx{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, row := range rows {
		if strings.Contains(row.SearchText, "entry limit reached") {
			found = true
		}
	}
	if !found {
		t.Fatalf("entry limit state missing from %d rows", len(rows))
	}
}
