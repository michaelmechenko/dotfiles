package projectcatalog

import (
	"context"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"

	wtapi "mm-sidebar/internal/worktrunk"
)

// Repository is one retained catalog entry and its current discovered worktree
// inventory. Unavailable records intentionally have no children.
type Repository struct {
	Entry
	Worktrees []Worktree
}

// Worktree is rendering-neutral Git/Worktrunk inventory. WorktrunkItem is nil
// for the NUL-safe Git fallback, whose porcelain intentionally has less status
// metadata but remains the reliable discovery authority when wt is unavailable.
type Worktree struct {
	Path          string
	Branch        string
	RepoRoot      string
	CommonDir     string
	BranchOnly    bool
	Main          bool
	WorktrunkItem *wtapi.Item
}

// Inventory enriches retained catalog entries once per gated projects fetch.
// A small worker pool and one shared deadline bound total Worktrunk latency;
// Git's porcelain remains the deterministic per-repository fallback.
func (c *Catalog) Inventory(entries []Entry, worktrunk wtapi.Client) []Repository {
	repositories := make([]Repository, len(entries))
	if len(entries) == 0 {
		return repositories
	}

	ctx, cancel := context.WithTimeout(context.Background(), c.inventoryTimeout)
	defer cancel()
	workers := c.inventoryWorkers
	if workers > len(entries) {
		workers = len(entries)
	}
	jobs := make(chan int)
	var wg sync.WaitGroup
	wg.Add(workers)
	for range workers {
		go func() {
			defer wg.Done()
			for i := range jobs {
				entry := entries[i]
				repo := Repository{Entry: entry}
				if entry.Available {
					if list, err := worktrunk.ListContext(ctx, entry.Root); err == nil {
						repo.Worktrees = fromWorktrunk(entry, list)
					} else {
						repo.Worktrees = listGitWorktrees(entry)
					}
					sortWorktrees(repo.Worktrees)
				}
				repositories[i] = repo
			}
		}()
	}
	for i := range entries {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	return repositories
}

func fromWorktrunk(entry Entry, list wtapi.List) []Worktree {
	rows := make([]Worktree, 0, len(list.Items))
	seen := make(map[string]bool)
	for i := range list.Items {
		item := &list.Items[i]
		branch := "(detached)"
		if item.Branch != nil && *item.Branch != "" {
			branch = *item.Branch
		}
		row := Worktree{Branch: branch, RepoRoot: entry.Root, CommonDir: entry.CommonDir, WorktrunkItem: item}
		if item.Worktree == nil {
			if item.Branch == nil || *item.Branch == "" {
				continue
			}
			row.BranchOnly = true
		} else if item.Worktree.Path == "" {
			continue
		} else {
			row.Path, row.Main = item.Worktree.Path, item.Worktree.Main
		}
		key := row.Path
		if row.BranchOnly {
			key = "branch\x00" + row.Branch
		}
		if !seen[key] {
			seen[key] = true
			rows = append(rows, row)
		}
	}
	return rows
}

func listGitWorktrees(entry Entry) []Worktree {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "git", "-C", entry.Root, "worktree", "list", "--porcelain", "-z").Output()
	if err != nil || len(out) == 0 {
		return nil
	}
	var rows []Worktree
	var current *Worktree
	flush := func() {
		if current != nil && current.Path != "" {
			if current.Branch == "" {
				current.Branch = "(detached)"
			}
			current.RepoRoot, current.CommonDir = entry.Root, entry.CommonDir
			rows = append(rows, *current)
		}
		current = nil
	}
	for _, line := range strings.Split(string(out), "\x00") {
		if line == "" {
			flush()
			continue
		}
		key, value, ok := strings.Cut(line, " ")
		if !ok {
			continue
		}
		switch key {
		case "worktree":
			flush()
			current = &Worktree{Path: value}
		case "branch":
			if current != nil {
				current.Branch = strings.TrimPrefix(value, "refs/heads/")
			}
		case "detached":
			if current != nil {
				current.Branch = "(detached)"
			}
		}
	}
	flush()
	return rows
}

func sortWorktrees(rows []Worktree) {
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		if a.BranchOnly != b.BranchOnly {
			return !a.BranchOnly
		}
		if a.Main != b.Main {
			return a.Main
		}
		if a.Branch != b.Branch {
			return a.Branch < b.Branch
		}
		return a.Path < b.Path
	})
}
