package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
)

func TestSyntaxSnapshotUsesOnlyPrivateSnapshotAndSafeBatArguments(t *testing.T) {
	root := t.TempDir()
	argsPath := filepath.Join(root, "args")
	bat := filepath.Join(root, "bat")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MM_TEST_ARGS\"\ncat \"$7\"\n"
	if err := os.WriteFile(bat, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MM_TEST_ARGS", argsPath)
	old := previewLookPath
	previewLookPath = func(name string) (string, error) {
		if name == "bat" {
			return bat, nil
		}
		return "", errors.New("missing")
	}
	t.Cleanup(func() { previewLookPath = old })

	live := filepath.Join(root, "live;$(not-shell).go")
	if err := os.WriteFile(live, []byte("live must not be opened\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	snapshot := filepath.Join(root, "snapshot")
	if err := os.WriteFile(snapshot, []byte("safe snapshot\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	styled := filepath.Join(root, "styled")
	if err := syntaxSnapshot(context.Background(), snapshot, styled, "live;$(not-shell).go"); err != nil {
		t.Fatal(err)
	}
	args, err := os.ReadFile(argsPath)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Split(strings.TrimSpace(string(args)), "\n")
	want := []string{"--color=always", "--theme=ansi", "--wrap=never", "--paging=never", "--file-name", "live;$(not-shell).go", snapshot}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("bat args = %#v, want %#v", got, want)
	}
	if strings.Contains(string(args), live) {
		t.Fatalf("bat received live path: %q", args)
	}
	info, err := os.Stat(styled)
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("styled snapshot permissions = %v, %v", info.Mode(), err)
	}
	if body, _ := os.ReadFile(styled); string(body) != "safe snapshot\n" {
		t.Fatalf("styled snapshot = %q", body)
	}
}

func TestPreviewPagerPrefersMoorAndUsesPrivateLesskey(t *testing.T) {
	old := previewLookPath
	t.Cleanup(func() { previewLookPath = old })
	previewLookPath = func(name string) (string, error) {
		if name == "moor" {
			return "/bin/moor", nil
		}
		return "", errors.New("missing")
	}
	pager, args, env, err := previewPager(t.TempDir(), "/private/styled")
	if err != nil || pager != "/bin/moor" || len(env) != 0 || !reflect.DeepEqual(args, []string{"--no-linenumbers", "--mousemode=scroll", "--statusbar=plain", "/private/styled"}) {
		t.Fatalf("moor pager = %q %#v %#v %v", pager, args, env, err)
	}
	previewLookPath = func(name string) (string, error) {
		if name == "less" {
			return "/bin/less", nil
		}
		return "", errors.New("missing")
	}
	dir := t.TempDir()
	pager, args, env, err = previewPager(dir, "/private/styled")
	if err != nil || pager != "/bin/less" || !reflect.DeepEqual(args, []string{"-R", "/private/styled"}) || len(env) != 1 || !strings.HasPrefix(env[0], "LESSKEYIN=") {
		t.Fatalf("less pager = %q %#v %#v %v", pager, args, env, err)
	}
	lesskey := strings.TrimPrefix(env[0], "LESSKEYIN=")
	if filepath.Dir(lesskey) != dir {
		t.Fatalf("lesskey escaped private dir: %q", lesskey)
	}
	if body, err := os.ReadFile(lesskey); err != nil || string(body) != "#command\n\\e quit\nq quit\n" {
		t.Fatalf("lesskey = %q, %v", body, err)
	}
}

func TestSyntaxSnapshotFallsBackToPlainPrivateSnapshotWithoutBat(t *testing.T) {
	old := previewLookPath
	previewLookPath = func(string) (string, error) { return "", errors.New("missing") }
	t.Cleanup(func() { previewLookPath = old })
	dir := t.TempDir()
	snapshot, styled := filepath.Join(dir, "snapshot"), filepath.Join(dir, "styled")
	if err := os.WriteFile(snapshot, []byte("sanitized\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := syntaxSnapshot(context.Background(), snapshot, styled, "x"); err != nil {
		t.Fatal(err)
	}
	if body, err := os.ReadFile(styled); err != nil || string(body) != "sanitized\n" {
		t.Fatalf("plain fallback = %q, %v", body, err)
	}
}

func TestMergePreviewEnvOverridesExistingLesskey(t *testing.T) {
	got := mergePreviewEnv([]string{"PATH=/bin", "LESSKEYIN=/user/lesskey"}, []string{"LESSKEYIN=/private/lesskey"})
	if !reflect.DeepEqual(got, []string{"PATH=/bin", "LESSKEYIN=/private/lesskey"}) {
		t.Fatalf("preview env = %#v", got)
	}
}

func TestRunPreviewPathRejectsFIFOBeforePager(t *testing.T) {
	pipe := filepath.Join(t.TempDir(), "preview-pipe")
	if err := syscall.Mkfifo(pipe, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := runPreviewPath(pipe); err == nil || !strings.Contains(err.Error(), "special") {
		t.Fatalf("FIFO preview error = %v", err)
	}
}
