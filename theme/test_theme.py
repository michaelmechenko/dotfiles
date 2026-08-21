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
    def test_all_palettes_load(self):
        names = sorted(path.stem for path in theme.PALETTES_DIR.glob("*.json"))
        self.assertGreaterEqual(len(names), 37)
        for name in names:
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

    def test_tmux_sources_active_palette_portably(self):
        config = (theme.CONFIG_DIR / "tmux.conf").read_text()
        source = "source-file ~/.config/theme/active/tmux/colors.conf"
        self.assertEqual(config.count(source), 2)
        self.assertNotIn("source-file /Users/", config)


class AuditTests(unittest.TestCase):
    def test_generated_bundle_has_no_hue_names(self):
        b = theme.build("vague")
        tmux_conf = b["tmux/colors.conf"]
        for hue in ("rose", "lavender", "dusty_pink", "ephemeral", "float"):
            self.assertNotIn(f"@color-{hue}", tmux_conf)


class QualityTests(unittest.TestCase):
    """Consumer-aware contrast/distinctness checks (theme.check_quality), not
    just structural validation. Every canonical palette must pass every check."""

    def test_all_palettes_pass_quality(self):
        names = sorted(path.stem for path in theme.PALETTES_DIR.glob("*.json"))
        for name in names:
            with self.subTest(palette=name):
                findings = theme.effective_quality_findings(theme.load_palette(name))
                self.assertEqual(findings, [], f"{name}: {findings}")

    def test_every_imported_palette_holds_the_full_floor_with_no_waiver(self):
        # Only the two hand-authored palettes may carry a documented waiver.
        self.assertEqual(set(theme.QUALITY_WAIVERS), {"vague", "oldworld"})

    def test_contrast_ratio_known_values(self):
        # WCAG reference: black on white is 21:1; identical colors are 1:1.
        self.assertAlmostEqual(theme.contrast_ratio("#000000", "#ffffff"), 21.0, places=1)
        self.assertAlmostEqual(theme.contrast_ratio("#808080", "#808080"), 1.0, places=1)

    def test_substrata_brighter_is_not_a_duplicate_of_substrata(self):
        base = theme.load_palette("substrata")
        brighter = theme.load_palette("substrata-brighter")
        self.assertNotEqual(base["roles"], brighter["roles"])
        self.assertNotEqual(base["ansi"], brighter["ansi"])

    def test_substrata_muted_family_not_pooled_to_one_dark_literal(self):
        r = theme.load_palette("substrata")["roles"]
        self.assertNotEqual(r["text-muted"], "#32353e")
        self.assertGreaterEqual(theme.contrast_ratio(r["text-muted"], r["canvas"]), 3.0)

    def test_substrata_pi_card_backgrounds_are_dark_tints(self):
        r = theme.load_palette("substrata")["roles"]
        self.assertNotEqual(r["surface-heading-h1"], r["accent-primary"])
        self.assertNotEqual(r["surface-tint-rose"], r["accent-primary"])
        self.assertGreaterEqual(theme.contrast_ratio(r["text"], r["surface-heading-h1"]), 4.5)
        self.assertGreaterEqual(theme.contrast_ratio(r["text"], r["surface-tint-rose"]), 4.5)


class DesktopFreezeTests(unittest.TestCase):
    """SketchyBar/JankyBorders must never move because a terminal role changed."""

    def test_sketchybar_adapter_does_not_read_shared_terminal_roles(self):
        import inspect
        src = inspect.getsource(theme._sketchybar)
        self.assertNotIn("r['text-ui']", src)
        self.assertNotIn('r["text-ui"]', src)
        self.assertNotIn("r['surface-chrome']", src)
        self.assertNotIn('r["surface-chrome"]', src)
        self.assertIn("bar-border-active", src)
        self.assertIn("bar-border-inactive", src)

    def test_terminal_scope_never_calls_sketchybar_or_borders(self):
        calls = []
        orig_bar, orig_borders = theme._apply_sketchybar, theme._apply_borders
        orig_tmux, orig_omp, orig_lg = theme._apply_tmux, theme._apply_ohmyposh, theme._apply_lazygit
        orig_active = theme._active_name()
        theme._apply_sketchybar = lambda: calls.append("sketchybar")
        theme._apply_borders = lambda: calls.append("borders")
        theme._apply_tmux = lambda: None
        theme._apply_ohmyposh = lambda: None
        theme._apply_lazygit = lambda: None
        try:
            theme.switch("vague", scope="terminal")
        finally:
            theme._apply_sketchybar, theme._apply_borders = orig_bar, orig_borders
            theme._apply_tmux, theme._apply_ohmyposh, theme._apply_lazygit = orig_tmux, orig_omp, orig_lg
            # Restore the live active pointer; this test must not leave the
            # machine's active theme changed as a side effect of running.
            if orig_active:
                theme._set_active(orig_active)
        self.assertEqual(calls, [])

    def test_invalid_scope_rejected(self):
        with self.assertRaises(theme.ThemeError):
            theme.switch("vague", scope="bogus")


class BundleDriftTests(unittest.TestCase):
    """Every tracked bundle must match what the current generator produces."""

    def test_all_tracked_bundles_match_generator_output(self):
        stale = []
        for path in sorted(theme.PALETTES_DIR.glob("*.json")):
            name = path.stem
            bundle_dir = theme.BUNDLES_DIR / name
            if not bundle_dir.exists():
                continue
            expected = theme.render_bundle(theme.load_palette(name))
            for rel, content in expected.items():
                on_disk = bundle_dir / rel
                if not on_disk.exists() or on_disk.read_text() != content:
                    stale.append(f"{name}/{rel}")
        self.assertEqual(stale, [], f"stale generated artifacts (run `theme build` for each): {stale}")


class TmuxFooterTests(unittest.TestCase):
    def test_active_unlabeled_center_stars_distinct_from_outer_stars(self):
        config = (theme.CONFIG_DIR / "tmux.conf").read_text()
        # The normal (non-zoomed) active+unlabeled branch: outer 4 stars keep
        # accent-tertiary, the center *-*-* trio switches to accent-primary.
        marker = ("#[us=#{@color-text-muted}]#[fg=#{@color-accent-tertiary}]*"
                   "#[fg=#{@color-accent-secondary}]---#[fg=#{@color-accent-tertiary}]*"
                   "#[fg=#{@color-accent-secondary}]---#[fg=#{@color-accent-primary}]*"
                   "#[fg=#{@color-accent-secondary}]-#[fg=#{@color-accent-primary}]*"
                   "#[fg=#{@color-accent-secondary}]-#[fg=#{@color-accent-primary}]*"
                   "#[fg=#{@color-accent-secondary}]---#[fg=#{@color-accent-tertiary}]*"
                   "#[fg=#{@color-accent-secondary}]---#[fg=#{@color-accent-tertiary}]*")
        self.assertIn(marker, config)


if __name__ == "__main__":
    unittest.main(verbosity=2)
