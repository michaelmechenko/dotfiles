"""Native GTK3 dock/menu fixture. Run under Xvfb, never on the live desktop.

Usage: dock-style-test.py CSS PALETTE OUTPUT_DIR DOCK_IMAGES [ICON_ROOT HICOLOR_ROOT]
DOCK_IMAGES contains the packaged SVGs, not synthetic text indicators.
The optional icon paths exercise packaged Legcord at GTK's menu size.
"""
import json
import os
from pathlib import Path
import sys
import time

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GdkPixbuf, Gio, Gtk
from PIL import Image

Gtk.init([])
css, palette, output, dock_images = map(Path, sys.argv[1:5])
output.mkdir(parents=True, exist_ok=True)
data = json.loads(palette.read_text())
roles = data["roles"] | data.get("overrides", {}).get("roles", {})


def resolve(name):
    value = roles[name]
    return resolve(value[1:]) if value.startswith("@") else value


def rgb(name):
    value = resolve(name).lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


provider = Gtk.CssProvider()
provider.load_from_path(str(css))  # Parsing warnings/errors fail the fixture.
Gtk.StyleContext.add_provider_for_screen(
    Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
)
settings = Gtk.Settings.get_default()
settings.set_property("gtk-enable-animations", False)
if len(sys.argv) == 7:
    Gtk.IconTheme.get_default().set_search_path(sys.argv[5:7])
    settings.set_property("gtk-icon-theme-name", "hicolor")


# Resolve desktop identity and real SVG artwork through GTK's installed theme,
# independently of the hicolor menu fixture. Do not launch either application.
if os.environ.get("SCRATCH_DESKTOP_ENTRY"):
    scratch = Gio.DesktopAppInfo.new_from_filename(os.environ["SCRATCH_DESKTOP_ENTRY"])
    normal = Gio.DesktopAppInfo.new_from_filename(os.environ["NORMAL_GHOSTTY_DESKTOP_ENTRY"])
    assert scratch and normal
    assert scratch.get_startup_wm_class() == "com.mitchellh.ghostty.scratch"
    assert not scratch.should_show()
    theme = Gtk.IconTheme.new()
    theme.set_search_path(sys.argv[5:7])
    theme.set_custom_theme("breeze-dark")
    for size in (20, 40):
        info = theme.lookup_by_gicon(scratch.get_icon(), size, Gtk.IconLookupFlags.FORCE_SIZE)
        normal_info = theme.lookup_by_gicon(normal.get_icon(), size, Gtk.IconLookupFlags.FORCE_SIZE)
        assert info and normal_info
        assert Path(info.get_filename()).suffix == ".svg"
        assert info.get_filename() != normal_info.get_filename()
        pixbuf = info.load_icon()
        assert (pixbuf.get_width(), pixbuf.get_height()) == (size, size)
        path = output / f"scratch-icon-{size}.png"
        pixbuf.savev(str(path), "png", [], [])
        pixels = Image.open(path).convert("RGBA")
        assert any(a and (r != g or g != b) for r, g, b, a in pixels.get_flattened_data())
        print(f"Scratch icon: {size}px resolved to {info.get_filename()}")


def flush():
    while Gtk.events_pending():
        Gtk.main_iteration()


def color(context, prop, state=Gtk.StateFlags.NORMAL):
    value = context.get_property(prop, state)
    return tuple(round(c * 255) for c in (value.red, value.green, value.blue, value.alpha))


def snapshot(window, name):
    # State invalidation queues a frame-clock draw, not an immediately pending
    # event. Wait for the actual repaint before reading the Xvfb surface.
    window.queue_draw()
    for _ in range(5):
        flush()
        time.sleep(0.02)
    flush()
    allocation = window.get_allocation()
    pixbuf = Gdk.pixbuf_get_from_window(window.get_window(), 0, 0,
                                      allocation.width, allocation.height)
    path = output / f"{name}.png"
    pixbuf.savev(str(path), "png", [], [])
    return Image.open(path).convert("RGBA")


# These are real top-level GTK windows, like the layer-shell dock/detectors.
window = Gtk.Window()
panel = Gtk.Box(spacing=0)
panel.set_name("box")
window.add(panel)
icon = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, True, 8, 40, 40)
icon.fill(0x3399CCFF)  # Deliberately colored test image; CSS must not desaturate it.
buttons = []
indicators = []
columns = []
for label, asset, count in (("Pinned", "empty", 0), ("Running", "single", 1),
                            ("Multiple windows", "multiple", 2)):
    # Match tools.go: the indicator is a sibling of the button, before it for
    # bottom placement. Preserve the upstream 40 by 40/8 pixbuf size request.
    pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(
        str(dock_images / f"task-{asset}.svg"), 40, 5)
    path = output / f"indicator-{asset}.png"
    pixbuf.savev(str(path), "png", [], [])
    pixels = Image.open(path).convert("RGBA")
    assert pixels.height == 5 and pixels.width <= 40
    opaque = {position for position in range(pixels.width * pixels.height)
              if pixels.getpixel((position % pixels.width, position // pixels.width))[3]}
    # Count rendered connected shapes, preserving zero/one/two-dot semantics.
    shapes = 0
    while opaque:
        shapes += 1
        pending = [opaque.pop()]
        while pending:
            point = pending.pop()
            x, y = point % pixels.width, point // pixels.width
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                neighbor = ny * pixels.width + nx
                if 0 <= nx < pixels.width and 0 <= ny < pixels.height and neighbor in opaque:
                    opaque.remove(neighbor)
                    pending.append(neighbor)
    assert shapes == count, (asset, shapes)
    if count:
        assert rgb("accent-secondary") + (255,) in pixels.get_flattened_data(), asset
        assert (0, 255, 255, 255) not in pixels.get_flattened_data(), asset
    column = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
    indicator = Gtk.Image.new_from_pixbuf(pixbuf)
    button = Gtk.Button()
    button.set_image(Gtk.Image.new_from_pixbuf(icon))
    button.set_always_show_image(True)
    button.set_tooltip_text(label)
    column.pack_start(indicator, False, False, 0)
    column.pack_start(button, False, False, 0)
    panel.pack_start(column, False, False, 0)
    buttons.append(button)
    indicators.append(indicator)
    columns.append(column)
window.show_all()
window.set_focus(None)
flush()
button = buttons[0]
for column, indicator, sibling in zip(columns, indicators, buttons):
    assert column.get_children() == [indicator, sibling]
    above = indicator.get_allocation()
    below = sibling.get_allocation()
    assert above.y + above.height <= below.y
assert len({button.get_allocation().y for button in buttons}) == 1
assert len({column.get_allocation().height for column in columns}) == 1


def preferred(widget):
    minimum, natural = widget.get_preferred_size()
    return minimum.width, minimum.height, natural.width, natural.height


normal_size = preferred(button)
normal_allocation = button.get_allocation()
assert color(window.get_style_context(), "background-color")[3] == 0
assert panel.get_style_context().get_border(Gtk.StateFlags.NORMAL).left == 2
assert panel.get_style_context().get_property("border-radius", Gtk.StateFlags.NORMAL) == 8
assert color(panel.get_style_context(), "background-color") == rgb("surface-chrome") + (255,)
assert color(panel.get_style_context(), "border-color") == rgb("divider-subtle") + (255,)
assert button.get_style_context().get_property("font-size", Gtk.StateFlags.NORMAL) == 13

states = {
    "idle": Gtk.StateFlags.NORMAL,
    "hover": Gtk.StateFlags.PRELIGHT,
    "pressed": Gtk.StateFlags.ACTIVE,
    "checked": Gtk.StateFlags.CHECKED,
    "focus": Gtk.StateFlags.FOCUSED,
    "hover-focus": Gtk.StateFlags.PRELIGHT | Gtk.StateFlags.FOCUSED,
}
for name, state in states.items():
    window.set_focus_visible(bool(state & Gtk.StateFlags.FOCUSED))
    if state & Gtk.StateFlags.FOCUSED:
        window.get_window().focus(Gdk.CURRENT_TIME)
        flush()
        button.grab_focus()
    else:
        window.set_focus(None)
    button.set_state_flags(state, True)
    flush()
    assert preferred(button) == normal_size, name
    allocation = button.get_allocation()
    assert (allocation.width, allocation.height) == (normal_allocation.width, normal_allocation.height), name
    context = button.get_style_context()
    if state & (Gtk.StateFlags.PRELIGHT | Gtk.StateFlags.ACTIVE | Gtk.StateFlags.CHECKED):
        assert color(context, "background-color", state) == rgb("surface-highlight") + (255,), name
    if state & Gtk.StateFlags.FOCUSED:
        assert color(context, "outline-color", state) == rgb("accent-secondary") + (255,), name
    image = snapshot(window, f"dock-{name}")
    pixels = set(image.get_flattened_data())
    for index, indicator in enumerate(indicators):
        x, y = indicator.translate_coordinates(window, 0, 0)
        size = indicator.get_allocation()
        painted = image.crop((x, y, x + size.width, y + size.height))
        has_dot = rgb("accent-secondary") + (255,) in painted.get_flattened_data()
        assert has_dot == (index > 0), f"{name}: indicator missing or closed pin marked"
    assert (51, 153, 204, 255) in pixels, "Icon color changed"
    assert rgb("surface-chrome") + (255,) in pixels, name
    assert rgb("divider-subtle") + (255,) in pixels, name
    if state & (Gtk.StateFlags.PRELIGHT | Gtk.StateFlags.ACTIVE | Gtk.StateFlags.CHECKED):
        assert rgb("surface-highlight") + (255,) in pixels, f"{name} did not paint"
    if state & Gtk.StateFlags.FOCUSED:
        assert rgb("accent-secondary") + (255,) in pixels, f"{name} outline did not paint"
button.set_state_flags(Gtk.StateFlags.NORMAL, True)
window.set_focus(None)
# A pin transitioning closed -> single -> multiple -> closed must not shift any
# icon or resize its column. Reuse the real asset pixbufs from the other slots.
baseline = [(column.get_allocation().width, column.get_allocation().height,
             sibling.get_allocation().y) for column, sibling in zip(columns, buttons)]
original = [indicator.get_pixbuf() for indicator in indicators]
for index in (1, 2, 0):
    indicators[0].set_from_pixbuf(original[index])
    snapshot(window, f"dock-pin-transition-{index}")
    current = [(column.get_allocation().width, column.get_allocation().height,
                sibling.get_allocation().y) for column, sibling in zip(columns, buttons)]
    assert current == baseline, (index, current, baseline)
window.destroy()

hotspot = Gtk.Window()
hotspot.add(Gtk.Box())
hotspot.show_all()
flush()
context = hotspot.get_style_context()
assert color(context, "background-color")[3] == 0
assert context.get_border(Gtk.StateFlags.NORMAL).left == 0
assert context.get_padding(Gtk.StateFlags.NORMAL).left == 0
hotspot.destroy()

# Real Gtk.Menu / MenuItem hierarchy used by the dock, including submenus.
menu = Gtk.Menu()
item = Gtk.MenuItem()
row = Gtk.Box(spacing=6)
menu_icon = (Gtk.Image.new_from_icon_name("legcord", Gtk.IconSize.MENU)
             if len(sys.argv) == 7 else Gtk.Image.new_from_pixbuf(icon.scale_simple(16, 16, GdkPixbuf.InterpType.BILINEAR)))
row.pack_start(menu_icon, False, False, 0)
row.pack_start(Gtk.Label(label="Discord — window 1"), False, False, 0)
item.add(row)
menu.append(item)
menu.append(Gtk.SeparatorMenuItem())
parent = Gtk.MenuItem(label="Other windows")
submenu = Gtk.Menu()
submenu.append(Gtk.MenuItem(label="Discord — window 2"))
parent.set_submenu(submenu)
menu.append(parent)
disabled = Gtk.MenuItem(label="Unavailable")
disabled.set_sensitive(False)
menu.append(disabled)
menu.show_all()
menu.popup(None, None, None, None, 0, Gtk.get_current_event_time())
flush()
assert menu_icon.get_preferred_width().natural_width == 16
assert menu_icon.get_preferred_height().natural_height == 16
assert color(menu.get_style_context(), "background-color") == rgb("surface-chrome") + (255,)
assert menu.get_style_context().get_border(Gtk.StateFlags.NORMAL).left == 2
item_size = preferred(item)
for name, state in (("normal", Gtk.StateFlags.NORMAL), ("selected", Gtk.StateFlags.PRELIGHT)):
    item.set_state_flags(state, True)
    flush()
    assert preferred(item) == item_size
    if state:
        assert color(item.get_style_context(), "color", state) == rgb("accent-secondary") + (255,)
        assert color(item.get_style_context(), "background-color", state) == rgb("surface-highlight") + (255,)
    rendered = snapshot(menu.get_toplevel(), f"menu-{name}")
    if state:
        assert rgb("surface-highlight") + (255,) in rendered.get_flattened_data(), "Menu selection did not paint"
menu.popdown()
submenu.show_all()
submenu.popup(None, None, None, None, 0, Gtk.get_current_event_time())
flush()
snapshot(submenu.get_toplevel(), "submenu")
assert color(submenu.get_style_context(), "background-color") == rgb("surface-chrome") + (255,)
submenu.popdown()
menu.destroy()

# Gtk tooltip CSS node in a top-level fixture (no live pointer movement).
class TooltipFixture(Gtk.Window):
    __gtype_name__ = "DockTooltipFixture"


TooltipFixture.set_css_name("tooltip")
tooltip = TooltipFixture()
tooltip.add(Gtk.Label(label="Discord"))
tooltip.show_all()
flush()
assert color(tooltip.get_style_context(), "background-color") == rgb("surface-chrome") + (255,)
snapshot(tooltip, "tooltip")
tooltip.destroy()
print(f"Dock: native GTK states, stable allocations, transparent hotspot, menus and colored icons passed; renders: {output}")
