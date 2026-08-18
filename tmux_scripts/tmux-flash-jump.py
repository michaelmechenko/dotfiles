#!/usr/bin/env python3
"""
tmux-flash-jump: flash.nvim-style jump for tmux copy-mode.

Bound to `S` in the copy-mode-vi key table. Press S, type a query, matching
substrings in the current viewport are highlighted with a single-key label;
pressing that label (or Enter for the nearest match) moves the REAL
copy-mode cursor there. This is a cursor jump, not a copy -- normal copy-mode
operations (v, y, more movement) continue from the new position.

Inspired by github.com/Kristijan/flash-copy.tmux (itself inspired by
flash.nvim), adapted for jumping the live copy-mode cursor instead of
copying to the clipboard. Deliberately smaller: no word-separator/copy-text
extraction, no range selection, no auto-paste, no clipboard.

Architecture:
  - Two modes in one file. Mode 1 ("launcher", the tmux keybind target):
    resolves the triggering pane's absolute geometry and opens a borderless
    popup positioned exactly over it, running this same script in mode 2.
  - Mode 2 ("--interactive"): captures the pane's CURRENT viewport (which,
    while in copy-mode, reflects the current scroll position), runs the
    search/label loop in raw terminal mode, and on selection moves the
    ORIGINAL pane's copy-mode cursor directly before exiting (the popup then
    auto-closes via -E).

Deliberate choices verified against a live tmux server before implementing
(see the plan) -- do not "simplify" these back to the more obvious approach,
both were tried and found to break jumps on soft-wrapped lines:
  - capture-pane is run WITHOUT -J. -J joins soft-wrapped physical rows into
    one logical line, which would desync captured line-index from
    copy_cursor_y (which is physical-row-granular, confirmed live).
  - The cursor is repositioned using ONLY relative `cursor-up/down/left/
    right -N <count>`, never `start-of-line`/`end-of-line`. Those two are
    logical-line-aware and jump backward across a wrapped line's row
    boundary (confirmed live), which would land in the wrong place.
    cursor-up/down were confirmed to step by exactly one physical row
    (preserving column, sticky-column style) regardless of wrapping, and
    cursor-left/right were confirmed to flow continuously across a wrap
    boundary -- so: move vertically by row-delta first, then horizontally
    by the remaining column-delta.

Terminal-cell mapping uses the standard library: tabs, East Asian
wide/full-width glyphs, and combining marks before a match preserve both the
overlay alignment and relative copy-mode cursor movement. Complex emoji ZWJ
clusters and terminals that render East Asian ambiguous-width glyphs as wide
remain outside this deliberately dependency-free mapping.
"""

import json
import os
import re
import select
import subprocess
import sys
import termios
import tty
import unicodedata

LABEL_CHARS = "asdfghjklqwertyuiopzxcvbnmASDFGHJKLQWERTYUIOPZXCVBNM"

CTRL_C = "\x03"
ESC = "\x1b"
CTRL_U = "\x15"
CTRL_W = "\x17"
BACKSPACE = "\x7f"
BACKSPACE_ALT = "\x08"
ENTER = "\r"
ENTER_ALT = "\n"

RESET = "\033[0m"
CLEAR_SCREEN = "\033[2J\033[H"
HIDE_CURSOR = "\033[?25l"
SHOW_CURSOR = "\033[?25h"
DEBUG_LOG = "/tmp/tmux-flash-jump-debug.jsonl"


# --------------------------------------------------------------------------
# tmux helpers
# --------------------------------------------------------------------------


class TmuxError(RuntimeError):
    pass


def run_tmux(args: list[str]) -> str:
    """Run a tmux command or raise a concise, actionable error."""
    result = subprocess.run(
        ["tmux", *args], capture_output=True, text=True, check=False
    )
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip() or "unknown error"
        raise TmuxError(f"tmux {' '.join(args[:2])}: {detail}")
    return result.stdout


def debug_enabled() -> bool:
    return (
        os.environ.get("TMUX_FLASH_JUMP_DEBUG") == "1"
        or run_tmux(["show-options", "-gqv", "@flash_jump_debug"]).strip() == "1"
    )


def debug_log(enabled: bool, event: str, **fields) -> None:
    """Append metadata only; never write captured pane content or query text."""
    if not enabled:
        return
    record = {"event": event, **fields}
    fd = os.open(DEBUG_LOG, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        os.write(fd, (json.dumps(record, sort_keys=True) + "\n").encode())
    finally:
        os.close(fd)


def tmux_color(option: str, fallback: str) -> str:
    """Read a global tmux user option (hex colour), falling back if unset."""
    value = run_tmux(["show-options", "-gqv", option]).strip()
    return value or fallback


def hex_to_ansi_fg(hex_colour: str) -> str:
    """Convert a #rrggbb string to a 24-bit ANSI foreground escape."""
    h = hex_colour.lstrip("#")
    if len(h) != 6:
        return ""
    try:
        r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return ""
    return f"\033[38;2;{r};{g};{b}m"


def get_geometry(pane_id: str) -> tuple[int, int, int, int]:
    """Return (left, top, width, height) of a pane, absolute to the client."""
    out = run_tmux(
        [
            "display-message",
            "-t",
            pane_id,
            "-p",
            "#{pane_left} #{pane_top} #{pane_width} #{pane_height}",
        ]
    ).strip()
    left, top, width, height = (int(v) for v in out.split())
    return left, top, width, height


def get_status_geometry() -> tuple[str, int]:
    """Return the status position and number of status rows."""
    position = run_tmux(["show-options", "-gqv", "status-position"]).strip()
    value = run_tmux(["show-options", "-gqv", "status"]).strip()
    try:
        lines = int(value)
    except ValueError:
        lines = 0
    return position, max(lines, 0)


def get_cursor(pane_id: str) -> tuple[int, int]:
    """Return (y, x) of the copy-mode cursor, 0-indexed within the viewport."""
    out = run_tmux(
        ["display-message", "-t", pane_id, "-p", "#{copy_cursor_y} #{copy_cursor_x}"]
    ).strip()
    y, x = (int(v) for v in out.split())
    return y, x


def capture_lines(pane_id: str) -> list[str]:
    """Capture the pane's current viewport, one entry per physical row.

    `capture-pane -p` terminates every physical row with a newline. Remove
    only that final separator: `str.split("\\n")` directly creates a phantom
    extra row, which previously desynchronised the popup from the viewport.
    Deliberately no -J (see module docstring) and no -e (no ANSI colour --
    the overlay applies its own dim/highlight/label styling, so the
    original colours aren't needed and skipping -e sidesteps ANSI-aware
    indexing entirely).
    """
    out = run_tmux(["capture-pane", "-p", "-t", pane_id])
    if out.endswith("\n"):
        out = out[:-1]
    return out.split("\n")


# --------------------------------------------------------------------------
# matching + labelling
# --------------------------------------------------------------------------


class Match:
    __slots__ = ("line", "col", "end_col", "display_col", "label")

    def __init__(self, line: int, col: int, end_col: int, display_col: int):
        # col/end_col index Python characters for slicing and matching;
        # display_col is the terminal-cell position used for proximity.
        self.line = line
        self.col = col
        self.end_col = end_col
        self.display_col = display_col
        self.label: str | None = None

    def __repr__(self):
        return f"Match(line={self.line}, col={self.col}, end_col={self.end_col}, label={self.label!r})"


def cell_width(char: str, column: int) -> int:
    """Return a character's terminal-cell width at `column`."""
    if char == "\t":
        return 8 - (column % 8)
    if unicodedata.combining(char) or char in ("\u200d", "\ufe0e", "\ufe0f"):
        return 0
    if unicodedata.east_asian_width(char) in ("W", "F"):
        return 2
    return 1


def display_width(text: str) -> int:
    column = 0
    for char in text:
        column += cell_width(char, column)
    return column


def clip_to_width(text: str, width: int) -> str:
    """Keep whole terminal characters that fit in `width` cells."""
    column = 0
    kept = []
    for char in text:
        char_width = cell_width(char, column)
        if char_width and column + char_width > width:
            break
        kept.append(char)
        column += char_width
    return "".join(kept)


def motion_index_for_source_index(text: str, source_index: int) -> int:
    """Map a source character index to tmux cursor-right/left movements."""
    motion_index = 0
    for index, char in enumerate(text):
        if index >= source_index:
            break
        if cell_width(char, display_width(text[:index])):
            motion_index += 1
    return motion_index


def motion_index_for_column(text: str, column: int) -> int:
    """Map a copy_cursor_x terminal column to a cursor movement index."""
    display_column = 0
    motion_index = 0
    for char in text:
        if display_column >= column:
            break
        char_width = cell_width(char, display_column)
        if char_width:
            display_column += char_width
            motion_index += 1
    # Copy mode may retain a sticky column past a short row. Those blank cells
    # are traversed one at a time.
    return motion_index + max(column - display_column, 0)


def relative_cursor_steps(text: str, current_column: int, target_index: int) -> int:
    return (
        motion_index_for_source_index(text, target_index)
        - motion_index_for_column(text, current_column)
    )


def find_matches(lines: list[str], query: str) -> list[Match]:
    """Find every non-overlapping occurrence of query in lines.

    Smart-case: case-insensitive unless the query itself contains an
    uppercase character.
    """
    if not query:
        return []

    case_sensitive = any(c.isupper() for c in query)
    needle = query if case_sensitive else query.lower()
    matches: list[Match] = []

    for line_idx, line in enumerate(lines):
        haystack = line if case_sensitive else line.lower()
        pos = 0
        while True:
            found = haystack.find(needle, pos)
            if found < 0:
                break
            matches.append(
                Match(line_idx, found, found + len(needle), display_width(line[:found]))
            )
            pos = found + len(needle)  # non-overlapping

    return matches


def assign_labels(
    lines: list[str],
    matches: list[Match],
    query: str,
    cursor: tuple[int, int],
    visible_rows: int | None = None,
) -> None:
    """Assign a single-key label to as many matches as possible, in place.

    Labels closest to the cursor are assigned first (best/home-row labels
    land on the most likely target). A label is never reused, and is never
    a character that is part of the query or that immediately follows ANY
    match -- both would be ambiguous with "keep typing the query" (mirrors
    flash-copy.tmux's search_interface.py labelling rule: excluding
    continuation chars from the whole label pool, not just per-match, is
    what makes "typed char matches an assigned label" unambiguously mean
    "select that label", never "keep narrowing the search"). `visible_rows`
    excludes prompt-row matches from receiving an invisible label.
    """
    if not matches:
        return

    cursor_y, cursor_x = cursor
    query_chars = {c.lower() for c in query}

    continuation_chars: set[str] = set()
    for m in matches:
        line = lines[m.line] if m.line < len(lines) else ""
        if m.end_col < len(line):
            continuation_chars.add(line[m.end_col].lower())

    ordered = sorted(
        matches,
        key=lambda m: (abs(m.line - cursor_y), abs(m.display_col - cursor_x)),
    )

    used: set[str] = set()
    for match in ordered:
        if visible_rows is not None and match.line >= visible_rows:
            continue
        for c in LABEL_CHARS:
            lc = c.lower()
            if c in used or lc in query_chars or lc in continuation_chars:
                continue
            match.label = c
            used.add(c)
            break


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------


def render_frame(
    lines: list[str],
    matches: list[Match],
    query: str,
    width: int,
    height: int,
    dim_fg: str,
    match_fg: str,
    label_fg: str,
) -> str:
    """Build the full screen buffer (one big string) for one redraw."""
    by_line: dict[int, list[Match]] = {}
    for m in matches:
        by_line.setdefault(m.line, []).append(m)

    status_row = height - 1
    out_lines: list[str] = []

    for i in range(height):
        if i == status_row:
            prompt = clip_to_width(f" search: {query}", width)
            out_lines.append(f"{RESET}{prompt}" + (" " * (width - display_width(prompt))))
            continue

        raw = lines[i] if i < len(lines) else ""
        raw = clip_to_width(raw, width)
        line_matches = sorted(by_line.get(i, []), key=lambda m: m.col)

        rendered = []
        cursor = 0
        for m in line_matches:
            if m.col < cursor:
                continue  # defensive: skip overlap from a stale index
            rendered.append(dim_fg + raw[cursor : m.col])
            if m.label:
                # A label occupies the first cell of its own (non-overlapping)
                # match. Preserve a tab or wide glyph's full cell span so the
                # rest of the overlay stays aligned with the underlying pane.
                first = raw[m.col : m.col + 1]
                replacement_padding = max(display_width(first) - 1, 0)
                rendered.append(label_fg + m.label + (" " * replacement_padding))
                rendered.append(match_fg + raw[m.col + 1 : m.end_col])
            else:
                rendered.append(match_fg + raw[m.col : m.end_col])
            cursor = m.end_col
        rendered.append(dim_fg + raw[cursor:])
        rendered.append(dim_fg + (" " * max(width - display_width(raw), 0)))
        out_lines.append("".join(rendered) + RESET)

    return CLEAR_SCREEN + "\r\n".join(out_lines)


# --------------------------------------------------------------------------
# raw terminal input
# --------------------------------------------------------------------------


def read_key() -> str:
    """Read one key from stdin. Drains a trailing escape sequence (if any)
    after a lone ESC, so leftover arrow-key bytes can't bleed into whatever
    pane regains focus once this process exits."""
    ch = sys.stdin.read(1)
    if ch == ESC:
        while select.select([sys.stdin], [], [], 0.01)[0]:
            sys.stdin.read(1)
    return ch


# --------------------------------------------------------------------------
# interactive mode
# --------------------------------------------------------------------------


def interactive_main(pane_id: str) -> None:
    captured_lines = capture_lines(pane_id)
    cursor = get_cursor(pane_id)
    geometry = run_tmux(
        ["display-message", "-t", pane_id, "-p", "#{pane_width} #{pane_height}"]
    ).strip()
    geo_width, height = (int(value) for value in geometry.split())
    # The last popup row belongs to the prompt. Search only the visible
    # content rows, then pad a short capture defensively without inventing a
    # target for the prompt row.
    content_height = max(height - 1, 0)
    lines = captured_lines[:content_height]
    lines.extend([""] * (content_height - len(lines)))
    width = max(max((len(line) for line in lines), default=0), geo_width, 1)
    debug = debug_enabled()
    debug_log(
        debug,
        "start",
        pane=pane_id,
        cursor={"y": cursor[0], "x": cursor[1]},
        geometry={"width": geo_width, "height": height},
        captured_rows=len(captured_lines),
        searchable_rows=content_height,
        row_cell_widths=[display_width(line) for line in lines],
    )

    dim_fg = hex_to_ansi_fg(tmux_color("@color-text-muted", "#656a80"))
    match_fg = hex_to_ansi_fg(tmux_color("@color-accent-secondary", "#aeaed1"))
    label_fg = "\033[1m" + hex_to_ansi_fg(tmux_color("@color-accent-primary", "#d8647e"))

    fd = sys.stdin.fileno()
    old_settings = termios.tcgetattr(fd)
    query = ""
    matches: list[Match] = []

    def redraw():
        sys.stdout.write(
            render_frame(lines, matches, query, width, height, dim_fg, match_fg, label_fg)
        )
        sys.stdout.flush()

    def jump_to(match: Match) -> None:
        cur_y, cur_x = get_cursor(pane_id)
        debug_log(
            debug,
            "jump_start",
            target={"line": match.line, "index": match.col, "cell": match.display_col, "label": match.label},
            cursor={"y": cur_y, "x": cur_x},
        )
        dy = match.line - cur_y
        if dy > 0:
            run_tmux(["send-keys", "-t", pane_id, "-X", "-N", str(dy), "cursor-down"])
        elif dy < 0:
            run_tmux(["send-keys", "-t", pane_id, "-X", "-N", str(-dy), "cursor-up"])

        cur_y_after, cur_x_after = get_cursor(pane_id)
        target_line = lines[match.line]
        steps = relative_cursor_steps(target_line, cur_x_after, match.col)
        debug_log(
            debug,
            "jump_horizontal",
            cursor_after_vertical={"y": cur_y_after, "x": cur_x_after},
            vertical_delta=dy,
            horizontal_steps=steps,
            target_row_cells=display_width(target_line),
        )
        if steps > 0:
            run_tmux(["send-keys", "-t", pane_id, "-X", "-N", str(steps), "cursor-right"])
        elif steps < 0:
            run_tmux(["send-keys", "-t", pane_id, "-X", "-N", str(-steps), "cursor-left"])
        final_y, final_x = get_cursor(pane_id)
        debug_log(debug, "jump_end", cursor={"y": final_y, "x": final_x})

    raw_mode = False
    try:
        tty.setcbreak(fd)
        raw_mode = True
        sys.stdout.write(HIDE_CURSOR)
        redraw()

        while True:
            ch = read_key()

            if ch in (CTRL_C, ESC):
                debug_log(debug, "cancel", cursor={"y": get_cursor(pane_id)[0], "x": get_cursor(pane_id)[1]})
                break

            if ch in (BACKSPACE, BACKSPACE_ALT):
                query = query[:-1]
            elif ch == CTRL_U:
                query = ""
            elif ch == CTRL_W:
                query = re.sub(r"\S*\s*$", "", query)
            elif ch in (ENTER, ENTER_ALT):
                if matches:
                    nearest = min(
                        matches,
                        key=lambda m: (
                            abs(m.line - cursor[0]),
                            abs(m.display_col - cursor[1]),
                        ),
                    )
                    debug_log(debug, "select_nearest", label=nearest.label)
                    jump_to(nearest)
                else:
                    debug_log(debug, "select_nearest", label=None)
                break
            elif matches and any(m.label == ch for m in matches):
                debug_log(debug, "select_label", label=ch)
                jump_to(next(m for m in matches if m.label == ch))
                break
            elif ch.isprintable():
                query += ch
            else:
                continue

            matches = find_matches(lines, query)
            assign_labels(lines, matches, query, cursor, visible_rows=content_height)
            debug_log(
                debug,
                "matches",
                query_length=len(query),
                targets=[
                    {"line": m.line, "index": m.col, "cell": m.display_col, "label": m.label}
                    for m in matches
                ],
            )
            redraw()
    finally:
        sys.stdout.write(SHOW_CURSOR + RESET)
        sys.stdout.flush()
        if raw_mode:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)


# --------------------------------------------------------------------------
# launcher mode
# --------------------------------------------------------------------------


def launcher_main(pane_id: str) -> None:
    left, top, width, height = get_geometry(pane_id)
    status_position, status_lines = get_status_geometry()
    # pane_top is window-relative, while display-popup -y is client-relative.
    # A top status bar shifts the entire window down by its number of rows.
    popup_top = top + status_lines if status_position == "top" else top
    debug = debug_enabled()
    debug_log(
        debug,
        "launch",
        pane=pane_id,
        pane_geometry={"left": left, "top": top, "width": width, "height": height},
        popup_geometry={"left": left, "top": popup_top, "width": width, "height": height},
        status={"position": status_position, "lines": status_lines},
    )
    script = __file__
    run_tmux(
        [
            "display-popup",
            "-B",
            "-E",
            "-x",
            str(left),
            "-y",
            str(popup_top),
            "-w",
            str(width),
            "-h",
            str(height),
            script,
            "--interactive",
            pane_id,
        ]
    )


# --------------------------------------------------------------------------
# self-test (no tmux/tty required)
# --------------------------------------------------------------------------


def self_test() -> int:
    failures = []

    def check(label, condition):
        if not condition:
            failures.append(label)

    lines = ["hello world", "world hello world", "no match here"]
    matches = find_matches(lines, "world")
    check("finds 3 occurrences", len(matches) == 3)
    check(
        "positions correct",
        {(m.line, m.col) for m in matches} == {(0, 6), (1, 0), (1, 12)},
    )

    # non-overlapping: "aaaa" searched for "aa" should yield 2 matches, not 3
    overlap_lines = ["aaaa"]
    overlap_matches = find_matches(overlap_lines, "aa")
    check("non-overlapping count", len(overlap_matches) == 2)

    # smart-case
    check("lowercase query is case-insensitive", len(find_matches(["Hello"], "hello")) == 1)
    check("uppercase query is case-sensitive", len(find_matches(["Hello hello"], "Hello")) == 1)

    # label assignment: closest match to cursor gets 'a' (first label char)
    ml_lines = ["xx match1 xx", "xx match2 xx"]
    ml = find_matches(ml_lines, "match")
    assign_labels(ml_lines, ml, "match", cursor=(1, 0))
    closest = min(ml, key=lambda m: abs(m.line - 1))
    excluded = {c for c in "match"} | {"1", "2"}  # query chars + continuation chars
    best_available = next(c for c in LABEL_CHARS if c.lower() not in excluded)
    check("closest match gets best available label", closest.label == best_available)
    check("labels are unique", len({m.label for m in ml}) == len(ml))

    # continuation-char exclusion: query "a", matches "apple" and "avocado" ->
    # 'p' and 'v' (the chars right after the query) must never be a label
    cl_lines = ["apple avocado"]
    cl = find_matches(cl_lines, "a")
    assign_labels(cl_lines, cl, "a", cursor=(0, 0))
    used_labels = {m.label for m in cl if m.label}
    check("continuation chars excluded from labels", not ({"p", "v"} & used_labels))

    if failures:
        print("FAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"PASS ({5 + 2} checks)")
    return 0


# --------------------------------------------------------------------------


def main() -> None:
    args = sys.argv[1:]
    try:
        if args and args[0] == "--self-test":
            sys.exit(self_test())

        if args and args[0] == "--interactive":
            if len(args) < 2:
                print("usage: tmux-flash-jump.py --interactive <pane_id>", file=sys.stderr)
                sys.exit(2)
            interactive_main(args[1])
            return

        if not args:
            print("usage: tmux-flash-jump.py <pane_id>", file=sys.stderr)
            sys.exit(2)

        launcher_main(args[0])
    except (TmuxError, ValueError, termios.error) as error:
        print(f"tmux-flash-jump: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
