#!/usr/bin/env python3
"""Tests for the theme module. Run with `python3 theme/test_theme.py` (stdlib unittest)."""

from __future__ import annotations

import json
import os
import re
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


class LazyGitAdapterTests(unittest.TestCase):
    def test_default_foreground_uses_primary_text(self):
        for path in sorted(theme.PALETTES_DIR.glob("*.json")):
            with self.subTest(palette=path.stem):
                palette = theme.load_palette(path.stem)
                lazygit = theme.render_bundle(palette)["lazygit/colors.yml"]
                self.assertIn(
                    f'defaultFgColor:\n    - "{palette["roles"]["text"]}"',
                    lazygit,
                )

    def test_selected_background_keeps_default_foreground_readable(self):
        for path in sorted(theme.PALETTES_DIR.glob("*.json")):
            with self.subTest(palette=path.stem):
                palette = theme.load_palette(path.stem)
                selected_bg = theme._lazygit_selected_bg(palette)
                self.assertGreaterEqual(
                    theme.contrast_ratio(palette["roles"]["text"], selected_bg),
                    theme.CONTRAST_NORMAL,
                )
                lazygit = theme.render_bundle(palette)["lazygit/colors.yml"]
                self.assertIn(f'selectedLineBgColor:\n    - "{selected_bg}"', lazygit)

    def test_all_launch_paths_use_generated_config(self):
        generated = "theme/generated/lazygit/config.yml"
        zsh = (theme.CONFIG_DIR / "zshrc").read_text()
        popup = (theme.CONFIG_DIR / "tmux_scripts/tmux-lazygit-popup").read_text()
        nvim = (theme.CONFIG_DIR / "nvim/lua/plugins/lazygit.lua").read_text()
        for entrypoint in (zsh, popup, nvim):
            self.assertIn(generated, entrypoint)
        self.assertIn("--use-config-file", zsh)
        self.assertIn("--use-config-file", popup)
        self.assertIn("lazygit_use_custom_config_file_path = 1", nvim)


class TmuxAdapterTests(unittest.TestCase):
    def test_static_styles_are_materialized(self):
        tmux = theme.render_bundle(theme.load_palette("vague"))["tmux/colors.conf"]
        self.assertIn('set -g @color-surface-inactive "#0b0a0c"', tmux)
        self.assertIn('set -g @color-surface-pane-active "#1a1920"', tmux)
        self.assertIn('set -g status-style "bg=#100e11"', tmux)
        self.assertIn('setw -g pane-active-border-style "fg=#aeaed1, bg=#100e11"', tmux)
        self.assertIn("if -F '#{==:#{version},next-3.8}' 'setw -g window-style \"bg=#0b0a0c,dim=20%\"' 'setw -g window-style \"bg=#0b0a0c\"'", tmux)
        self.assertNotIn('status-style "bg=#{', tmux)
        self.assertNotIn('pane-active-border-style "fg=#{', tmux)

    def test_materialized_style_hex_is_lowercase_for_safe_format_expansion(self):
        for path in sorted(theme.PALETTES_DIR.glob("*.json")):
            with self.subTest(palette=path.stem):
                tmux = theme.render_bundle(theme.load_palette(path.stem))["tmux/colors.conf"]
                static = tmux.split("# Materialized static styles", 1)[1]
                colors = re.findall(r"#[0-9A-Fa-f]{6}", static)
                self.assertTrue(colors)
                self.assertEqual(colors, [color.lower() for color in colors])

    def test_derived_pane_surfaces(self):
        self.assertEqual(theme._tmux_inactive_surface("#1E1D23", "#242329"), "#151418")
        self.assertEqual(theme._tmux_inactive_surface("#000000", "#101010"), "#080808")
        self.assertEqual(theme._tmux_active_surface("#242329"), "#232228")

    def test_derived_pane_surfaces_stay_distinct_in_every_palette(self):
        for path in sorted(theme.PALETTES_DIR.glob("*.json")):
            with self.subTest(palette=path.stem):
                palette = theme.load_palette(path.stem)
                canvas = palette["roles"]["canvas"]
                active_role = palette["roles"]["surface-active"]
                inactive = theme._tmux_inactive_surface(canvas, active_role)
                active = theme._tmux_active_surface(active_role)
                self.assertGreaterEqual(theme._hex_distance(canvas, inactive), theme.DISTINCT_SURFACE)
                self.assertGreaterEqual(theme._hex_distance(canvas, active), theme.DISTINCT_SURFACE)
                self.assertGreaterEqual(theme._hex_distance(inactive, active), theme.DISTINCT_SURFACE)

    def test_derived_surface_validation_rejects_impossible_fallback(self):
        with self.assertRaisesRegex(theme.ThemeError, "tmux derived canvas/inactive"):
            theme._validate_tmux_surfaces("#000000", "#030000", "#060000")

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
    def test_footer_uses_requested_silhouettes_and_zoom_background(self):
        config = (theme.CONFIG_DIR / "tmux.conf").read_text()
        self.assertIn("#{?#{window_zoomed_flag},#[bg=#{@color-divider}],}", config)
        self.assertIn("#{?#{window_zoomed_flag},#[bg=#{@color-canvas}],}", config)
        self.assertNotIn("#[underscore#,us=#{@color-divider}]", config)
        self.assertIn("#{@pane-label}#[fg=#{@color-accent-secondary}]───*───*───*───*───*", config)
        self.assertIn("#{@pane-label}#[fg=#{@color-text-muted}]───#[fg=#{@color-accent-primary}]*", config)
        self.assertNotIn("---#[fg=#{@color-accent", config)
        footer = next(line for line in config.splitlines() if line.startswith("setw -g pane-border-format"))
        self.assertEqual(footer.count("#[align=centre]"), 2)
        self.assertNotIn("align=absolute-centre", footer)
        status_row = next(line for line in config.splitlines() if line.startswith("set -g status-format[1]"))
        self.assertIn("#{?#{e|>:#{pane_left},0},+,}", status_row)
        self.assertIn("#{window_width}},+,}", status_row)


class LualineConfigTests(unittest.TestCase):
    def test_buffer_components_share_resolved_palette_colors(self):
        config = (theme.CONFIG_DIR / "nvim/lua/plugins/lualine.lua").read_text()
        self.assertEqual(config.count("buffers_color = buffer_colors"), 2)
        self.assertIn('local buffer_active_bg = palette["surface-highlight"]', config)
        self.assertIn("fg = chrome_fg", config)
        self.assertIn("bg = buffer_active_bg", config)
        self.assertIn("fg = inactive_fg", config)
        self.assertIn("bg = chrome", config)
        self.assertNotIn('bg = "chrome"', config)
        self.assertNotIn('fg = "inactive_fg"', config)


class PiDiscoveryTests(unittest.TestCase):
    """Pi resolves themes by internal `name`. Every canonical palette renders a
    generated pi theme named after the palette; the only other files pi
    auto-discovers in agent/themes are standalone themes. No two of them may
    share an internal name (pi would report a conflict / pick a duplicate)."""

    PI_THEMES_DIR = theme.CONFIG_DIR / "pi-config" / "agent" / "themes"

    def test_all_canonical_pi_names_unique_against_standalone_themes(self):
        names = []
        for path in sorted(theme.PALETTES_DIR.glob("*.json")):
            p = theme.load_palette(path.stem)
            names.append(json.loads(theme._pi(p))["name"])
        for f in sorted(self.PI_THEMES_DIR.glob("*.json")):
            if f.name == "active.json":
                continue
            names.append(json.loads(f.read_text())["name"])
        dups = sorted({n for n in names if names.count(n) > 1})
        self.assertEqual(dups, [], f"duplicate pi internal theme names: {dups}")

    def test_managed_pi_themes_dir_holds_only_active_discovery_link(self):
        entries = {e.name for e in self.PI_THEMES_DIR.iterdir()}
        self.assertEqual(entries, {"active.json"},
                         "the managed pi themes dir must contain only the active.json discovery link")


class OverrideTests(unittest.TestCase):
    """Optional `overrides: {roles, reason?}` layered onto canonical base roles
    before reference resolution. Overrides are role-only, cannot supply missing
    canonical roles, and feed every adapter and quality check through the
    effective palette."""

    def _vague_raw(self):
        return theme._load_raw("vague")

    def test_override_applies_before_reference_resolution(self):
        raw = self._vague_raw()
        # surface-extend is @accent-primary; overriding accent-primary must
        # propagate into the effective surface-extend (post-merge resolution).
        raw["overrides"] = {"roles": {"accent-primary": "#123456"}}
        p = theme.resolve_palette(raw)
        self.assertEqual(p["roles"]["accent-primary"], "#123456")
        self.assertEqual(p["roles"]["surface-extend"], "#123456")

    def test_override_reaches_adapters(self):
        raw = self._vague_raw()
        raw["overrides"] = {"roles": {"canvas": "#191a1e"}}
        p = theme.resolve_palette(raw)
        bundle = theme.render_bundle(p)
        self.assertEqual(p["roles"]["canvas"], "#191a1e")
        self.assertIn("#191a1e", bundle["tmux/colors.conf"])
        self.assertIn("#191a1e", bundle["ghostty/theme"])
        pi_json = json.loads(bundle["pi/theme.json"])
        self.assertEqual(pi_json["vars"]["canvas"], "#191a1e")

    def test_override_unknown_role_rejected(self):
        raw = self._vague_raw()
        raw["overrides"] = {"roles": {"not-a-role": "#ffffff"}}
        with self.assertRaises(theme.ThemeError) as cm:
            theme.resolve_palette(raw)
        self.assertIn("not-a-role", str(cm.exception))

    def test_override_malformed_value_rejected(self):
        raw = self._vague_raw()
        raw["overrides"] = {"roles": {"canvas": "#12345"}}
        with self.assertRaises(theme.ThemeError):
            theme.resolve_palette(raw)

    def test_override_malformed_shape_rejected(self):
        raw = self._vague_raw()
        for bad in ({"roles": "nope"}, {"roles": 42}, "overrides-not-an-object"):
            raw["overrides"] = bad
            with self.assertRaises(theme.ThemeError):
                theme.resolve_palette(raw)

    def test_override_reason_must_be_string(self):
        raw = self._vague_raw()
        raw["overrides"] = {"roles": {"canvas": "#191a1e"}, "reason": 7}
        with self.assertRaises(theme.ThemeError):
            theme.resolve_palette(raw)

    def test_override_cannot_supply_missing_base_role(self):
        raw = self._vague_raw()
        del raw["roles"]["canvas"]
        raw["overrides"] = {"roles": {"canvas": "#191a1e"}}
        with self.assertRaises(theme.ThemeError) as cm:
            theme.resolve_palette(raw)
        self.assertIn("canvas", str(cm.exception))

    def test_post_merge_reference_cycle_detected(self):
        raw = self._vague_raw()
        # Overridden values can close a cycle that the base graph does not have.
        raw["overrides"] = {"roles": {"accent-primary": "@canvas", "canvas": "@accent-primary"}}
        with self.assertRaises(theme.ThemeError) as cm:
            theme.resolve_palette(raw)
        self.assertIn("cycle", str(cm.exception))

    def test_overrides_feed_quality_checks(self):
        raw = self._vague_raw()
        raw["overrides"] = {"roles": {"canvas": "#000000"}}
        p = theme.resolve_palette(raw)
        findings = theme.check_quality(p)
        joined = "\n".join(findings)
        self.assertNotIn(" on canvas ", joined)
        self.assertNotIn("canvas vs surface-active too similar", joined)

    def test_terminal_override_does_not_move_sketchybar_bundle(self):
        base = theme.resolve_palette(self._vague_raw())
        raw2 = json.loads(json.dumps(self._vague_raw()))
        raw2["overrides"] = {"roles": {"canvas": "#111111", "text": "#eeeeee"}}
        over = theme.resolve_palette(raw2)
        self.assertEqual(
            theme._sketchybar(base), theme._sketchybar(over),
            "sketchybar bundle must be byte-identical regardless of terminal-role overrides",
        )

    def test_override_deterministic_rendering(self):
        raw = self._vague_raw()
        raw["overrides"] = {"roles": {"canvas": "#191a1e"}}
        p = theme.resolve_palette(raw)
        self.assertEqual(theme.render_bundle(p), theme.render_bundle(p))

    def test_resolve_palette_matches_load_palette_without_overrides(self):
        self.assertEqual(
            theme.load_palette("vague"), theme.resolve_palette(theme._load_raw("vague")))


if __name__ == "__main__":
    unittest.main(verbosity=2)
