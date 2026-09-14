package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/fsnotify/fsnotify"
)

// filetreeWatch owns the filesystem watches for the two-level filetree view.
// fsnotify is directory-scoped, so it watches the root (first-level entries)
// plus every immediate child directory (second-level entries). It deliberately
// does not recurse farther: those changes cannot alter the rendered rows.
type filetreeWatch struct {
	ctx context.Context

	roots      chan string
	events     chan struct{}
	configured chan struct{} // testable acknowledgement; never blocks production
	start      sync.Once
	close      sync.Once
	wg         sync.WaitGroup
}

func newFiletreeWatch(ctx context.Context) *filetreeWatch {
	return &filetreeWatch{
		ctx:        ctx,
		roots:      make(chan string, 1),
		events:     make(chan struct{}, 1),
		configured: make(chan struct{}, 1),
	}
}

func (w *filetreeWatch) Start() {
	w.start.Do(func() {
		w.wg.Add(1)
		go w.loop()
	})
}

// SetRoot is safe on Bubble Tea's update path: it only replaces a one-element
// desired-root mailbox. The worker owns all fsnotify mutation and OS calls.
func (w *filetreeWatch) SetRoot(root string) {
	root = filepath.Clean(root)
	if root == "." {
		root = ""
	}
	select {
	case <-w.ctx.Done():
		return
	default:
	}
	select {
	case <-w.roots:
	default:
	}
	select {
	case w.roots <- root:
	case <-w.ctx.Done():
	}
}

func (w *filetreeWatch) wait() tea.Cmd {
	return func() tea.Msg {
		select {
		case <-w.events:
			return filetreeChangedMsg{}
		case <-w.ctx.Done():
			return nil
		}
	}
}

func (w *filetreeWatch) Close() {
	w.close.Do(func() { w.wg.Wait() })
}

func (w *filetreeWatch) loop() {
	defer w.wg.Done()
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return
	}
	defer watcher.Close()

	watched := map[string]struct{}{}
	setRoot := func(root string) {
		desired := make(map[string]struct{})
		for _, path := range filetreeWatchDirs(root) {
			desired[path] = struct{}{}
			if _, ok := watched[path]; ok {
				continue
			}
			if err := watcher.Add(path); err == nil {
				watched[path] = struct{}{}
			}
		}
		// Add new watches before removing obsolete ones. For an unchanged root,
		// this leaves its watch continuously installed while child dirs change.
		for path := range watched {
			if _, ok := desired[path]; ok {
				continue
			}
			_ = watcher.Remove(path)
			delete(watched, path)
		}
	}

	for {
		select {
		case <-w.ctx.Done():
			return
		case root := <-w.roots:
			setRoot(root)
			select {
			case w.configured <- struct{}{}:
			default:
			}
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			// Backends remove a watch when its directory is renamed or deleted. Keep
			// the mirror honest so the next World refresh can re-add a recreated root
			// or child instead of treating a dead kernel watch as installed.
			if event.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
				delete(watched, filepath.Clean(event.Name))
			}
			select {
			case w.events <- struct{}{}:
			default: // the model already has a forced refresh pending
			}
		case _, ok := <-watcher.Errors:
			if !ok {
				return
			}
		}
	}
}

// filetreeWatchDirs returns exactly the directories whose immediate entries can
// appear in a two-level Filetree.Fetch. A symlinked directory is included using
// Stat, matching nav.readSplit's rendering classification.
func filetreeWatchDirs(root string) []string {
	if root == "" {
		return nil
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return nil
	}
	dirs := []string{root}
	entries, err := os.ReadDir(root)
	if err != nil {
		return dirs
	}
	for _, entry := range entries {
		path := filepath.Join(root, entry.Name())
		isDir := entry.IsDir()
		if entry.Type()&os.ModeSymlink != 0 {
			if target, err := os.Stat(path); err == nil {
				isDir = target.IsDir()
			}
		}
		if isDir {
			dirs = append(dirs, path)
		}
	}
	return dirs
}
