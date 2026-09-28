#!/usr/bin/env python3
"""Exercise the real permission-repair directive on disposable tmux servers."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
TMUX = shutil.which("tmux")
assert TMUX, "tmux is required"
CHMOD = shutil.which("chmod") or ""
assert CHMOD, "chmod is required"
# Keep this focused on the permission repair, not unrelated config hooks/plugins.
DIRECTIVE = "\n".join(
    line for line in (ROOT / "tmux.conf").read_text().splitlines()
    if line.startswith("run-shell ") and "chmod" in line
)
assert DIRECTIVE, "permission repair directive missing"


def check(platform):
    with tempfile.TemporaryDirectory(prefix="tmux-permissions-") as directory:
        home = Path(directory)
        scripts = home / ".config/tmux_scripts"
        scripts.mkdir(parents=True)
        script = scripts / "fixture"
        script.write_text("#!/bin/sh\nexit 0\n")
        script.chmod(0o644)
        binaries = home / "bin"
        binaries.mkdir()
        log = home / "chmod.log"
        for name, text in {
            "uname": '#!/bin/sh\nprintf "%s\\n" "$TEST_PLATFORM"\n',
            "chmod": '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CHMOD_LOG"\n'
                     '[ "$TEST_PLATFORM" = Darwin ] || exit 1\n'
                     'exec "$REAL_CHMOD" "$@"\n',
        }.items():
            path = binaries / name
            path.write_text(text)
            path.chmod(0o755)
        config = home / "reload.conf"
        config.write_text(DIRECTIVE + "\n")
        env = os.environ.copy()
        env.pop("TMUX", None)
        env.pop("TMUX_PANE", None)
        env.update(HOME=str(home), TEST_PLATFORM=platform, CHMOD_LOG=str(log),
                   REAL_CHMOD=CHMOD,
                   PATH=str(binaries) + os.pathsep + env["PATH"])
        command = [TMUX, "-S", str(home / "socket")]
        def tmux(*args, check=True):
            return subprocess.run(command + list(args), env=env, check=check,
                                  capture_output=True, text=True, timeout=10)
        try:
            tmux("-f", "/dev/null", "new-session", "-d", "-s", "fixture", "sleep 30")
            for _ in range(2):
                result = tmux("source-file", str(config), check=False)
                assert result.returncode == 0, result.stdout + result.stderr
                assert "returned 1" not in result.stdout + result.stderr, result
            if platform == "Darwin":
                assert log.exists() and len(log.read_text().splitlines()) == 2
                assert script.stat().st_mode & 0o111, "macOS repair did not set executable bits"
            else:
                assert not log.exists(), f"{platform} reload attempted chmod on packaged scripts"
                assert not script.stat().st_mode & 0o111
        finally:
            tmux("kill-server", check=False)  # Only this fixture's private socket.
        print(f"ok: {platform} repeated reload permission policy")


for platform in ("Linux", "Darwin"):
    check(platform)
