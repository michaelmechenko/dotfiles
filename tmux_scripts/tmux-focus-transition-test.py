#!/usr/bin/env python3
"""Natural attached-client pane-focus transition checks and repaint A/B metrics."""
from __future__ import annotations

import fcntl
import os
import select
import statistics
import struct
import subprocess
import termios
import time
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SYNC_START = b"\x1b[?2026h"
SYNC_END = b"\x1b[?2026l"
FULL_ERASE = b"\x1b[2J"
ROWS = 28
COLS = 120


@dataclass
class Result:
    name: str
    sizes: list[int]
    frames: list[int]

    @property
    def median(self) -> int:
        return int(statistics.median(self.sizes))


def wait_for(test, message: str) -> None:
    deadline = time.time() + 4
    while time.time() < deadline:
        if test():
            return
        time.sleep(0.02)
    raise AssertionError(message)


def read_quiet(master: int, timeout: float = 1.0) -> bytes:
    data = b""
    deadline = time.time() + timeout
    quiet_since: float | None = None
    while time.time() < deadline:
        if select.select([master], [], [], 0.03)[0]:
            data += os.read(master, 65536)
            quiet_since = None
        elif data:
            quiet_since = quiet_since or time.time()
            if time.time() - quiet_since >= 0.06:
                break
    return data


def truecolor_escape(kind: int, color: str) -> bytes:
    rgb = tuple(int(color[index:index + 2], 16) for index in (1, 3, 5))
    return f"\x1b[{kind};2;{rgb[0]};{rgb[1]};{rgb[2]}m".encode()


def run_case(name: str, *, equal_backgrounds: bool = False,
             footer: bool = True, command: str | None = None,
             focus_events: bool = True, minimal_chrome: bool = False,
             pane_styles: bool = True) -> Result:
    socket = f"tmux-focus-{os.getpid()}-{name}"
    base = ["tmux", "-L", socket]

    def tmux(*args: str, check: bool = True) -> str:
        proc = subprocess.run(base + list(args), text=True, capture_output=True)
        if check and proc.returncode:
            raise RuntimeError(proc.stderr.strip())
        return proc.stdout.rstrip("\n")

    master, slave = os.openpty()
    proc = None
    try:
        args = ["-f", str(ROOT / "tmux.conf"), "new-session", "-d", "-s", "focus",
                "-x", str(COLS), "-y", str(ROWS)]
        if command:
            args.append(command)
        tmux(*args)
        first = tmux("display-message", "-p", "-t", "=focus:", "#{pane_id}")
        split_args = ["split-window", "-h", "-P", "-F", "#{pane_id}", "-t", first]
        if command:
            split_args.append(command)
        second = tmux(*split_args)
        tmux("select-pane", "-t", first)
        if not focus_events:
            tmux("set-option", "-g", "focus-events", "off")

        fcntl.ioctl(slave, termios.TIOCSWINSZ,
                    struct.pack("HHHH", ROWS, COLS, 0, 0))
        env = os.environ.copy() | {"TERM": "xterm-ghostty"}
        env.pop("TMUX", None)
        proc = subprocess.Popen(base + ["attach", "-t", "=focus"], env=env,
                                stdin=slave, stdout=slave, stderr=slave,
                                start_new_session=True)
        tty = os.ttyname(slave)
        wait_for(lambda: tty in tmux("list-clients", "-F", "#{client_tty}"),
                 f"{name}: client did not attach")
        time.sleep(0.8 if command else 0.5)
        while select.select([master], [], [], 0)[0]:
            os.read(master, 65536)

        if not pane_styles:
            tmux("set-window-option", "-g", "window-style", "default")
            tmux("set-window-option", "-g", "window-active-style", "default")
            tmux("set-window-option", "-u", "-t", "=focus:", "window-style")
            tmux("set-window-option", "-u", "-t", "=focus:", "window-active-style")
        elif equal_backgrounds:
            active = tmux("show-option", "-gqv", "@color-surface-pane-active")
            tmux("set-window-option", "-t", "=focus:", "window-style", f"bg={active}")
            tmux("set-window-option", "-t", "=focus:", "window-active-style", f"bg={active}")
        if not footer or minimal_chrome:
            tmux("set-window-option", "-t", "=focus:", "pane-border-status", "off")
        if minimal_chrome:
            muted = tmux("show-option", "-gqv", "@color-text-muted")
            canvas = tmux("show-option", "-gqv", "@color-canvas")
            tmux("set-option", "-g", "status-format[1]",
                 f"#[fg={muted}]#{{R:─,#{{client_width}}}}")
            tmux("set-window-option", "-t", "=focus:",
                 "pane-active-border-style", f"fg={muted}, bg={canvas}")
            tmux("set-window-option", "-t", "=focus:",
                 "pane-border-style", f"fg={muted}, bg={canvas}")
        if equal_backgrounds or not footer or minimal_chrome or not pane_styles:
            tmux("refresh-client", "-t", tty)
            read_quiet(master)

        # Warm both directions after shells/apps and any option redraw settle.
        for key, destination in ((b"\x1bl", second), (b"\x1bh", first)):
            os.write(master, key)
            read_quiet(master)
            wait_for(lambda: tmux("display-message", "-p", "-t", "=focus:",
                                  "#{pane_id}") == destination,
                     f"{name}: warm-up focus did not move to {destination}")
        time.sleep(0.2)
        while select.select([master], [], [], 0)[0]:
            os.read(master, 65536)

        inactive = tmux("show-option", "-gqv", "@color-surface-inactive")
        active = tmux("show-option", "-gqv", "@color-surface-pane-active")
        inactive_bg = truecolor_escape(48, inactive)
        active_bg = truecolor_escape(48, active)
        sizes: list[int] = []
        frames: list[int] = []

        # Discard one measured probe after warm-up; interactive shell startup can
        # finish asynchronously and append extra synchronized frames to it.
        for index in range(13):
            destination = second if index % 2 == 0 else first
            key = b"\x1bl" if index % 2 == 0 else b"\x1bh"
            os.write(master, key)
            data = read_quiet(master)
            wait_for(lambda: tmux("display-message", "-p", "-t", "=focus:",
                                  "#{pane_id}") == destination,
                     f"{name}: focus did not move to {destination}")
            starts = [pos for pos in range(len(data)) if data.startswith(SYNC_START, pos)]
            ends = [pos for pos in range(len(data)) if data.startswith(SYNC_END, pos)]
            if len(starts) != len(ends) or not starts:
                raise AssertionError(
                    f"{name}: unbalanced synchronized frames starts={len(starts)} ends={len(ends)}"
                )
            if data[:starts[0]] or data[ends[-1] + len(SYNC_END):]:
                raise AssertionError(f"{name}: bytes escaped synchronized frames")
            if FULL_ERASE in data:
                raise AssertionError(f"{name}: focus transition issued a full-screen erase")
            if pane_styles and not equal_backgrounds and (inactive_bg not in data or active_bg not in data):
                raise AssertionError(f"{name}: transition omitted active/inactive backgrounds")
            if index:
                sizes.append(len(data))
                frames.append(len(starts))

        return Result(name, sizes, frames)
    finally:
        tmux("kill-server", check=False)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=1)
        os.close(slave)
        os.close(master)


def main() -> int:
    current = run_case("current")
    equal = run_case("equal-bg", equal_backgrounds=True)
    no_footer = run_case("no-footer", footer=False)
    nvim = run_case("nvim", command="nvim --clean")
    nvim_no_focus = run_case("nvim-no-focus-events", command="nvim --clean",
                             focus_events=False)
    nvim_equal = run_case("nvim-equal-bg", command="nvim --clean",
                          equal_backgrounds=True)
    nvim_minimal = run_case("nvim-minimal-chrome", command="nvim --clean",
                            equal_backgrounds=True, minimal_chrome=True)
    nvim_no_styles = run_case("nvim-no-pane-styles", command="nvim --clean",
                              pane_styles=False)

    results = (current, equal, no_footer, nvim, nvim_no_focus, nvim_equal,
               nvim_minimal, nvim_no_styles)
    for result in results:
        if set(result.frames) != {1}:
            raise AssertionError(
                f"{result.name}: expected one synchronized frame, got {result.frames}"
            )

    print("ok: natural focus transitions stay synchronized without full erase")
    print("diagnostic repaint byte counts (reported, not pass/fail invariants):")
    for result in results:
        print(f"  {result.name}: median={result.median} bytes frames={min(result.frames)}-{max(result.frames)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
