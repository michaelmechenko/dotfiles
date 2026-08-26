package projectcatalog

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDefaultPathUsesXDGStateHome(t *testing.T) {
	t.Setenv("XDG_STATE_HOME", "/tmp/state-home")
	if got, want := DefaultPath(), "/tmp/state-home/mm-sidebar/projects.json"; got != want {
		t.Fatalf("DefaultPath() = %q, want %q", got, want)
	}
}

func TestObserveMigratesLegacyArrayToSchemaOne(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	when := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	legacy := `[ {"root":"/repo","common_dir":"/repo/.git","last_seen":"` + when.Format(time.RFC3339Nano) + `"} ]`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	catalog := New(Config{Path: path, Now: func() time.Time { return when }, Resolve: testResolver(map[string]Identity{
		"/repo": {Root: "/repo", CommonDir: "/repo/.git"},
	})})
	entries, err := catalog.Observe(nil)
	if err != nil || len(entries) != 1 || !entries[0].Available {
		t.Fatalf("Observe = %#v, %v", entries, err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"schema": 1`) || strings.HasPrefix(strings.TrimSpace(string(data)), "[") {
		t.Fatalf("legacy state was not migrated: %s", data)
	}
}

func TestFutureAndCorruptStateArePreserved(t *testing.T) {
	for name, data := range map[string][]byte{
		"future":  []byte(`{"schema":2,"entries":[]}`),
		"corrupt": []byte(`{not json`),
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "projects.json")
			if err := os.WriteFile(path, data, 0o600); err != nil {
				t.Fatal(err)
			}
			_, err := New(Config{Path: path, Resolve: testResolver(nil)}).Observe([]string{"/repo"})
			if name == "future" && !errors.Is(err, ErrFutureSchema) {
				t.Fatalf("future error = %v", err)
			}
			if name == "corrupt" && !errors.Is(err, ErrCorrupt) {
				t.Fatalf("corrupt error = %v", err)
			}
			got, readErr := os.ReadFile(path)
			if readErr != nil || string(got) != string(data) {
				t.Fatalf("state changed after %v: %q (%v)", err, got, readErr)
			}
		})
	}
}

func TestAtomicWriteFailureLeavesPriorStateUntouched(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	original := []byte(`{"schema":1,"entries":[]}`)
	if err := os.WriteFile(path, original, 0o600); err != nil {
		t.Fatal(err)
	}
	catalog := New(Config{
		Path:    path,
		Resolve: testResolver(map[string]Identity{"/repo": {Root: "/repo", CommonDir: "/repo/.git"}}),
		Write:   func(string, []byte) error { return errors.New("disk full") },
	})
	if _, err := catalog.Observe([]string{"/repo"}); err == nil {
		t.Fatal("Observe succeeded despite injected atomic writer failure")
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(original) {
		t.Fatalf("prior state changed: %q (%v)", got, err)
	}
}

func TestCatalogOrderingRetentionAndPinned(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	identities := make(map[string]Identity)
	cwds := make([]string, 0, 22)
	for i := 0; i < 22; i++ {
		root := filepath.Join("/repo", string(rune('a'+i)))
		identities[root] = Identity{Root: root, CommonDir: root + "/.git"}
		cwds = append(cwds, root)
	}
	catalog := New(Config{Path: path, Now: func() time.Time { return now }, Resolve: testResolver(identities)})
	entries, err := catalog.Observe(cwds)
	if err != nil || len(entries) != maxUnpinned {
		t.Fatalf("retained entries=%d err=%v", len(entries), err)
	}
	// Make the oldest retained record pinned, then add more observations. Pinned
	// records survive the unpinned cap and always sort before recency.
	pinned := entries[len(entries)-1]
	if err := catalog.SetPinned(pinned.CommonDir, true); err != nil {
		t.Fatal(err)
	}
	entries, err = catalog.Observe(cwds)
	if err != nil || len(entries) != maxUnpinned+1 || !entries[0].Pinned || entries[0].CommonDir != pinned.CommonDir {
		t.Fatalf("pinned ordering/retention = %#v, %v", entries, err)
	}
}

func TestObserveClearsLiveForEntriesNotInCurrentObservation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	catalog := New(Config{Path: path, Resolve: testResolver(map[string]Identity{
		"/repo": {Root: "/repo", CommonDir: "/repo/.git"},
	})})
	if _, err := catalog.Observe([]string{"/repo"}); err != nil {
		t.Fatal(err)
	}
	entries, err := catalog.Observe(nil)
	if err != nil || len(entries) != 1 || entries[0].Live {
		t.Fatalf("unobserved entry remained live: %#v, %v", entries, err)
	}
}

func TestObserveKeepsExistingEntryLiveAfterEarlierAppend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	when := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	if err := atomicWrite(path, mustState(t, []Entry{{Root: "/existing", CommonDir: "/existing/.git", LastSeen: when}})); err != nil {
		t.Fatal(err)
	}
	catalog := New(Config{Path: path, Now: func() time.Time { return when }, Resolve: testResolver(map[string]Identity{
		"/new":      {Root: "/new", CommonDir: "/new/.git"},
		"/existing": {Root: "/existing", CommonDir: "/existing/.git"},
	})})
	entries, err := catalog.Observe([]string{"/new", "/existing"})
	if err != nil || len(entries) != 2 {
		t.Fatalf("Observe = %#v, %v", entries, err)
	}
	for _, entry := range entries {
		if entry.CommonDir == "/existing/.git" && entry.Live && entry.Available {
			return
		}
	}
	t.Fatalf("existing entry was not updated after append: %#v", entries)
}

func TestStoredRootsStayUnavailableUntilTheyResolveToExpectedCommonDir(t *testing.T) {
	path := filepath.Join(t.TempDir(), "projects.json")
	when := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	if err := atomicWrite(path, mustState(t, []Entry{{Root: "/repo", CommonDir: "/repo/.git", LastSeen: when}})); err != nil {
		t.Fatal(err)
	}
	identities := map[string]Identity{"/repo": {Root: "/repo", CommonDir: "/other/.git"}}
	catalog := New(Config{Path: path, Resolve: testResolver(identities)})
	entries, err := catalog.Observe(nil)
	if err != nil || len(entries) != 1 || entries[0].Available {
		t.Fatalf("reused root was trusted: %#v, %v", entries, err)
	}
	identities["/repo"] = Identity{Root: "/repo", CommonDir: "/repo/.git"}
	entries, err = catalog.Observe(nil)
	if err != nil || !entries[0].Available {
		t.Fatalf("expected root did not recover: %#v, %v", entries, err)
	}
}

func TestResolveGitCanonicalizesSymlinkedCommonDir(t *testing.T) {
	root := t.TempDir()
	if out, err := exec.Command("git", "-C", root, "init").CombinedOutput(); err != nil {
		t.Fatalf("git init: %v: %s", err, out)
	}
	link := filepath.Join(t.TempDir(), "linked-repo")
	if err := os.Symlink(root, link); err != nil {
		t.Fatal(err)
	}
	direct, err := ResolveGit(root)
	if err != nil {
		t.Fatal(err)
	}
	viaLink, err := ResolveGit(link)
	if err != nil {
		t.Fatal(err)
	}
	if direct.CommonDir != viaLink.CommonDir || direct.Root != viaLink.Root {
		t.Fatalf("symlink identities differ: direct=%#v link=%#v", direct, viaLink)
	}
}

func TestCatalogSiblingLockSerializesSeparateProcess(t *testing.T) {
	if os.Getenv("MM_SIDEBAR_LOCK_HELPER") == "1" {
		path := os.Getenv("MM_SIDEBAR_LOCK_PATH")
		ready := os.Getenv("MM_SIDEBAR_LOCK_READY")
		catalog := New(Config{Path: path})
		if err := catalog.withLock(func() error {
			if err := os.WriteFile(ready, []byte("ready"), 0o600); err != nil {
				return err
			}
			time.Sleep(250 * time.Millisecond)
			return nil
		}); err != nil {
			os.Exit(2)
		}
		os.Exit(0)
	}
	path := filepath.Join(t.TempDir(), "projects.json")
	ready := path + ".ready"
	cmd := exec.Command(os.Args[0], "-test.run=TestCatalogSiblingLockSerializesSeparateProcess")
	cmd.Env = append(os.Environ(), "MM_SIDEBAR_LOCK_HELPER=1", "MM_SIDEBAR_LOCK_PATH="+path, "MM_SIDEBAR_LOCK_READY="+ready)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	for deadline := time.Now().Add(time.Second); ; {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		if time.Now().After(deadline) {
			_ = cmd.Process.Kill()
			t.Fatal("lock helper did not become ready")
		}
		time.Sleep(5 * time.Millisecond)
	}
	started := time.Now()
	if err := New(Config{Path: path}).withLock(func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed < 150*time.Millisecond {
		t.Fatalf("sibling lock did not block: %s", elapsed)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal(err)
	}
}

func testResolver(items map[string]Identity) ResolveFunc {
	return func(path string) (Identity, error) {
		identity, ok := items[path]
		if !ok {
			return Identity{}, errors.New("not a repository")
		}
		return identity, nil
	}
}

func mustState(t *testing.T, entries []Entry) []byte {
	t.Helper()
	data, err := marshalState(entries)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
