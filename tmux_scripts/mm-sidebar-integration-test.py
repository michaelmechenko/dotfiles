#!/usr/bin/env python3
"""Real-tmux lifecycle coverage for the mm-sidebar launcher.

This is deliberately separate from the Go unit tests: it starts a disposable
server on a unique `tmux -L` socket, with `-f /dev/null`, and runs every script
from a temporary HOME fixture. It never reads or modifies the live tmux server,
the user's sidebar binary, or the user config tree.

Lifecycle and compatibility coverage runs against a disposable server only.
Fault injection is implemented by a fixture-local tmux wrapper, never by the
production launcher.
"""

from __future__ import annotations

import fcntl
import os
import secrets
import select
import signal
import shlex
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


ROOT = Path(__file__).resolve().parent
WIDTH = 36


class Failure(AssertionError):
    pass


def process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


CSI_M_TAB = b"\x1b[9;3u"
CSI_M_BTAB = b"\x1b[9;4u"
# xterm's terminfo F13/F14 application sequences. The test keeps no root
# bindings for either key, so it covers transport only; model_test.go covers
# their sidebar-specific semantic handling.
F13 = b"\x1b[1;2P"
F14 = b"\x1b[1;2Q"
# tmux's send-keys M-Tab guard forwards its canonical legacy representation.
POPUP_M_TAB = b"\x1b\t"


@dataclass
class AttachedClient:
    harness: "Harness"
    tty: str
    master: int
    process: subprocess.Popen[bytes]

    @classmethod
    def attach(cls, harness: "Harness", session: str) -> "AttachedClient":
        master, slave = os.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 180, 0, 0))
        tty = os.ttyname(slave)
        env = harness.env.copy()
        # A dedicated terminal description keeps this independent of the parent
        # process (which may itself be inside tmux or have no TERM at all).
        env["TERM"] = "xterm-256color"
        process = subprocess.Popen(
            ["tmux", "-L", harness.socket, "attach-session", "-t", session],
            env=env,
            stdin=slave,
            stdout=slave,
            stderr=slave,
            start_new_session=True,
        )
        os.close(slave)
        os.set_blocking(master, False)
        client = cls(harness, tty, master, process)
        harness.wait(
            f"attached client for {session}",
            lambda: client.alive and harness.client_present(tty),
        )
        return client

    @property
    def alive(self) -> bool:
        return self.process.poll() is None

    def send(self, data: bytes) -> None:
        if not self.alive:
            raise Failure("attached tmux client exited before input could be sent")
        self.drain()
        os.write(self.master, data)

    def drain(self) -> None:
        while select.select([self.master], [], [], 0)[0]:
            try:
                if not os.read(self.master, 65536):
                    return
            except BlockingIOError:
                return

    def close(self) -> None:
        if self.alive:
            self.harness.tmux("detach-client", "-t", self.tty, check=False)
            try:
                self.process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=1)
        try:
            os.close(self.master)
        except OSError:
            pass


class Harness:
    def __init__(self) -> None:
        # tmux appends `tmux-<uid>/<socket>` below TMUX_TMPDIR and macOS limits
        # Unix-domain socket paths tightly, so do not inherit a long GUI TMPDIR.
        self.tmp = Path(tempfile.mkdtemp(prefix="msi.", dir="/tmp"))
        self.home = self.tmp / "home"
        self.scripts = self.home / ".config" / "tmux_scripts"
        self.socket = f"mm-sidebar-it-{os.getpid()}-{secrets.token_hex(4)}"
        self.env = os.environ.copy()
        # Do not let a parent interactive tmux leak its server/pane identity
        # into this server's global environment.
        self.env.pop("TMUX", None)
        self.env.pop("TMUX_PANE", None)
        self.env.update(
            {
                "HOME": str(self.home),
                "TMPDIR": str(self.tmp / "tmp"),
                # Keep even the named tmux socket below this fixture rather
                # than accepting a parent shell's TMUX_TMPDIR.
                "TMUX_TMPDIR": str(self.tmp / "tmux"),
            }
        )
        self.real_tmux = shutil.which("tmux")
        if not self.real_tmux:
            raise Failure("tmux is not on PATH")
        self.builder_source = (ROOT / "tmux-sidebar-build").read_bytes()
        self.clients: list[AttachedClient] = []
        self.bindings_installed = False
        self.passed = 0

    def setup(self) -> None:
        self.scripts.parent.mkdir(parents=True)
        (self.tmp / "tmp").mkdir()
        (self.tmp / "tmux").mkdir()
        self.install_fault_wrapper()
        # Copying the Go module means the on-demand build writes only under the
        # fixture. The architecture-specific source-tree binary is excluded.
        shutil.copytree(
            ROOT / "mm-sidebar",
            self.scripts / "mm-sidebar",
            ignore=shutil.ignore_patterns("mm-sidebar", "mm-sidebar.tmp.*"),
        )
        # The fallback starts a few sibling scripts while painting. Copying the
        # small script bundle keeps that path real without letting it see HOME.
        for source in ROOT.iterdir():
            if source.is_file() and source.name != "mm-sidebar":
                shutil.copy2(source, self.scripts / source.name)
        self.tmux("-f", "/dev/null", "start-server")
        # Compile once before lifecycle timing starts. This verifies the normal
        # builder against the copied module and prevents a first open from being
        # mistaken for a launcher race while Go warms its cache.
        build = subprocess.run(
            [str(self.scripts / "tmux-sidebar-build")],
            env=self.env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=120,
        )
        if build.returncode or not Path(build.stdout.strip()).is_file():
            raise Failure(f"fixture build failed: {build.stderr.strip()}")

    def install_fault_wrapper(self) -> None:
        """Install a tmux shim visible only to launcher subprocesses in this fixture."""
        bindir = self.tmp / "bin"
        bindir.mkdir()
        wrapper = bindir / "tmux"
        wrapper.write_text(
            "#!/bin/sh\n"
            "fail=${MM_SIDEBAR_TEST_FAIL:-}\n"
            "marker=${MM_SIDEBAR_TEST_FAIL_MARKER:-}\n"
            "match=0\n"
            "case ,$fail, in *,split,*)\n"
            "  [ \"${1:-}\" = split-window ] && match=1\n"
            "  [ \"${1:-}\" = if-shell ] && case \" $* \" in *\"split-window\"*) match=1;; esac\n"
            "esac\n"
            "case ,$fail, in *,saved-layout,*) [ \"${1:-}\" = set-option ] && case \" $* \" in *\" -wt \"*\" @sidebar_saved_layout \"*) match=1;; esac;; esac\n"
            "case ,$fail, in *,mark,*)\n"
            "  [ \"${1:-}\" = set-option ] && case \" $* \" in *\" -pt \"*\" @sidebar_pane \"*) match=1;; esac\n"
            "  [ \"${1:-}\" = if-shell ] && case \" $* \" in *\"set-option -pt\"*\"@sidebar_pane\"*) match=1;; esac\n"
            "esac\n"
            "case ,$fail, in *,option,*) [ \"${1:-}\" = set-option ] && case \" $* \" in *\" -wt \"*\" @sidebar_content_pane \"*) match=1;; esac;; esac\n"
            "case ,$fail, in *,kill,*)\n"
            "  [ \"${1:-}\" = kill-pane ] && match=1\n"
            "  [ \"${1:-}\" = if-shell ] && case \" $* \" in *\"kill-pane -t\"*) match=1;; esac\n"
            "esac\n"
            "if [ \"$match\" = 1 ]; then [ -z \"$marker\" ] || : >\"$marker\"; exit 1; fi\n"
            "pause_marker=${MM_SIDEBAR_TEST_SPLIT_RETURN_MARKER:-}\n"
            "pause_hold=${MM_SIDEBAR_TEST_SPLIT_RETURN_HOLD:-}\n"
            "pause_split=0\n"
            "[ \"${1:-}\" = split-window ] && pause_split=1\n"
            "[ \"${1:-}\" = if-shell ] && case \" $* \" in *\"split-window\"*) pause_split=1;; esac\n"
            "if [ \"$pause_split\" = 1 ] && [ -n \"$pause_marker\" ]; then\n"
            "  out=$(mktemp \"${TMPDIR:-/tmp}/mm-sidebar-split.XXXXXX\") || exit 1\n"
            f"  {shlex.quote(self.real_tmux)} \"$@\" >\"$out\"; status=$?\n"
            "  : >\"$pause_marker\"\n"
            "  while [ -e \"$pause_hold\" ]; do sleep 0.02; done\n"
            "  cat \"$out\"; rm -f \"$out\"; exit \"$status\"\n"
            "fi\n"
            "move_source=${MM_SIDEBAR_TEST_MOVE_AFTER_VALIDATION_SOURCE:-}\n"
            "move_target=${MM_SIDEBAR_TEST_MOVE_AFTER_VALIDATION_TARGET:-}\n"
            "move_marker=${MM_SIDEBAR_TEST_MOVE_AFTER_VALIDATION_MARKER:-}\n"
            "move_format=0; case \" $* \" in *\" -F #{pane_id}\"*) move_format=1;; esac\n"
            "if [ \"${1:-}\" = list-panes ] && [ \"$move_format\" = 1 ] && [ -n \"$move_source\" ] && [ -n \"$move_target\" ] && [ -n \"$move_marker\" ] && [ ! -e \"$move_marker\" ]; then\n"
            "  out=$(mktemp \"${TMPDIR:-/tmp}/mm-sidebar-list.XXXXXX\") || exit 1\n"
            f"  {shlex.quote(self.real_tmux)} \"$@\" >\"$out\"; status=$?\n"
            "  candidate=$(grep -Fxv \"$move_source\" \"$out\" | head -1)\n"
            "  if [ -n \"$candidate\" ]; then\n"
            "    printf '%s' \"$candidate\" >\"$move_marker\"\n"
            f"    {shlex.quote(self.real_tmux)} break-pane -d -s \"$candidate\" -t \"$move_target\" >/dev/null 2>&1 || true\n"
            "  fi\n"
            "  cat \"$out\"; rm -f \"$out\"; exit \"$status\"\n"
            "fi\n"
            f"exec {shlex.quote(self.real_tmux)} \"$@\"\n"
        )
        wrapper.chmod(0o755)
        self.env["PATH"] = f"{bindir}:{self.env.get('PATH', '')}"

    def cleanup(self) -> None:
        try:
            for client in self.clients:
                client.close()
            self.tmux("kill-server", check=False)
        finally:
            shutil.rmtree(self.tmp, ignore_errors=True)

    def install_test_bindings(self) -> None:
        """Install only the root bindings needed to exercise raw CSI-u input.

        The real config has many unrelated bindings, so the disposable server
        stays on /dev/null and gets this exact minimal sidebar pair instead.
        """
        toggle = self.scripts / "tmux-sidebar-toggle"
        command = (
            "TMUX_PANE='#{pane_id}' MM_SIDEBAR_ORIGIN_CLIENT='#{client_name}' "
            f"HOME={shlex.quote(str(self.home))} {shlex.quote(str(toggle))}"
        )
        config = self.tmp / "phase2-bindings.conf"
        config.write_text(
            "set-option -g extended-keys on\n"
            "set-option -g extended-keys-format csi-u\n"
            "bind-key -n M-Tab if -F '#{||:#{popup_width},#{==:#{session_name},nnn}}' "
            f'{{ send-keys M-Tab }} {{ run-shell "{command} --toggle-persistent" }}\n'
            "bind-key -n M-BTab if -F '#{||:#{popup_width},#{==:#{session_name},nnn}}' "
            f'{{ send-keys M-BTab }} {{ run-shell "{command} --focus" }}\n'
        )
        self.tmux("source-file", str(config))
        self.bindings_installed = True

    def install_persistent_hooks(self) -> None:
        sync = self.scripts / "tmux-sidebar-sync"
        command = f"HOME={shlex.quote(str(self.home))} {shlex.quote(str(sync))} #{{q:window_id}} #{{q:client_name}}"
        config = self.tmp / "persistent-hooks.conf"
        config.write_text(
            f'set-hook -g after-select-window[101] \'run-shell -b "{command}"\'\n'
            f'set-hook -g client-session-changed[101] \'run-shell -b "{command}"\'\n'
            f'set-hook -g pane-exited[101] \'run-shell -b "sleep 0.05; {command}"\'\n'
            f'set-hook -g window-layout-changed[101] \'run-shell -b "sleep 0.05; {command}"\'\n'
        )
        self.tmux("source-file", str(config))

    def tmux(
        self,
        *args: str,
        check: bool = True,
        timeout: float = 15,
    ) -> str:
        proc = subprocess.run(
            ["tmux", "-L", self.socket, *args],
            env=self.env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        if check and proc.returncode:
            raise Failure(
                f"tmux {' '.join(args)} failed ({proc.returncode}): {proc.stderr.strip()}"
            )
        return proc.stdout.strip()

    def tmux_process(self, *args: str) -> subprocess.Popen[str]:
        return subprocess.Popen(
            ["tmux", "-L", self.socket, *args],
            env=self.env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def shell(self, pane: str, command: str, check: bool = True) -> None:
        # run-shell -t scopes tmux's command queue but does not export that
        # target as TMUX_PANE, so bindings and scripts pass it explicitly.
        self.tmux("run-shell", "-t", pane, f"TMUX_PANE={shlex.quote(pane)} {command}", check=check)

    def invoke_toggle(
        self, pane: str, mode: str = "", fail: str = "", extra_env: dict[str, str] | None = None
    ) -> None:
        command = f"HOME={shlex.quote(str(self.home))} {shlex.quote(str(self.scripts / 'tmux-sidebar-toggle'))}"
        if fail:
            marker = self.home / f"fault-{fail}-{secrets.token_hex(3)}"
            command = (
                f"MM_SIDEBAR_TEST_FAIL={shlex.quote(fail)} "
                f"MM_SIDEBAR_TEST_FAIL_MARKER={shlex.quote(str(marker))} {command}"
            )
            self.last_fault_marker = marker
        if extra_env:
            command = " ".join(
                f"{name}={shlex.quote(value)}" for name, value in extra_env.items()
            ) + " " + command
        if mode:
            command += f" {shlex.quote(mode)}"
        # Fault-driven opens intentionally terminate after rollback.
        self.shell(pane, command, check=not bool(fail or extra_env))

    def begin_split_return_paused_open(self, pane: str) -> tuple[Path, Path, Path]:
        """Pause after tmux creates the pane but before shell captures its ID."""
        marker = self.home / f"split-return-{secrets.token_hex(3)}"
        hold = self.home / f"split-return-hold-{secrets.token_hex(3)}"
        pid = self.home / f"split-return-pid-{secrets.token_hex(3)}"
        hold.touch()
        toggle = self.scripts / "tmux-sidebar-toggle"
        runner = f"echo $$ > {shlex.quote(str(pid))}; exec {shlex.quote(str(toggle))}"
        command = (
            f"TMUX_PANE={shlex.quote(pane)} HOME={shlex.quote(str(self.home))} "
            f"MM_SIDEBAR_TEST_SPLIT_RETURN_MARKER={shlex.quote(str(marker))} "
            f"MM_SIDEBAR_TEST_SPLIT_RETURN_HOLD={shlex.quote(str(hold))} "
            f"/bin/sh -c {shlex.quote(runner)}"
        )
        self.tmux("run-shell", "-b", "-t", pane, command)
        self.wait("open pauses before pane-id assignment", marker.exists)
        return marker, hold, pid

    def new_session(self, name: str, command: str = "/bin/sh -i") -> str:
        self.tmux(
            "new-session",
            "-d",
            "-x",
            "180",
            "-y",
            "50",
            "-s",
            name,
            command,
        )
        if not self.bindings_installed:
            self.install_test_bindings()
        return self.tmux("list-panes", "-t", f"{name}:0", "-F", "#{pane_id}")

    def split(self, pane: str, *args: str) -> str:
        return self.tmux(
            "split-window", "-d", "-t", pane, *args, "-P", "-F", "#{pane_id}"
        )

    def fmt(self, target: str, form: str) -> str:
        return self.tmux("display-message", "-p", "-t", target, form)

    def window(self, pane: str) -> str:
        return self.fmt(pane, "#{session_id}:#{window_index}")

    def attach(self, session: str) -> AttachedClient:
        client = AttachedClient.attach(self, session)
        self.clients.append(client)
        return client

    def client_present(self, tty: str) -> bool:
        return tty in self.tmux("list-clients", "-F", "#{client_tty}", check=False).splitlines()

    def option(self, pane: str, name: str) -> str:
        return self.tmux("show-options", "-wqv", "-t", self.window(pane), name, check=False)

    def sidebar(self, pane: str) -> str:
        return self.option(pane, "@sidebar_pane_id")

    def alive(self, pane: str) -> bool:
        return bool(self.tmux("display-message", "-p", "-t", pane, "#{pane_id}", check=False))

    def active_pane(self, pane: str) -> str:
        rows = self.tmux(
            "list-panes", "-t", self.window(pane), "-F", "#{?pane_active,#{pane_id},}"
        ).splitlines()
        return next((row for row in rows if row), "")

    def client_state(self, client: AttachedClient) -> tuple[str, str, str]:
        rows = self.tmux(
            "list-clients",
            "-F",
            "#{client_tty}\t#{session_name}\t#{window_index}\t#{pane_id}",
            check=False,
        ).splitlines()
        for row in rows:
            fields = row.split("\t")
            if len(fields) == 4 and fields[0] == client.tty:
                return fields[1], fields[2], fields[3]
        return "", "", ""

    def layout(self, pane: str) -> str:
        return self.fmt(pane, "#{window_layout}")

    def wait(self, label: str, predicate: Callable[[], bool], seconds: float = 6) -> None:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            for client in self.clients:
                client.drain()
            if predicate():
                return
            time.sleep(0.05)
        raise Failure(f"timed out: {label}")

    def require(self, condition: bool, message: str) -> None:
        if not condition:
            raise Failure(message)

    def close(self, pane: str) -> None:
        self.invoke_toggle(pane, "--close")
        self.wait("sidebar closes", lambda: not self.sidebar(pane))

    def panes(self, pane: str) -> list[str]:
        return self.tmux("list-panes", "-t", self.window(pane), "-F", "#{pane_id}").splitlines()

    def begin_paused_open(self, pane: str) -> tuple[Path, Path, Path]:
        """Start an open paused after split but before ownership publication."""
        marker = self.home / f"after-split-{secrets.token_hex(3)}"
        hold = self.home / f"after-split-hold-{secrets.token_hex(3)}"
        pid = self.home / f"after-split-pid-{secrets.token_hex(3)}"
        hold.touch()
        toggle = self.scripts / "tmux-sidebar-toggle"
        runner = f"echo $$ > {shlex.quote(str(pid))}; exec {shlex.quote(str(toggle))}"
        command = (
            f"TMUX_PANE={shlex.quote(pane)} HOME={shlex.quote(str(self.home))} "
            f"MM_SIDEBAR_TEST_AFTER_SPLIT_MARKER={shlex.quote(str(marker))} "
            f"MM_SIDEBAR_TEST_AFTER_SPLIT_HOLD={shlex.quote(str(hold))} "
            f"/bin/sh -c {shlex.quote(runner)}"
        )
        self.tmux("run-shell", "-b", "-t", pane, command)
        self.wait("open pauses after split", marker.exists)
        return marker, hold, pid

    def begin_gate_release_paused_open(self, pane: str) -> tuple[Path, Path]:
        """Pause after publication but before the gate can exec the child."""
        marker = self.home / f"before-gate-release-{secrets.token_hex(3)}"
        hold = self.home / f"before-gate-release-hold-{secrets.token_hex(3)}"
        hold.touch()
        toggle = self.scripts / "tmux-sidebar-toggle"
        command = (
            f"TMUX_PANE={shlex.quote(pane)} HOME={shlex.quote(str(self.home))} "
            f"MM_SIDEBAR_TEST_BEFORE_GATE_RELEASE_MARKER={shlex.quote(str(marker))} "
            f"MM_SIDEBAR_TEST_BEFORE_GATE_RELEASE_HOLD={shlex.quote(str(hold))} "
            f"{shlex.quote(str(toggle))}"
        )
        self.tmux("run-shell", "-b", "-t", pane, command)
        self.wait("open pauses before gate release", marker.exists)
        return marker, hold

    def run(self, name: str, body: Callable[[], None]) -> None:
        body()
        self.passed += 1
        print(f"ok: {name}")


def raw_capture_command(ready: Path, output: Path, count: int, hold: bool = False) -> str:
    reader = (
        "import os\n"
        "data = b''\n"
        f"limit = {count}\n"
        "while len(data) < limit:\n"
        "    chunk = os.read(0, limit - len(data))\n"
        "    if not chunk:\n"
        "        break\n"
        "    data += chunk\n"
        f"open({str(output)!r}, 'wb').write(data)\n"
    )
    script = (
        "stty raw -echo; "
        f": > {shlex.quote(str(ready))}; "
        f"{shlex.quote(sys.executable)} -c {shlex.quote(reader)}; "
        "stty sane"
    )
    if hold:
        script += "; sleep 30"
    return f"/bin/sh -c {shlex.quote(script)}"


def assert_sidebar_geometry(h: Harness, content: str) -> str:
    sidebar = h.sidebar(content)
    h.require(sidebar and h.alive(sidebar), "sidebar option must name a live pane")
    h.require(h.fmt(sidebar, "#{pane_width}") == str(WIDTH), "sidebar width must be 36")
    h.require(h.fmt(sidebar, "#{pane_left}") == "0", "sidebar must be leftmost")
    h.require(
        h.fmt(sidebar, "#{pane_top}:#{pane_height}")
        == f"0:{h.fmt(sidebar, '#{window_height}')}",
        "sidebar must span the complete window height",
    )
    h.require(h.fmt(sidebar, "#{@sidebar_pane}") == "1", "sidebar pane marker missing")
    h.require(h.fmt(sidebar, "#{pane_title}") == "sidebar", "sidebar title missing")
    return sidebar


def test_detached_open_close(h: Harness) -> None:
    main = h.new_session("detached")
    h.invoke_toggle(main)
    h.wait("detached sidebar open", lambda: bool(h.sidebar(main)))
    assert_sidebar_geometry(h, main)
    h.require(h.active_pane(main) == main, "plain open must leave focus in content")
    h.require(h.option(main, "@sidebar_content_pane") == main, "content pane was not recorded")
    h.require(h.option(main, "@sidebar_source") == "sessions", "first open must set sessions source")
    h.close(main)
    h.require(h.alive(main), "close must preserve the content pane")
    h.require(not h.option(main, "@sidebar_content_pane"), "content option must clear on close")
    h.require(not h.option(main, "@sidebar_saved_layout"), "saved layout must clear on close")


def test_focus_switch(h: Harness) -> None:
    main = h.new_session("focus")
    other = h.split(main, "-h", "-l", "60")
    h.tmux("select-pane", "-t", other)
    h.invoke_toggle(other, "--focus")
    h.wait("focused sidebar open", lambda: bool(h.sidebar(other)))
    sidebar = assert_sidebar_geometry(h, other)
    h.require(h.active_pane(other) == sidebar, "--focus must focus a newly-opened sidebar")
    # The binary can query before the launcher records @sidebar_content_pane;
    # its documented RightOfPane fallback then picks the pane right of the
    # full-height sidebar. Transactional lifecycle ordering is a later phase.
    h.require(h.option(other, "@sidebar_content_pane"), "focused open did not record a content pane")

    h.invoke_toggle(sidebar, "--focus")
    h.wait("focus returns from sidebar", lambda: h.active_pane(other) == other)
    h.require(h.sidebar(other) == sidebar, "focus return must keep sidebar alive")

    h.invoke_toggle(main, "--focus")
    h.wait("focus retargets sidebar", lambda: h.active_pane(main) == sidebar)
    h.require(h.option(main, "@sidebar_content_pane") == main, "focus retarget did not record caller")
    h.close(main)


def test_layouts(h: Harness) -> None:
    for count in (1, 2, 3):
        main = h.new_session(f"layout-{count}")
        if count == 2:
            h.split(main, "-h", "-l", "55")
        elif count == 3:
            right = h.split(main, "-h", "-l", "75")
            h.split(right, "-v", "-l", "20")
        before = h.layout(main)
        h.invoke_toggle(main)
        h.wait(f"{count}-pane sidebar open", lambda: bool(h.sidebar(main)))
        assert_sidebar_geometry(h, main)
        h.close(main)
        h.require(
            h.layout(main) == before,
            f"{count}-pane layout was not restored after close",
        )


def test_stale_layout(h: Harness) -> None:
    main = h.new_session("stale")
    h.split(main, "-h", "-l", "55")
    h.invoke_toggle(main)
    h.wait("stale-layout sidebar open", lambda: bool(h.sidebar(main)))
    h.split(main, "-v", "-l", "18")
    h.close(main)
    h.require(len(h.tmux("list-panes", "-t", h.window(main), "-F", "#{pane_id}").splitlines()) == 3,
              "close with stale layout must not delete newly-created panes")
    h.require(not h.option(main, "@sidebar_saved_layout"), "stale saved layout must still clear")


def test_multiple_windows_and_repin(h: Harness) -> None:
    first = h.new_session("multi")
    second = h.tmux(
        "new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "multi:", "-n", "other", "/bin/sh -i"
    )
    # The launcher lock intentionally serializes rapid invocations, even across
    # windows; wait for the first process to release it before opening the next.
    h.invoke_toggle(first)
    h.wait("first window sidebar", lambda: bool(h.sidebar(first)))
    h.invoke_toggle(second)
    h.wait("second window sidebar", lambda: bool(h.sidebar(second)))
    first_sidebar = assert_sidebar_geometry(h, first)
    second_sidebar = assert_sidebar_geometry(h, second)
    h.close(first)
    h.require(bool(h.sidebar(second)) and h.alive(second_sidebar), "closing one window must not close another sidebar")

    h.tmux("resize-pane", "-t", second_sidebar, "-x", "24")
    h.require(h.fmt(second_sidebar, "#{pane_width}") == "24", "test setup failed to drift sidebar width")
    h.shell(second, f"HOME={shlex.quote(str(h.home))} {shlex.quote(str(h.scripts / 'tmux-sidebar-repin'))}")
    h.wait("manual repin", lambda: h.fmt(second_sidebar, "#{pane_width}") == str(WIDTH))
    h.close(second)


def wait_sidebar_lifecycle_idle(h: Harness) -> None:
    h.wait(
        "sidebar lifecycle lock releases",
        lambda: not (h.tmp / "tmp" / "mm-sidebar-toggle.lock").exists()
        and not (h.tmp / "tmp" / "mm-sidebar-persistent.lock").exists(),
    )


def test_q_and_escape_startup_stress(h: Harness) -> None:
    # The launcher now gates the child until ownership is published. This sends
    # q/Esc at the first observable post-publication point without waiting for a
    # Bubble Tea frame; the explicit pre-publication gate test covers the gap.
    for key, name in (("q", "q"), ("Escape", "Esc")):
        for attempt in range(8):
            wait_sidebar_lifecycle_idle(h)
            main = h.new_session(f"key-{name.lower()}-{attempt}")
            h.invoke_toggle(main, "--focus")
            h.wait(f"{name} sidebar open", lambda: bool(h.sidebar(main)))
            sidebar = h.sidebar(main)
            h.tmux("send-keys", "-t", sidebar, key)
            h.wait(f"{name} closes real binary", lambda: not h.sidebar(main))
            h.require(h.alive(main), f"{name} close must preserve content")


def test_q_close_keeps_immutable_window_context(h: Harness) -> None:
    active = h.new_session("q-context-active")
    h.attach("q-context-active")
    inactive = h.new_session("q-context-inactive")
    before = h.layout(inactive)
    h.invoke_toggle(inactive, "--focus")
    h.wait("inactive sidebar open", lambda: bool(h.sidebar(inactive)))
    sidebar = h.sidebar(inactive)

    # The only attached client remains on another session. q must still pass
    # this sidebar's immutable pane to the close owner rather than resolving the
    # attached client's active pane.
    h.tmux("send-keys", "-t", sidebar, "q")
    h.wait("inactive q closes its own sidebar", lambda: not h.sidebar(inactive))
    h.require(not h.alive(sidebar), "q left the inactive sidebar pane alive")
    h.require(h.layout(inactive) == before, "q restored the wrong window layout")
    h.require(h.alive(active), "q disturbed the attached client's active pane")


def test_csi_u_sidebar_gestures(h: Harness) -> None:
    main = h.new_session("csi-u")
    client = h.attach("csi-u")

    client.send(CSI_M_TAB)
    h.wait("raw M-Tab opens sidebar", lambda: bool(h.sidebar(main)))
    sidebar = assert_sidebar_geometry(h, main)
    h.require(h.active_pane(main) == main, "raw M-Tab open must keep content focused")

    client.send(CSI_M_BTAB)
    h.wait("raw M-BTab focuses sidebar", lambda: h.active_pane(main) == sidebar)
    client.send(CSI_M_BTAB)
    h.wait("raw M-BTab returns to content", lambda: h.active_pane(main) == main)
    h.require(h.sidebar(main) == sidebar, "M-BTab focus return must keep sidebar alive")

    client.send(CSI_M_TAB)
    h.wait("raw M-Tab closes sidebar", lambda: not h.sidebar(main))
    h.require(h.alive(main), "raw M-Tab close must preserve content")


def test_popup_guard(h: Harness) -> None:
    main = h.new_session("popup")
    client = h.attach("popup")
    ready = h.home / "popup-ready"
    captured = h.home / "popup-csi"
    popup = h.tmux_process(
        "display-popup",
        "-c",
        client.tty,
        "-t",
        main,
        "-E",
        "-w",
        "50%",
        "-h",
        "20%",
        raw_capture_command(ready, captured, len(POPUP_M_TAB), hold=True),
    )
    h.wait("popup input reader ready", ready.exists)
    # tmux display-popup blocks its invoking client until this real popup closes.
    h.require(popup.poll() is None, "real popup command exited before input")

    client.send(CSI_M_TAB)
    h.wait("popup receives forwarded M-Tab", captured.exists)
    observed = captured.read_bytes()
    h.require(observed == POPUP_M_TAB, f"popup M-Tab guard changed: {observed!r}")
    h.require(not h.sidebar(main), "M-Tab inside a popup must not open a sidebar")
    h.require(popup.poll() is None, "M-Tab must leave the real popup open")

    h.tmux("display-popup", "-c", client.tty, "-C")
    popup.wait(timeout=5)


def test_f13_f14_transport(h: Harness) -> None:
    ready = h.home / "f13-f14-ready"
    captured = h.home / "f13-f14-csi"
    main = h.new_session("f13-f14")
    client = h.attach("f13-f14")
    h.tmux(
        "respawn-pane",
        "-k",
        "-t",
        main,
        raw_capture_command(ready, captured, len(F13 + F14), hold=True),
    )
    h.wait("application input reader ready", ready.exists)

    client.send(F13 + F14)
    h.wait("application receives F13/F14", captured.exists)
    observed = captured.read_bytes()
    h.require(
        observed == F13 + F14,
        f"F13/F14 transport changed: {observed!r}",
    )
    h.require(h.alive(main), "transport probe must not kill the application pane")


def test_nnn_guard(h: Harness) -> None:
    main = h.new_session("nnn")
    done = h.home / "nnn-guard-finished"
    h.shell(
        main,
        f"HOME={shlex.quote(str(h.home))} {shlex.quote(str(h.scripts / 'tmux-sidebar-toggle'))}; : > {shlex.quote(str(done))}",
    )
    h.wait("nnn guard handler", done.exists)
    h.require(not h.sidebar(main), "nnn session guard must not open a sidebar")


def force_fallback_builder(h: Harness) -> Path:
    build = h.scripts / "tmux-sidebar-build"
    build.write_text("#!/bin/sh\nprintf fallback >\"$HOME/fallback-build-called\"\nexit 1\n")
    build.chmod(0o755)
    return build


def restore_builder(h: Harness, build: Path) -> None:
    build.write_bytes(h.builder_source)
    build.chmod(0o755)


def test_fallback(h: Harness) -> None:
    # Force only the fixture's builder to fail. The real legacy dispatcher is
    # then selected, proving the no-Go path without poisoning the source tree.
    build = force_fallback_builder(h)
    try:
        for key, label in (("q", "q"), ("Escape", "Esc")):
            main = h.new_session(f"fallback-{label}")
            h.invoke_toggle(main, "--focus")
            h.wait(f"fallback {label} sidebar open", lambda: bool(h.sidebar(main)))
            h.require((h.home / "fallback-build-called").read_text() == "fallback", "fixture builder was not invoked")
            sidebar = h.sidebar(main)
            h.tmux("send-keys", "-t", sidebar, key)
            h.wait(f"fallback {label} exits", lambda: not h.alive(sidebar) and not h.sidebar(main))
    finally:
        # Later probes must exercise the compiled launcher, not this fixture-only
        # forced fallback.
        restore_builder(h, build)


def assert_transient_state_cleared(h: Harness, pane: str) -> None:
    for name in (
        "@sidebar_pane_id",
        "@sidebar_content_pane",
        "@sidebar_saved_layout",
        "@sidebar_was_zoomed",
        "@sidebar_zoom_pane",
        "@sidebar_gate",
    ):
        h.require(not h.option(pane, name), f"{name} must clear")


def test_fallback_layout_and_zoom(h: Harness) -> None:
    build = force_fallback_builder(h)
    try:
        main = h.new_session("fallback-layout-zoom")
        h.split(main, "-h", "-l", "55")
        before = h.layout(main)
        h.tmux("resize-pane", "-t", main, "-Z")
        h.require(h.fmt(main, "#{window_zoomed_flag}") == "1", "test setup did not zoom pane")
        h.invoke_toggle(main, "--focus")
        h.wait("fallback layout sidebar", lambda: bool(h.sidebar(main)))
        h.require(h.option(main, "@sidebar_was_zoomed") == "1", "fallback open did not record zoom")
        h.require(h.option(main, "@sidebar_zoom_pane") == main, "fallback open recorded wrong zoom pane")
        sidebar = h.sidebar(main)
        h.tmux("send-keys", "-t", sidebar, "q")
        h.wait("fallback q", lambda: not h.alive(sidebar) and not h.sidebar(main))
        h.wait("fallback zoom restoration", lambda: h.fmt(main, "#{window_zoomed_flag}") == "1")
        h.require(h.layout(main) == before, "fallback q must replay saved layout")
        assert_transient_state_cleared(h, main)
    finally:
        restore_builder(h, build)


def test_zoom_restoration(h: Harness) -> None:
    main = h.new_session("zoom")
    h.split(main, "-h", "-l", "55")
    h.tmux("resize-pane", "-t", main, "-Z")
    h.require(h.fmt(main, "#{window_zoomed_flag}") == "1", "test setup did not zoom pane")
    h.invoke_toggle(main)
    h.wait("zoom sidebar", lambda: bool(h.sidebar(main)))
    h.close(main)
    h.require(h.fmt(main, "#{window_zoomed_flag}") == "1", "close must restore prior zoom")
    assert_transient_state_cleared(h, main)


def test_transaction_rollbacks(h: Harness) -> None:
    for fault in ("saved-layout", "split", "mark", "option"):
        main = h.new_session(f"rollback-{fault}")
        h.split(main, "-h", "-l", "55")
        before = h.layout(main)
        before_panes = h.tmux("list-panes", "-t", h.window(main), "-F", "#{pane_id}").splitlines()
        h.invoke_toggle(main, fail=fault)
        h.wait(f"{fault} fault triggered", lambda: h.last_fault_marker.exists())
        h.wait(
            f"{fault} rollback",
            lambda: (
                not h.sidebar(main)
                and h.layout(main) == before
                and h.tmux("list-panes", "-t", h.window(main), "-F", "#{pane_id}").splitlines() == before_panes
                and not any(h.option(main, name) for name in (
                    "@sidebar_content_pane", "@sidebar_saved_layout", "@sidebar_was_zoomed", "@sidebar_zoom_pane"
                ))
            ),
        )


def test_signal_after_split_rolls_back(h: Harness) -> None:
    main = h.new_session("signal-rollback")
    h.split(main, "-h", "-l", "55")
    before_layout = h.layout(main)
    before_panes = h.panes(main)
    _, hold, pid = h.begin_split_return_paused_open(main)
    h.require(not h.sidebar(main), "ownership must not publish before the gate opens")
    h.require(len(h.panes(main)) == len(before_panes) + 1, "split must exist while paused")
    h.require(h.option(main, "@sidebar_gate"), "paused child gate must be retained")
    os.kill(int(pid.read_text().strip()), signal.SIGTERM)
    hold.unlink()
    h.wait(
        "signal rollback",
        lambda: h.panes(main) == before_panes and not h.sidebar(main) and h.layout(main) == before_layout,
    )
    assert_transient_state_cleared(h, main)
    h.require(not (h.tmp / "tmp" / "mm-sidebar-toggle.lock").exists(), "signal rollback leaked the launcher lock")


def test_prepublication_gate(h: Harness) -> None:
    main = h.new_session("prepublication-gate")
    _, hold, _ = h.begin_paused_open(main)
    paused = [p for p in h.panes(main) if p != main]
    h.require(len(paused) == 1, "paused transaction must create exactly one child")
    h.require(
        h.fmt(paused[0], "#{pane_current_command}") not in ("mm-sidebar", "tmux-sidebar"),
        "child must wait behind the gate instead of starting a sidebar",
    )
    h.require(not h.sidebar(main), "waiting child must not publish ownership early")
    # A close arriving in the publication gap is harmless: it cannot kill an
    # unowned child. Releasing the gate then completes one ordinary open.
    h.invoke_toggle(main, "--close")
    h.require(h.alive(paused[0]), "pre-publication close killed the waiting child")
    hold.unlink()
    h.wait("gate publishes sidebar", lambda: bool(h.sidebar(main)))
    h.require(h.sidebar(main) == paused[0], "published owner must be the gated child")
    h.close(main)


def test_moved_child_before_assignment_is_cancelled(h: Harness) -> None:
    source = h.new_session("moved-before-assignment")
    _, hold, pid = h.begin_split_return_paused_open(source)
    gate = Path(h.option(source, "@sidebar_gate"))
    h.require(gate.exists(), "split-return gate was not created")
    child = next(p for p in h.panes(source) if p != source)
    # This is earlier than the regular publication pause: split-window has made
    # the child, but the launcher's command substitution has not received its
    # pane ID. Moving it now requires find_gated_pane to search all panes.
    h.tmux("break-pane", "-d", "-s", child, "-t", "moved-before-assignment:")
    os.kill(int(pid.read_text().strip()), signal.SIGTERM)
    hold.unlink()
    h.wait(
        "moved child cancelled before assignment",
        lambda: (not h.alive(child) or h.fmt(child, "#{pane_dead}") == "1") and not gate.exists(),
    )
    h.require(not h.sidebar(source), "moved child published source ownership")
    if h.alive(child):
        h.require(h.fmt(child, "#{@sidebar_pane}") != "1", "moved child was marked")
        h.require(h.fmt(child, "#{pane_title}") != "sidebar", "moved child was titled")
    assert_transient_state_cleared(h, source)


def test_move_after_validation_never_initializes_child(h: Harness) -> None:
    source = h.new_session("move-after-validation")
    destination = h.new_session("move-after-validation-destination")
    marker = h.home / "move-after-validation-marker"
    h.invoke_toggle(
        source,
        extra_env={
            "MM_SIDEBAR_TEST_MOVE_AFTER_VALIDATION_SOURCE": source,
            "MM_SIDEBAR_TEST_MOVE_AFTER_VALIDATION_TARGET": "move-after-validation-destination:",
            "MM_SIDEBAR_TEST_MOVE_AFTER_VALIDATION_MARKER": str(marker),
        },
    )
    h.wait("after-validation move", marker.exists)
    moved = marker.read_text()
    h.wait(
        "after-validation gate cancellation",
        lambda: not h.alive(moved) or h.fmt(moved, "#{pane_dead}") == "1",
    )
    h.require(not h.sidebar(source), "moved child published source ownership")
    if h.alive(moved):
        h.require(h.fmt(moved, "#{@sidebar_pane}") != "1", "moved child was marked after validation")
        h.require(h.fmt(moved, "#{pane_title}") != "sidebar", "moved child was titled after validation")
    assert_transient_state_cleared(h, source)


def test_kill_failure_retries(h: Harness) -> None:
    main = h.new_session("kill-retry")
    h.invoke_toggle(main)
    h.wait("sidebar open for close retry", lambda: bool(h.sidebar(main)))
    sidebar = h.sidebar(main)
    h.invoke_toggle(main, "--close", fail="kill")
    h.require(h.sidebar(main) == sidebar and h.alive(sidebar), "failed close lost sidebar ownership")
    h.require(h.option(main, "@sidebar_content_pane"), "failed close cleared content state")
    h.close(main)

    rollback = h.new_session("rollback-kill-retry")
    h.invoke_toggle(rollback, fail="mark,kill")
    h.wait("rollback kill fault", lambda: h.last_fault_marker.exists())
    h.wait("rollback failure retains owner", lambda: bool(h.sidebar(rollback)))
    waiting = h.sidebar(rollback)
    h.require(h.alive(waiting), "failed rollback killed the pane despite injected failure")
    h.require(h.option(rollback, "@sidebar_saved_layout") or h.option(rollback, "@sidebar_was_zoomed"), "failed rollback cleared saved state")
    h.close(rollback)
    h.require(not h.alive(waiting), "retry close did not kill retained rollback pane")
    assert_transient_state_cleared(h, rollback)


def test_move_before_gate_release_cancels_and_clears_source(h: Harness) -> None:
    source = h.new_session("move-before-gate-release")
    destination = h.new_session("move-before-gate-release-destination")
    _, hold = h.begin_gate_release_paused_open(source)
    sidebar = h.sidebar(source)
    h.require(sidebar, "sidebar must publish before the gate-release pause")
    h.tmux("break-pane", "-d", "-s", sidebar, "-t", "move-before-gate-release-destination:")
    hold.unlink()
    h.wait(
        "gate-release moved child cancellation",
        lambda: not h.alive(sidebar) or h.fmt(sidebar, "#{pane_dead}") == "1",
    )
    h.require(not h.sidebar(source), "source retained a moved sidebar owner")
    assert_transient_state_cleared(h, source)


def test_close_open_interleave_is_serialized(h: Harness) -> None:
    main = h.new_session("close-open-lock")
    h.split(main, "-h", "-l", "55")
    before = h.layout(main)
    h.invoke_toggle(main)
    h.wait("sidebar open before serialized close", lambda: bool(h.sidebar(main)))
    marker = h.home / "after-close-kill"
    hold = h.home / "after-close-kill-hold"
    hold.touch()
    toggle = h.scripts / "tmux-sidebar-toggle"
    command = (
        f"TMUX_PANE={shlex.quote(main)} HOME={shlex.quote(str(h.home))} "
        f"MM_SIDEBAR_TEST_AFTER_CLOSE_KILL_MARKER={shlex.quote(str(marker))} "
        f"MM_SIDEBAR_TEST_AFTER_CLOSE_KILL_HOLD={shlex.quote(str(hold))} "
        f"{shlex.quote(str(toggle))} --close"
    )
    h.tmux("run-shell", "-b", "-t", main, command)
    h.wait("close pauses after kill", marker.exists)
    panes_during_close = h.panes(main)

    # A new open while the old close owns the lifecycle lock is dropped; it
    # cannot publish state that the old close then clears.
    h.invoke_toggle(main)
    h.require(h.panes(main) == panes_during_close, "open interleaved with close restoration")
    hold.unlink()
    h.wait("serialized close restores layout", lambda: not h.sidebar(main) and h.layout(main) == before)
    assert_transient_state_cleared(h, main)


def test_gate_hup_before_binary_handler(h: Harness) -> None:
    source = h.new_session("gate-hup")
    _, parent_hold = h.begin_gate_release_paused_open(source)
    sidebar = h.sidebar(source)
    gate = Path(h.option(source, "@sidebar_gate"))
    child_hold = Path(str(gate) + ".child-hold")
    child_marker = Path(str(gate) + ".child-marker")
    child_hold.touch()
    parent_hold.unlink()
    h.wait("gate child reaches pre-exec hold", child_marker.exists)
    pid = int(h.fmt(sidebar, "#{pane_pid}"))
    os.kill(pid, signal.SIGHUP)
    h.wait("gate records pre-handler HUP", lambda: Path(str(gate) + ".hup").exists())
    child_hold.unlink()
    h.wait("pre-handler HUP clears source", lambda: not h.sidebar(source))
    h.wait("pre-handler HUP process exits", lambda: not process_alive(pid))
    assert_transient_state_cleared(h, source)
    child_marker.unlink(missing_ok=True)


def test_move_between_child_validation_and_exec(h: Harness) -> None:
    source = h.new_session("move-after-child-check")
    destination = h.new_session("move-after-child-check-destination")
    _, parent_hold = h.begin_gate_release_paused_open(source)
    sidebar = h.sidebar(source)
    gate = Path(h.option(source, "@sidebar_gate"))
    child_hold = Path(str(gate) + ".child-hold")
    child_marker = Path(str(gate) + ".child-marker")
    child_hold.touch()

    # Let the parent publish and remove the normal gate. The child passes its
    # shell ownership check, then pauses immediately before exec.
    parent_hold.unlink()
    h.wait("child validates owner before exec", child_marker.exists)
    h.tmux("join-pane", "-d", "-s", sidebar, "-t", destination)
    child_hold.unlink()

    # The binary repeats the stable-window check before creating Bubble Tea
    # state, cleans only the source window, and exits from the moved pane.
    h.wait("moved post-validation child clears source", lambda: not h.sidebar(source))
    h.wait("moved post-validation child exits", lambda: not h.alive(sidebar))
    assert_transient_state_cleared(h, source)
    child_marker.unlink(missing_ok=True)


def test_canonical_close_does_not_kill_destination_sidebar(h: Harness) -> None:
    source = h.new_session("canonical-close-source")
    destination = h.new_session("canonical-close-destination")
    h.invoke_toggle(source)
    h.wait("source sidebar", lambda: bool(h.sidebar(source)))
    source_sidebar = h.sidebar(source)
    h.invoke_toggle(destination)
    h.wait("destination sidebar", lambda: bool(h.sidebar(destination)))
    destination_sidebar = h.sidebar(destination)
    # Move the source sidebar into the destination's existing sidebar window.
    source_window = h.fmt(source, "#{window_id}")
    h.tmux("join-pane", "-d", "-s", source_sidebar, "-t", destination)
    h.shell(
        source_sidebar,
        f"HOME={shlex.quote(str(h.home))} MM_SIDEBAR_EXPECTED_PANE={shlex.quote(source_sidebar)} "
        f"MM_SIDEBAR_EXPECTED_WINDOW={shlex.quote(source_window)} "
        f"{shlex.quote(str(h.scripts / 'tmux-sidebar-toggle'))} --close",
    )
    h.wait("moved canonical source cleanup", lambda: not h.sidebar(source))
    h.require(h.sidebar(destination) == destination_sidebar, "moved canonical close killed destination owner")
    h.require(h.alive(destination_sidebar), "moved canonical close killed destination sidebar")
    assert_transient_state_cleared(h, source)
    h.close(destination)


def test_sidebar_nav_transport_handles_hostile_tmux_strings(h: Harness) -> None:
    float_pane = h.new_session("float-hostile-nav")
    float_session_id = h.fmt(float_pane, "#{session_id}")
    pane = h.new_session("hostile-nav")
    hostile_dir = h.home / "cwd\x1f\n\t\x1b中é"
    hostile_dir.mkdir()
    h.tmux("new-window", "-d", "-t", h.fmt(pane, "#{session_id}"), "-c", str(hostile_dir), "sleep 120")
    # tmux rejects controls in session/window names, but quotes, backslashes,
    # spaces, and Unicode still exercise q/a quoting there. The cwd carries the
    # full control-byte fixture because tmux accepts it unchanged.
    hostile_window = "window '\\ 中é"
    h.tmux("rename-window", "-t", pane, hostile_window)
    hostile_session = "session '\\ 中é"
    h.tmux("rename-session", "-t", pane, hostile_session)

    for mode, fields in (("--list-windows-sidebar", 7), ("--list-sessions-sidebar", 8)):
        out = h.home / (mode.removeprefix("--") + ".tsv")
        command = (
            f"TMUX_PANE={shlex.quote(pane)} "
            f"{shlex.quote(str(h.scripts / 'tmux-fzf-nav'))} {mode} > {shlex.quote(str(out))}"
        )
        h.tmux("run-shell", "-t", pane, command)
        h.wait(f"{mode} output", out.exists)
        data = out.read_bytes()
        h.require(b"\x1f" not in data and b"\x1b" not in data, f"{mode} leaked raw controls")
        lines = data.splitlines()
        h.require(len(lines) >= 2, f"{mode} lost hostile row")
        for line in lines:
            h.require(line.count(b"\t") == fields - 1, f"{mode} shifted fields: {line!r}")
        for line in lines[1:]:
            first, target = line.split(b"\t", 2)[:2]
            h.require(b"%" in first or first == b"-", f"{mode} shifted pane target")
            h.require(b"$" in target, f"{mode} shifted session target")
        if mode == "--list-sessions-sidebar":
            first_target = lines[1].split(b"\t", 2)[1]
            h.require(float_session_id.encode() in first_target, "safe sessions lost float-first order")


def test_context_prompt_preserves_hostile_label(h: Harness) -> None:
    main = h.new_session("context-prompt")
    client = h.attach("context-prompt")
    client.send(CSI_M_BTAB)
    h.wait("context prompt sidebar focus", lambda: bool(h.sidebar(main)) and h.active_pane(main) == h.sidebar(main))
    sidebar = h.sidebar(main)

    # Pane tab -> action palette -> second action (set pane label).
    h.tmux("send-keys", "-t", sidebar, "2")
    h.wait(
        "pane navigator rows",
        lambda: "0:" in h.tmux("capture-pane", "-p", "-t", sidebar, check=False),
    )
    time.sleep(0.25)
    h.tmux("send-keys", "-t", sidebar, "a", "Down", "Enter")
    # command-prompt is opened asynchronously by the Bubble Tea action Cmd;
    # wait for the originating client to enter it before writing prompt bytes.
    time.sleep(0.75)
    hostile = "label '\"\\$HOME; display-message PWN"
    client.send(hostile.encode() + b"\r")
    time.sleep(0.8)
    current_label = h.tmux("show-options", "-pqv", "-t", main, "@pane-label", check=False)
    if current_label != hostile:
        raise Failure(
            "hostile pane label round trip: "
            f"got={current_label!r} pane={h.tmux('capture-pane', '-p', '-t', sidebar, check=False)!r} "
            f"messages={h.tmux('show-messages', check=False)!r}"
        )
    # Exact one-field round-trip proves spaces/semicolon stayed data rather than
    # becoming an additional tmux command or set-option argument.
    h.close(main)


def test_compiled_hup_canonical_close(h: Harness) -> None:
    main = h.new_session("compiled-hup")
    h.invoke_toggle(main, "--focus")
    h.wait("compiled HUP sidebar", lambda: bool(h.sidebar(main)))
    sidebar = h.sidebar(main)
    pid = int(h.fmt(sidebar, "#{pane_pid}"))
    os.kill(pid, signal.SIGHUP)
    h.wait("compiled HUP canonical close", lambda: not h.sidebar(main))
    h.require(not h.alive(sidebar), "compiled HUP left sidebar pane alive")
    h.wait("compiled HUP process exits", lambda: not process_alive(pid))


def test_fallback_hup_closes_and_restores_terminal(h: Harness) -> None:
    build = force_fallback_builder(h)
    try:
        main = h.new_session("fallback-hup")
        h.invoke_toggle(main, "--focus")
        h.wait("fallback HUP sidebar", lambda: bool(h.sidebar(main)))
        sidebar = h.sidebar(main)
        os.kill(int(h.fmt(sidebar, "#{pane_pid}")), signal.SIGHUP)
        h.wait("fallback HUP canonical close", lambda: not h.sidebar(main))
        h.require(not h.alive(sidebar), "fallback HUP left sidebar pane alive")
        # The content shell remains usable, proving the fallback restored its
        # terminal state before dispatching the canonical close owner.
        h.tmux("send-keys", "-t", main, "printf HUP_OK > ~/fallback-hup-ok", "Enter")
        h.wait("fallback HUP content shell", lambda: (h.home / "fallback-hup-ok").exists())
    finally:
        restore_builder(h, build)


def test_moved_sidebar_and_content_are_stale(h: Harness) -> None:
    prepublication = h.new_session("moved-prepublication")
    _, hold, _ = h.begin_paused_open(prepublication)
    gate = Path(h.option(prepublication, "@sidebar_gate"))
    h.require(gate.exists(), "pre-publication gate was not created")
    pending = next(p for p in h.panes(prepublication) if p != prepublication)
    h.tmux("break-pane", "-d", "-s", pending, "-t", "moved-prepublication:")
    hold.unlink()
    h.wait(
        "moved pre-publication cleanup",
        lambda: (
            not h.sidebar(prepublication)
            and not h.option(prepublication, "@sidebar_gate")
            and not gate.exists()
            and not (h.tmp / "tmp" / "mm-sidebar-toggle.lock").exists()
        ),
    )
    if h.alive(pending):
        h.require(
            h.fmt(pending, "#{@sidebar_pane}") != "1",
            "moved pre-publication child was marked in its new window",
        )

    source = h.new_session("moved-sidebar")
    h.invoke_toggle(source)
    h.wait("sidebar open before move", lambda: bool(h.sidebar(source)))
    sidebar = h.sidebar(source)
    h.tmux("break-pane", "-d", "-s", sidebar, "-t", "moved-sidebar:")
    h.invoke_toggle(source, "--close")
    h.wait("moved sidebar state clears", lambda: not h.sidebar(source))
    h.require(h.alive(sidebar), "close killed a sidebar moved to another window")

    content = h.new_session("moved-content")
    other = h.split(content, "-h", "-l", "55")
    h.invoke_toggle(content, "--focus")
    h.wait("sidebar open before content move", lambda: bool(h.sidebar(content)))
    content_sidebar = h.sidebar(content)
    h.tmux("break-pane", "-d", "-s", content, "-t", "moved-content:")
    h.invoke_toggle(content_sidebar, "--focus")
    h.wait("moved content focus fallback", lambda: h.active_pane(other) == other)
    h.require(h.alive(content), "focus fallback touched moved content pane")
    h.close(other)
    h.require(h.alive(content), "close touched moved content pane")


def test_focus_pane_switch_client_compatibility(h: Harness) -> None:
    origin = h.new_session("focus-compat-origin")
    sibling = h.split(origin, "-h", "-l", "55")
    destination = h.new_session("focus-compat-destination")
    other_client = h.attach("focus-compat-origin")
    origin_client = h.attach("focus-compat-origin")

    # Same-session pane targets select the pane without moving the other client.
    h.tmux("switch-client", "-c", origin_client.tty, "-Z", "-t", sibling)
    h.wait("same-session focus", lambda: h.client_state(origin_client)[2] == sibling)
    h.require(h.client_state(other_client)[0] == "focus-compat-origin", "same-session focus moved other client")

    # Cross-session targets switch only the named originating client.
    h.tmux("switch-client", "-c", origin_client.tty, "-Z", "-t", destination)
    h.wait("cross-session focus", lambda: h.client_state(origin_client)[0] == "focus-compat-destination")
    h.require(h.client_state(other_client)[0] == "focus-compat-origin", "cross-session focus moved other client")

    # -Z preserves an existing destination zoom and a dead pane fails without
    # changing the attached client's location.
    h.tmux("split-window", "-d", "-t", destination, "-h", "-l", "55")
    h.tmux("resize-pane", "-t", destination, "-Z")
    h.tmux("switch-client", "-c", origin_client.tty, "-Z", "-t", destination)
    h.require(h.fmt(destination, "#{window_zoomed_flag}") == "1", "-Z lost destination zoom")
    state = h.client_state(origin_client)
    h.tmux("switch-client", "-c", origin_client.tty, "-Z", "-t", "%999999", check=False)
    h.require(h.client_state(origin_client) == state, "dead pane changed client state")


def test_sidebar_focus_preserves_window_name(h: Harness) -> None:
    main = h.new_session("rename-guard")
    h.tmux("set-option", "-g", "automatic-rename", "on")
    h.tmux(
        "set-option",
        "-g",
        "automatic-rename-format",
        "#{?#{@sidebar_pane},#{window_name},#{pane_current_command}}",
    )
    h.tmux("rename-window", "-t", h.window(main), "kept-name")
    h.invoke_toggle(main, "--focus")
    h.wait("rename-guard sidebar", lambda: bool(h.sidebar(main)))
    time.sleep(0.1)
    h.require(h.fmt(main, "#{window_name}") == "kept-name", "sidebar focus changed window name")
    h.close(main)


def test_persistent_sidebar_across_windows_and_sessions(h: Harness) -> None:
    main = h.new_session("persistent")
    other_window = h.tmux("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "persistent", "-n", "next", "sleep 30")
    other_session = h.new_session("persistent-other")
    client = h.attach("persistent")
    h.install_persistent_hooks()

    # M-Tab records global desired state and opens only the selected owner. Its
    # -d split must not steal the attached client's focus.
    client.send(CSI_M_TAB)
    h.wait("persistent sidebar opens in selected window", lambda: bool(h.sidebar(main)))
    h.require(h.active_pane(main) == main, "persistent open stole content focus")
    first_sidebar = h.sidebar(main)

    # Event hooks ensure each newly selected window/session independently. A
    # second hook delivery is idempotent and cannot duplicate its sidebar.
    h.tmux("switch-client", "-c", client.tty, "-t", "persistent:1")
    h.wait("persistent sidebar opens in next window", lambda: bool(h.sidebar(other_window)))
    h.tmux("run-shell", "-b", "-t", other_window, f"HOME={shlex.quote(str(h.home))} {shlex.quote(str(h.scripts / 'tmux-sidebar-sync'))} {shlex.quote(h.fmt(other_window, '#{window_id}'))} {shlex.quote(client.tty)}")
    time.sleep(0.15)
    h.require(len(h.panes(other_window)) == 2, "repeated sync duplicated sidebar")

    h.tmux("switch-client", "-c", client.tty, "-t", "persistent-other")
    h.wait("persistent sidebar opens in next session", lambda: bool(h.sidebar(other_session)))

    # A local crash preserves global desired state and the pane-exited hook
    # repairs only that window. No other owner changes identity.
    crashed = h.sidebar(other_window)
    h.tmux("kill-pane", "-t", crashed)
    h.wait("persistent crash recovers", lambda: bool(h.sidebar(other_window)) and h.sidebar(other_window) != crashed)
    h.require(h.sidebar(main) == first_sidebar, "crash recovery touched another window")

    # M-Tab's disable path is global and canonical: every sidebar closes through
    # its own transaction and all original content panes survive.
    h.tmux("switch-client", "-c", client.tty, "-t", "persistent:0")
    client.send(CSI_M_TAB)
    h.wait(
        "persistent dismissal closes all",
        lambda: not h.sidebar(main) and not h.sidebar(other_window) and not h.sidebar(other_session),
    )
    h.require(h.tmux("show-options", "-gqv", "@sidebar_persistent", check=False) == "", "persistent desired state survived dismissal")
    h.require(h.alive(main) and h.alive(other_window) and h.alive(other_session), "global close killed content")

    # q/Esc shares the same global dismissal semantics, rather than merely
    # killing the focused pane and leaving unvisited windows stale.
    client.send(CSI_M_TAB)
    h.wait("persistent reopens for q", lambda: bool(h.sidebar(main)))
    h.tmux("switch-client", "-c", client.tty, "-t", "persistent:1")
    h.wait("persistent q setup next window", lambda: bool(h.sidebar(other_window)))
    h.tmux("switch-client", "-c", client.tty, "-t", "persistent-other")
    h.wait("persistent q setup next session", lambda: bool(h.sidebar(other_session)))
    h.tmux("switch-client", "-c", client.tty, "-t", "persistent:0")
    h.tmux("select-pane", "-t", h.sidebar(main))
    h.wait("persistent q focuses sidebar", lambda: h.active_pane(main) == h.sidebar(main))
    client.send(b"q")
    h.wait(
        "persistent q closes all",
        lambda: not h.sidebar(main) and not h.sidebar(other_window) and not h.sidebar(other_session),
    )
    h.require(h.tmux("show-options", "-gqv", "@sidebar_persistent", check=False) == "", "q left persistent mode enabled")


def test_explicit_targeting(h: Harness) -> None:
    main = h.new_session("xfail-target")
    other = h.split(main, "-h", "-l", "55")
    h.tmux("select-pane", "-t", main)
    h.attach("xfail-target")

    # Query an inactive run-shell target explicitly. This mirrors Client.Query
    # and guards against a second attached client's active pane leaking into a
    # scoped sidebar command.
    observed = h.home / "explicit-target-pane"
    probe = h.home / "explicit-target-probe.sh"
    probe.write_text(f"#!/bin/sh\ntmux display-message -p -t {shlex.quote(other)} '#{{pane_id}}' > {shlex.quote(str(observed))}\n")
    probe.chmod(0o755)
    h.tmux("run-shell", "-t", other, str(probe))
    h.wait("explicit inactive-pane query", observed.exists)
    reported = observed.read_text().strip()
    h.require(
        reported == other,
        f"explicit query from inactive {other} returned {reported}",
    )


def main() -> int:
    h = Harness()
    try:
        h.setup()
        h.run("detached open/close", lambda: test_detached_open_close(h))
        h.run("--focus open and switch", lambda: test_focus_switch(h))
        h.run("one/two/three-pane layouts", lambda: test_layouts(h))
        h.run("stale saved layout", lambda: test_stale_layout(h))
        h.run("multiple windows and manual re-pin", lambda: test_multiple_windows_and_repin(h))
        h.run("real binary q/Esc startup stress", lambda: test_q_and_escape_startup_stress(h))
        h.run("q close keeps immutable window context", lambda: test_q_close_keeps_immutable_window_context(h))
        h.run("raw CSI-u M-Tab/M-BTab gestures", lambda: test_csi_u_sidebar_gestures(h))
        h.run("real popup M-Tab guard", lambda: test_popup_guard(h))
        h.run("F13/F14 application transport", lambda: test_f13_f14_transport(h))
        h.run("nnn guard", lambda: test_nnn_guard(h))
        h.run("fallback mode", lambda: test_fallback(h))
        h.run("fallback layout and zoom", lambda: test_fallback_layout_and_zoom(h))
        h.run("zoom restoration", lambda: test_zoom_restoration(h))
        h.run("transaction rollbacks", lambda: test_transaction_rollbacks(h))
        h.run("signal-after-split rollback", lambda: test_signal_after_split_rolls_back(h))
        h.run("pre-publication child gate", lambda: test_prepublication_gate(h))
        h.run("moved child before assignment", lambda: test_moved_child_before_assignment_is_cancelled(h))
        h.run("after-validation child move", lambda: test_move_after_validation_never_initializes_child(h))
        h.run("kill failure retry", lambda: test_kill_failure_retries(h))
        h.run("move before gate release", lambda: test_move_before_gate_release_cancels_and_clears_source(h))
        h.run("close/open lifecycle serialization", lambda: test_close_open_interleave_is_serialized(h))
        h.run("gate HUP before binary handler", lambda: test_gate_hup_before_binary_handler(h))
        h.run("move between child validation and exec", lambda: test_move_between_child_validation_and_exec(h))
        h.run("canonical close owner guard", lambda: test_canonical_close_does_not_kill_destination_sidebar(h))
        h.run("hostile navigator transport", lambda: test_sidebar_nav_transport_handles_hostile_tmux_strings(h))
        h.run("context prompt hostile label", lambda: test_context_prompt_preserves_hostile_label(h))
        h.run("compiled HUP cleanup", lambda: test_compiled_hup_canonical_close(h))
        h.run("fallback HUP cleanup", lambda: test_fallback_hup_closes_and_restores_terminal(h))
        h.run("moved sidebar/content safety", lambda: test_moved_sidebar_and_content_are_stale(h))
        h.run("switch-client focus compatibility", lambda: test_focus_pane_switch_client_compatibility(h))
        h.run("sidebar window-name guard", lambda: test_sidebar_focus_preserves_window_name(h))
        h.run("persistent window/session sidebars", lambda: test_persistent_sidebar_across_windows_and_sessions(h))
        h.run("explicit inactive-pane targeting", lambda: test_explicit_targeting(h))
        print(f"ok: {h.passed} lifecycle checks")
        return 0
    except (Failure, subprocess.SubprocessError, OSError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    finally:
        h.cleanup()


if __name__ == "__main__":
    raise SystemExit(main())
