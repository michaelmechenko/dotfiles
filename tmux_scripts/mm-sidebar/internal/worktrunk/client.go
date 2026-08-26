// Package worktrunk is the bounded, optional adapter for Worktrunk's stable
// schema-2 JSON. Git remains the sidebar's repository discovery authority.
package worktrunk

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

const defaultTimeout = 3 * time.Second

var (
	ErrUnavailable       = errors.New("worktrunk unavailable")
	ErrUnsupportedSchema = errors.New("unsupported worktrunk list schema")
)

// CommandRunner is injectable so tests never depend on an installed wt binary.
type CommandRunner func(context.Context, string, ...string) ([]byte, error)

// Client executes bounded Worktrunk commands. A zero Client uses wt from PATH.
type Client struct {
	Binary  string
	Timeout time.Duration
	Run     CommandRunner
}

func (c Client) binary() string {
	if c.Binary != "" {
		return c.Binary
	}
	return "wt"
}

func (c Client) timeout() time.Duration {
	if c.Timeout > 0 {
		return c.Timeout
	}
	return defaultTimeout
}

func (c Client) runner() CommandRunner {
	if c.Run != nil {
		return c.Run
	}
	return func(ctx context.Context, binary string, args ...string) ([]byte, error) {
		if _, err := exec.LookPath(binary); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		return exec.CommandContext(ctx, binary, args...).Output()
	}
}

// List returns local worktrees and local branch-only rows. It never requests
// --full, so CI and LLM summary collection remain disabled.
func (c Client) List(root string) (List, error) {
	return c.ListContext(context.Background(), root)
}

// ListContext lets a catalog-wide deadline bound several repository probes.
// The client's own timeout remains an upper bound when the parent is longer.
func (c Client) ListContext(parent context.Context, root string) (List, error) {
	timeout := c.timeout()
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	millis := strconv.FormatInt(timeout.Milliseconds(), 10)
	out, err := c.runner()(ctx, c.binary(),
		"-C", root,
		"--config-set", "list.json-schema=2",
		"--config-set", "list.timeout-ms="+millis,
		"list", "--branches", "--format=json",
	)
	if err != nil {
		return List{}, commandError(ctx, "list", err)
	}
	return ParseList(out)
}

// Switch materializes an existing local branch when needed and returns the
// resulting worktree path. It intentionally does not create branches, bypass
// hooks, approve commands, change the caller's cwd, merge, or remove anything.
func (c Client) Switch(root, branch string) (SwitchResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), c.timeout())
	defer cancel()

	out, err := c.runner()(ctx, c.binary(),
		"-C", root,
		"--config-set", "list.json-schema=2",
		"switch", branch, "--no-cd", "--format=json",
	)
	if err != nil {
		return SwitchResult{}, commandError(ctx, "switch", err)
	}
	var result SwitchResult
	if err := json.Unmarshal(out, &result); err != nil {
		return SwitchResult{}, fmt.Errorf("parse worktrunk switch: %w", err)
	}
	if result.Path == "" {
		return SwitchResult{}, errors.New("worktrunk switch returned no path")
	}
	return result, nil
}

func commandError(ctx context.Context, operation string, err error) error {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return fmt.Errorf("worktrunk %s timed out", operation)
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		message := strings.TrimSpace(string(exitErr.Stderr))
		if message != "" {
			if line, _, ok := strings.Cut(message, "\n"); ok {
				message = line
			}
			return fmt.Errorf("worktrunk %s: %s", operation, message)
		}
	}
	return fmt.Errorf("worktrunk %s: %w", operation, err)
}

// List is Worktrunk's schema-2 envelope. Fields omitted or null by Worktrunk
// remain nil rather than being guessed.
type List struct {
	Schema int    `json:"schema"`
	Repo   Repo   `json:"repo"`
	Items  []Item `json:"items"`
}

type Repo struct {
	DefaultBranch string `json:"default_branch"`
	Forge         *Forge `json:"forge"`
}

type Forge struct {
	Name string `json:"name"`
}

type Item struct {
	Branch        *string        `json:"branch"`
	Head          *Head          `json:"head"`
	Worktree      *Worktree      `json:"worktree"`
	DefaultBranch *DefaultBranch `json:"default_branch"`
	Upstream      *Upstream      `json:"upstream"`
	Display       Display        `json:"display"`
}

type Head struct {
	ShortSHA string `json:"short_sha"`
	Subject  string `json:"subject"`
}

type Worktree struct {
	Path            string   `json:"path"`
	Main            bool     `json:"main"`
	Current         bool     `json:"current"`
	Detached        bool     `json:"detached"`
	BranchMismatch  bool     `json:"branch_mismatch"`
	DuplicateBranch bool     `json:"duplicate_branch"`
	Locked          *Reason  `json:"locked"`
	Prunable        *Reason  `json:"prunable"`
	Operation       *string  `json:"operation"`
	Changes         *Changes `json:"changes"`
}

type Reason struct {
	Reason *string `json:"reason"`
}

type Changes struct {
	Staged     bool  `json:"staged"`
	Modified   bool  `json:"modified"`
	Untracked  bool  `json:"untracked"`
	Renamed    bool  `json:"renamed"`
	Deleted    bool  `json:"deleted"`
	Conflicted *bool `json:"conflicted"`
}

type DefaultBranch struct {
	Ahead          *int         `json:"ahead"`
	Behind         *int         `json:"behind"`
	Orphan         *bool        `json:"orphan"`
	MergeConflicts *bool        `json:"merge_conflicts"`
	Integration    *Integration `json:"integration"`
}

type Integration struct {
	Reason string `json:"reason"`
}

type Upstream struct {
	Remote string  `json:"remote"`
	Branch *string `json:"branch"`
	Ahead  int     `json:"ahead"`
	Behind int     `json:"behind"`
}

type Display struct {
	State   *string `json:"state"`
	Symbols *string `json:"symbols"`
}

type SwitchResult struct {
	Action string `json:"action"`
	Branch string `json:"branch"`
	Path   string `json:"path"`
}

func ParseList(out []byte) (List, error) {
	var list List
	if err := json.Unmarshal(out, &list); err != nil {
		return List{}, fmt.Errorf("parse worktrunk list: %w", err)
	}
	if list.Schema != 2 {
		return List{}, fmt.Errorf("%w: %d", ErrUnsupportedSchema, list.Schema)
	}
	return list, nil
}
