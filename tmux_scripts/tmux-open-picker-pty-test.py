#!/usr/bin/env python3
"""Smoke-test the tmux-open-picker curses UI under a pty (stdlib only).

For each scenario, monkeypatch capture_pane/pane_cwd to return fixture content,
run main() in a child pty, feed 'q' (or Esc), and assert the child exits 0 with
no traceback. Catches curses crashes on empty/narrow/long-label states that the
extraction unit tests can't reach.

Run: python3 tmux_scripts/tmux-open-picker-pty-test.py
"""
import fcntl
import importlib.machinery
import importlib.util
import os
import pty
import struct
import sys
import termios
import time

HERE = os.path.dirname(os.path.abspath(__file__))
MODULE = os.path.join(HERE, "tmux-open-picker")

SCENARIOS = [
    ("empty", "", []),
    ("url-only", "see https://example.com and www.foo.bar/x\n", []),
    ("path-only", "open notes.txt and src/main.rs:7\n", ["/tmp"]),
    ("mixed", "visit https://x.com\nsee src/main.rs:7\nedit notes.txt\n", ["/tmp"]),
    ("long-label", "see " + ("a" * 400) + ".txt and https://example.com/" + ("z" * 300) + "\n", ["/tmp"]),
]


def load():
    loader = importlib.machinery.SourceFileLoader("p", MODULE)
    spec = importlib.util.spec_from_loader("p", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


def run_scenario(name, content, cwds, key=b"q", winsize=(24, 80)):
    mod = load()
    mod.capture_pane = lambda pane: content
    mod.pane_cwd = lambda pane: (cwds[0] if cwds else "/tmp")

    pid, fd = pty.fork()
    if pid == 0:
        # child
        try:
            rows, cols = winsize
            fcntl.ioctl(1, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
            mod.main("%9")
        except SystemExit:
            os._exit(0)
        except BaseException as e:
            sys.stderr.write("TRACEBACK %s: %r\n" % (name, e))
            os._exit(1)
        os._exit(0)

    # parent
    deadline = time.time() + 3
    time.sleep(0.3)
    try:
        os.write(fd, key)
    except OSError:
        pass
    status = None
    while time.time() < deadline:
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
        except OSError:
            status = 0
            break
        if wpid == pid:
            break
        time.sleep(0.05)
    if status is None:
        try:
            os.kill(pid, 9)
        except OSError:
            pass
        try:
            os.waitpid(pid, 0)
        except OSError:
            pass
        return False, "timeout"
    code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else -1
    # drain any child stderr
    try:
        err = os.read(fd, 65536).decode("utf-8", "replace")
    except OSError:
        err = ""
    return code == 0, ("exit=%d %s" % (code, err.strip()[:200]))


def main():
    fails = 0
    for name, content, cwds in SCENARIOS:
        for key, label in [(b"q", "q"), (b"\x1b", "Esc")]:
            ok, info = run_scenario(name, content, cwds, key=key, winsize=(24, 80))
            print(("ok   " if ok else "FAIL ") + "%s [%s] %s" % (name, label, info if not ok else ""))
            if not ok:
                fails += 1
    # narrow + resized
    ok, info = run_scenario("narrow", SCENARIOS[3][1], ["/tmp"], key=b"q", winsize=(6, 20))
    print(("ok   " if ok else "FAIL ") + "narrow [q] " + (info if not ok else ""))
    if not ok:
        fails += 1
    # action menu: real file, switch to paths, Enter (open menu), Esc cancel, q quit
    import tempfile
    td = tempfile.mkdtemp(prefix="picker-pty-")
    open(os.path.join(td, "real.rs"), "w").close()
    ok, info = run_scenario("menu", "see real.rs:3\n", [td],
                            key=b"l" + b"\n" + b"\x1b" + b"q", winsize=(24, 80))
    print(("ok   " if ok else "FAIL ") + "menu [l Enter Esc q] " + (info if not ok else ""))
    if not ok:
        fails += 1
    print("fails=%d" % fails)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()