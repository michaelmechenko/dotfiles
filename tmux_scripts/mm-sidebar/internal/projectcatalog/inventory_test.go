package projectcatalog

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	wtapi "mm-sidebar/internal/worktrunk"
)

func TestInventoryBoundsConcurrentWorktrunkEnrichment(t *testing.T) {
	const workers = 3
	entries := make([]Entry, 10)
	for i := range entries {
		entries[i] = Entry{
			Root:      fmt.Sprintf("/missing/repo-%d", i),
			CommonDir: fmt.Sprintf("/missing/repo-%d/.git", i),
			Available: true,
		}
	}

	var active, peak atomic.Int32
	client := wtapi.Client{Timeout: time.Second, Run: func(ctx context.Context, _ string, _ ...string) ([]byte, error) {
		n := active.Add(1)
		defer active.Add(-1)
		for {
			old := peak.Load()
			if n <= old || peak.CompareAndSwap(old, n) {
				break
			}
		}
		<-ctx.Done()
		return nil, ctx.Err()
	}}
	catalog := New(Config{
		Path:             t.TempDir() + "/projects.json",
		InventoryTimeout: 30 * time.Millisecond,
		InventoryWorkers: workers,
	})

	started := time.Now()
	repositories := catalog.Inventory(entries, client)
	if elapsed := time.Since(started); elapsed > 500*time.Millisecond {
		t.Fatalf("inventory exceeded shared deadline: %s", elapsed)
	}
	if got := peak.Load(); got > workers {
		t.Fatalf("peak Worktrunk calls = %d, want <= %d", got, workers)
	}
	if len(repositories) != len(entries) {
		t.Fatalf("repositories = %d, want %d", len(repositories), len(entries))
	}
	for i, repo := range repositories {
		if repo.CommonDir != entries[i].CommonDir {
			t.Fatalf("repository %d order/identity changed: %#v", i, repo)
		}
		if len(repo.Worktrees) != 0 {
			t.Fatalf("missing fallback repository %d unexpectedly has worktrees", i)
		}
	}
}

func TestInventoryFallsBackPerRepository(t *testing.T) {
	catalog := New(Config{Path: t.TempDir() + "/projects.json"})
	entry := Entry{Root: t.TempDir(), CommonDir: "/expected/.git", Available: true}
	client := wtapi.Client{Run: func(context.Context, string, ...string) ([]byte, error) {
		return nil, errors.New("unavailable")
	}}
	got := catalog.Inventory([]Entry{entry}, client)
	if len(got) != 1 || got[0].CommonDir != entry.CommonDir {
		t.Fatalf("fallback lost repository: %#v", got)
	}
}
