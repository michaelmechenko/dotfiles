#!/usr/bin/env python3
"""Focus a known application's most recent Hyprland window, or launch it."""

import json
import re
import subprocess
import sys


APPS = {
    "helium": ("helium", "helium"),
    "ghostty": ("com.mitchellh.ghostty", "ghostty"),
    "dolphin": ("dolphin", "dolphin"),
    "obsidian": ("md.obsidian.Obsidian", "obsidian"),
}
ADDRESS = re.compile(r"0x[0-9a-fA-F]+\Z")


def clients(run):
    result = run(["hyprctl", "-j", "clients"], capture_output=True, text=True, check=True)
    windows = json.loads(result.stdout)
    if not isinstance(windows, list):
        raise ValueError("Hyprland clients response is not an array")
    return windows


def latest(windows, app_class):
    matches = [
        window for window in windows
        if isinstance(window, dict)
        and window.get("mapped") is True
        and app_class in (window.get("class"), window.get("initialClass"))
    ]
    if not matches:
        return None
    # Lower focusHistoryID means more recent; an invalid ID cannot win.
    def recency(window):
        history_id = window.get("focusHistoryID")
        return history_id if type(history_id) is int and history_id >= 0 else sys.maxsize

    return min(matches, key=recency)


def focus_or_launch(app, run=subprocess.run, start=subprocess.Popen):
    app_class, command = APPS[app]
    for attempt in range(2):
        window = latest(clients(run), app_class)
        if window is None:
            start(["uwsm", "app", "--", command], start_new_session=True)
            return
        address = window.get("address")
        if not isinstance(address, str) or not ADDRESS.fullmatch(address):
            raise ValueError("Hyprland returned an invalid window address")
        active = run(["hyprctl", "-j", "activewindow"], capture_output=True, text=True, check=True)
        current = json.loads(active.stdout)
        if not isinstance(current, dict):
            raise ValueError("Hyprland active window response is not an object")
        if current.get("address") == address:
            return
        # Hyprland 0.55 Lua dispatcher; address is strictly hexadecimal, not code.
        result = run(
            ["hyprctl", "dispatch", f"hl.dsp.focus({{ window = 'address:{address}' }})"],
            capture_output=True, text=True,
        )
        if result.returncode == 0 and result.stdout.strip() == "ok":
            return
        if attempt == 1:
            raise RuntimeError(f"Hyprland could not focus {app}")
        # A window may have vanished between listing and focusing. Refresh once.


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in APPS:
        print("usage: app-focus {helium|ghostty|dolphin|obsidian}", file=sys.stderr)
        return 2
    try:
        focus_or_launch(sys.argv[1])
    except (OSError, ValueError, KeyError, json.JSONDecodeError, subprocess.CalledProcessError, RuntimeError) as error:
        print(f"app-focus: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
