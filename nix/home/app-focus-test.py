#!/usr/bin/env python3
"""Pure IPC fixtures for the focus-or-launch command; never touch the live desktop."""

import importlib.util
from pathlib import Path
import json
import subprocess
import unittest

spec = importlib.util.spec_from_file_location("app_focus", Path(__file__).with_name("app-focus.py"))
assert spec is not None and spec.loader is not None
app_focus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app_focus)


def window(app_class, address="0xabc", history=0, mapped=True):
    return {"class": app_class, "initialClass": app_class, "address": address,
            "focusHistoryID": history, "mapped": mapped}


class IPC:
    def __init__(self, snapshots, active="0x999", outcomes=None):
        self.snapshots = iter(snapshots)
        self.active = active
        self.outcomes = iter(outcomes or [])
        self.commands = []
        self.launches = []

    def run(self, argv, **kwargs):
        self.commands.append(argv)
        if argv == ["hyprctl", "-j", "clients"]:
            value = next(self.snapshots)
            if isinstance(value, Exception):
                raise value
            return subprocess.CompletedProcess(argv, 0, json.dumps(value))
        if argv == ["hyprctl", "-j", "activewindow"]:
            return subprocess.CompletedProcess(argv, 0, json.dumps({"address": self.active}))
        if argv[:2] == ["hyprctl", "dispatch"]:
            code, output = next(self.outcomes, (0, "ok"))
            return subprocess.CompletedProcess(argv, code, output)
        raise AssertionError(argv)

    def start(self, argv, **kwargs):
        self.launches.append((argv, kwargs))


class AppFocusTests(unittest.TestCase):
    def test_no_match_launches_fixed_argv(self):
        ipc = IPC([[window("other")]])
        app_focus.focus_or_launch("obsidian", ipc.run, ipc.start)
        self.assertEqual(ipc.launches[0][0], ["uwsm", "app", "--", "obsidian"])
        self.assertTrue(ipc.launches[0][1]["start_new_session"])

    def test_most_recent_exact_mapped_match(self):
        ipc = IPC([[window("helium-helper", history=0), window("helium", "0xbeef", 1),
                    window("helium", "0x123", 3), window("helium", "0x456", 0, False)]])
        app_focus.focus_or_launch("helium", ipc.run, ipc.start)
        self.assertEqual(ipc.commands[-1], ["hyprctl", "dispatch", "hl.dsp.focus({ window = 'address:0xbeef' })"])
        self.assertEqual(ipc.launches, [])

    def test_already_focused_does_nothing(self):
        ipc = IPC([[window("com.mitchellh.ghostty")]], active="0xabc")
        app_focus.focus_or_launch("ghostty", ipc.run, ipc.start)
        self.assertEqual(len(ipc.commands), 2)
        self.assertEqual(ipc.launches, [])

    def test_scratch_does_not_win_normal_ghostty_focus(self):
        ipc = IPC([[window("com.mitchellh.ghostty.scratch", "0x111", 0),
                    window("com.mitchellh.ghostty", "0x222", 4)]])
        app_focus.focus_or_launch("ghostty", ipc.run, ipc.start)
        self.assertIn("address:0x222", ipc.commands[-1][2])
        self.assertEqual(ipc.launches, [])

    def test_only_scratch_still_launches_normal_ghostty(self):
        ipc = IPC([[window("com.mitchellh.ghostty.scratch")]])
        app_focus.focus_or_launch("ghostty", ipc.run, ipc.start)
        self.assertEqual(ipc.launches[0][0], ["uwsm", "app", "--", "ghostty"])

    def test_failed_query_never_launches(self):
        ipc = IPC([subprocess.CalledProcessError(1, "hyprctl")])
        with self.assertRaises(subprocess.CalledProcessError):
            app_focus.focus_or_launch("dolphin", ipc.run, ipc.start)
        self.assertEqual(ipc.launches, [])

    def test_malformed_response_or_address_never_dispatches(self):
        for snapshot in ({"clients": []}, [window("helium", "0xabc' }) print('bad")]):
            with self.subTest(snapshot=snapshot):
                ipc = IPC([snapshot])
                with self.assertRaises(ValueError):
                    app_focus.focus_or_launch("helium", ipc.run, ipc.start)
                self.assertEqual(ipc.launches, [])
                self.assertFalse(any(cmd[:2] == ["hyprctl", "dispatch"] for cmd in ipc.commands))

    def test_stale_address_refreshes_once(self):
        ipc = IPC([[window("helium", "0xabc")], [window("helium", "0xdef")]],
                  outcomes=[(1, "window not found"), (0, "ok")])
        app_focus.focus_or_launch("helium", ipc.run, ipc.start)
        self.assertIn("address:0xdef", ipc.commands[-1][2])
        self.assertEqual(ipc.launches, [])

    def test_failed_focus_twice_does_not_launch(self):
        ipc = IPC([[window("helium")], [window("helium")]], outcomes=[(1, "error"), (1, "error")])
        with self.assertRaises(RuntimeError):
            app_focus.focus_or_launch("helium", ipc.run, ipc.start)
        self.assertEqual(ipc.launches, [])


if __name__ == "__main__":
    unittest.main()
