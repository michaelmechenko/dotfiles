// Package projectcatalog owns the sidebar's persistent repository inventory.
// It deliberately knows nothing about rows, tmux, Worktrunk, or rendering.
package projectcatalog

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	schemaVersion = 1
	maxUnpinned   = 20
)

var (
	ErrCorrupt      = errors.New("project catalog is corrupt")
	ErrFutureSchema = errors.New("project catalog has a newer schema")
)

// Identity is Git's canonical repository identity and one usable representative
// worktree root. CommonDir is always absolute and symlink-resolved.
type Identity struct {
	Root      string
	CommonDir string
}

// ResolveFunc resolves a directory inside a Git worktree to its identity.
type ResolveFunc func(string) (Identity, error)

// Entry is a persisted catalog record plus its current availability. Available
// and Live are observations and are intentionally not written to disk.
type Entry struct {
	Root      string
	CommonDir string
	Pinned    bool
	LastSeen  time.Time
	Available bool
	Live      bool
}

// Config permits deterministic tests without changing production behaviour.
type Config struct {
	Path    string
	Now     func() time.Time
	Resolve ResolveFunc
	// InventoryTimeout bounds all Worktrunk enrichment in one gated fetch.
	InventoryTimeout time.Duration
	// InventoryWorkers bounds concurrent repository probes.
	InventoryWorkers int
	// Write overrides the default durable atomic writer. It is intended only for
	// failure-injection tests; callers remain responsible for durable semantics.
	Write func(string, []byte) error
}

// Catalog is safe across processes through a stable sibling flock. It has no
// background work: observations happen only during an explicit projects fetch.
type Catalog struct {
	path             string
	lock             string
	now              func() time.Time
	resolve          ResolveFunc
	inventoryTimeout time.Duration
	inventoryWorkers int
	write            func(string, []byte) error
	mu               sync.Mutex
}

func New(cfg Config) *Catalog {
	path := cfg.Path
	if path == "" {
		path = DefaultPath()
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	resolve := cfg.Resolve
	if resolve == nil {
		resolve = ResolveGit
	}
	inventoryTimeout := cfg.InventoryTimeout
	if inventoryTimeout <= 0 {
		inventoryTimeout = 3 * time.Second
	}
	inventoryWorkers := cfg.InventoryWorkers
	if inventoryWorkers <= 0 {
		inventoryWorkers = 4
	}
	write := cfg.Write
	if write == nil {
		write = atomicWrite
	}
	return &Catalog{
		path: path, lock: path + ".lock", now: now, resolve: resolve,
		inventoryTimeout: inventoryTimeout, inventoryWorkers: inventoryWorkers, write: write,
	}
}

// DefaultPath returns the XDG state location without creating it.
func DefaultPath() string {
	stateHome := os.Getenv("XDG_STATE_HOME")
	if stateHome == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			home = os.Getenv("HOME")
		}
		stateHome = filepath.Join(home, ".local", "state")
	}
	return filepath.Join(stateHome, "mm-sidebar", "projects.json")
}

// Path exposes the state file location for diagnostics and focused tests.
func (c *Catalog) Path() string { return c.path }

// Resolve resolves a root or cwd with this catalog's canonical resolver.
func (c *Catalog) Resolve(path string) (Identity, error) { return c.resolve(path) }

// Observe merges live cwd observations into the catalog and returns all retained
// records. Stored roots are revalidated on every fetch: unavailable records stay
// visible/forgettable but never redirect actions to a replacement repository.
func (c *Catalog) Observe(cwds []string) ([]Entry, error) {
	var entries []Entry
	err := c.withLock(func() error {
		state, exists, migrated, err := readState(c.path)
		if err != nil {
			return err
		}
		changed := migrated
		// Keep indexes rather than pointers: appending a newly observed repository
		// can reallocate state, invalidating pointers into its backing array.
		byCommon := make(map[string]int, len(state))
		for i := range state {
			// Live is a snapshot of this observation pass, never durable state.
			// Clear it before marking only currently observed repositories live.
			state[i].Live = false
			state[i].Available = c.valid(&state[i])
			byCommon[state[i].CommonDir] = i
		}
		now := c.now().UTC()
		for _, cwd := range unique(cwds) {
			id, err := c.resolve(cwd)
			if err != nil {
				continue // non-Git and vanished pane cwd values are not catalog entries
			}
			index, ok := byCommon[id.CommonDir]
			if !ok {
				state = append(state, Entry{Root: id.Root, CommonDir: id.CommonDir})
				index = len(state) - 1
				byCommon[id.CommonDir] = index
				changed = true
			}
			entry := &state[index]
			if entry.Root != id.Root || !entry.Available || !entry.Live || !entry.LastSeen.Equal(now) {
				entry.Root, entry.CommonDir, entry.Available, entry.Live, entry.LastSeen = id.Root, id.CommonDir, true, true, now
				changed = true
			}
		}
		state = retain(state)
		if len(state) != len(byCommon) {
			changed = true
		}
		if changed || (!exists && len(state) > 0) {
			if err := c.writeState(state); err != nil {
				return err
			}
		}
		entries = ordered(state)
		return nil
	})
	return entries, err
}

// SetPinned changes one existing catalog record. It returns an error for a
// missing record rather than creating a path not observed by the navigator.
func (c *Catalog) SetPinned(common string, pinned bool) error {
	return c.mutate(func(entries []Entry) ([]Entry, bool, error) {
		for i := range entries {
			if entries[i].CommonDir == common {
				if entries[i].Pinned == pinned {
					return entries, false, nil
				}
				entries[i].Pinned = pinned
				return entries, true, nil
			}
		}
		return entries, false, fmt.Errorf("project catalog entry no longer exists")
	})
}

// Forget removes one record after the caller has checked live panes at the
// action boundary. Catalog remains deliberately independent from tmux.
func (c *Catalog) Forget(common string) error {
	return c.mutate(func(entries []Entry) ([]Entry, bool, error) {
		for i := range entries {
			if entries[i].CommonDir == common {
				return append(entries[:i:i], entries[i+1:]...), true, nil
			}
		}
		return entries, false, fmt.Errorf("project catalog entry no longer exists")
	})
}

func (c *Catalog) mutate(change func([]Entry) ([]Entry, bool, error)) error {
	return c.withLock(func() error {
		entries, _, migrated, err := readState(c.path)
		if err != nil {
			return err
		}
		entries, changed, err := change(entries)
		if err != nil {
			return err
		}
		entries = retain(entries)
		if changed || migrated {
			return c.writeState(entries)
		}
		return nil
	})
}

func (c *Catalog) valid(entry *Entry) bool {
	id, err := c.resolve(entry.Root)
	return err == nil && id.CommonDir == entry.CommonDir
}

func (c *Catalog) writeState(entries []Entry) error {
	data, err := marshalState(entries)
	if err != nil {
		return err
	}
	return c.write(c.path, data)
}

func (c *Catalog) withLock(fn func() error) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(c.path), 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(c.lock, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
	return fn()
}

type diskState struct {
	Schema  int         `json:"schema"`
	Entries []diskEntry `json:"entries"`
}

type diskEntry struct {
	Root      string `json:"root"`
	CommonDir string `json:"common_dir"`
	Pinned    bool   `json:"pinned,omitempty"`
	LastSeen  string `json:"last_seen"`
}

func readState(path string) ([]Entry, bool, bool, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, false, nil
	}
	if err != nil {
		return nil, false, false, err
	}
	var legacy []diskEntry
	if err := json.Unmarshal(data, &legacy); err == nil && legacy != nil {
		entries, err := decodeEntries(legacy)
		return entries, true, true, err
	}
	var state diskState
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, true, false, fmt.Errorf("%w: %v", ErrCorrupt, err)
	}
	if state.Schema > schemaVersion {
		return nil, true, false, fmt.Errorf("%w: %d", ErrFutureSchema, state.Schema)
	}
	if state.Schema != schemaVersion {
		return nil, true, false, fmt.Errorf("%w: unsupported schema %d", ErrCorrupt, state.Schema)
	}
	entries, err := decodeEntries(state.Entries)
	return entries, true, false, err
}

func decodeEntries(items []diskEntry) ([]Entry, error) {
	entries := make([]Entry, 0, len(items))
	seen := make(map[string]bool)
	for _, item := range items {
		if item.Root == "" || item.CommonDir == "" || seen[item.CommonDir] {
			return nil, fmt.Errorf("%w: invalid duplicate or empty entry", ErrCorrupt)
		}
		seen[item.CommonDir] = true
		lastSeen, err := time.Parse(time.RFC3339Nano, item.LastSeen)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid last_seen: %v", ErrCorrupt, err)
		}
		entries = append(entries, Entry{Root: item.Root, CommonDir: item.CommonDir, Pinned: item.Pinned, LastSeen: lastSeen.UTC()})
	}
	return entries, nil
}

func marshalState(entries []Entry) ([]byte, error) {
	disk := make([]diskEntry, 0, len(entries))
	for _, entry := range entries {
		disk = append(disk, diskEntry{Root: entry.Root, CommonDir: entry.CommonDir, Pinned: entry.Pinned, LastSeen: entry.LastSeen.UTC().Format(time.RFC3339Nano)})
	}
	return json.MarshalIndent(diskState{Schema: schemaVersion, Entries: disk}, "", "  ")
}

func atomicWrite(path string, data []byte) error {
	dir := filepath.Dir(path)
	file, err := os.CreateTemp(dir, ".projects.json-")
	if err != nil {
		return err
	}
	tmp := file.Name()
	defer os.Remove(tmp)
	if err := file.Chmod(0o600); err != nil {
		file.Close()
		return err
	}
	if _, err := file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err := file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	if err := d.Sync(); err != nil && !unsupportedSync(err) {
		return err
	}
	return nil
}

func unsupportedSync(err error) bool {
	return errors.Is(err, syscall.EINVAL) || errors.Is(err, syscall.ENOTSUP) || errors.Is(err, syscall.ENOSYS)
}

func retain(entries []Entry) []Entry {
	entries = append([]Entry(nil), entries...)
	sort.SliceStable(entries, func(i, j int) bool { return less(entries[i], entries[j]) })
	unpinned := 0
	out := entries[:0]
	for _, entry := range entries {
		if !entry.Pinned {
			if unpinned >= maxUnpinned {
				continue
			}
			unpinned++
		}
		out = append(out, entry)
	}
	return out
}

func ordered(entries []Entry) []Entry {
	out := append([]Entry(nil), entries...)
	sort.SliceStable(out, func(i, j int) bool { return less(out[i], out[j]) })
	return out
}

func less(a, b Entry) bool {
	if a.Pinned != b.Pinned {
		return a.Pinned
	}
	if !a.LastSeen.Equal(b.LastSeen) {
		return a.LastSeen.After(b.LastSeen)
	}
	an, bn := strings.ToLower(filepath.Base(a.Root)), strings.ToLower(filepath.Base(b.Root))
	if an != bn {
		return an < bn
	}
	if a.Root != b.Root {
		return a.Root < b.Root
	}
	return a.CommonDir < b.CommonDir
}

func unique(values []string) []string {
	seen := make(map[string]bool, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" && !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out
}
