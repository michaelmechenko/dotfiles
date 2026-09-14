#!/usr/bin/env python3
"""Offline hostile-data checks for active tmux shell/action boundaries."""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent


def require(ok: bool, message: str) -> None:
    if not ok:
        raise AssertionError(message)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="tmux-boundary-") as td:
        tmp = Path(td)
        bindir = tmp / "bin"
        bindir.mkdir()
        log = tmp / "tmux.jsonl"
        fake = bindir / "tmux"
        fake.write_text("""#!/usr/bin/env python3
import json, os, sys
args=sys.argv[1:]
mode=os.environ.get('TMUX_TEST_MODE','')
if args and args[0] == 'display-message':
    fmt=args[-1]
    print('240' if 'client_width' in fmt else ('$0' if 'session_id' in fmt else 'main'))
elif args and args[0] == 'list-sessions':
    print('$2\\tfloat odd;$(touch nope)')
    print("$1\\twork space ' #\\tname")
elif args and args[0] == 'list-panes':
    sep='\\x1f'
    print(sep.join(['$2','float odd','%9',"win ' #{}",'zsh','/tmp/a b','\\x1b[31mtitle;$(touch nope)','']))
elif args[:2] == ['show-options','-gqv']:
    values={'@color-accent-primary':'#FF7DA3','@color-accent-tertiary':'#BDA9D4','@color-text-muted':'#7F737D'}
    print(values.get(args[-1],''))
else:
    with open(os.environ['TMUX_TEST_LOG'],'a') as f: f.write(json.dumps(args)+'\\n')
""")
        fake.chmod(0o755)
        env = os.environ.copy()
        env.update({"PATH": f"{bindir}:{env['PATH']}", "TMUX_TEST_LOG": str(log)})

        for script in ("tmux-status-session-ls", "tmux-status-pane-ls"):
            log.write_text("")
            subprocess.run([str(ROOT / "tmux_scripts" / script)], env=env, check=True)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            menu = next(call for call in calls if call and call[0] == "display-menu")
            rendered = "\n".join(menu)
            require("work space ' ## name" in rendered or "win ' ##{}" in rendered,
                    f"{script} lost hostile display metadata: {rendered!r}")
            require("touch nope" in rendered, f"{script} unexpectedly evaluated display text")
            require("\x1b" not in rendered, f"{script} retained terminal controls in labels")
        require(not (tmp / "nope").exists(), "status metadata executed as shell source")

        # Extrakto open appends one opaque argument rather than constructing run-shell source.
        module_path = ROOT / "tmux_plugins" / "extrakto" / "extrakto_plugin.py"
        sys.path.insert(0, str(module_path.parent))
        spec = importlib.util.spec_from_file_location("extrakto_plugin_test", module_path)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader
        spec.loader.exec_module(module)
        plugin = module.ExtraktoPlugin.__new__(module.ExtraktoPlugin)
        plugin.open_tool = "/tmp/adapter --flag"
        payload = "quo'te;$(touch nope)\tunicode-λ"
        with patch.object(module.subprocess, "run") as run:
            plugin.open(payload)
        require(run.call_args.args[0] == ["/tmp/adapter", "--flag", payload], "Extrakto split selected text")

        # Claude actions re-resolve both session and pane immediately before acting.
        home_scripts = tmp / "home" / ".config" / "tmux_scripts"
        home_scripts.mkdir(parents=True)
        shutil.copy2(ROOT / "tmux_scripts" / "tmux-claude-menu", home_scripts / "tmux-claude-menu")
        rows = tmp / "claude-rows"
        ls = home_scripts / "tmux-claude-ls"
        ls.write_text(f"#!/bin/sh\ncat {rows!s}\n")
        ls.chmod(0o755)
        rows.write_text("sid-1\t%7\ttarget\ts\twaiting\tname\t-\twin\t0\n")
        claude_env = env | {"HOME": str(tmp / "home")}
        log.write_text("")
        subprocess.run([str(home_scripts / "tmux-claude-menu"), "--act", "approve", "sid-1", "%7"], env=claude_env, check=True)
        require(any(call[:3] == ["send-keys", "-t", "%7"] for call in map(json.loads, log.read_text().splitlines())),
                "live Claude approval was not dispatched")
        rows.write_text("")
        log.write_text("")
        subprocess.run([str(home_scripts / "tmux-claude-menu"), "--act", "kill", "sid-1", "%7"], env=claude_env, check=True)
        require(log.read_text() == "", "stale Claude row acted on a replacement process")

        # cd-origin emits one literal, unsubmitted shell command for hostile paths.
        hostile = tmp / "cwd'$()" / "dir'$(touch nope)"
        hostile.mkdir(parents=True)
        log.write_text("")
        cd_env = env | {"NNN_ORIGIN_PANE": "%4"}
        subprocess.run([str(ROOT / "nnn" / "plugins" / "cd-origin"), hostile.name], cwd=hostile.parent, env=cd_env, check=True)
        calls = [json.loads(line) for line in log.read_text().splitlines()]
        send = next(call for call in calls if call and call[0] == "send-keys")
        require(send[-2] == "-l" and "'\\''" in send[-1] and "cd -- " in send[-1], "cd-origin did not shell-quote its path")
        require(not (hostile.parent / "nope").exists(), "cd-origin executed generated prompt text")

    print("ok: tmux hostile-data boundaries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
