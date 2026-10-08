#!/usr/bin/env python3
"""Production window bindings/helpers on private sockets and attached PTYs."""
import os
from pathlib import Path
import pty
import select
import shlex
import shutil
import subprocess
import tempfile
import sys
import termios
import time
import unittest

ROOT = Path(__file__).resolve().parent


class WindowInsertTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="window-insert-")
        self.home = Path(self.temp.name)
        self.socket = str(self.home / "socket")
        self.scripts = self.home / ".config/tmux_scripts"
        self.scripts.mkdir(parents=True)
        for name in ("tmux-break-pane", "tmux-pane-to-new-window"):
            shutil.copy2(ROOT / name, self.scripts / name)
        real_tmux = shutil.which("tmux")
        assert real_tmux
        self.real_tmux: str = real_tmux
        bindir = self.home / "bin"
        bindir.mkdir()
        # Every helper command is confined to the test socket, even if inherited
        # environment or a missing target would otherwise choose another server.
        (bindir / "tmux").write_text(
            "#!/bin/sh\n"
            'printf "%s\\n" "$1" >> "$HOME/commands"\n'
            '[ "$1" != break-pane ] || exit 99\n'
            '[ "$1" != "${WINDOW_INSERT_FAIL:-}" ] || exit 7\n'
            f"exec {shlex.quote(self.real_tmux)} -S {shlex.quote(self.socket)} \"$@\"\n"
        )
        (bindir / "tmux").chmod(0o755)
        self.env = dict(os.environ, HOME=str(self.home), TERM="xterm-256color",
                        PATH=str(bindir) + os.pathsep + os.environ["PATH"])
        for key in ("TMUX", "TMUX_PANE", "WINDOW_INSERT_FAIL"):
            self.env.pop(key, None)
        self.clients = []
        config = self.home / "tmux.conf"
        lines = (ROOT.parent / "tmux.conf").read_text().splitlines()
        bindings = [line for line in lines if line.startswith((
            "bind-key -n M-e ", "bind-key -n M-q ", "bind q ", "bind c "
        ))]
        self.assertEqual(len(bindings), 4)
        config.write_text(
            "set -g base-index 1\nset -g renumber-windows on\n"
            "set -g status off\nset -g default-shell /bin/sh\n"
            "set -g default-command 'sleep 120'\nset -g prefix C-Space\n" +
            "\n".join(bindings) + "\n"
        )
        self.config = config

    def tearDown(self):
        self.tmux("kill-server", check=False)
        for proc, master in self.clients:
            proc.wait(timeout=5)
            os.close(master)
        self.temp.cleanup()

    def tmux(self, *args, check=True):
        return subprocess.run([self.real_tmux, "-S", self.socket, *args],
                              env=self.env, text=True, capture_output=True,
                              check=check, timeout=5).stdout.strip()

    def fmt(self, target, value):
        return self.tmux("display-message", "-p", "-t", target, value)

    def wait(self, predicate):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            for _, master in self.clients:
                while select.select([master], [], [], 0)[0]:
                    try:
                        os.read(master, 65536)
                    except OSError:
                        break
            if predicate():
                return
            time.sleep(.03)
        self.fail("isolated window operation timed out")

    def session(self, name="test"):
        first = self.tmux("-f", str(self.config), "new-session", "-d", "-s", name,
                          "-P", "-F", "#{window_id}", "-n", "window1")
        windows = [first]
        for i in (2, 3):
            windows.append(self.tmux("new-window", "-d", "-t", name + ":",
                                     "-n", f"window{i}", "-P", "-F", "#{window_id}"))
        return windows

    def attach(self, session="test"):
        master, slave = pty.openpty()
        termios.tcsetwinsize(slave, (30, 100))
        tty = os.ttyname(slave)
        proc = subprocess.Popen([self.real_tmux, "-S", self.socket, "attach", "-t", session],
                                env=self.env, stdin=slave, stdout=slave, stderr=slave)
        os.close(slave)
        self.clients.append((proc, master))
        self.wait(lambda: tty in self.tmux("list-clients", "-F", "#{client_tty}"))
        return master, tty

    def windows(self, session="test"):
        return [row.split() for row in self.tmux(
            "list-windows", "-t", session, "-F", "#{window_index} #{window_id}").splitlines()]

    def assert_order(self, expected, session="test"):
        rows = self.windows(session)
        self.assertEqual([row[1] for row in rows], expected)
        self.assertEqual([int(row[0]) for row in rows], list(range(1, len(rows) + 1)))

    def invoke(self, name, pane, *args, env=None, check=True):
        return subprocess.run([str(self.scripts / name), pane, *args],
                              env=env or self.env, text=True, capture_output=True,
                              check=check, timeout=5)

    def test_new_window_edges_and_cwd(self):
        for position in (0, 1, 2):
            with self.subTest(position=position):
                name = f"edge{position}"
                windows = self.session(name)
                origin = windows[position]
                cwd = self.home / "directory with spaces"
                cwd.mkdir(exist_ok=True)
                pane = self.fmt(origin, "#{pane_id}")
                self.tmux("respawn-pane", "-k", "-t", pane, "-c", str(cwd), "sleep 120")
                self.tmux("select-window", "-t", origin)
                master, _ = self.attach(name)
                os.write(master, b"\x1be")
                self.wait(lambda: len(self.windows(name)) == 4)
                new = self.fmt(name + ":", "#{window_id}")
                self.assertNotIn(new, windows)
                self.assert_order(windows[:position + 1] + [new] + windows[position + 1:], name)
                self.assertEqual(self.fmt(new, "#{pane_current_path}"), str(cwd))

    def test_new_window_index_gap_and_prefix_c_unchanged(self):
        windows = self.session()
        self.tmux("set", "-g", "renumber-windows", "off")
        self.tmux("move-window", "-s", windows[2], "-t", "test:7")
        self.tmux("select-window", "-t", windows[1])
        master, _ = self.attach()
        os.write(master, b"\x1be")
        self.wait(lambda: len(self.windows()) == 4)
        rows = self.windows()
        self.assertEqual([int(row[0]) for row in rows], [1, 2, 3, 7])
        self.assertEqual(rows[-1][1], windows[2])
        self.tmux("select-window", "-t", windows[1])
        os.write(master, b"\x00c")
        self.wait(lambda: len(self.windows()) == 5)
        binding = next(row for row in self.tmux("list-keys", "-T", "prefix").splitlines()
                       if row.split()[3] == "c")
        self.assertIn("new-window -c", binding)
        self.assertNotIn("new-window -a", binding)

    def test_breakout_bindings_preserve_pane_and_name(self):
        for key in (b"\x1bq", b"\x00q"):
            with self.subTest(key=key):
                name = "break" + str(key[-1]) + ("meta" if key[0] else "prefix")
                windows = self.session(name)
                origin = windows[1]
                pane = self.fmt(origin, "#{pane_id}")
                self.tmux("respawn-pane", "-k", "-t", pane, "printf retained-content; sleep 120")
                self.wait(lambda: "retained-content" in self.tmux("capture-pane", "-p", "-t", pane))
                sibling = self.tmux("split-window", "-d", "-h", "-t", pane,
                                    "-P", "-F", "#{pane_id}", "sleep 120")
                pid = self.fmt(pane, "#{pane_pid}")
                self.tmux("set", "-p", "-t", pane, "@pane-named", "manual name")
                self.tmux("select-window", "-t", origin)
                self.tmux("select-pane", "-t", pane)
                master, _ = self.attach(name)
                os.write(master, key)
                self.wait(lambda: self.fmt(pane, "#{window_id}") != origin)
                new = self.fmt(pane, "#{window_id}")
                self.wait(lambda: self.fmt(name + ":", "#{window_id}") == new)
                self.assert_order([windows[0], origin, new, windows[2]], name)
                self.assertEqual(self.fmt(pane, "#{pane_pid}"), pid)
                self.assertIn("retained-content", self.tmux("capture-pane", "-p", "-t", pane))
                self.assertEqual(self.fmt(new, "#{window_name}"), "manual name")
                self.assertEqual(self.fmt(new, "#{window_panes}"), "1")
                self.assertEqual(self.fmt(sibling, "#{window_id}"), origin)

    def test_explicit_origin_single_pane_and_default_cross_session(self):
        windows = self.session()
        pane = self.fmt(windows[1], "#{pane_id}")
        self.invoke("tmux-break-pane", pane)
        self.assertEqual(len(self.windows()), 3)
        self.tmux("split-window", "-d", "-h", "-t", pane, "sleep 120")
        self.tmux("select-window", "-t", windows[0])
        self.invoke("tmux-break-pane", pane)
        new = self.fmt(pane, "#{window_id}")
        self.assert_order([windows[0], windows[1], new, windows[2]])
        destination = self.session("destination")
        source = self.fmt(windows[0], "#{pane_id}")
        self.tmux("split-window", "-d", "-h", "-t", source, "sleep 120")
        self.invoke("tmux-pane-to-new-window", source, "destination")
        moved = self.fmt(source, "#{window_id}")
        self.assert_order(destination + [moved], "destination")

    def test_failed_creation_and_join_do_not_touch_source(self):
        windows = self.session()
        pane = self.fmt(windows[1], "#{pane_id}")
        pid = self.fmt(pane, "#{pane_pid}")
        self.tmux("split-window", "-d", "-h", "-t", pane, "sleep 120")
        for failure in ("new-window", "join-pane"):
            env = dict(self.env, WINDOW_INSERT_FAIL=failure)
            result = self.invoke("tmux-pane-to-new-window", pane, "test", "", windows[1],
                                 env=env, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assert_order(windows)
            self.assertEqual(self.fmt(pane, "#{window_id}"), windows[1])
            self.assertEqual(self.fmt(pane, "#{pane_pid}"), pid)
        result = self.invoke("tmux-pane-to-new-window", "%999999", check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assert_order(windows)
        self.assertNotIn("break-pane", (self.home / "commands").read_text().splitlines())

    def test_marked_nnn_and_real_popup_forward_meta_q(self):
        windows = self.session()
        pane = self.fmt(windows[1], "#{pane_id}")
        self.tmux("select-window", "-t", windows[1])
        master, tty = self.attach()
        receiver = self.home / "receiver.py"
        receiver.write_text(
            "import os,sys,tty,time\nfrom pathlib import Path\n"
            "tty.setraw(0)\nPath(sys.argv[1]+'.ready').touch()\n"
            "Path(sys.argv[1]).write_bytes(os.read(0,2))\ntime.sleep(.3)\n"
        )
        for popup in (False, True):
            output = self.home / ("popup" if popup else "nnn")
            command = shlex.join([sys.executable, str(receiver), str(output)])
            process = None
            if popup:
                process = subprocess.Popen([self.real_tmux, "-S", self.socket,
                                            "display-popup", "-c", tty, "-E", command],
                                           env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            else:
                self.tmux("set", "-t", "test", "@nnn_popup_token", "fixture")
                self.tmux("respawn-pane", "-k", "-t", pane, command + "; sleep 120")
                self.tmux("split-window", "-d", "-t", pane, "sleep 120")
            self.wait(lambda: Path(str(output) + ".ready").exists())
            os.write(master, b"\x1bq")
            self.wait(output.exists)
            self.assertEqual(output.read_bytes(), b"\x1bq")
            self.assert_order(windows)
            if popup:
                assert process is not None
                process.communicate(timeout=5)
            else:
                self.tmux("set", "-u", "-t", "test", "@nnn_popup_token")


if __name__ == "__main__":
    unittest.main()
