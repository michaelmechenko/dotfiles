#!/usr/bin/env python3
"""Deep theme module: one canonical semantic palette per colorscheme, one generator.

Commands:
    theme list                 list available palettes and the active one
    theme check <name>         validate a palette and render every artifact without
                               touching live state (dry-run build)
    theme build <name>         render and atomically publish the bundle for <name>
    theme switch <name>        build + publish + apply to the live app stack

Design (see COLORS.md and the plan):
  * A palette is a JSON object of semantic, hue-independent roles (hex or @role
    references), an explicit ANSI 0-15 array, Ghostty UI colors, a narrow native
    section (Neovim/Zed colorscheme names), and optional opacity metadata. A
    palette may carry an optional `overrides` layer (`{roles, reason?}`) applied
    to the canonical base roles before reference resolution, so personal tweaks
    live with the palette and feed every adapter and quality check through the
    effective role set.
  * Adapters render deterministic per-tool artifacts into a staged bundle, which is
    validated and published atomically. The active theme is recorded only after a
    successful build, so a failed render leaves the previous theme intact.
  * Canonical palettes and generated bundles are tracked; only the machine-local
    active pointer (theme/active) is untracked, so switching does not dirty git.

Stdlib only; deterministic output (sorted keys, stable ordering, no timestamps).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CONFIG_DIR = Path.home() / ".config"
THEME_DIR = CONFIG_DIR / "theme"
PALETTES_DIR = THEME_DIR / "palettes"
BUNDLES_DIR = THEME_DIR / "bundles"
ACTIVE_LINK = THEME_DIR / "active"

HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
HEX_ANYWHERE_RE = re.compile(r"#[0-9a-fA-F]{6}")
REF_RE = re.compile(r"^@([a-z][a-z0-9-]*)$")

# The complete semantic role set a palette must provide. Hue-independent names.
REQUIRED_ROLES = [
    # surfaces
    "canvas", "surface-active", "surface-chrome", "surface-highlight",
    "surface-extend", "surface-fold", "surface-heading-h1", "surface-heading-h2",
    "surface-heading-h3", "surface-tint-rose", "copy-mode-indicator", "divider-subtle",
    # text
    "text", "text-ui", "text-muted", "text-default",
    # accents
    "accent-primary", "accent-secondary", "accent-tertiary", "accent-highlight",
    "accent-info", "accent-periwinkle", "accent-warn", "accent-amber",
    # ghostty selection/chrome
    "selection-bg", "selection-fg", "split-divider",
    # sketchybar text/canvas (independent literals, never referenced by terminal adapters)
    "bar-text", "bar-canvas",
    # sketchybar/borders window-border colors, frozen to their pre-quality-fix values so
    # a terminal-role contrast repair can never move the live desktop bar/border output.
    # Do not reference these from any non-sketchybar adapter.
    "bar-border-active", "bar-border-inactive",
]

# Semantic tmux @color-* option names, keyed by role. Hue names (rose/lavender/
# dusty_pink) are gone; every option is a semantic role name.
TMUX_OPTIONS = {
    "canvas": "@color-canvas",
    "surface-active": "@color-surface-active",
    "surface-chrome": "@color-surface-chrome",
    "surface-highlight": "@color-surface-highlight",
    "divider-subtle": "@color-divider",
    "copy-mode-indicator": "@color-copy-indicator",
    "text": "@color-text",
    "text-ui": "@color-text-ui",
    "text-muted": "@color-text-muted",
    "text-default": "@color-text-default",
    "accent-primary": "@color-accent-primary",
    "accent-secondary": "@color-accent-secondary",
    "accent-tertiary": "@color-accent-tertiary",
    "accent-highlight": "@color-accent-highlight",
    "accent-info": "@color-accent-info",
    "accent-periwinkle": "@color-accent-periwinkle",
    "accent-warn": "@color-accent-warn",
    "accent-amber": "@color-accent-amber",
}


class ThemeError(Exception):
    """A palette or adapter failure, with a concise role/tool name."""


# ---------------------------------------------------------------------------
# Loading and validation
# ---------------------------------------------------------------------------

def _load_raw(name: str) -> dict:
    path = PALETTES_DIR / f"{name}.json"
    if not path.exists():
        raise ThemeError(f"palette '{name}' not found at {path}")
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as e:
        raise ThemeError(f"palette '{name}' is not valid JSON: {e}") from e


def _validate(palette: dict) -> None:
    name = palette.get("name")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", name):
        raise ThemeError("palette 'name' must be a lowercase kebab identifier")

    roles = palette.get("roles")
    if not isinstance(roles, dict):
        raise ThemeError(f"palette '{name}' missing 'roles' object")

    # Base roles must independently satisfy the canonical set. Overrides are a
    # personal layer on top; they may tweak existing roles but can never supply a
    # missing canonical role, so the base set is checked before overrides merge.
    missing = [r for r in REQUIRED_ROLES if r not in roles]
    if missing:
        raise ThemeError(f"palette '{name}' missing roles: {', '.join(missing)}")

    for role, value in roles.items():
        if not isinstance(value, str) or not (HEX_RE.match(value) or REF_RE.match(value)):
            raise ThemeError(f"palette '{name}' role '{role}' has invalid value {value!r}")

    overrides = palette.get("overrides")
    if overrides is not None:
        if (not isinstance(overrides, dict)
                or not isinstance(overrides.get("roles"), dict)):
            raise ThemeError(f"palette '{name}' 'overrides' must be an object with a 'roles' object")
        if "reason" in overrides and not isinstance(overrides["reason"], str):
            raise ThemeError(f"palette '{name}' 'overrides.reason' must be a string")
        for role, value in overrides["roles"].items():
            if role not in roles:
                raise ThemeError(f"palette '{name}' override role '{role}' is not a canonical role")
            if not isinstance(value, str) or not (HEX_RE.match(value) or REF_RE.match(value)):
                raise ThemeError(f"palette '{name}' override role '{role}' has invalid value {value!r}")

    ansi = palette.get("ansi")
    if not isinstance(ansi, list) or len(ansi) != 16:
        raise ThemeError(f"palette '{name}' 'ansi' must be a 16-element array")
    for i, v in enumerate(ansi):
        if not isinstance(v, str) or not HEX_RE.match(v):
            raise ThemeError(f"palette '{name}' ansi[{i}] is not a hex color: {v!r}")

    native = palette.get("native")
    if not isinstance(native, dict) or "nvim" not in native or "zed" not in native:
        raise ThemeError(f"palette '{name}' 'native' must declare nvim and zed")
    nvim = native["nvim"]
    if isinstance(nvim, str):
        pass
    elif (isinstance(nvim, dict) and isinstance(nvim.get("name"), str)
          and all(isinstance(k, str) and isinstance(v, (str, int, float, bool))
                  for k, v in nvim.get("globals", {}).items())):
        pass
    else:
        raise ThemeError(f"palette '{name}' native.nvim must be a name or {{name, globals}}")
    if native["zed"] is not None and not isinstance(native["zed"], str):
        raise ThemeError(f"palette '{name}' native.zed must be a name or null")


def _resolve_roles(palette: dict) -> dict:
    """Resolve @role references to concrete hex, with cycle detection.

    Overrides are merged into the base roles *before* resolution, so references
    observe overridden values and cycles through overridden references are caught
    on the effective graph."""
    roles = dict(palette["roles"])
    overrides = palette.get("overrides")
    if overrides:
        roles.update(overrides["roles"])
    resolved: dict[str, str] = {}
    resolving: list[str] = []

    def resolve(role: str) -> str:
        if role in resolved:
            return resolved[role]
        if role in resolving:
            cycle = " -> ".join(resolving + [role])
            raise ThemeError(f"role reference cycle: {cycle}")
        if role not in roles:
            raise ThemeError(f"role '{role}' referenced but not defined")
        resolving.append(role)
        value = roles[role]
        if REF_RE.match(value):
            target = REF_RE.match(value).group(1)
            result = resolve(target)
        else:
            result = value
        resolving.pop()
        resolved[role] = result
        return result

    for role in roles:
        resolve(role)
    return resolved


def resolve_palette(raw: dict) -> dict:
    """Validate a raw palette dict and resolve it to an effective palette, applying
    any `overrides` before reference resolution. Returns a dict with resolved roles
    ready for adapters and quality checks."""
    _validate(raw)
    roles = _resolve_roles(raw)
    return {
        "name": raw["name"],
        "roles": roles,
        "ansi": raw["ansi"],
        "ghostty": raw.get("ghostty", {}),
        "native": raw["native"],
        "opacity": raw.get("opacity", {}),
    }


def load_palette(name: str) -> dict:
    """Load, validate, and resolve a palette. Returns a dict with resolved roles."""
    return resolve_palette(_load_raw(name))


# ---------------------------------------------------------------------------
# Color helpers
# ---------------------------------------------------------------------------

def _rgb(hexstr: str) -> tuple[int, int, int]:
    h = hexstr.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _argb(hexstr: str, alpha: float = 1.0) -> str:
    """Convert a hex color to 0xAARRGGBB, rounding alpha halves upward."""
    r, g, b = _rgb(hexstr)
    a = int(alpha * 255 + 0.5)
    return f"0x{a:02X}{r:02X}{g:02X}{b:02X}"


def _rgb_tuple(hexstr: str) -> str:
    """Convert a hex color to 'R G B' decimal (Claude statusline rgb() form)."""
    r, g, b = _rgb(hexstr)
    return f"{r} {g} {b}"


def _linearize(c: int) -> float:
    c = c / 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def relative_luminance(hexstr: str) -> float:
    """WCAG 2.1 relative luminance of a hex color."""
    r, g, b = _rgb(hexstr)
    return 0.2126 * _linearize(r) + 0.7152 * _linearize(g) + 0.0722 * _linearize(b)


def contrast_ratio(hex1: str, hex2: str) -> float:
    """WCAG 2.1 contrast ratio between two hex colors (1.0-21.0)."""
    l1, l2 = relative_luminance(hex1), relative_luminance(hex2)
    if l1 < l2:
        l1, l2 = l2, l1
    return (l1 + 0.05) / (l2 + 0.05)


def _hex_distance(hex1: str, hex2: str) -> float:
    """Rough perceptual distance (Euclidean over sRGB) for distinctness checks."""
    r1, g1, b1 = _rgb(hex1)
    r2, g2, b2 = _rgb(hex2)
    return ((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) ** 0.5


# ---------------------------------------------------------------------------
# Quality checks (consumer-aware contrast/distinctness, not just structure)
# ---------------------------------------------------------------------------

# WCAG floors used across the checks below. 4.5:1 is the WCAG AA floor for
# normal text; 3:1 is the floor this project uses for muted/dim informational
# text (still meaningful, just visually secondary) and large/bold text.
CONTRAST_NORMAL = 4.5
CONTRAST_MUTED = 3.0
# Minimum sRGB Euclidean distance for "visually distinct" accent/surface pairs.
# Calibrated against vague.json (the hand-authored reference palette): its own
# accent-tertiary/accent-secondary pair sits at ~29, an intentional close-family
# purple pairing that must keep passing. The floor only needs to catch true
# duplicates/near-duplicates (the tmux center-vs-outer star bug class), not force
# maximal separation within a cohesive accent family.
DISTINCT_ACCENT = 15.0
DISTINCT_SURFACE = 6.0


def check_quality(p: dict) -> list[str]:
    """Consumer-aware quality checks: real text/background contrast pairs as
    they are actually rendered by tmux, Pi, Ghostty/ANSI, and the pane-footer
    accents, not just palette shape. Returns a list of human-readable failure
    strings; an empty list means the palette passes every check."""
    r = p["roles"]
    ansi = p["ansi"]
    name = p["name"]
    findings: list[str] = []

    def need(label: str, fg: str, bg: str, floor: float) -> None:
        c = contrast_ratio(r[fg] if fg in r else fg, r[bg] if bg in r else bg)
        if c < floor:
            findings.append(f"{name}: {label} contrast {c:.2f}:1 < {floor}:1 ({fg}={r.get(fg, fg)} on {bg}={r.get(bg, bg)})")

    # Normal text must clear 4.5:1 on every surface it actually renders on.
    for role in ("text", "text-ui", "text-default"):
        for surface in ("canvas", "surface-active", "surface-chrome"):
            need(f"{role} on {surface}", role, surface, CONTRAST_NORMAL)

    # Muted/dim informational text must clear 3:1 on every surface it renders on
    # (Pi 'dim'/'muted', tmux muted text, k9s comment, lazygit inactive border).
    for role in ("text-muted", "copy-mode-indicator"):
        for surface in ("canvas", "surface-active", "surface-chrome"):
            need(f"{role} on {surface}", role, surface, CONTRAST_MUTED)

    # ANSI 7 (normal white) / 15 (bright white) carry primary terminal text;
    # ANSI 8 (bright black) carries dim/comment text in ANSI-inheriting tools.
    canvas = r["canvas"]
    for idx, floor, label in ((7, CONTRAST_NORMAL, "ansi[7]"), (15, CONTRAST_NORMAL, "ansi[15]"),
                               (8, CONTRAST_MUTED, "ansi[8]")):
        c = contrast_ratio(ansi[idx], canvas)
        if c < floor:
            findings.append(f"{name}: {label} on canvas contrast {c:.2f}:1 < {floor}:1 ({ansi[idx]} on {canvas})")

    # Selection foreground/background must remain readable.
    need("selection-fg on selection-bg", "selection-fg", "selection-bg", CONTRAST_NORMAL)

    # Pi tool-card states: surface-heading-h1/h2/h3 and surface-tint-rose are
    # rendered as backgrounds under 'text' (title) and 'text-muted' (output).
    for card in ("surface-heading-h1", "surface-heading-h2", "surface-heading-h3", "surface-tint-rose"):
        need(f"text on {card}", "text", card, CONTRAST_NORMAL)
        need(f"text-muted on {card}", "text-muted", card, CONTRAST_MUTED)

    # tmux window-active-style switches window bg between canvas and
    # surface-active; they must be perceptibly different or the "active pane"
    # signal disappears.
    d = _hex_distance(r["canvas"], r["surface-active"])
    if d < DISTINCT_SURFACE:
        findings.append(f"{name}: canvas vs surface-active too similar ({d:.1f} < {DISTINCT_SURFACE}, {r['canvas']} vs {r['surface-active']})")

    # Pane-footer marker accents (outer stars, center stars, dashes/frame) must
    # be genuinely distinct from one another, not just from the background.
    pairs = (("accent-tertiary", "accent-primary"), ("accent-tertiary", "accent-secondary"),
             ("accent-primary", "accent-secondary"))
    for a, b in pairs:
        d = _hex_distance(r[a], r[b])
        if d < DISTINCT_ACCENT:
            findings.append(f"{name}: {a} vs {b} not visually distinct ({d:.1f} < {DISTINCT_ACCENT}, {r[a]} vs {r[b]})")

    return findings


# Narrow, documented exceptions to check_quality for the two hand-authored
# palettes. vague/oldworld predate theme.py: their text-muted/copy-mode-indicator
# (and, for oldworld, selection-bg) values are independently hardcoded across
# ~9 files outside the generator (COLORS.md, claude/themes/vague-aligned.json,
# ghostty/themes/vague and oldworld, lazygit/config.yml, mm-sidebar's Go source,
# nnn/plugins/preview-tui, .wezterm.lua, nvim dropbar/devicons) - see PALETTES.md.
# Re-deriving those roles here would fork the generated bundle from the
# established, widely-referenced values instead of matching them. The residual
# shortfalls are soft (2.2-3.2:1, never the near-zero contrast the imported-set
# bug produced); every other palette, including every imported one, holds the
# full floor with no waiver.
QUALITY_WAIVERS = {
    "vague": (
        "copy-mode-indicator on surface-active", "copy-mode-indicator on surface-chrome",
        "text-muted on surface-heading-h1", "text-muted on surface-heading-h2",
        "text-muted on surface-heading-h3", "text-muted on surface-tint-rose",
    ),
    "oldworld": (
        "text-muted on surface-chrome", "copy-mode-indicator on surface-chrome",
        "selection-fg on selection-bg",
        "text-muted on surface-heading-h1", "text-muted on surface-heading-h2",
        "text-muted on surface-heading-h3", "text-muted on surface-tint-rose",
    ),
}


def effective_quality_findings(p: dict) -> list[str]:
    """check_quality() findings with QUALITY_WAIVERS filtered out. This is what
    CI/tests should gate on; check_quality() itself stays unfiltered ground truth."""
    waived = QUALITY_WAIVERS.get(p["name"], ())
    return [f for f in check_quality(p) if not any(w in f for w in waived)]


# ---------------------------------------------------------------------------
# Adapters
# ---------------------------------------------------------------------------

def _ghostty(p: dict) -> str:
    lines = [f"palette = {i}={v}" for i, v in enumerate(p["ansi"])]
    g = p["ghostty"]
    for key in ("background", "foreground", "selection-background",
                "selection-foreground", "split-divider-color",
                "cursor-color", "cursor-text"):
        if key in g:
            val = g[key]
            if REF_RE.match(val):
                val = p["roles"][REF_RE.match(val).group(1)]
            lines.append(f"{key} = {val}")
    return "\n".join(lines) + "\n"


def _tmux(p: dict) -> str:
    r = p["roles"]
    canvas = r["canvas"]
    active = r["surface-active"]
    accent = r["accent-secondary"]
    muted = r["text-muted"]
    default = r["text-default"]
    highlight = r["accent-highlight"]
    indicator = r["copy-mode-indicator"]
    lines = ["# Generated by `theme build`. Semantic @color-* options; do not edit by hand."]
    for role, opt in TMUX_OPTIONS.items():
        lines.append(f'set -g {opt} "{r[role]}"')
    # Style options do not expand #{...} formats. Emit concrete values here rather
    # than putting user-option formats in tmux.conf; format options remain dynamic.
    lines.extend([
        "",
        "# Materialized static styles (tmux style options cannot expand formats).",
        f"set -g command-alias[200] 'refresh-active-bg=if -F \"#{{||:#{{==:#{{window_panes}},1}},#{{window_zoomed_flag}}}}\" {{ setw window-active-style \"bg={canvas}\" ; setw pane-active-border-style \"fg={accent}, bg={canvas}\" }} {{ setw window-active-style \"bg={active}\" ; setw pane-active-border-style \"fg={accent}, bg={canvas}\" }}'",
        f'set -g status-style "bg={canvas}"',
        f'setw -g pane-active-border-style "fg={accent}, bg={canvas}"',
        f'setw -g pane-border-style "fg={muted}, bg={canvas}"',
        f'setw -g message-style "fg={muted}, bg={canvas}, fill={canvas}"',
        f'set -g message-command-style "fg={muted}, bg={canvas}, fill={canvas}"',
        f'setw -g copy-mode-position-style "fg={default},bg={indicator}"',
        f'set -g prompt-cursor-colour "{default}"',
        f'setw -g copy-mode-line-number-style "fg={muted},dim"',
        f'setw -g copy-mode-current-line-number-style "fg={highlight},bold"',
        f'setw -g window-active-style "bg={canvas}"',
        f'setw -g window-style "bg={canvas}"',
        f'set -g window-status-current-style "fg={highlight}, bg={canvas}"',
        f'set -g window-status-style "fg={default}, bg={canvas}"',
        f'set -g window-status-last-style "fg={default}, bg={canvas}"',
        f'set -g window-status-activity-style "fg={default}, bg={canvas}"',
        f'set -g window-status-bell-style "fg={muted}, bg={canvas}, bold"',
    ])
    return "\n".join(lines) + "\n"


def _shell(p: dict) -> str:
    r = p["roles"]
    fzf = (
        "--pointer=▌ --color="
        f"fg:{r['text-muted']},fg+:{r['text']},bg:-1,bg+:-1,"
        f"hl:{r['accent-tertiary']},hl+:{r['accent-primary']}:bold,gutter:-1,"
        f"border:{r['divider-subtle']},separator:{r['divider-subtle']},"
        f"scrollbar:{r['divider-subtle']},preview-fg:{r['text']},preview-bg:-1,"
        f"preview-border:{r['divider-subtle']},preview-scrollbar:{r['divider-subtle']},"
        f"prompt:{r['accent-secondary']},pointer:{r['accent-primary']},"
        f"marker:{r['accent-tertiary']},spinner:{r['accent-amber']},"
        f"info:{r['text-muted']},header:{r['text-muted']},query:{r['accent-highlight']},"
        f"disabled:{r['text-muted']},label:{r['text-muted']}"
    )
    muted_rgb = _rgb_tuple(r["text-muted"])
    muted_ansi = ";".join(str(v) for v in _rgb(r["text-muted"]))
    lines = [
        "# Generated by `theme build`. Sourced by zshrc and Claude statusline; do not edit.",
        f"export FZF_DEFAULT_OPTS='{fzf}'",
        f"export THEME_MOOR_HINT='ESC[38;2;{muted_ansi}m'",
        f"export THEME_RGB_TEXT_MUTED='{muted_rgb}'",
        f"export THEME_RGB_ACCENT_TERTIARY='{_rgb_tuple(r['accent-tertiary'])}'",
        f"export THEME_RGB_ACCENT_AMBER='{_rgb_tuple(r['accent-amber'])}'",
        f"export THEME_RGB_ACCENT_PRIMARY='{_rgb_tuple(r['accent-primary'])}'",
    ]
    return "\n".join(lines) + "\n"


def _ohmyposh(p: dict) -> str:
    r = p["roles"]
    palette = {
        "canvas": r["canvas"],
        "text": r["text"],
        "text-muted": r["text-muted"],
        "accent-primary": r["accent-primary"],
        "accent-secondary": r["accent-secondary"],
        "accent-tertiary": r["accent-tertiary"],
        "accent-info": r["accent-info"],
        "accent-warn": r["accent-warn"],
    }
    return json.dumps(palette, indent=2) + "\n"


def _claude(p: dict) -> str:
    r = p["roles"]
    theme = {
        "name": f"{p['name'].title()} Aligned",
        "base": "dark-ansi",
        "overrides": {
            "claude": r["accent-primary"],
            "text": r["text"],
            "inactive": r["text-muted"],
            "success": r["accent-tertiary"],
            "error": r["accent-primary"],
            "warning": r["accent-amber"],
            "planMode": r["accent-info"],
            "autoAccept": r["accent-secondary"],
            "diffAdded": r["accent-tertiary"],
            "diffRemoved": r["accent-primary"],
            "promptBorder": r["divider-subtle"],
        },
    }
    return json.dumps(theme, indent=2) + "\n"


def _pi(p: dict) -> str:
    r = p["roles"]
    vars_ = {
        "canvas": r["canvas"],
        "surfaceActive": r["surface-active"],
        "surfaceChrome": r["surface-chrome"],
        "surfaceHighlight": r["surface-highlight"],
        "surfaceTintRose": r["surface-tint-rose"],
        "surfaceTintDustyPink": r["surface-heading-h1"],
        "text": r["text"],
        "textMuted": r["text-muted"],
        "dimGray": r["copy-mode-indicator"],
        "dividerSubtle": r["divider-subtle"],
        "rose": r["accent-primary"],
        "lavender": r["accent-secondary"],
        "dustyPink": r["accent-tertiary"],
        "slate": r["accent-info"],
        "periwinkle": r["accent-periwinkle"],
        "amber": r["accent-amber"],
    }
    colors = {
        "accent": "rose", "border": "dividerSubtle", "borderAccent": "lavender",
        "borderMuted": "dividerSubtle", "success": "dustyPink", "error": "rose",
        "warning": "amber", "muted": "textMuted", "dim": "dimGray", "text": "text",
        "thinkingText": "textMuted",
        "selectedBg": "surfaceHighlight", "userMessageBg": "surfaceHighlight",
        "userMessageText": "text", "customMessageBg": "surfaceChrome",
        "customMessageText": "text", "customMessageLabel": "lavender",
        "toolPendingBg": "surfaceChrome", "toolSuccessBg": "surfaceTintDustyPink",
        "toolErrorBg": "surfaceTintRose", "toolTitle": "text", "toolOutput": "textMuted",
        "mdHeading": "dustyPink", "mdLink": "lavender", "mdLinkUrl": "textMuted",
        "mdCode": "periwinkle", "mdCodeBlock": "text", "mdCodeBlockBorder": "dividerSubtle",
        "mdQuote": "textMuted", "mdQuoteBorder": "dividerSubtle", "mdHr": "dividerSubtle",
        "mdListBullet": "periwinkle",
        "toolDiffAdded": "dustyPink", "toolDiffRemoved": "rose", "toolDiffContext": "textMuted",
        "syntaxComment": "textMuted", "syntaxKeyword": "lavender", "syntaxFunction": "periwinkle",
        "syntaxVariable": "text", "syntaxString": "dustyPink", "syntaxNumber": "amber",
        "syntaxType": "slate", "syntaxOperator": "text", "syntaxPunctuation": "textMuted",
        "thinkingOff": "textMuted", "thinkingMinimal": "textMuted", "thinkingLow": "textMuted",
        "thinkingMedium": "lavender", "thinkingHigh": "dustyPink", "thinkingXhigh": "dustyPink",
        "thinkingMax": "dustyPink", "bashMode": "amber",
    }
    export = {
        "pageBg": r["canvas"],
        "cardBg": r["surface-chrome"],
        "infoBg": r["surface-heading-h3"],
    }
    return json.dumps({
        "$schema": "https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/src/modes/interactive/theme/theme-schema.json",
        "name": p["name"],
        "vars": vars_,
        "colors": colors,
        "export": export,
    }, indent="\t") + "\n"


def _k9s(p: dict) -> str:
    r = p["roles"]
    return f"""# Generated by `theme build`. Do not edit by hand.
foreground: &foreground "default"
background: &background "default"
current_line: &current_line "{r['selection-bg']}"
selection: &selection "{r['selection-bg']}"
comment: &comment "{r['copy-mode-indicator']}"
blue: &blue "{r['accent-info']}"
green: &green "{r['accent-warn']}"
lilac: &lilac "{r['accent-secondary']}"
pink: &pink "{r['accent-primary']}"
purple: &purple "{r['accent-tertiary']}"
red: &red "{r['accent-primary']}"
yellow: &yellow "{r['accent-amber']}"

# Skin...
k9s:
  body:
    fgColor: *foreground
    bgColor: *background
    logoColor: *purple
  prompt:
    fgColor: *foreground
    bgColor: *background
    suggestColor: *purple
  info:
    fgColor: *pink
    bgColor: *background
    sectionColor: *foreground
  dialog:
    fgColor: *foreground
    bgColor: *background
    buttonFgColor: *foreground
    buttonBgColor: *background
    buttonFocusFgColor: *yellow
    buttonFocusBgColor: *pink
    labelFgColor: *lilac
    fieldFgColor: *foreground
  frame:
    border:
      fgColor: *selection
      focusColor: *current_line
    menu:
      fgColor: *foreground
      keyColor: *pink
      numKeyColor: *pink
    crumbs:
      fgColor: *foreground
      bgColor: *background
      activeColor: *current_line
    status:
      newColor: *blue
      modifyColor: *purple
      addColor: *green
      errorColor: *red
      highlightColor: *lilac
      killColor: *comment
      completedColor: *comment
    title:
      fgColor: *foreground
      bgColor: *background
      highlightColor: *lilac
      counterColor: *purple
      filterColor: *pink
  views:
    charts:
      bgColor: default
      defaultDialColors:
        - *purple
        - *red
      defaultChartColors:
        - *purple
        - *red
    table:
      fgColor: *foreground
      bgColor: *background
      header:
        fgColor: *foreground
        bgColor: *background
        sorterColor: *blue
    xray:
      fgColor: *foreground
      bgColor: *background
      cursorColor: *current_line
      graphicColor: *purple
      showIcons: false
    yaml:
      keyColor: *pink
      colonColor: *purple
      valueColor: *foreground
    logs:
      fgColor: *foreground
      bgColor: *background
      indicator:
        fgColor: *foreground
        bgColor: *background
        toggleOnColor: *green
        toggleOffColor: *selection
"""


def _lazygit(p: dict) -> str:
    r = p["roles"]
    return f"""authorColors:
  "*": "{r['accent-amber']}"
theme:
  activeBorderColor:
    - "{r['accent-secondary']}"
    - "bold"
  inactiveBorderColor:
    - "{r['copy-mode-indicator']}"
  optionsTextColor:
    - "{r['copy-mode-indicator']}"
  selectedLineBgColor:
    - "{r['selection-bg']}"
  cherryPickedCommitFgColor:
    - "{r['accent-primary']}"
  cherryPickedCommitBgColor:
    - "bg"
  markedBaseCommitFgColor:
    - "{r['accent-amber']}"
  markedBaseCommitBgColor:
    - "bg"
  unstagedChangesColor:
    - "{r['accent-primary']}"
  defaultFgColor:
    - "{r['selection-fg']}"
"""


def _sketchybar(p: dict) -> str:
    """Desktop adapter. Reads only bar-* roles (independent literals, frozen at
    import time) so terminal-role quality repairs can never move live bar/border
    output. Do not read text-ui/surface-chrome or any other shared terminal role
    here; add a new frozen bar-* role instead."""
    r = p["roles"]
    opacity = p["opacity"].get("border-active", 0.70)
    return f"""# Generated by `theme build`. Sourced by sketchybarrc.full/.performance.
export THEME_BAR_BG="{_argb(r['bar-canvas'], 0x90 / 255)}"
export THEME_BAR_TEXT="{_argb(r['bar-text'], 1.0)}"
export THEME_BAR_TEXT_INACTIVE="{_argb(r['bar-text'], 0x80 / 255)}"
export THEME_BORDER_ACTIVE="{_argb(r['bar-border-active'], opacity)}"
export THEME_BORDER_INACTIVE="{_argb(r['bar-border-inactive'], 1.0)}"
"""


def _nvim(p: dict) -> str:
    r = p["roles"]
    entries = ",\n".join(f'  ["{role}"] = "{hex}"' for role, hex in sorted(r.items()))
    return (
        "-- Generated by `theme build`. Centralized palette access for nvim plugins.\n"
        "-- Do not edit by hand; source this from palette.lua.\n"
        "return {\n" + entries + "\n}\n"
    )


def _nvim_native(p: dict) -> str:
    """Render native colorscheme selector metadata consumed by theme-selector."""
    nvim = p["native"]["nvim"]
    if isinstance(nvim, str):
        nvim = {"name": nvim, "globals": {}}

    def lua(value: object) -> str:
        if isinstance(value, str):
            return json.dumps(value)
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)

    globals_ = nvim.get("globals", {})
    entries = "\n".join(f'    ["{key}"] = {lua(value)},' for key, value in sorted(globals_.items()))
    return (
        "-- Generated by `theme build`. Native nvim selector metadata; do not edit.\n"
        "return {\n"
        f'  name = {lua(nvim["name"])},\n'
        "  globals = {\n" + entries + "\n  },\n}\n"
    )


def _sidebar(p: dict) -> str:
    """Fallback palette for mm-sidebar when it runs outside a tmux server.
    Keys are the tmux @color-* option names so theme.go can look up directly."""
    r = p["roles"]
    roles = {
        "@color-canvas": r["canvas"],
        "@color-text-muted": r["text-muted"],
        "@color-accent-secondary": r["accent-secondary"],
        "@color-accent-highlight": r["accent-highlight"],
        "@color-accent-primary": r["accent-primary"],
        "@color-accent-tertiary": r["accent-tertiary"],
        "@color-divider": r["divider-subtle"],
    }
    return json.dumps(roles, indent=2) + "\n"


# Adapter name -> (relative bundle path, render function)
ADAPTERS: dict[str, tuple[str, object]] = {
    "ghostty": ("ghostty/theme", _ghostty),
    "tmux": ("tmux/colors.conf", _tmux),
    "shell": ("shell/palette.sh", _shell),
    "ohmyposh": ("ohmyposh/palette.json", _ohmyposh),
    "claude": ("claude/theme.json", _claude),
    "pi": ("pi/theme.json", _pi),
    "k9s": ("k9s/skin.yaml", _k9s),
    "lazygit": ("lazygit/colors.yml", _lazygit),
    "sketchybar": ("sketchybar/colors.sh", _sketchybar),
    "nvim": ("nvim/palette.lua", _nvim),
    "nvim-native": ("nvim/native.lua", _nvim_native),
    "sidebar": ("sidebar/fallback.json", _sidebar),
}


def render_bundle(p: dict) -> dict[str, str]:
    """Render every adapter for a palette. Returns {relative_path: content}."""
    bundle: dict[str, str] = {}
    for tool, (rel, fn) in ADAPTERS.items():
        try:
            bundle[rel] = fn(p)
        except Exception as e:  # noqa: BLE001 - surface a concise tool/role error
            raise ThemeError(f"adapter '{tool}' failed for palette '{p['name']}': {e}") from e
    return bundle


# ---------------------------------------------------------------------------
# Build / publish
# ---------------------------------------------------------------------------

def _bundle_dir(name: str) -> Path:
    return BUNDLES_DIR / name


def build(name: str) -> dict[str, str]:
    """Render a bundle and publish it with rollback. Returns the rendered bundle."""
    p = load_palette(name)
    bundle = render_bundle(p)
    dest = _bundle_dir(name)
    BUNDLES_DIR.mkdir(parents=True, exist_ok=True)
    # Stage every artifact before touching the published bundle. A failed render or
    # write therefore cannot disturb the active bundle. Directory replacement needs
    # a two-rename swap on macOS; restore the backup if the second rename fails.
    with tempfile.TemporaryDirectory(dir=str(BUNDLES_DIR)) as tmp:
        stage = Path(tmp)
        for rel, content in bundle.items():
            out = stage / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(content)
        backup = BUNDLES_DIR / f".{name}.previous"
        if backup.exists():
            shutil.rmtree(backup)
        had_dest = dest.exists()
        try:
            if had_dest:
                os.replace(dest, backup)
            os.replace(stage, dest)
        except OSError as e:
            if had_dest and backup.exists() and not dest.exists():
                os.replace(backup, dest)
            raise ThemeError(f"publish '{name}' failed: {e}") from e
        if backup.exists():
            shutil.rmtree(backup)
    return bundle


def _active_name() -> str | None:
    if ACTIVE_LINK.is_symlink():
        target = os.readlink(ACTIVE_LINK)
        return Path(target).name
    return None


def _set_active(name: str) -> None:
    target = _bundle_dir(name)
    if not target.exists():
        raise ThemeError(f"bundle for '{name}' not built; run `theme build {name}` first")
    tmp = ACTIVE_LINK.with_name(".active.tmp")
    if tmp.is_symlink() or tmp.exists():
        tmp.unlink()
    tmp.symlink_to(target, target_is_directory=True)
    os.replace(tmp, ACTIVE_LINK)


# Stable discovery symlinks: apps that resolve a theme by name (Claude `custom:<name>`,
# pi `theme`, K9s `skin`) point at a fixed name that follows the active bundle. These
# are created once and never repointed; they resolve through theme/active.
DISCOVERY_LINKS = {
    CONFIG_DIR / "claude" / "themes" / "active.json": "claude/theme.json",
    CONFIG_DIR / "pi-config" / "agent" / "themes" / "active.json": "pi/theme.json",
    CONFIG_DIR / "k9s" / "skins" / "active.yaml": "k9s/skin.yaml",
}


def _ensure_links() -> None:
    for link, rel in DISCOVERY_LINKS.items():
        target = THEME_DIR / "active" / rel
        if link.is_symlink():
            continue
        link.parent.mkdir(parents=True, exist_ok=True)
        if link.exists():
            link.unlink()
        link.symlink_to(target)


# ---------------------------------------------------------------------------
# Switch-time application
# ---------------------------------------------------------------------------

def _run(cmd: list[str], check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=check)


def _apply_tmux() -> None:
    """Reload tmux options and rematerialize active backgrounds in every window."""
    if not shutil.which("tmux"):
        return
    try:
        _run(["tmux", "source-file", str(THEME_DIR / "active" / "tmux" / "colors.conf")])
        canvas = _run(["tmux", "show-options", "-gqv", "@color-canvas"]).stdout.strip()
        active = _run(["tmux", "show-options", "-gqv", "@color-surface-active"]).stdout.strip()
        accent = _run(["tmux", "show-options", "-gqv", "@color-accent-secondary"]).stdout.strip()
        rows = _run([
            "tmux", "list-windows", "-aF",
            "#{window_id}\t#{window_panes}\t#{window_zoomed_flag}",
        ]).stdout.splitlines()
        for row in rows:
            window_id, panes, zoomed = row.split("\t")
            bg = canvas if panes == "1" or zoomed == "1" else active
            _run(["tmux", "set-window-option", "-t", window_id,
                  "window-active-style", f"bg={bg}"])
            _run(["tmux", "set-window-option", "-t", window_id,
                  "pane-active-border-style", f"fg={accent}, bg={canvas}"])
        _run(["tmux", "refresh-client", "-S"])
    except (subprocess.CalledProcessError, ValueError):
        # No live server, or a window disappeared during the sweep; non-fatal.
        pass


def _apply_sketchybar() -> None:
    """Restart SketchyBar through the safe kill+relaunch lifecycle."""
    if not shutil.which("sketchybar"):
        return
    try:
        _run(["pkill", "-x", "sketchybar"], check=False)
        _run(["sleep", "1"], check=False)
        subprocess.Popen(
            ["nohup", "sketchybar", "-c", str(CONFIG_DIR / "sketchybar" / "sketchybarrc")],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            env={**os.environ, "PATH": "/opt/homebrew/bin:" + os.environ.get("PATH", "")},
        )
    except Exception:  # noqa: BLE001
        pass


def _apply_borders() -> None:
    """Restart JankyBorders through the safe bordersrc lifecycle."""
    if not shutil.which("borders"):
        return
    try:
        _run(["pkill", "-x", "borders"], check=False)
        subprocess.Popen(
            ["/bin/bash", str(CONFIG_DIR / "borders" / "bordersrc")],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:  # noqa: BLE001
        pass


def _apply_ohmyposh() -> None:
    """Merge the active palette into the hand-maintained prompt structure and write
    the full theme to an untracked generated path (zshrc points oh-my-posh at it)."""
    base_path = CONFIG_DIR / "ohmyposh" / "base.json"
    palette_path = THEME_DIR / "active" / "ohmyposh" / "palette.json"
    if not base_path.exists() or not palette_path.exists():
        return
    base = json.loads(base_path.read_text())
    palette = json.loads(palette_path.read_text())
    base["palette"] = palette
    out = THEME_DIR / "generated" / "ohmyposh" / "theme.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(base, indent=2) + "\n")


def _apply_lazygit() -> None:
    """Merge the active colors into the hand-maintained lazygit structure and write
    the full config to an untracked generated path (the `lg` alias points at it)."""
    cfg_path = CONFIG_DIR / "lazygit" / "config.yml"
    colors_path = THEME_DIR / "active" / "lazygit" / "colors.yml"
    if not cfg_path.exists() or not colors_path.exists():
        return
    cfg = cfg_path.read_text()
    body = colors_path.read_text().rstrip("\n")
    # Re-indent the fragment (authorColors + theme) under the tracked config's `gui:` key.
    body = "\n".join("  " + line if line.strip() else line for line in body.splitlines())
    start = cfg.index("# THEME-BEGIN")
    end = cfg.index("# THEME-END") + len("# THEME-END")
    merged = cfg[:start].rstrip() + "\n" + body + "\n" + cfg[end:].lstrip("\n")
    out = THEME_DIR / "generated" / "lazygit" / "config.yml"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(merged)


SCOPES = ("all", "terminal")


def switch(name: str, scope: str = "all") -> None:
    """Build, publish, record active, and apply to the live stack.

    scope="terminal" applies every terminal/CLI consumer (tmux, Oh My Posh,
    LazyGit, pi/Claude/K9s discovery links) but never touches SketchyBar or
    JankyBorders - no process is signaled, killed, or relaunched. scope="all"
    (default) is the full switch, unchanged from before.
    """
    if scope not in SCOPES:
        raise ThemeError(f"unknown scope {scope!r}; expected one of {SCOPES}")
    build(name)
    _set_active(name)
    _ensure_links()
    _apply_ohmyposh()
    _apply_lazygit()
    _apply_tmux()
    if scope == "all":
        _apply_sketchybar()
        _apply_borders()
    _report_deferred(name, scope)


def _report_deferred(name: str, scope: str = "all") -> None:
    print(f"switched to {name} (scope={scope})")
    if scope == "all":
        print("applied: tmux, generated Oh My Posh/LazyGit configs, SketchyBar, JankyBorders")
    else:
        print("applied: tmux, generated Oh My Posh/LazyGit configs")
        print("skipped (terminal scope): SketchyBar, JankyBorders")
    print("updated: pi active theme file (hot reload depends on its file watcher)")
    print("deferred:")
    print("  - current shell: source ~/.config/theme/active/shell/palette.sh")
    print("  - Ghostty: press cmd+shift+r (reload config)")
    print("  - Neovim: reopen (local :ThemeSwitch path is pending)")
    print("  - Claude Code: restart")
    print("  - K9s / LazyGit / btop / OpenCode: reopen the running process")


# ---------------------------------------------------------------------------
# Color audit
# ---------------------------------------------------------------------------

# Hex literals that are legitimately hardcoded (non-theme/brand colors, or
# nvim-specific syntax surfaces not in the shared role table). The audit reports
# any active hex outside this list and the active palette.
AUDIT_EXCEPTIONS = {
    # Ghostty app-icon brand colors (not part of the terminal palette).
    "#eb6f92", "#9893a5",
    # nvim-specific syntax surfaces (markdown strong, diff backgrounds) that are
    # not shared roles; they follow the native colorscheme, not the cross-tool schema.
    "#c3c3d5", "#39323A", "#3F262C",
}

# Directories excluded from the audit (generated bundles, palettes, caches,
# disabled plugins, docs). The audit targets ACTIVE configs only.
AUDIT_EXCLUDE_DIRS = {
    ".git", "theme", "claude", "pi-config/agent/sessions",
    "pi-config/agent/extensions", "pi-config/agent/npm", "nvim/lazy-lock.json",
    "nvim/lua/disabled-plugins", "tmux_scripts/mm-sidebar", "btop", "raycast",
    "bat", "smap", "mcp",
    # Dormant/untracked surfaces (see theme/SUPPORT.md follow-ups):
    "sway", "zellij", "dmmulroy-config", "dmmulroy-skills", "caveman-local",
    "mattpocock-skills",
    # Superseded source files (the old Ghostty theme files and K9s skin are now
    # captured in theme/palettes/*.json and generated into the active bundle):
    "ghostty/themes",
}

# Files excluded from the audit (dormant surfaces, docs, machine state).
AUDIT_EXCLUDE_FILES = {
    ".wezterm.lua", "COLORS.md", "AGENTS.md", "KEYBINDS.md", "README.md",
    "pi-config/README.md", "pi-config/agent/AGENTS.md",
    "k9s/skins/vague.yaml",
}


def _is_comment(line: str) -> bool:
    s = line.lstrip()
    return s.startswith(("#", "--", "//", ";"))


def audit() -> list[str]:
    """Scan tracked configs for hex literals outside every canonical palette or
    the exceptions list. This permits dormant theme-specific defaults while still
    requiring each literal to have a canonical source. Returns findings."""
    known = set()
    for path in PALETTES_DIR.glob("*.json"):
        p = load_palette(path.stem)
        known.update(p["roles"].values())
        known.update(p["ansi"])
    known.update(AUDIT_EXCEPTIONS)
    known_lower = {k.lower() for k in known}

    findings: list[str] = []
    for root, dirs, files in os.walk(CONFIG_DIR):
        rel_root = os.path.relpath(root, CONFIG_DIR)
        if rel_root == ".":
            rel_root = ""
        dirs[:] = [d for d in dirs if os.path.join(rel_root, d) not in AUDIT_EXCLUDE_DIRS
                   and d not in ("node_modules", "__pycache__", ".git")]
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), CONFIG_DIR)
            if rel in AUDIT_EXCLUDE_FILES or f.endswith(".md"):
                continue
            path = Path(root) / f
            if path.suffix in (".jsonl", ".log", ".mdb", ".db", ".lock", ".bak"):
                continue
            try:
                text = path.read_text()
            except (OSError, UnicodeDecodeError):
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if _is_comment(line):
                    continue
                for m in HEX_ANYWHERE_RE.finditer(line):
                    h = m.group(0)
                    if h.lower() not in known_lower:
                        findings.append(f"{rel}:{i}: {h}")
    return findings


def _cmd_audit() -> None:
    findings = audit()
    if not findings:
        print("audit: clean (no unmanaged active hex literals)")
        return
    print(f"audit: {len(findings)} unmanaged hex literal(s):")
    for f in findings:
        print(f"  {f}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _cmd_list() -> None:
    names = sorted(p.stem for p in PALETTES_DIR.glob("*.json"))
    active = _active_name()
    for n in names:
        mark = "*" if n == active else " "
        print(f"{mark} {n}")


def _cmd_check(name: str) -> None:
    p = load_palette(name)
    bundle = render_bundle(p)
    print(f"check {name}: {len(p['roles'])} roles, {len(bundle)} artifacts OK")
    for rel in sorted(bundle):
        print(f"  {rel}")
    findings = effective_quality_findings(p)
    waived = len(check_quality(p)) - len(findings)
    if findings:
        print(f"quality: {len(findings)} finding(s):")
        for f in findings:
            print(f"  {f}")
    else:
        print("quality: clean (all consumer contrast/distinctness checks pass)")
    if waived:
        print(f"quality: {waived} finding(s) waived (see QUALITY_WAIVERS in theme.py)")


def _cmd_quality(name: str | None) -> int:
    names = [name] if name else sorted(p.stem for p in PALETTES_DIR.glob("*.json"))
    total = 0
    for n in names:
        findings = effective_quality_findings(load_palette(n))
        total += len(findings)
        for f in findings:
            print(f)
    if total:
        print(f"quality: {total} finding(s) across {len(names)} palette(s)")
        return 1
    print(f"quality: clean across {len(names)} palette(s)")
    return 0


def _cmd_build(name: str) -> None:
    bundle = build(name)
    print(f"built {name}: {len(bundle)} artifacts -> {_bundle_dir(name)}")


def _cmd_switch(name: str, scope: str) -> None:
    switch(name, scope=scope)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="theme", description="Canonical colorscheme generator/switch")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="list palettes and the active one")
    sub.add_parser("audit", help="scan for unmanaged active hex literals")

    for c in ("check", "build"):
        sp = sub.add_parser(c, help=f"{c} a palette")
        sp.add_argument("name", help="palette name")

    sp = sub.add_parser("switch", help="switch a palette")
    sp.add_argument("name", help="palette name")
    sp.add_argument("--scope", choices=SCOPES, default="all",
                     help="'terminal' skips SketchyBar/JankyBorders (default: all)")

    sp = sub.add_parser("quality", help="run consumer contrast/distinctness checks")
    sp.add_argument("name", nargs="?", default=None, help="palette name (default: every palette)")

    args = parser.parse_args(argv)
    try:
        if args.cmd == "list":
            _cmd_list()
        elif args.cmd == "audit":
            _cmd_audit()
        elif args.cmd == "quality":
            return _cmd_quality(args.name)
        elif args.cmd == "check":
            _cmd_check(args.name)
        elif args.cmd == "build":
            _cmd_build(args.name)
        elif args.cmd == "switch":
            _cmd_switch(args.name, args.scope)
        return 0
    except ThemeError as e:
        print(f"theme: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
