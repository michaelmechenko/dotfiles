#!/usr/bin/env python3
"""Byte-level and real attached-client tests; never uses the live clipboard/server."""
import base64
import importlib.util
import os
from pathlib import Path
import pty
import select
import shlex
import struct
import subprocess
import tempfile
import termios
import time
import unittest
import fcntl

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("dedent_copy", HERE / "tmux-copy-dedent.py")
assert spec and spec.loader
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class TransformTests(unittest.TestCase):
    def test_bytes(self):
        cases = [
            (b"   command", b"command"),
            (b"  first\n    second\n", b"first\n  second\n"),
            (b"   first\n     second\n", b"first\n  second\n"),
            (b"   first\n \t\n     second\n", b"first\n\n  second\n"),
            (b"   first\n     \n     second\n", b"first\n  \n  second\n"),
            (b"   first\r\n \r\n     second\t \r\n", b"first\r\n\r\n  second\t \r\n"),
            (b" \ta\n   b", b"a\n b"),
            (b"\ta\n\t\t\tb", b"a\n\t\tb"),
            (b" \ta\n  \tb", b"a\n\tb"),
            (b"  first\n  second\n", b"first\nsecond\n"),
            (b"", b""), (b" \t\n  \r\n", b" \t\n  \r\n"),
            (b"  a\nzero\n", b"  a\nzero\n"),
            (b"  a\r\n \r\n  b \t\r\n", b"a\r\n\r\nb \t\r\n"),
            (b"\t  a\n\t  b", b"a\nb"),
            (b" \ta\n  b", b"a\nb"),
            (b"  a\n\n  b\n", b"a\n\nb\n"),
            ("  café\n  日本語".encode(), "café\n日本語".encode()),
            (b"  \xff\x0bcontent\t\n", b"\xff\x0bcontent\t\n"),
            ("\u00a0a\n  b".encode(), "\u00a0a\n  b".encode()),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertEqual(helper.dedent(raw), expected)


class BindingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dedent-test-")
        self.root = Path(self.temp.name)
        self.socket = str(self.root / "tmux socket")
        self.env = dict(os.environ, HOME=str(self.root), TERM="xterm-256color")
        self.env.pop("TMUX", None)
        self.env.pop("TMUX_PANE", None)
        scripts = self.root / ".config/tmux_scripts"
        scripts.mkdir(parents=True)
        (scripts / "tmux-copy-dedent.py").symlink_to(HERE / "tmux-copy-dedent.py")
        self.sink = self.root / "clipboard"
        self.clipboard = self.root / ".config/qol_scripts/copy"
        self.clipboard.parent.mkdir(parents=True)
        self.clipboard.write_text("#!/bin/sh\ncat > " + shlex.quote(str(self.sink)) + "\n")
        self.clipboard.chmod(0o755)
        self.base = ["tmux", "-S", self.socket, "-f", "/dev/null"]
        self.run_tmux("new-session", "-d", "-s", "test", "-x", "80", "-y", "24")
        self.run_tmux("set", "-g", "status", "off")
        self.run_tmux("set", "-s", "set-clipboard", "external")
        self.run_tmux("set", "-as", "terminal-overrides", ",xterm*:Ms=\\E]52;%p1%s;%p2%s\\007")
        config = (HERE.parent / "tmux.conf").read_text()
        start = config.index("set-window-option -g mode-keys vi")
        end = config.index("# flash.nvim-style jump", start)
        fragment = self.root / "copy.conf"
        fragment.write_text(config[start:end])
        self.run_tmux("source-file", str(fragment))
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        self.client = subprocess.Popen(
            self.base + ["attach", "-t", "test"], stdin=slave, stdout=slave,
            stderr=slave, env=self.env,
        )
        os.close(slave)
        self.wait(lambda: bool(self.run_tmux("list-clients").stdout))
        self.output = bytearray()
        self.drain()

    def tearDown(self):
        self.run_tmux("kill-server", check=False)
        self.client.wait(timeout=5)
        os.close(self.master)
        self.temp.cleanup()

    def run_tmux(self, *args, check=True):
        return subprocess.run(self.base + list(args), env=self.env, capture_output=True,
                              check=check, timeout=5)

    def drain(self):
        while select.select([self.master], [], [], 0.03)[0]:
            try:
                self.output.extend(os.read(self.master, 65536))
            except OSError:
                break

    def wait(self, predicate):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if predicate():
                return
            if hasattr(self, "output"):
                self.drain()
            time.sleep(0.02)
        self.fail("isolated tmux operation timed out")

    def fixture(self, data):
        path = self.root / "fixture"
        path.write_bytes(data)
        command = "cat " + shlex.quote(str(path)) + "; sleep 60"
        self.run_tmux("respawn-pane", "-k", "-t", "test:0.0", command)
        self.wait(lambda: data.split(b"\n")[0].rstrip() in self.run_tmux("capture-pane", "-p", "-J").stdout)
        self.drain()

    def select_text(self, commands):
        self.run_tmux("copy-mode", "-t", "test:0.0")
        self.run_tmux("send-keys", "-X", "top-line")
        self.run_tmux("send-keys", "-X", "beginning-of-line")
        for command in commands:
            if isinstance(command, bytes):
                os.write(self.master, command)
                time.sleep(0.08)
            else:
                self.run_tmux("send-keys", "-X", command)

    def press_copy(self, key):
        self.sink.unlink(missing_ok=True)
        self.output.clear()
        os.write(self.master, key)
        self.wait(lambda: self.run_tmux("display", "-p", "#{pane_in_mode}").stdout.strip() == b"0")
        self.wait(lambda: self.sink.exists() and self.sink.stat().st_size > 0)
        self.wait(lambda: bool(self.run_tmux("list-buffers").stdout))
        self.drain()
        return self.run_tmux("save-buffer", "-").stdout

    def compare(self, data, commands):
        self.fixture(data)
        self.select_text(commands)
        raw = self.press_copy(b"\r")
        self.assertEqual(self.sink.read_bytes(), raw)
        count = len(self.run_tmux("list-buffers").stdout.splitlines())
        self.select_text(commands)
        result = self.press_copy(b"y")
        self.assertEqual(result, helper.dedent(raw))
        self.assertEqual(self.sink.read_bytes(), result)
        self.assertEqual(len(self.run_tmux("list-buffers").stdout.splitlines()), count + 1)
        # The attached terminal receives only the processed OSC 52 payload.
        osc = bytes(self.output).split(b"\x1b]52;")[1:]
        self.assertTrue(osc)
        for entry in osc:
            payload = entry.split(b";", 1)[1].split(b"\x07", 1)[0]
            self.assertEqual(base64.b64decode(payload), result)
        return result

    def test_linewise_repeated_and_single(self):
        data = b"   first\n     second\n"
        self.assertEqual(self.compare(data, [b"V", "cursor-down"]), b"first\n  second\n")
        self.assertEqual(self.compare(b"   first\n   second\n",
                                     [b"V", "cursor-down"]), b"first\nsecond\n")
        self.assertEqual(self.compare(b"   command\n", [b"V"]), b"command\n")

    def test_production_clipboard_helper(self):
        self.clipboard.write_bytes((HERE.parent / "qol_scripts/copy").read_bytes())
        backend = self.root / "bin"
        backend.mkdir()
        (backend / "pbcopy").write_text("#!/bin/sh\ncat > " + shlex.quote(str(self.sink)) + "\n")
        (backend / "pbcopy").chmod(0o755)
        self.env["PATH"] = str(backend) + os.pathsep + os.environ["PATH"]
        # The tmux server predates this PATH; direct invocation exercises the real
        # helper's executable shebang and the dedent delivery boundary safely.
        subprocess.run([str(HERE / "tmux-copy-dedent.py"), self.socket],
                       input=b"  first\n    second\n", env=self.env,
                       check=True, capture_output=True)
        self.assertEqual(self.sink.read_bytes(), b"first\n  second\n")
        self.assertEqual(self.run_tmux("save-buffer", "-").stdout,
                         b"first\n  second\n")

    def test_characterwise_reverse_rectangle_and_wrap(self):
        for commands in ([b"v", "cursor-down", "end-of-line"],
                         ["cursor-down", "end-of-line", b"v", "cursor-up", "beginning-of-line"],
                         [b"v", "rectangle-toggle", "cursor-down", "cursor-right", "cursor-right", "cursor-right", "cursor-right"]):
            self.compare(b"   alpha\n     beta\n", commands)
        self.compare(b"   " + b"x" * 100 + b"\n     tail\n", [b"V", "cursor-down", "cursor-down"])

    def test_raw_control_j_and_mouse_binding(self):
        self.fixture(b"   raw\n")
        self.select_text([b"V"])
        self.assertEqual(self.press_copy(b"\n"), b"   raw\n")
        binding = next(line for line in self.run_tmux("list-keys", "-T", "copy-mode-vi").stdout.splitlines() if b"MouseDragEnd1Pane" in line)
        self.assertIn(b"qol_scripts/copy", binding)
        self.assertNotIn(b"dedent", binding)

    def test_mouse_drag_copies_raw_and_exits_at_live_bottom(self):
        self.run_tmux("set", "-g", "mouse", "on")
        self.fixture(b"   mouse raw\n")
        self.select_text([b"V"])
        self.sink.unlink(missing_ok=True)
        os.write(self.master, b"\x1b[<0;1;1M")
        time.sleep(0.08)
        os.write(self.master, b"\x1b[<32;12;1M")
        time.sleep(0.08)
        os.write(self.master, b"\x1b[<0;12;1m")
        self.wait(lambda: self.sink.exists() and self.sink.stat().st_size > 0)
        self.assertTrue(self.sink.read_bytes().startswith(b"   mouse"))
        self.assertEqual(self.run_tmux("save-buffer", "-").stdout, self.sink.read_bytes())
        self.assertEqual(self.run_tmux("display", "-p", "#{pane_in_mode}").stdout.strip(), b"0")

    def test_only_origin_client_receives_terminal_clipboard(self):
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        other = subprocess.Popen(self.base + ["attach", "-t", "test"],
                                 stdin=slave, stdout=slave, stderr=slave, env=self.env)
        os.close(slave)
        try:
            self.wait(lambda: len(self.run_tmux("list-clients").stdout.splitlines()) == 2)
            self.fixture(b"   targeted\n")
            self.select_text([b"V"])
            while select.select([master], [], [], 0.05)[0]:
                os.read(master, 65536)
            self.assertEqual(self.press_copy(b"y"), b"targeted\n")
            received = bytearray()
            while select.select([master], [], [], 0.2)[0]:
                received.extend(os.read(master, 65536))
            self.assertNotIn(b"\x1b]52;", received)
            self.assertIn(b"\x1b]52;", self.output)
        finally:
            # Only the test-owned attach client is terminated; no live server.
            other.terminate()
            other.wait(timeout=5)
            os.close(master)

    def test_explicit_socket_overrides_inherited_tmux(self):
        socket = str(self.root / "other socket")
        base = ["tmux", "-S", socket, "-f", "/dev/null"]
        subprocess.run(base + ["new-session", "-d", "-s", "other"],
                       env=self.env, check=True, capture_output=True)
        try:
            subprocess.run(base + ["set-buffer", "sentinel"], env=self.env, check=True)
            env = dict(self.env, TMUX=f"{socket},1,0")
            subprocess.run([str(HERE / "tmux-copy-dedent.py"), self.socket],
                           input=b"   explicit", env=env, check=True, capture_output=True)
            self.assertEqual(self.run_tmux("save-buffer", "-").stdout, b"explicit")
            self.assertEqual(self.sink.read_bytes(), b"explicit")
            self.assertEqual(subprocess.run(base + ["save-buffer", "-"], env=self.env,
                                           check=True, capture_output=True).stdout, b"sentinel")
        finally:
            subprocess.run(base + ["kill-server"], env=self.env, check=False,
                           capture_output=True)

    def test_clipboard_failure_retains_processed_buffer(self):
        self.clipboard.write_text("#!/bin/sh\nexit 7\n")
        self.fixture(b"   retained\n")
        self.select_text([b"V"])
        os.write(self.master, b"y")
        self.wait(lambda: self.run_tmux("save-buffer", "-", check=False).stdout == b"retained\n")
        self.wait(lambda: b"Dedented copy failed" in self.run_tmux("show-messages").stdout)
        self.assertEqual(len(self.run_tmux("list-buffers").stdout.splitlines()), 1)


if __name__ == "__main__":
    unittest.main()
