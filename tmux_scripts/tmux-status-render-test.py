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

        tmux("new-session", "-d", "-s", "float-work")
        tmux("new-session", "-d", "-s", "float")
        tmux("new-session", "-d", "-s", "omega")
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 220, 0, 0))
        tty = os.ttyname(slave)
        client_env = env | {"TERM": "xterm-256color"}
        proc = subprocess.Popen(["tmux", "-L", SOCKET, "attach", "-t", "alpha"], env=client_env,
                                stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        slave = -1
        wait_for(lambda: tty in tmux("list-clients", "-F", "#{client_tty}"), "client did not attach")

        def resize(cols: int) -> None:
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, cols, 0, 0))
            proc.send_signal(signal.SIGWINCH)
            wait_for(lambda: tmux("display-message", "-p", "-c", tty, "#{client_width}") == str(cols),
                     f"client did not resize to {cols}")
            tmux("refresh-client", "-t", tty, "-S")
            time.sleep(0.08)

        resize(12)
        narrow = tmux("display-message", "-p", "-c", tty, "#{E:status-right}")
        plain = re.sub(r"#\[[^]]*\]", "", narrow)
        if plain != "alpha":
            raise AssertionError(f"narrow status tier = {plain!r}")

        resize(220)
        wide = tmux("display-message", "-p", "-c", tty, "#{E:status-right}")
        if "[" not in wide or "#[underscore]" not in wide:
            raise AssertionError(f"wide status tier missing session stars: {wide!r}")
        before_active = wide[:wide.find("#[underscore]")]
        if before_active.count(" * ") != 1:
            raise AssertionError("only the exact float session should precede the active non-float session")

        pane = tmux("display-message", "-p", "-t", "=alpha:", "#{pane_id}")
        tmux("split-window", "-h", "-t", pane)
        tmux("select-pane", "-t", pane)
        tmux("set-option", "-p", "-t", pane, "@pane-label", "focus label")
        footer = tmux("display-message", "-p", "-t", pane, "#{E:pane-border-format}")
        if "focus label" not in footer or "underscore" in footer:
            raise AssertionError(f"normal labeled footer mismatch: {footer!r}")
        tmux("resize-pane", "-Z", "-t", pane)
        zoomed = tmux("display-message", "-p", "-t", pane, "#{E:pane-border-format}")
        if "focus label" not in zoomed or len(zoomed) <= len(footer):
            raise AssertionError("zoomed labeled footer did not use its expanded state")

        # Force a complete status redraw on the disposable attached client.
        tmux("set-option", "-g", "status", "off")
        tmux("set-option", "-g", "status", "2")
        tmux("refresh-client", "-t", tty)
        time.sleep(0.08)
        rendered = b""
        while select.select([master], [], [], 0)[0]:
            rendered += os.read(master, 65536)
        if not rendered:
            raise AssertionError("attached client produced no redraw output")

        print("ok: attached tmux status and footer states")
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
