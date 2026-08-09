"""Recolor the style-editor swamp tiles to the Fiorwoods runtime palette."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image


SCRIPT_DIRECTORY = Path(__file__).resolve().parent
CLIENT_DIRECTORY = SCRIPT_DIRECTORY.parent
PUBLIC_ASSET_DIRECTORY = CLIENT_DIRECTORY / "public" / "assets"
STYLE_LIBRARY_DIRECTORY = (
    PUBLIC_ASSET_DIRECTORY
    / "chained-echoes-assets-sorted"
    / "Assets"
    / "Maps"
    / "Rohlan Fields"
)
SWAMP_ASSET_DIRECTORY = PUBLIC_ASSET_DIRECTORY / "swamp-obstacle"

# Rohlan Fields water -> the solid water used by the bridge obstacle.
# Rohlan Fields grass -> the normal Fiorwoods ground-grass palette.
PALETTE = {
    (43, 140, 163, 255): (8, 30, 26, 255),
    (125, 221, 237, 255): (8, 30, 26, 255),
    (58, 112, 57, 255): (31, 67, 40, 255),
    (80, 141, 74, 255): (36, 78, 41, 255),
    (41, 83, 44, 255): (23, 53, 31, 255),
    (40, 71, 30, 255): (23, 53, 31, 255),
    (121, 178, 116, 255): (61, 108, 61, 255),
}


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recolor swamp sprites and rewrite their paths in a style export."
    )
    parser.add_argument("style_json", type=Path, help="Input labyrinth-style-v1 JSON")
    parser.add_argument("output_json", type=Path, help="Recolored style JSON to create")
    return parser.parse_args()


def output_name(sprite_name: str) -> str:
    return f"{sprite_name.replace(' ', '_')}.png"


def recolor_sprite(source_path: Path, output_path: Path) -> None:
    with Image.open(source_path) as source:
        image = source.convert("RGBA")

    pixels = list(image.get_flattened_data())
    source_colors = set(pixels)
    unexpected = source_colors - set(PALETTE) - {(0, 0, 0, 0)}
    if unexpected:
        values = ", ".join(f"#{r:02X}{g:02X}{b:02X}/{a}" for r, g, b, a in unexpected)
        raise ValueError(f"Unexpected colors in {source_path.name}: {values}")

    image.putdata([PALETTE.get(pixel, pixel) for pixel in pixels])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, optimize=True)


def recolor_export(input_path: Path, output_path: Path) -> tuple[int, int]:
    document = json.loads(input_path.read_text(encoding="utf-8"))
    swamp_elements = [
        element
        for element in document["elements"]
        if element.get("assetPath", "").startswith("/style-assets/Maps/")
        and element.get("name", "").startswith("Sprite_Rohlan Fields_")
    ]
    if not swamp_elements:
        raise ValueError("No Rohlan Fields swamp elements were found in the style export")

    sprite_names = sorted({element["name"] for element in swamp_elements})
    for sprite_name in sprite_names:
        source_path = STYLE_LIBRARY_DIRECTORY / f"{sprite_name}.png"
        destination_name = output_name(sprite_name)
        recolor_sprite(source_path, SWAMP_ASSET_DIRECTORY / destination_name)

    for element in swamp_elements:
        element["assetPath"] = f"/assets/swamp-obstacle/{output_name(element['name'])}"

    document["updatedAt"] = (
        datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return len(sprite_names), len(swamp_elements)


def main() -> None:
    arguments = parse_arguments()
    sprite_count, element_count = recolor_export(arguments.style_json, arguments.output_json)
    print(
        f"Recolored {sprite_count} swamp sprites used by {element_count} elements; "
        f"wrote {arguments.output_json}"
    )


if __name__ == "__main__":
    main()
