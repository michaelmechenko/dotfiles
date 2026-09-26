"""Curate local artwork without extracting or executing archive paths."""
import configparser
import json
import re
import sys
import zipfile
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

from PIL import Image, ImageOps

archive, mapping, palette, destination = sys.argv[1:]
entries = json.loads(Path(mapping).read_text())
roles = json.loads(Path(palette).read_text())
root = Path(destination) / "share/icons/HackerNoonPixel"
contexts = {"Applications": "apps", "Places": "places", "MimeTypes": "mimetypes", "Actions": "actions", "Status": "status"}
index = configparser.ConfigParser(interpolation=None)
index.optionxform = str
index["Icon Theme"] = {"Name": "HackerNoon Pixel", "Comment": "Pixel Icon Library by HackerNoon (CC BY 4.0), locally adapted", "Inherits": "breeze-dark,breeze,hicolor"}
seen = set()
ET.register_namespace("", "http://www.w3.org/2000/svg")
with zipfile.ZipFile(archive) as source:
    for entry in entries:
        source_name = entry["source"]
        assert re.fullmatch(r"(?:regular|solid|brands)/[a-z0-9-]+", source_name), source_name
        context = entry["context"]
        color = roles[entry["role"]]
        assert re.fullmatch(r"#[0-9a-fA-F]{6}", color), color
        svg = ET.fromstring(source.read(f"icons/SVG/{source_name}.svg"))
        assert svg.tag == "{http://www.w3.org/2000/svg}svg"
        # Only simple vector artwork is allowed; no scripts, references or URLs.
        for node in svg.iter():
            assert node.tag.split("}")[-1] in {"svg", "g", "path", "polygon", "polyline", "rect", "circle", "ellipse", "line", "title", "desc"}
            assert all(not k.lower().startswith("on") and "href" not in k.lower() and "url(" not in v.lower() for k, v in node.attrib.items())
            if node.get("fill") not in (None, "none"):
                node.set("fill", color)
            if node.get("stroke") not in (None, "none"):
                node.set("stroke", color)
        svg.set("fill", color)
        vector = ET.tostring(svg, encoding="utf-8", xml_declaration=True)
        rasters = {}
        for size in (16, 24, 48):
            image = Image.open(BytesIO(source.read(f"icons/PNG/for-dark-mode/{size}px/{source_name}.png"))).convert("RGBA")
            # Some upstream PNG canvases are non-square (e.g. clipboard is
            # 17x16). Crop transparent overflow before fitting to avoid
            # unnecessarily shrinking the visible drawing.
            if image.width > size or image.height > size:
                bounds = image.getchannel("A").getbbox()
                if bounds and bounds[2] <= size and bounds[3] <= size:
                    image = image.crop((0, 0, min(image.width, size), min(image.height, size)))
                else:
                    image = ImageOps.contain(image, (size, size), Image.Resampling.NEAREST)
            image = ImageOps.pad(image, (size, size), Image.Resampling.NEAREST, color=(0, 0, 0, 0))
            tinted = Image.new("RGBA", image.size, color)
            tinted.putalpha(image.getchannel("A"))
            out = BytesIO()
            tinted.save(out, format="PNG")
            rasters[size] = out.getvalue()
        for name in entry["names"]:
            assert re.fullmatch(r"[A-Za-z0-9._-]+", name) and name not in {".", ".."}, name
            assert name not in seen, f"Duplicate alias: {name}"
            seen.add(name)
            for size, data, suffix in [(s, d, "png") for s, d in rasters.items()] + [("scalable", vector, "svg")]:
                directory = f"{size if size == 'scalable' else str(size)+'x'+str(size)}/{contexts[context]}"
                path = root / directory / f"{name}.{suffix}"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                index[directory] = {"Size": "24" if size == "scalable" else str(size), "Context": context, "Type": "Scalable" if size == "scalable" else "Fixed"}
                if size == "scalable":
                    index[directory].update({"MinSize": "8", "MaxSize": "512"})
index["Icon Theme"]["Directories"] = ",".join(index.sections()[1:])
with (root / "index.theme").open("w") as output:
    index.write(output, space_around_delimiters=False)
(root / "ATTRIBUTION").write_text(
    "Pixel Icon Library by HackerNoon\n"
    "https://github.com/hackernoon/pixel-icon-library\n"
    "https://pixeliconlibrary.com/\n"
    "Icons: Creative Commons Attribution 4.0 International\n"
    "https://creativecommons.org/licenses/by/4.0/\n"
    "Changes: curated, renamed, reorganized and recolored using the Vague palette; PNG canvases normalized.\n"
    "This locally built theme does not imply HackerNoon endorsement.\n"
)
print(f"Built {len(seen)} icon aliases in {len(index.sections()) - 1} directories")
