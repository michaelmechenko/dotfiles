#!/usr/bin/env python3
"""
Integration harness for tmux-flash-jump.py.

Drives the REAL plugin through the real tmux code path: an isolated tmux
server (-L socket, never touches the user's live server), a pane with
deterministic fixture content, an attached client on a PTY, copy-mode
entered on the pane, then `S` sent through the client so the actual
copy-mode-vi binding fires -> run-shell -> launcher -> display-popup ->
interactive mode. The PTY is also the popup's stdin, so we type the query
and selection exactly like a human. After the popup closes we read the
final copy_cursor_y/x and assert.

Run:  python3 tmux-flash-jump-test.py
"""

import fcntl
import importlib.util
import json
import os
import struct
import subprocess
import sys
import termios
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PLUGIN = os.path.join(HERE, "tmux-flash-jump.py")

# Import the plugin module to reuse find_matches/assign_labels for predicting
# expected labels (the selection key we send) and expected cursor targets.
_spec = importlib.util.spec_from_file_location("flash_jump", PLUGIN)
fj = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fj)


# ---------------------------------------------------------------------------
# isolated tmux server
# ---------------------------------------------------------------------------


class Tmux:
    def __init__(self, sock: str):
        self.sock = sock
        # -f /dev/null keeps the test independent of the user's live config.
        self.base = ["tmux", "-L", sock, "-f", "/dev/null"]

    def run(self, args, check=True, timeout=10):
        r = subprocess.run(
            self.base + args, capture_output=True, text=True, timeout=timeout
        )
        if check and r.returncode != 0:
            raise RuntimeError(
                f"tmux {' '.join(args)} failed: rc={r.returncode} err={r.stderr!r}"
            )
        return r.stdout

    def start(self, width, height, cmd):
        # Kill any stale server on this socket, then start a fresh detached
        # session whose pane runs `cmd` (prints fixture, then sleeps).
        subprocess.run(self.base + ["kill-server"], capture_output=True)
        self.run(
            [
                "new-session",
                "-d",
                "-s",
                "test",
                "-x",
                str(width),
                "-y",
                str(height),
                cmd,
            ]
        )
        self.run(["set-window-option", "-g", "mode-keys", "vi"])
        # Match the production binding exactly: run-shell receives one shell
        # command, then expands the triggering pane ID when S is pressed.
        self.run(
            [
                "bind-key",
                "-T",
                "copy-mode-vi",
                "S",
                f'run-shell "{PLUGIN} \'#{{pane_id}}\'"',
            ]
        )

    def kill(self):
        subprocess.run(self.base + ["kill-server"], capture_output=True)

    def capture(self, pane="test:0.0"):
        return self.run(["capture-pane", "-p", "-t", pane])

    def cursor(self, pane="test:0.0"):
        out = self.run(
            ["display-message", "-t", pane, "-p", "#{copy_cursor_y} #{copy_cursor_x}"]
        ).strip()
        y, x = (int(v) for v in out.split())
        return (y, x)

    def enter_copy_mode(self, pane="test:0.0"):
        self.run(["copy-mode", "-t", pane])
        # Park the copy cursor at the top-left so starts are deterministic.
        self.run(["send-keys", "-t", pane, "-X", "top-line"])
        self.run(["send-keys", "-t", pane, "-X", "beginning-of-line"])

# ---------------------------------------------------------------------------
# PTY client
# ---------------------------------------------------------------------------


ACTIVE_PTYS = []


class Pty:
    def __init__(self, argv, width, height):
        self.pid, self.fd = os.forkpty()
        if self.pid == 0:
            # child
            os.environ["TERM"] = "xterm-256color"
            os.execvp(argv[0], argv)
            os._exit(127)
        # parent: set the client terminal size before tmux attaches so it
        # cannot resize the fixture pane to the harness process's 80x24.
        fcntl.ioctl(
            self.fd,
            termios.TIOCSWINSZ,
            struct.pack("HHHH", height, width, 0, 0),
        )
        fl = fcntl.fcntl(self.fd, fcntl.F_GETFL)
        fcntl.fcntl(self.fd, fcntl.F_SETFL, fl | os.O_NONBLOCK)
        self.buf = bytearray()
        self._stop = False
        self.thread = threading.Thread(target=self._reader, daemon=True)
        self.thread.start()

    def _reader(self):
        while not self._stop:
            try:
                data = os.read(self.fd, 65536)
            except BlockingIOError:
                time.sleep(0.005)
                continue
            except OSError:
                break
            if not data:
                break
            self.buf.extend(data)

    def wait_for(self, pat, timeout=5.0):
        if isinstance(pat, str):
            pat = pat.encode()
        deadline = time.time() + timeout
        while time.time() < deadline:
            idx = self.buf.find(pat)
            if idx >= 0:
                return bytes(self.buf[: idx + len(pat)])
            time.sleep(0.01)
        return None

    def send(self, data):
        if isinstance(data, str):
            data = data.encode()
        os.write(self.fd, data)

    def snapshot(self):
        return bytes(self.buf)

    def stop(self):
        self._stop = True
        try:
            os.close(self.fd)
        except OSError:
            pass
        try:
            os.waitpid(self.pid, 0)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# harness
# ---------------------------------------------------------------------------


def attach_client(tmux):
    dimensions = tmux.run(
        ["display-message", "-t", "test:0.0", "-p", "#{window_width} #{window_height}"]
    ).strip()
    width, height = (int(value) for value in dimensions.split())
    # Account for the status line when the client claims the full terminal.
    pty = Pty(
        ["tmux", "-L", tmux.sock, "-f", "/dev/null", "attach", "-t", "test"],
        width,
        height + 1,
    )
    ACTIVE_PTYS.append(pty)
    deadline = time.time() + 3.0
    while time.time() < deadline:
        if tmux.run(["list-clients"], check=False).strip():
            return pty
        time.sleep(0.05)
    raise AssertionError("client did not attach to isolated tmux server")


def drive(tmux, pty, query, selection):
    """Trigger S, type query, send selection key, wait for popup to close.

    `selection` is a string written verbatim to the PTY (e.g. a label char,
    "\\r" for Enter, "\\x1b" for Esc, "\\x15" for Ctrl-U).
    Returns the rendered frame bytes captured while the popup was open.
    """
    before = len(pty.buf)
    pty.send("S")
    # Wait for the plugin to render its first frame (the prompt row).
    if not pty.wait_for(" search:", timeout=5.0):
        tail = pty.snapshot()[before:][-1200:].decode("utf-8", "backslashreplace")
        raise AssertionError(
            f"popup did not open / no prompt row rendered; PTY tail={tail!r}"
        )
    # Type the query.
    pty.send(query)
    # Wait for the prompt to reflect the full query before selecting.
    if not pty.wait_for(f" search: {query}", timeout=3.0):
        raise AssertionError(f"query {query!r} not reflected in prompt")
    # Give the redraw (labels) a moment to flush.
    time.sleep(0.08)
    frame = pty.snapshot()[before:]
    pty.send(selection)
    # The plugin exits synchronously after consuming this key; allow tmux to
    # deliver its relative cursor moves and tear down the popup before reading
    # copy_cursor_y/x. popup_width is not exposed by list-clients on 3.7b.
    time.sleep(0.25)
    return frame


def expected_matches(tmux, query, pane="test:0.0"):
    """Compute matches the way the plugin will, from the live capture."""
    lines = tmux.capture(pane).split("\n")
    cursor = tmux.cursor(pane)
    ms = fj.find_matches(lines, query)
    fj.assign_labels(lines, ms, query, cursor)
    return lines, cursor, ms


# ---------------------------------------------------------------------------
# cases
# ---------------------------------------------------------------------------


def case_adjacent_matches_have_visible_labels(tmux):
    """Every selectable adjacent match must have a visible label cell."""
    lines = ["aaaa"]
    matches = fj.find_matches(lines, "aa")
    fj.assign_labels(lines, matches, "aa", (0, 0))
    frame = fj.render_frame(
        lines, matches, "aa", width=4, height=2,
        dim_fg="D", match_fg="M", label_fg="L",
    )
    assigned = [m for m in matches if m.label]
    assert frame.count("L") == len(assigned), (
        f"adjacent labels: assigned {len(assigned)}, rendered {frame.count('L')}"
    )


def case_prompt_row_has_no_hidden_target(tmux):
    """The prompt row cannot contain an assigned-but-invisible match label."""
    lines = ["top", "bottom needle"]
    matches = fj.find_matches(lines, "needle")
    fj.assign_labels(lines, matches, "needle", (0, 0), visible_rows=1)
    frame = fj.render_frame(
        lines, matches, "needle", width=20, height=2,
        dim_fg="D", match_fg="M", label_fg="L",
    )
    assigned = [m for m in matches if m.label]
    assert frame.count("L") == len(assigned), (
        f"prompt-row target: assigned {len(assigned)}, rendered {frame.count('L')}"
    )


def case_nearest_enter(tmux):
    """Type a query, press Enter -> jump to the nearest match."""
    fixture = "alpha\nbeta gamma\nbeta delta\n"
    setup_pane(tmux, fixture, width=40, height=10)
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    # cursor at (0,0); nearest "beta" by row distance is row 1.
    _, _, ms = expected_matches(tmux, "beta")
    nearest = min(ms, key=lambda m: (abs(m.line - 0), abs(m.col - 0)))
    drive(tmux, pty, "beta", "\r")
    got = tmux.cursor()
    assert got == (nearest.line, nearest.col), (
        f"nearest-enter: expected {nearest.line,nearest.col}, got {got}"
    )


def case_cancel_unchanged(tmux):
    """Esc cancels and leaves the cursor exactly where it was."""
    fixture = "alpha\nbeta gamma\nbeta delta\n"
    setup_pane(tmux, fixture, width=40, height=10)
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    # move cursor to a known non-zero spot
    tmux.run(["send-keys", "-t", "test:0.0", "-X", "-N", "2", "cursor-down"])
    tmux.run(["send-keys", "-t", "test:0.0", "-X", "-N", "3", "cursor-right"])
    before = tmux.cursor()
    drive(tmux, pty, "beta", "\x1b")
    after = tmux.cursor()
    assert after == before, f"cancel: cursor moved {before} -> {after}"


def case_label_select(tmux):
    """Select a specific match by its predicted label -> land on that match."""
    fixture = "alpha beta gamma beta\nbeta beta beta\n"
    setup_pane(tmux, fixture, width=40, height=10)
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    lines, cursor, ms = expected_matches(tmux, "beta")
    labeled = [m for m in ms if m.label]
    assert labeled, "no labels assigned"
    target = labeled[-1]  # pick one that is not the nearest (exercises labels)
    frame = drive(tmux, pty, "beta", target.label)
    got = tmux.cursor()
    assert got == (target.line, target.col), (
        f"label-select: expected {target.line,target.col} (label {target.label!r}), "
        f"got {got}"
    )
    return frame, target


def case_wide_char_cursor_target(tmux):
    """A cursor to the right of a wide glyph still lands on the match cell."""
    fixture = "界needle\n"
    setup_pane(tmux, fixture, width=40, height=10)
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    # Measure the terminal-cell position of the match start independently:
    # one copy-mode character movement skips the two-cell glyph.
    tmux.run(["send-keys", "-t", "test:0.0", "-X", "cursor-right"])
    expected = tmux.cursor()
    tmux.run(["send-keys", "-t", "test:0.0", "-X", "end-of-line"])
    _, _, matches = expected_matches(tmux, "needle")
    assert len(matches) == 1 and matches[0].label, f"wide target missing: {matches}"
    drive(tmux, pty, "needle", matches[0].label)
    got = tmux.cursor()
    assert got == expected, f"wide-char: expected {expected}, got {got}"


def case_tab_cursor_target(tmux):
    """A tab before the target maps cursor motion by characters, not cells."""
    fixture = "\tneedle\n"
    setup_pane(tmux, fixture, width=40, height=10)
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    tmux.run(["send-keys", "-t", "test:0.0", "-X", "cursor-right"])
    expected = tmux.cursor()
    tmux.run(["send-keys", "-t", "test:0.0", "-X", "end-of-line"])
    _, _, matches = expected_matches(tmux, "needle")
    assert len(matches) == 1 and matches[0].label, f"tab target missing: {matches}"
    drive(tmux, pty, "needle", matches[0].label)
    got = tmux.cursor()
    assert got == expected, f"tab: expected {expected}, got {got}"


def case_combining_char_cursor_target(tmux):
    """Combining marks do not consume a separate cursor movement."""
    fixture = "e\u0301needle\n"
    setup_pane(tmux, fixture, width=40, height=10)
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    tmux.run(["send-keys", "-t", "test:0.0", "-X", "cursor-right"])
    expected = tmux.cursor()
    tmux.run(["send-keys", "-t", "test:0.0", "-X", "end-of-line"])
    _, _, matches = expected_matches(tmux, "needle")
    assert len(matches) == 1 and matches[0].label, f"combining target missing: {matches}"
    drive(tmux, pty, "needle", matches[0].label)
    got = tmux.cursor()
    assert got == expected, f"combining: expected {expected}, got {got}"


def case_split_pane(tmux):
    """The popup geometry follows the left pane in a split window."""
    fixture = "alpha\nneedle left\nneedle again\n"
    setup_pane(tmux, fixture, width=60, height=12)
    tmux.run(["split-window", "-h", "-t", "test:0.0", "-l", "15", "sleep 300"])
    tmux.run(["select-pane", "-t", "test:0.0"])
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    _, cursor, matches = expected_matches(tmux, "needle")
    nearest = min(matches, key=lambda m: (abs(m.line - cursor[0]), abs(m.col - cursor[1])))
    drive(tmux, pty, "needle", "\r")
    got = tmux.cursor()
    assert got == (nearest.line, nearest.col), (
        f"split-pane: expected {nearest.line,nearest.col}, got {got}"
    )


def case_neighbor_pane(tmux, name, split_args, status_position):
    """The active copy-mode pane wins over an adjacent, unrelated pane."""
    fixture = "TARGET row zero\nTARGET needle here\nTARGET row two\n"
    setup_pane(tmux, fixture, width=60, height=14)
    target_pane = tmux.run(
        ["display-message", "-t", "test:0.0", "-p", "#{pane_id}"]
    ).strip()
    tmux.run(["set", "-g", "status-position", status_position])
    tmux.run(["set", "-g", "status", "2"])
    tmux.run(["set", "-g", "@flash_jump_debug", "1"])

    neighbor_path = f"/tmp/tmux-flash-jump-{name}-fixture.txt"
    with open(neighbor_path, "w") as f:
        f.write("NEIGHBOR unrelated content\nNEIGHBOR second row\n")
    neighbor = tmux.run(
        [
            "split-window",
            *split_args,
            "-d",
            "-P",
            "-F",
            "#{pane_id}",
            "-t",
            target_pane,
            "sh",
            "-c",
            f"clear; cat {neighbor_path}; sleep 300",
        ]
    ).strip()
    tmux.run(["select-pane", "-t", target_pane])
    pty = attach_client(tmux)

    # Keep a copy cursor in the non-triggering pane so the assertion detects
    # an accidental `send-keys -t` target change as well as a wrong capture.
    tmux.enter_copy_mode(neighbor)
    neighbor_before = tmux.cursor(neighbor)
    tmux.run(["select-pane", "-t", target_pane])
    tmux.enter_copy_mode(target_pane)

    lines, cursor, matches = expected_matches(tmux, "needle", pane=target_pane)
    assert len(matches) == 1, f"{name}: target pane was not captured: {lines!r}"
    target = matches[0]
    try:
        os.remove(fj.DEBUG_LOG)
    except FileNotFoundError:
        pass
    frame = drive(tmux, pty, "needle", target.label)

    got = tmux.cursor(target_pane)
    assert got == (target.line, target.col), (
        f"{name}: expected {target.line,target.col}, got {got}"
    )
    assert b"TARGET needle here" in frame, f"{name}: popup omitted target-pane content"
    assert tmux.cursor(neighbor) == neighbor_before, f"{name}: neighbor cursor moved"

    events = [json.loads(line) for line in open(fj.DEBUG_LOG)]
    launch = next(event for event in events if event["event"] == "launch")
    pane_geometry = launch["pane_geometry"]
    popup_geometry = launch["popup_geometry"]
    expected_top = pane_geometry["top"] + (
        launch["status"]["lines"] if status_position == "top" else 0
    )
    assert launch["pane"] == target_pane, f"{name}: launch targeted {launch['pane']}"
    assert popup_geometry["left"] == pane_geometry["left"], f"{name}: popup x changed"
    assert popup_geometry["top"] == expected_top, (
        f"{name}: expected popup y={expected_top}, got {popup_geometry['top']}"
    )


def case_pane_above_active(tmux):
    case_neighbor_pane(tmux, "pane-above", ["-v", "-b"], "top")


def case_pane_below_active(tmux):
    case_neighbor_pane(tmux, "pane-below", ["-v"], "bottom")


def case_pane_left_active(tmux):
    case_neighbor_pane(tmux, "pane-left", ["-h", "-b"], "top")


def case_pane_right_active(tmux):
    case_neighbor_pane(tmux, "pane-right", ["-h"], "bottom")


def case_scrolled_history(tmux):
    """Search and jump operate on the current, scrolled copy-mode viewport."""
    fixture = "".join(f"line {i:02d} needle\n" for i in range(24))
    setup_pane(tmux, fixture, width=40, height=10)
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    tmux.run(["send-keys", "-t", "test:0.0", "-X", "-N", "12", "scroll-up"])
    tmux.run(["send-keys", "-t", "test:0.0", "-X", "top-line"])
    lines, cursor, matches = expected_matches(tmux, "needle")
    assert matches, "scrolled viewport has no fixture matches"
    nearest = min(matches, key=lambda m: (abs(m.line - cursor[0]), abs(m.col - cursor[1])))
    drive(tmux, pty, "needle", "\r")
    got = tmux.cursor()
    assert got == (nearest.line, nearest.col), (
        f"scrolled-history: expected {nearest.line,nearest.col}, got {got}; "
        f"viewport={lines!r}"
    )


def case_wrapped_line(tmux):
    """A long line soft-wraps; a match on the wrapped physical row must land
    on the correct physical row (the no-`-J` invariant)."""
    # 20-col pane: the long line wraps. "zeta" sits past col 20 -> row 1.
    head = "aaaa "  # 5 cols
    tail = "zeta"  # match starts at col 25 -> physical row 1, col 5
    long_line = head * 4 + tail  # 24 chars, wraps at 20 -> row0[0:20], row1[20:24]
    fixture = f"{long_line}\n"
    setup_pane(tmux, fixture, width=20, height=8)
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    lines = tmux.capture().split("\n")
    # Sanity: the wrap produced a second physical row containing "zeta".
    assert len(lines) >= 2 and "zeta" in lines[1], (
        f"wrap setup wrong: {lines[:3]!r}"
    )
    ms = fj.find_matches(lines, "zeta")
    assert len(ms) == 1, f"expected 1 zeta match, got {ms}"
    target = ms[0]
    fj.assign_labels(lines, ms, "zeta", (0, 0))
    assert target.label, "no label for wrapped target"
    drive(tmux, pty, "zeta", target.label)
    got = tmux.cursor()
    assert got == (target.line, target.col), (
        f"wrapped: expected {target.line,target.col}, got {got}"
    )


def case_ctrl_w_edit(tmux):
    """Ctrl-W removes the current query word before a fresh search."""
    fixture = "alpha\nbeta gamma\n"
    setup_pane(tmux, fixture, width=40, height=10)
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    pty.send("S")
    if not pty.wait_for(" search:", timeout=5.0):
        raise AssertionError("popup did not open")
    pty.send("typo")
    if not pty.wait_for(" search: typo", timeout=3.0):
        raise AssertionError("query before Ctrl-W not shown")
    pty.send("\x17")
    time.sleep(0.08)
    pty.send("beta")
    if not pty.wait_for(" search: beta", timeout=3.0):
        raise AssertionError("post-Ctrl-W query not shown")
    pty.send("\r")
    time.sleep(0.25)
    got = tmux.cursor()
    assert got == (1, 0), f"Ctrl-W edit: expected (1, 0), got {got}"


def case_query_edit(tmux):
    """Ctrl-U clears the query; after clearing, a fresh query still jumps."""
    fixture = "alpha\nbeta gamma\nzeta delta\n"
    setup_pane(tmux, fixture, width=40, height=10)
    pty = attach_client(tmux)
    tmux.enter_copy_mode()
    # Trigger S, type "be", Ctrl-U, then "zeta" + Enter.
    pty.send("S")
    if not pty.wait_for(" search:", timeout=5.0):
        raise AssertionError("popup did not open")
    pty.send("be")
    if not pty.wait_for(" search: be", timeout=3.0):
        raise AssertionError("partial query not shown")
    pty.send("\x15")  # Ctrl-U
    if not pty.wait_for(" search: \r", timeout=3.0) and not pty.wait_for(
        " search: \n", timeout=3.0
    ):
        # The prompt row is re-rendered on its own line; just check the query
        # text is gone by waiting for the bare prompt after the clear redraw.
        time.sleep(0.1)
    pty.send("zeta")
    if not pty.wait_for(" search: zeta", timeout=3.0):
        raise AssertionError("post-Ctrl-U query not shown")
    pty.send("\r")
    time.sleep(0.25)
    # The cursor already moved by the jump; we know the pre-jump position was
    # we know we started at (0,0), so nearest zeta is at row 2.
    expected = (2, 0)
    got = tmux.cursor()
    assert got == expected, f"query-edit: expected {expected}, got {got}"


# ---------------------------------------------------------------------------
# pane setup
# ---------------------------------------------------------------------------


def setup_pane(tmux, fixture, width, height):
    """(Re)create the test session with deterministic fixture content."""
    # Write fixture to a temp file the pane will `cat` then sleep.
    path = "/tmp/tmux-flash-jump-fixture.txt"
    with open(path, "w") as f:
        f.write(fixture)
    cmd = f"sh -c 'clear; cat {path}; sleep 300'"
    tmux.start(width, height, cmd)
    # Wait for the content to be painted.
    deadline = time.time() + 3.0
    marker = next(line for line in reversed(fixture.split("\n")) if line)[:10]
    while time.time() < deadline:
        cap = tmux.capture()
        if marker in cap:
            return
        time.sleep(0.05)
    raise AssertionError(f"pane never showed fixture; got:\n{tmux.capture()!r}")


# ---------------------------------------------------------------------------
# runner
# ---------------------------------------------------------------------------


def main():
    sock = "flashjump-test"
    tmux = Tmux(sock)
    cases = [
        ("adjacent_labels", case_adjacent_matches_have_visible_labels),
        ("prompt_row_target", case_prompt_row_has_no_hidden_target),
        ("nearest_enter", case_nearest_enter),
        ("cancel_unchanged", case_cancel_unchanged),
        ("label_select", case_label_select),
        ("wide_char_target", case_wide_char_cursor_target),
        ("tab_target", case_tab_cursor_target),
        ("combining_char_target", case_combining_char_cursor_target),
        ("split_pane", case_split_pane),
        ("pane_above_active", case_pane_above_active),
        ("pane_below_active", case_pane_below_active),
        ("pane_left_active", case_pane_left_active),
        ("pane_right_active", case_pane_right_active),
        ("scrolled_history", case_scrolled_history),
        ("wrapped_line", case_wrapped_line),
        ("ctrl_w_edit", case_ctrl_w_edit),
        ("query_edit", case_query_edit),
    ]
    results = []
    for name, fn in cases:
        try:
            fn(tmux)
            results.append((name, "PASS", None))
        except AssertionError as e:
            results.append((name, "FAIL", str(e)))
        except Exception as e:
            results.append((name, "ERROR", f"{type(e).__name__}: {e}"))
        finally:
            while ACTIVE_PTYS:
                ACTIVE_PTYS.pop().stop()
            tmux.kill()

    print()
    for name, status, detail in results:
        line = f"  {name:18s} {status}"
        if detail:
            line += f"  -- {detail}"
        print(line)
    failed = [r for r in results if r[1] != "PASS"]
    print()
    if failed:
        print(f"FAIL: {len(failed)}/{len(results)} cases failed")
        sys.exit(1)
    print(f"PASS ({len(results)} cases)")
    sys.exit(0)


if __name__ == "__main__":
    main()