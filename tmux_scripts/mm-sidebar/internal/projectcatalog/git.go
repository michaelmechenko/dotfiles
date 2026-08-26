package projectcatalog

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// ResolveGit resolves a path through Git and canonicalizes both the worktree
// root and its common directory. EvalSymlinks makes catalog identity stable
// when the same repository is reached through a symlinked worktree path.
func ResolveGit(path string) (Identity, error) {
	root, err := gitPath(path, "rev-parse", "--show-toplevel")
	if err != nil {
		return Identity{}, err
	}
	common, err := gitPath(root, "rev-parse", "--path-format=absolute", "--git-common-dir")
	if err != nil {
		return Identity{}, err
	}
	root, err = canonicalPath(root)
	if err != nil {
		return Identity{}, err
	}
	common, err = canonicalPath(common)
	if err != nil {
		return Identity{}, err
	}
	return Identity{Root: root, CommonDir: common}, nil
}

func gitPath(dir string, args ...string) (string, error) {
	out, err := exec.Command("git", append([]string{"-C", dir}, args...)...).Output()
	if err != nil {
		return "", err
	}
	path := strings.TrimSuffix(strings.TrimSuffix(string(out), "\n"), "\r")
	if path == "" {
		return "", fmt.Errorf("git returned an empty path")
	}
	return path, nil
}

func canonicalPath(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	return filepath.Clean(resolved), nil
}
