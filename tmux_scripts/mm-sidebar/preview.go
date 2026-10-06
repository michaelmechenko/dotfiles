package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"mm-sidebar/internal/display"
	"mm-sidebar/internal/preview"
)

const previewPathEnv = "MM_SIDEBAR_PREVIEW_PATH"

var previewLookPath = exec.LookPath

const (
	previewCommandTimeout = 5 * time.Second
	previewStderrLimit    = 8 << 10
)

// runPreview runs only inside a display-popup. Register termination handling
// before any filesystem read or child process so every normal interruption
// removes the private snapshot directory.
func runPreview() int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGHUP, syscall.SIGTERM)
	defer stop()
	if err := runPreviewPathContext(ctx, os.Getenv(previewPathEnv)); err != nil {
		// display-popup -E would otherwise erase a subprocess/render error before
		// it is legible. Keep this bounded local failure surface until Enter or a
		// termination signal; successful pager exits retain the normal auto-close.
		showPreviewFailure(ctx, err)
		return 1
	}
	return 0
}

func runPreviewPath(path string) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGHUP, syscall.SIGTERM)
	defer stop()
	return runPreviewPathContext(ctx, path)
}

func showPreviewFailure(ctx context.Context, err error) {
	fmt.Fprintf(os.Stderr, "mm-sidebar preview: %s\n\nPress Enter to close.\n", display.Sanitize(err.Error()))
	entered := make(chan struct{}, 1)
	go func() {
		var input [1]byte
		_, _ = os.Stdin.Read(input[:])
		entered <- struct{}{}
	}()
	select {
	case <-ctx.Done():
	case <-entered:
	}
}

func runPreviewPathContext(ctx context.Context, path string) error {
	if err := ctx.Err(); err != nil {
		return nil
	}
	if path == "" || strings.IndexByte(path, 0) >= 0 {
		return fmt.Errorf("missing preview path")
	}
	result, err := preview.Render(path, preview.Limits{})
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return nil
	}
	dir, err := os.MkdirTemp("", "mm-sidebar-preview-")
	if err != nil {
		return fmt.Errorf("create private preview directory: %w", err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		_ = os.RemoveAll(dir)
		return fmt.Errorf("protect preview directory: %w", err)
	}
	defer os.RemoveAll(dir)

	title := result.Title
	if title == "" {
		title = "preview.txt"
	}
	snapshot := filepath.Join(dir, "snapshot")
	body := append([]string(nil), result.Lines...)
	if len(body) == 0 {
		body = append(body, result.Empty)
	}
	if result.Truncated {
		body = append(body, "(truncated)")
	}
	if err := os.WriteFile(snapshot, []byte(strings.Join(body, "\n")+"\n"), 0o600); err != nil {
		return fmt.Errorf("write preview snapshot: %w", err)
	}
	if err := os.Chmod(snapshot, 0o600); err != nil {
		return fmt.Errorf("protect preview snapshot: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil
	}

	styled := filepath.Join(dir, "styled")
	if err := syntaxSnapshot(ctx, snapshot, styled, title); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return nil
	}
	return pageSnapshot(ctx, dir, styled)
}

// syntaxSnapshot falls back to the already-sanitized private snapshot when bat
// is unavailable. Preview remains useful on minimal hosts without reopening the
// live selected path.
func syntaxSnapshot(ctx context.Context, snapshot, styled, title string) error {
	bat, err := previewLookPath("bat")
	if err != nil {
		return copyPrivateSnapshot(snapshot, styled)
	}
	out, err := os.OpenFile(styled, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("create highlighted snapshot: %w", err)
	}
	defer out.Close()
	commandCtx, cancel := context.WithTimeout(ctx, previewCommandTimeout)
	defer cancel()
	cmd := exec.CommandContext(commandCtx, bat, "--color=always", "--theme=ansi", "--wrap=never", "--paging=never", "--file-name", title, snapshot)
	cmd.Stdout = out
	stderr := &boundedBuffer{limit: previewStderrLimit}
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		if commandCtx.Err() != nil {
			return commandCtx.Err()
		}
		return fmt.Errorf("highlight preview: %w%s", err, compactCommandError(stderr.String()))
	}
	if err := out.Chmod(0o600); err != nil {
		return fmt.Errorf("protect highlighted snapshot: %w", err)
	}
	return nil
}

func copyPrivateSnapshot(snapshot, styled string) error {
	in, err := os.Open(snapshot)
	if err != nil {
		return fmt.Errorf("open preview snapshot: %w", err)
	}
	defer in.Close()
	out, err := os.OpenFile(styled, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("create plain preview snapshot: %w", err)
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return fmt.Errorf("copy plain preview snapshot: %w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close plain preview snapshot: %w", closeErr)
	}
	return nil
}

type boundedBuffer struct {
	limit int
	buf   strings.Builder
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	written := len(p)
	if b.buf.Len() < b.limit {
		remaining := b.limit - b.buf.Len()
		if len(p) > remaining {
			p = p[:remaining]
		}
		_, _ = b.buf.Write(p)
	}
	return written, nil
}

func (b *boundedBuffer) String() string { return b.buf.String() }

func compactCommandError(stderr string) string {
	stderr = strings.TrimSpace(stderr)
	if stderr == "" {
		return ""
	}
	return ": " + stderr
}

func pageSnapshot(ctx context.Context, dir, styled string) error {
	pager, args, env, err := previewPager(dir, styled)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, pager, args...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.Env = mergePreviewEnv(os.Environ(), env)
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return fmt.Errorf("run preview pager: %w", err)
	}
	return nil
}

func mergePreviewEnv(base, overrides []string) []string {
	keys := make(map[string]struct{}, len(overrides))
	for _, entry := range overrides {
		if key, _, ok := strings.Cut(entry, "="); ok {
			keys[key] = struct{}{}
		}
	}
	out := make([]string, 0, len(base)+len(overrides))
	for _, entry := range base {
		key, _, _ := strings.Cut(entry, "=")
		if _, overridden := keys[key]; !overridden {
			out = append(out, entry)
		}
	}
	return append(out, overrides...)
}

// previewPager keeps q as each pager's standard exit and adds an Esc quit
// binding only for less. Current moor handles Esc itself. Modern less reads the
// private source file named by LESSKEYIN directly, avoiding global user config.
func previewPager(dir, styled string) (string, []string, []string, error) {
	if moor, err := previewLookPath("moor"); err == nil {
		return moor, []string{"--no-linenumbers", "--mousemode=scroll", "--statusbar=plain", styled}, nil, nil
	}
	if less, err := previewLookPath("less"); err == nil {
		lesskey := filepath.Join(dir, "lesskey")
		if err := os.WriteFile(lesskey, []byte("#command\n\\e quit\nq quit\n"), 0o600); err != nil {
			return "", nil, nil, fmt.Errorf("write private lesskey: %w", err)
		}
		return less, []string{"-R", styled}, []string{"LESSKEYIN=" + lesskey}, nil
	}
	return "", nil, nil, fmt.Errorf("no supported preview pager (need moor or less)")
}
