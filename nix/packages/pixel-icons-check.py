"""Validate the installed theme contract without GTK or a live desktop."""
import configparser
import json
import struct
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

root = Path(sys.argv[1]) / "share/icons/HackerNoonPixel"
mapping = json.loads(Path(sys.argv[2]).read_text())
index = configparser.ConfigParser(interpolation=None)
index.read(root / "index.theme")
assert index["Icon Theme"]["Inherits"] == "breeze-dark,breeze,hicolor"
directories = index["Icon Theme"]["Directories"].split(",")
assert set(directories) == set(index.sections()) - {"Icon Theme"}
assert "CC BY 4.0" in index["Icon Theme"]["Comment"]
assert "https://creativecommons.org/licenses/by/4.0/" in (root / "ATTRIBUTION").read_text()
contexts = {"Applications": "apps", "Places": "places", "MimeTypes": "mimetypes", "Actions": "actions", "Status": "status"}
count = 0
for entry in mapping:
    for alias in entry["names"]:
        for size in (16, 24, 48):
            directory = f"{size}x{size}/{contexts[entry['context']]}"
            assert index[directory]["Context"] == entry["context"]
            assert index[directory]["Type"] == "Fixed"
            assert int(index[directory]["Size"]) == size
            data = (root / directory / f"{alias}.png").read_bytes()
            assert data[:8] == b"\x89PNG\r\n\x1a\n"
            assert struct.unpack(">II", data[16:24]) == (size, size)
        svg = ET.parse(root / f"scalable/{contexts[entry['context']]}" / f"{alias}.svg").getroot()
        assert svg.get("viewBox") == "0 0 24 24"
        assert svg.get("fill", "").startswith("#")
        count += 1
assert not list(root.rglob("blender.*")) and not list(root.rglob("obsidian.*")), "Keep branded fallbacks"
print(f"Pixel icon checks passed: {count} aliases, three native sizes and SVG fallbacks")
