#!/usr/bin/env python3
"""Disposable attached-client checks for status tiers and pane-footer states."""
from __future__ import annotations

import fcntl
import os
import re
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOCKET = f"tmux-render-{os.getpid()}"


def tmux(*args: str, check: bool = True) -> str:
    proc = subprocess.run(["tmux", "-L", SOCKET, *args], text=True, capture_output=True)
    if check and proc.returncode:
        raise RuntimeError(proc.stderr.strip())
    return proc.stdout.rstrip("\n")


def wait_for(test, message: str) -> None:
    end = time.time() + 3
    while time.time() < end:
        if test():
            return
        time.sleep(0.02)
    raise AssertionError(message)


def render_terminal(data: bytes, rows: int, cols: int) -> tuple[list[list[str]], list[list[str | None]]]:
    """Apply the small VT subset tmux uses for redraws and return cells plus fg."""
    chars = [[" " for _ in range(cols)] for _ in range(rows)]
    colors: list[list[str | None]] = [[None for _ in range(cols)] for _ in range(rows)]
    row = col = 0
    fg: str | None = None
    last = (" ", None)
    i = 0

    def draw(char: str) -> None:
        nonlocal col, last
        if 0 <= row < rows and 0 <= col < cols:
            chars[row][col] = char
            colors[row][col] = fg
        col += 1
        last = (char, fg)

    while i < len(data):
        byte = data[i]
        if byte == 0x1B:
            if i + 1 < len(data) and data[i + 1] == ord("["):
                end = i + 2
                while end < len(data) and not 0x40 <= data[end] <= 0x7E:
                    end += 1
                if end >= len(data):
                    break
                raw = data[i + 2:end].decode("ascii", "ignore")
                final = chr(data[end])
                params = raw.lstrip("?>").replace(":", ";")
                values = [int(value) if value else 0 for value in params.split(";")] if params else []
                first = values[0] if values else 0
                if final in ("H", "f"):
                    row = (values[0] if values and values[0] else 1) - 1
                    col = (values[1] if len(values) > 1 and values[1] else 1) - 1
                elif final == "G":
                    col = (first or 1) - 1
                elif final == "d":
                    row = (first or 1) - 1
                elif final == "A":
                    row -= first or 1
                elif final in ("B", "e"):
                    row += first or 1
                elif final == "C":
                    col += first or 1
                elif final == "D":
                    col -= first or 1
                elif final == "E":
                    row += first or 1
                    col = 0
                elif final == "F":
                    row -= first or 1
                    col = 0
                elif final == "b":
                    old_fg = fg
                    char, repeated_fg = last
                    fg = repeated_fg
                    for _ in range(first or 1):
                        draw(char)
                    fg = old_fg
                elif final == "X":
                    for offset in range(first or 1):
                        if 0 <= row < rows and 0 <= col + offset < cols:
                            chars[row][col + offset] = " "
                            colors[row][col + offset] = fg
                elif final == "K" and 0 <= row < rows:
                    start, stop = (0, cols) if first == 2 else ((0, col + 1) if first == 1 else (col, cols))
                    for offset in range(max(0, start), min(cols, stop)):
                        chars[row][offset] = " "
                        colors[row][offset] = fg
                elif final == "m":
                    index = 0
                    if not values:
                        fg = None
                    while index < len(values):
                        code = values[index]
                        if code in (0, 39):
                            fg = None
                        elif code == 38 and index + 4 < len(values) and values[index + 1] == 2:
                            fg = "#" + "".join(f"{channel:02x}" for channel in values[index + 2:index + 5])
                            index += 4
                        index += 1
                i = end + 1
                continue
            if i + 1 < len(data) and data[i + 1] == ord("]"):
                end = data.find(b"\x07", i + 2)
                st = data.find(b"\x1b\\", i + 2)
                candidates = [pos for pos in (end, st) if pos >= 0]
                if not candidates:
                    break
                finish = min(candidates)
                i = finish + (2 if data[finish:finish + 2] == b"\x1b\\" else 1)
                continue
            i += 3 if data[i + 1:i + 2] in (b"(", b")") else 2
            continue
        if byte == 0x0D:
            col = 0
            i += 1
            continue
        if byte == 0x0A:
            row += 1
            i += 1
            continue
        if byte == 0x08:
            col = max(0, col - 1)
            i += 1
            continue
        if byte < 0x20:
            i += 1
            continue
        length = 1 if byte < 0x80 else 2 if byte < 0xE0 else 3 if byte < 0xF0 else 4
        draw(data[i:i + length].decode("utf-8", "replace"))
        i += length
    return chars, colors


def verify_status_click(width: int) -> None:
    socket = f"{SOCKET}-click-{width}"
    base = ["tmux", "-L", socket]

    def run(*args: str, check: bool = True) -> str:
        proc = subprocess.run(base + list(args), text=True, capture_output=True)
        if check and proc.returncode:
            raise RuntimeError(proc.stderr.strip())
        return proc.stdout.rstrip("\n")

    master, slave = os.openpty()
    proc = None
    try:
        run("-f", str(ROOT / "tmux.conf"), "new-session", "-d", "-s", "click-test",
            "-x", str(width), "-y", "30")
        run("new-window", "-d", "-t", "=click-test:", "-n", "click-target")
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, width, 0, 0))
        env = os.environ.copy() | {"TERM": "xterm-ghostty"}
        env.pop("TMUX", None)
        proc = subprocess.Popen(base + ["attach", "-t", "=click-test"], env=env,
                                stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        tty = os.ttyname(slave)
        wait_for(lambda: tty in run("list-clients", "-F", "#{client_tty}"),
                 f"{width}-column click client did not attach")
        rendered = b""
        end = time.time() + 3
        while time.time() < end and b"click-target" not in rendered:
            if select.select([master], [], [], 0.1)[0]:
                rendered += os.read(master, 65536)
        if b"click-target" not in rendered:
            raise AssertionError(f"{width}-column status did not finish its initial redraw")

        def plain(value: str) -> str:
            return re.sub(r"#\[[^]]*\]", "", value)

        current = plain(run("display-message", "-p", "-t", "=click-test:1",
                            "#{E:window-status-current-format}"))
        separator = plain(run("display-message", "-p", "-t", "=click-test:1",
                              "#{E:window-status-separator}"))
        x = len(current) + len(separator) + 1
        os.write(master, f"\x1b[<0;{x};1M".encode())
        wait_for(lambda: "\t2" in run("list-clients", "-F", "#{session_name}\t#{window_index}"),
                 f"{width}-column status click did not select window 2")
    finally:
        run("kill-server", check=False)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                proc.kill()
        os.close(slave)
        os.close(master)


def verify_status_stripe_layouts() -> None:
    socket = f"{SOCKET}-stripe"
    base = ["tmux", "-L", socket]

    def run(*args: str, check: bool = True) -> str:
        proc = subprocess.run(base + list(args), text=True, capture_output=True)
        if check and proc.returncode:
            raise RuntimeError(proc.stderr.strip())
        return proc.stdout.rstrip("\n")

    master, slave = os.openpty()
    proc = None
    try:
        run("-f", str(ROOT / "tmux.conf"), "new-session", "-d", "-s", "stripe",
            "-x", "101", "-y", "30")
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 101, 0, 0))
        env = os.environ.copy() | {"TERM": "xterm-ghostty"}
        env.pop("TMUX", None)
        proc = subprocess.Popen(base + ["attach", "-t", "=stripe"], env=env,
                                stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        tty = os.ttyname(slave)
        wait_for(lambda: tty in run("list-clients", "-F", "#{client_tty}"),
                 "stripe client did not attach")
        client_name = next(
            line.split("\t", 1)[0]
            for line in run("list-clients", "-F", "#{client_name}\t#{client_tty}").splitlines()
            if line.endswith("\t" + tty)
        )
        muted = run("show-option", "-gqv", "@color-text-muted")
        accent = run("show-option", "-gqv", "@color-accent-secondary")

        def capture_status_redraw() -> tuple[list[str], list[str | None]]:
            while select.select([master], [], [], 0)[0]:
                os.read(master, 65536)
            run("refresh-client", "-t", tty, "-S")
            data = b""
            deadline = time.time() + 1
            quiet_since: float | None = None
            while time.time() < deadline:
                if select.select([master], [], [], 0.05)[0]:
                    data += os.read(master, 65536)
                    quiet_since = None
                elif data:
                    quiet_since = quiet_since or time.time()
                    if time.time() - quiet_since >= 0.1:
                        break
            chars, colors = render_terminal(data, 30, 101)
            return chars[1], colors[1]

        def check_stripe(pane: str, should_highlight: bool) -> None:
            window_id = run("display-message", "-p", "-t", pane, "#{window_id}")
            run("switch-client", "-c", client_name, "-t", window_id)
            run("select-pane", "-t", pane)
            value = run("display-message", "-p", "-c", client_name, "-t", pane,
                        "#{E:status-format[1]}")
            left, width, window = map(int, run(
                "display-message", "-p", "-t", pane,
                "#{pane_left} #{pane_width} #{window_width}",
            ).split())
            if should_highlight:
                left_border = left > 0
                start = max(0, left - 1)
                right_border = left + width < window
                end = min(window, left + width + 1)
                suffix = 101 - end
                active_text = ("+" if left_border else "") + "─" * width
                if right_border:
                    active_text += "+"
                expected = (f"#[fg={muted}]" + "─" * start +
                            f"#[fg={accent}]" + active_text +
                            f"#[fg={muted}]" + "─" * suffix)
            else:
                if width != window:
                    raise AssertionError("full-width stripe test targeted a partial pane")
                expected = f"#[fg={muted}]" + "─" * 101
            if value != expected:
                raise AssertionError(
                    f"stripe mismatch for {pane}: geometry={left}/{width}/{window} "
                    f"actual={value!r} expected={expected!r}"
                )
            expected_colors = [muted.lower()] * 101
            if should_highlight:
                expected_colors[start:end] = [accent.lower()] * (end - start)
            expected_chars = ["─"] * 101
            if should_highlight and left_border:
                expected_chars[left - 1] = "+"
            if should_highlight and right_border:
                expected_chars[left + width] = "+"
            rendered_chars, rendered_colors = capture_status_redraw()
            if rendered_chars != expected_chars or rendered_colors != expected_colors:
                runs = []
                for color in rendered_colors:
                    if not runs or runs[-1][0] != color:
                        runs.append([color, 1])
                    else:
                        runs[-1][1] += 1
                raise AssertionError(
                    f"rendered stripe mismatch for {pane}: "
                    f"text={''.join(rendered_chars)!r} color-runs={runs!r}"
                )

        full = run("display-message", "-p", "-t", "=stripe:", "#{pane_id}")
        check_stripe(full, False)

        right = run("split-window", "-h", "-P", "-F", "#{pane_id}", "-t", full)
        check_stripe(full, True)
        check_stripe(right, True)
        run("resize-pane", "-Z", "-t", full)
        check_stripe(full, False)
        run("resize-pane", "-Z", "-t", full)

        third = run("split-window", "-h", "-P", "-F", "#{pane_id}", "-t", right)
        columns = sorted((int(left), pane) for pane, left in (
            line.split("\t") for line in run(
                "list-panes", "-t", "=stripe:", "-F", "#{pane_id}\t#{pane_left}",
            ).splitlines()
        ))
        check_stripe(columns[1][1], True)
        run("kill-pane", "-t", third)

        stacked_window = run("new-window", "-d", "-P", "-F", "#{window_id}",
                             "-t", "=stripe:", "-n", "stacked")
        stacked_top = run("display-message", "-p", "-t", stacked_window, "#{pane_id}")
        stacked_bottom = run("split-window", "-v", "-P", "-F", "#{pane_id}",
                             "-t", stacked_top)
        check_stripe(stacked_top, False)
        check_stripe(stacked_bottom, False)

        mixed_window = run("new-window", "-d", "-P", "-F", "#{window_id}",
                           "-t", "=stripe:", "-n", "mixed")
        mixed_left = run("display-message", "-p", "-t", mixed_window, "#{pane_id}")
        mixed_right = run("split-window", "-h", "-P", "-F", "#{pane_id}",
                          "-t", mixed_left)
        mixed_lower_left = run("split-window", "-v", "-P", "-F", "#{pane_id}",
                               "-t", mixed_left)
        check_stripe(mixed_left, True)
        check_stripe(mixed_lower_left, True)
        check_stripe(mixed_right, True)
    finally:
        run("kill-server", check=False)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=1)
        os.close(slave)
        os.close(master)


def verify_footer_centering() -> None:
    parity_cases = 0
    inactive_color_cases = 0

    def run_case(cols: int, layout: str) -> None:
        nonlocal parity_cases, inactive_color_cases
        socket = f"{SOCKET}-footer-{cols}-{layout}"
        base = ["tmux", "-L", socket]

        def run(*args: str, check: bool = True) -> str:
            proc = subprocess.run(base + list(args), text=True, capture_output=True)
            if check and proc.returncode:
                raise RuntimeError(proc.stderr.strip())
            return proc.stdout.rstrip("\n")

        master, slave = os.openpty()
        proc = None
        try:
            run("-f", str(ROOT / "tmux.conf"), "new-session", "-d", "-s", "footer",
                "-x", str(cols), "-y", "30")
            first = run("display-message", "-p", "-t", "=footer:", "#{pane_id}")
            right = run("split-window", "-h", "-P", "-F", "#{pane_id}", "-t", first)
            panes = [first, right]
            if layout == "three":
                panes.append(run("split-window", "-h", "-P", "-F", "#{pane_id}",
                                 "-t", right))
            elif layout == "mixed":
                panes.append(run("split-window", "-v", "-P", "-F", "#{pane_id}",
                                 "-t", first))
            panes.sort(key=lambda pane: tuple(map(int, run(
                "display-message", "-p", "-t", pane, "#{pane_left} #{pane_top}",
            ).split())))

            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, cols, 0, 0))
            env = os.environ.copy() | {"TERM": "xterm-ghostty"}
            env.pop("TMUX", None)
            proc = subprocess.Popen(base + ["attach", "-t", "=footer"], env=env,
                                    stdin=slave, stdout=slave, stderr=slave,
                                    start_new_session=True)
            tty = os.ttyname(slave)
            wait_for(lambda: tty in run("list-clients", "-F", "#{client_tty}"),
                     f"{cols}/{layout} footer client did not attach")
            active_marker = run("show-option", "-gqv", "@color-accent-tertiary").lower()
            inactive_marker = run("show-option", "-gqv", "@color-accent-primary").lower()
            muted_marker = run("show-option", "-gqv", "@color-text-muted").lower()

            def capture() -> tuple[list[list[str]], list[list[str | None]]]:
                while select.select([master], [], [], 0)[0]:
                    os.read(master, 65536)
                run("refresh-client", "-t", tty)
                data = b""
                deadline = time.time() + 1
                quiet_since: float | None = None
                while time.time() < deadline:
                    if select.select([master], [], [], 0.05)[0]:
                        data += os.read(master, 65536)
                        quiet_since = None
                    elif data:
                        quiet_since = quiet_since or time.time()
                        if time.time() - quiet_since >= 0.1:
                            break
                return render_terminal(data, 30, cols)

            for pane in panes:
                left, width, top, height, window = map(int, run(
                    "display-message", "-p", "-t", pane,
                    "#{pane_left} #{pane_width} #{pane_top} #{pane_height} #{window_width}",
                ).split())
                if width == window:
                    continue
                span_start = max(0, left - 1)
                span_end = min(window - 1, left + width)
                target_center = (span_start + span_end) / 2
                for label, needle in (("CENTER", "CENTER"), ("", "*─*─*")):
                    for other in panes:
                        run("set-option", "-pu", "-t", other, "@pane-label")
                    if label:
                        run("set-option", "-p", "-t", pane, "@pane-label", label)
                    for active in (True, False):
                        focus = pane if active else next(other for other in panes if other != pane)
                        run("select-pane", "-t", focus)
                        if (label and width % 2 and left + width == window
                                and len(label) % 2 == 0):
                            expanded = run("display-message", "-p", "-t", pane,
                                           "#{E:pane-border-format}")
                            plain = re.sub(r"#\[[^]]*\]", "", expanded)
                            if not plain.endswith("*──") or plain.endswith("*────"):
                                state = "active" if active else "inactive"
                                raise AssertionError(
                                    f"{state} odd right-edge/even-label parity pad "
                                    f"is not two cells: {plain!r}"
                                )
                            parity_cases += 1
                        chars, colors = capture()
                        footer_row = 2 + top + height
                        row = "".join(chars[footer_row])
                        index = row.find(needle, span_start, span_end + 1)
                        state = "active" if active else "inactive"
                        if index < 0:
                            raise AssertionError(
                                f"{cols}/{layout}/{pane}/{state} footer lacks "
                                f"{needle!r}: {row!r}"
                            )
                        expected_marker = active_marker if active else inactive_marker
                        if colors[footer_row][index] != expected_marker:
                            raise AssertionError(
                                f"{cols}/{layout}/{pane}/{state}/{needle} marker "
                                f"color={colors[footer_row][index]!r} expected={expected_marker}"
                            )
                        if not label and not active:
                            motif = "*───*───*───*───*───*─*─*───*───*───*───*───*"
                            motif_start = row.find(motif, span_start, span_end + 1)
                            if motif_start >= 0:
                                inactive_color_cases += 1
                                star_offsets = [i for i, char in enumerate(motif) if char == "*"]
                                for star_index, offset in enumerate(star_offsets):
                                    expected = muted_marker if star_index < 3 or star_index >= 10 else inactive_marker
                                    actual = colors[footer_row][motif_start + offset]
                                    if actual != expected:
                                        raise AssertionError(
                                            f"{cols}/{layout}/{pane}/inactive star {star_index} "
                                            f"color={actual!r} expected={expected}"
                                        )
                        actual_center = index + (len(needle) - 1) / 2
                        fraction = (len(needle) - 1) / 2 % 1
                        expected_center = int(target_center - fraction) + fraction
                        if actual_center != expected_center:
                            raise AssertionError(
                                f"{cols}/{layout}/{pane}/{state}/{needle} "
                                f"center={actual_center} expected nearest-left="
                                f"{expected_center} span={span_start}:{span_end}"
                            )
        finally:
            run("kill-server", check=False)
            if proc and proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=1)
            os.close(slave)
            os.close(master)

    run_case(181, "two")
    run_case(180, "two")
    run_case(181, "three")
    run_case(180, "mixed")
    if parity_cases == 0:
        raise AssertionError("footer matrix missed odd right-edge/even-label parity")
    if inactive_color_cases == 0:
        raise AssertionError("footer matrix missed a fully visible inactive unlabeled motif")


def verify_zoom_render() -> None:
    """Attach after zoom is established so the first frame is a complete repaint."""
    socket = f"{SOCKET}-zoom"
    base = ["tmux", "-L", socket]

    def run(*args: str, check: bool = True) -> str:
        proc = subprocess.run(base + list(args), text=True, capture_output=True)
        if check and proc.returncode:
            raise RuntimeError(proc.stderr.strip())
        return proc.stdout.rstrip("\n")

    master, slave = os.openpty()
    proc = None
    try:
        run("-f", str(ROOT / "tmux.conf"), "new-session", "-d", "-s", "zoom-render",
            "-x", "180", "-y", "40")
        pane = run("display-message", "-p", "-t", "=zoom-render:", "#{pane_id}")
        run("split-window", "-h", "-t", pane)
        run("select-pane", "-t", pane)
        run("set-option", "-p", "-t", pane, "@pane-label", "label")
        run("resize-pane", "-Z", "-t", pane)
        divider = run("show-option", "-gqv", "@color-divider")

        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 180, 0, 0))
        env = os.environ.copy() | {"TERM": "xterm-ghostty"}
        env.pop("TMUX", None)
        proc = subprocess.Popen(base + ["attach", "-t", "=zoom-render"], env=env,
                                stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        divider_rgb = tuple(int(divider[i:i + 2], 16) for i in (1, 3, 5))
        divider_escape = f"\x1b[48;2;{divider_rgb[0]};{divider_rgb[1]};{divider_rgb[2]}m".encode()
        rendered = b""
        end = time.time() + 3
        while time.time() < end and divider_escape not in rendered:
            if select.select([master], [], [], 0.1)[0]:
                rendered += os.read(master, 65536)
        time.sleep(0.05)
        while select.select([master], [], [], 0)[0]:
            rendered += os.read(master, 65536)
        if divider_escape not in rendered:
            backgrounds = sorted(set(re.findall(rb"\x1b\[48[^m]*m", rendered)))
            raise AssertionError(f"rendered zoom footer lacks divider background: expected={divider_escape!r} seen={backgrounds!r}")
        terminal_text = re.sub(rb"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))", b"", rendered)
        terminal_text = terminal_text.replace(b"\x1b(B", b"").replace(b"\x1b=", b"")
        shape = "*───*───*───*───*───label───*───*───*───*───*".encode()
        if shape not in terminal_text:
            raise AssertionError("initial attached frame lacks the zoomed labeled footer cells")
    finally:
        run("kill-server", check=False)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                proc.kill()
        os.close(slave)
        os.close(master)


def main() -> int:
    tmp = tempfile.mkdtemp(prefix="tmux-render-", dir="/tmp")
    old_tmux_tmpdir = os.environ.get("TMUX_TMPDIR")
    os.environ["TMUX_TMPDIR"] = tmp
    env = os.environ.copy()
    master, slave = os.openpty()
    proc = None
    try:
        subprocess.run(["tmux", "-L", SOCKET, "-f", str(ROOT / "tmux.conf"),
                        "new-session", "-d", "-s", "alpha", "-x", "220", "-y", "40"],
                       env=env, check=True, capture_output=True)
        prefix_w = "\n".join(line for line in tmux("list-keys", "-T", "prefix").splitlines()
                             if re.search(r"-T prefix +w +", line))
        if "tmux-window-ls" not in prefix_w:
            raise AssertionError(f"prefix w is not the documented picker: {prefix_w!r}")
        root_keys = tmux("list-keys", "-T", "root")
        if "M-Tab" not in root_keys or "M-BTab" not in root_keys or "M-S-Tab" in root_keys:
            raise AssertionError("sidebar Meta/Backtab bindings do not match the transport contract")
        if not re.search(r"MouseDown1StatusRight\s+run-shell -b .*tmux-cycle-session previous", root_keys):
            raise AssertionError("status-right left click is not previous-session cycling")
        if not re.search(r"MouseDown3StatusRight\s+run-shell -b .*tmux-cycle-session next", root_keys):
            raise AssertionError("status-right right click is not next-session cycling")

        tmux("new-session", "-d", "-s", "float-work")
        tmux("new-session", "-d", "-s", "float")
        tmux("new-session", "-d", "-s", "omega")
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 220, 0, 0))
        tty = os.ttyname(slave)
        client_env = env | {"TERM": "xterm-ghostty"}
        proc = subprocess.Popen(["tmux", "-L", SOCKET, "attach", "-t", "=alpha"], env=client_env,
                                stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        slave = -1
        wait_for(lambda: tty in tmux("list-clients", "-F", "#{client_tty}"), "client did not attach")
        # Detached new-session calls update tmux's preferred session; pin this
        # specific attached client to the test session before exercising ranges.
        clients = (line.split("\t", 1) for line in
                   tmux("list-clients", "-F", "#{client_name}\t#{client_tty}").splitlines())
        client_name = next(name for name, client_tty in clients if client_tty == tty)

        def client_state() -> tuple[str, str, str]:
            rows = (line.split("\t") for line in
                    tmux("list-clients", "-F",
                         "#{client_name}\t#{session_name}\t#{window_index}\t#{client_width}").splitlines())
            for name, session, window, width in rows:
                if name == client_name:
                    return session, window, width
            raise AssertionError("attached client disappeared")

        tmux("switch-client", "-c", client_name, "-t", "=alpha")
        wait_for(lambda: client_state()[0] == "alpha", "client did not switch to alpha")

        def resize(cols: int) -> None:
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, cols, 0, 0))
            proc.send_signal(signal.SIGWINCH)
            wait_for(lambda: client_state()[2] == str(cols), f"client did not resize to {cols}")
            tmux("refresh-client", "-t", tty, "-S")
            time.sleep(0.08)

        resize(12)
        narrow = tmux("display-message", "-p", "-c", client_name, "-t", "=alpha:", "#{E:status-right}")
        plain = re.sub(r"#\[[^]]*\]", "", narrow)
        if plain != "alpha":
            raise AssertionError(f"narrow status tier = {plain!r}")

        resize(220)
        wide = tmux("display-message", "-p", "-c", client_name, "-t", "=alpha:", "#{E:status-right}")
        if "[" not in wide or "#[underscore]" not in wide:
            raise AssertionError(f"wide status tier missing session stars: {wide!r}")
        before_active = wide[:wide.find("#[underscore]")]
        if before_active.count(" * ") != 1:
            raise AssertionError("only the exact float session should precede the active non-float session")

        def click_status_right(button: int, expected_session: str) -> None:
            tmux("switch-client", "-c", client_name, "-t", "=alpha")
            wait_for(lambda: client_state()[0] == "alpha", "client did not reset to alpha")
            os.write(master, f"\x1b[<{button};220;1M".encode())
            wait_for(
                lambda: client_state()[0] == expected_session,
                f"status-right button {button} did not switch to {expected_session}",
            )

        click_status_right(0, "float")
        click_status_right(2, "float-work")
        tmux("switch-client", "-c", client_name, "-t", "=alpha")
        wait_for(lambda: client_state()[0] == "alpha", "client did not return to alpha")

        def plain_format(value: str) -> str:
            return re.sub(r"#\[[^]]*\]", "", value)

        pane = tmux("display-message", "-p", "-t", "=alpha:", "#{pane_id}")
        inactive = tmux("split-window", "-h", "-P", "-F", "#{pane_id}", "-t", pane)
        tmux("select-pane", "-t", pane)
        base_footer = {
            (pane, ""): "*───*───*───*───*───*─*─*───*───*───*───*───*",
            (inactive, ""): "*───*───*───*───*───*─*─*───*───*───*───*───*",
            (pane, "label"): "*───*───*───*───*───label───*───*───*───*───*",
            (inactive, "label"): "*───*───*───*───*───label───*───*───*───*───*",
        }

        def footer_pad(target: str, label: str) -> str:
            left, width, window = map(int, tmux(
                "display-message", "-p", "-t", target,
                "#{pane_left} #{pane_width} #{window_width}",
            ).split())
            if width == window:
                return ""
            if left + width < window:
                return "──"
            if width % 2 and label and len(label) % 2 == 0:
                return "──"
            return "────"

        expected = {
            key: shape + footer_pad(key[0], key[1]) for key, shape in base_footer.items()
        }
        for (target, label), shape in expected.items():
            if label:
                tmux("set-option", "-p", "-t", target, "@pane-label", label)
            else:
                tmux("set-option", "-pu", "-t", target, "@pane-label")
            footer = tmux("display-message", "-p", "-t", target, "#{E:pane-border-format}")
            if plain_format(footer) != shape:
                raise AssertionError(f"footer shape mismatch: {plain_format(footer)!r} != {shape!r}")

        normal = tmux("display-message", "-p", "-t", pane, "#{E:pane-border-format}")
        tmux("resize-pane", "-Z", "-t", pane)
        zoomed = tmux("display-message", "-p", "-t", pane, "#{E:pane-border-format}")
        if plain_format(normal) != plain_format(zoomed) + "──":
            raise AssertionError("zoom did not remove only the outer-column centering bias")
        divider = tmux("show-option", "-gqv", "@color-divider")
        canvas = tmux("show-option", "-gqv", "@color-canvas")
        if f"#[bg={divider}]" not in zoomed or not zoomed.endswith(f"#[bg={canvas}]"):
            raise AssertionError(f"zoomed footer lacks a scoped background block: {zoomed!r}")
        if f"#[bg={divider}]" in normal:
            raise AssertionError("normal footer unexpectedly has the zoom background")

        # The production status styles must survive #{E:...} expansion. Uppercase
        # #D used to become the #D pane-ID shorthand, invalidating the range style.
        for style in ("window-status-style", "window-status-current-style",
                      "window-status-last-style", "window-status-activity-style",
                      "window-status-bell-style"):
            expanded = tmux("display-message", "-p", f"#{{E:{style}}}")
            if "%" in expanded or re.search(r"#[0-9A-Fa-f]{6}", expanded) is None:
                raise AssertionError(f"unsafe expanded {style}: {expanded!r}")

        tmux("resize-pane", "-Z", "-t", pane)
        verify_status_click(220)
        verify_status_click(40)
        verify_status_stripe_layouts()
        verify_footer_centering()
        verify_zoom_render()

        print("ok: attached tmux status clicks and footer states")
        return 0
    finally:
        tmux("kill-server", check=False)
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                proc.kill()
        if slave >= 0:
            os.close(slave)
        os.close(master)
        if old_tmux_tmpdir is None:
            os.environ.pop("TMUX_TMPDIR", None)
        else:
            os.environ["TMUX_TMPDIR"] = old_tmux_tmpdir
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
