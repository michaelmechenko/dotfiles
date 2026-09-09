// Package preview provides bounded, terminal-safe filesystem previews.
package preview

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"unicode/utf8"

	"mm-sidebar/internal/display"
)

const (
	defaultBytes   = 64 * 1024
	defaultLines   = 200
	defaultEntries = 200
)

// Limits bounds all work and output. Zero fields use conservative defaults.
type Limits struct {
	Bytes   int
	Lines   int
	Entries int
}

// Result is display-ready text with no live terminal controls.
type Result struct {
	Title     string
	Lines     []string
	Empty     string
	Truncated bool
}

func (l Limits) normalized() Limits {
	if l.Bytes <= 0 {
		l.Bytes = defaultBytes
	}
	if l.Lines <= 0 {
		l.Lines = defaultLines
	}
	if l.Entries <= 0 {
		l.Entries = defaultEntries
	}
	return l
}

// Render follows symlinks and opens with O_NONBLOCK before checking the opened
// object. A path replacement therefore cannot turn a validated regular file
// into a blocking FIFO/device open.
func Render(path string, limits Limits) (Result, error) {
	limits = limits.normalized()
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return Result{}, errors.New("path no longer exists")
	}
	file := os.NewFile(uintptr(fd), path)
	if file == nil {
		syscall.Close(fd)
		return Result{}, errors.New("path could not be opened")
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return Result{}, errors.New("path no longer exists")
	}
	result := Result{Title: display.Sanitize(filepath.Base(filepath.Clean(path)))}
	if info.IsDir() {
		return renderDirectory(file, result, limits)
	}
	if !info.Mode().IsRegular() {
		return Result{}, fmt.Errorf("special files cannot be previewed")
	}
	return renderFile(file, result, limits)
}

func renderDirectory(dir *os.File, result Result, limits Limits) (Result, error) {
	entries, err := dir.ReadDir(limits.Entries + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return Result{}, fmt.Errorf("read directory: %w", err)
	}
	result.Empty = "(empty directory)"
	if len(entries) > limits.Entries {
		entries = entries[:limits.Entries]
		result.Truncated = true
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	result.Lines = make([]string, 0, len(entries))
	for _, entry := range entries {
		name := display.Sanitize(entry.Name())
		if entry.IsDir() {
			name += "/"
		}
		result.Lines = append(result.Lines, name)
	}
	return result, nil
}

func renderFile(file *os.File, result Result, limits Limits) (Result, error) {
	data, err := io.ReadAll(io.LimitReader(file, int64(limits.Bytes)+1))
	if err != nil {
		return Result{}, fmt.Errorf("read file: %w", err)
	}
	if len(data) > limits.Bytes {
		data = data[:limits.Bytes]
		result.Truncated = true
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return Result{}, errors.New("binary file cannot be previewed")
	}
	text := string(data)
	if !utf8.Valid(data) {
		text = strings.ToValidUTF8(text, "�")
	}
	result.Empty = "(empty file)"
	if text == "" {
		return result, nil
	}
	lines := strings.Split(text, "\n")
	if len(lines) > limits.Lines {
		lines = lines[:limits.Lines]
		result.Truncated = true
	}
	result.Lines = make([]string, len(lines))
	for i, line := range lines {
		result.Lines[i] = display.Sanitize(line)
	}
	return result, nil
}
