#!/usr/bin/env python3
"""Tests for the theme module. Run with `python3 theme/test_theme.py` (stdlib unittest)."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import theme  # noqa: E402


class PaletteValidationTests(unittest.TestCase):
    def test_both_palettes_load(self):
        for name in ("vague", "oldworld"):
            p = theme.load_palette(name)
            self.assertEqual(p["name"], name)
            self.assertEqual(len(p["ansi"]), 16)
            self.assertEqual(len(p["roles"]), len(theme.REQUIRED_ROLES))

    def test_missing_role_fails(self):
        raw = theme._load_raw("vague")
        del raw["roles"]["canvas"]
        with self.assertRaises(theme.ThemeError) as cm:
            theme._validate(raw)
        self.assertIn("canvas", str(cm.exception))

    def test_invalid_hex_fails(self):
        raw = theme._load_raw("vague")
        raw["roles"]["canvas"] = "#12345"
        with self.assertRaises(theme.ThemeError):
            theme._validate(raw)

    def test_reference_cycle_fails(self):
        raw = theme._load_raw("vague")
        raw["roles"]["surface-extend"] = "@surface-fold"
        raw["roles"]["surface-fold"] = "@surface-extend"
        with self.assertRaises(theme.ThemeError) as cm:
            theme._resolve_roles(raw)
        self.assertIn("cycle", str(cm.exception))

    def test_reference_resolves(self):
        p = theme.load_palette("vague")
        # surface-extend is @accent-primary
        self.assertEqual(p["roles"]["surface-extend"], p["roles"]["accent-primary"])
        self.assertEqual(p["roles"]["surface-extend"], "#d8647e")


class ColorConversionTests(unittest.TestCase):
    def test_argb(self):
        self.assertEqual(theme._argb("#9094A0", 0.70), "0xB39094A0")
        self.assertEqual(theme._argb("#1c1c24", 1.0), "0xFF1C1C24")

    def test_rgb_tuple(self):
        self.assertEqual(theme._rgb_tuple("#656a80"), "101 106 128")


class BuildTests(unittest.TestCase):
    def test_deterministic_build(self):
        b1 = theme.build("vague")
        b2 = theme.build("vague")
        self.assertEqual(b1, b2)

    def test_all_adapters_present(self):
        b = theme.build("vague")
        for tool in theme.ADAPTERS:
            self.assertIn(theme.ADAPTERS[tool][0], b)

    def test_failed_build_leaves_active(self):
        # Corrupt a palette, attempt build, ensure active is unchanged.
        active_before = theme._active_name()
        path = theme.PALETTES_DIR / "vague.json"
        original = path.read_text()
        try:
            path.write_text("{ not valid json")
            with self.assertRaises(theme.ThemeError):
                theme.build("vague")
        finally:
            path.write_text(original)
        self.assertEqual(theme._active_name(), active_before)


class TmuxAdapterTests(unittest.TestCase):
    def test_static_styles_are_materialized(self):
        tmux = theme.render_bundle(theme.load_palette("vague"))["tmux/colors.conf"]
        self.assertIn('set -g status-style "bg=#100E11"', tmux)
        self.assertIn('setw -g pane-active-border-style "fg=#aeaed1, bg=#100E11"', tmux)
        self.assertNotIn('status-style "bg=#{', tmux)
        self.assertNotIn('pane-active-border-style "fg=#{', tmux)


class AuditTests(unittest.TestCase):
    def test_generated_bundle_has_no_hue_names(self):
        b = theme.build("vague")
        tmux_conf = b["tmux/colors.conf"]
        for hue in ("rose", "lavender", "dusty_pink", "ephemeral", "float"):
            self.assertNotIn(f"@color-{hue}", tmux_conf)


if __name__ == "__main__":
    unittest.main(verbosity=2)
