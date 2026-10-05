"""Exercise the same GTK icon-name menu loader used by nwg-dock."""
from pathlib import Path
import sys

import gi
from PIL import Image

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk

root = Path(sys.argv[1])
source = Image.open(sys.argv[2]).convert("RGBA")
for size in (16, 22, 24, 32, 48, 64, 128, 256, 512):
    path = root / f"share/icons/hicolor/{size}x{size}/apps/legcord.png"
    with Image.open(path) as icon:
        assert icon.size == (size, size), (path, icon.size)
        expected = source.resize((size, size), Image.Resampling.LANCZOS)
        assert icon.convert("RGBA").tobytes() == expected.tobytes(), path

Gtk.init([])
theme = Gtk.IconTheme.get_default()
# Use this package plus the real hicolor index; exclude live caches/overrides.
theme.set_search_path([str(root / "share/icons"), sys.argv[3]])
Gtk.Settings.get_default().set_property("gtk-icon-theme-name", "hicolor")
for requested in (Gtk.IconSize.MENU, Gtk.IconSize.LARGE_TOOLBAR):
    menu = Gtk.Menu()
    item = Gtk.MenuItem()
    box = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
    image = Gtk.Image.new_from_icon_name("legcord", requested)
    box.pack_start(image, False, False, 0)
    item.add(box)
    menu.append(item)
    menu.show_all()
    width = image.get_preferred_width().natural_width
    height = image.get_preferred_height().natural_height
    success, expected_width, expected_height = Gtk.icon_size_lookup(requested)
    assert success and (width, height) == (expected_width, expected_height), (width, height)
    print(f"GTK menu icon: {width}x{height}")
    menu.destroy()
print("Legcord: icon dimensions, resampled artwork and native GTK menu sizes passed.")
