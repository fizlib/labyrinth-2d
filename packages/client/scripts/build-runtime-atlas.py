"""Build the eagerly loaded runtime sprite atlas from authored PNG sources."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


SCRIPT_DIRECTORY = Path(__file__).resolve().parent
CLIENT_DIRECTORY = SCRIPT_DIRECTORY.parent
PUBLIC_DIRECTORY = CLIENT_DIRECTORY / "public"
ATLAS_DIRECTORY = PUBLIC_DIRECTORY / "assets" / "runtime"
ATLAS_PATH = ATLAS_DIRECTORY / "runtime-atlas.png"
MANIFEST_PATH = CLIENT_DIRECTORY / "src" / "assets" / "runtimeAtlasManifest.ts"

# The character animation sheet is already densely packed and changes through
# its own generator. Keeping it separate avoids inflating the environment atlas
# while still reducing the runtime image load to two requests.
SINGLE_ASSET_PATHS = (
    "assets/tiles.png",
    "assets/wall_tiles.png",
    "assets/gates.png",
    "assets/oak-tree.png",
    "assets/shadow_top.png",
    "assets/shadow_left.png",
    "assets/shadow_corner.png",
    "assets/runestones.png",
    "assets/portal_spritesheet.png",
    "assets/wisdom_orb.png",
    "assets/expand_button.png",
    "assets/contract_button.png",
    "assets/plate_spritesheet.png",
)

ASSET_DIRECTORIES = (
    "assets/forest",
    "assets/fiorwoods-runtime",
    "assets/runtime-style",
    "assets/portal-platform",
    "assets/bridge-obstacle",
    "assets/swamp-obstacle",
    "assets/chest-dead-end",
    "assets/t-intersection-decoration",
    "assets/cage",
)

# One transparent guard pixel plus one extruded edge pixel on every side keeps
# neighboring sprites isolated under fractional camera transforms.
GUARD_PIXELS = 1
EXTRUDE_PIXELS = 1
FRAME_PADDING = GUARD_PIXELS + EXTRUDE_PIXELS
MIN_ATLAS_DIMENSION = 512
MAX_ATLAS_DIMENSION = 2048
ATLAS_DIMENSION_STEP = 64


@dataclass(frozen=True)
class Rectangle:
    x: int
    y: int
    width: int
    height: int

    @property
    def right(self) -> int:
        return self.x + self.width

    @property
    def bottom(self) -> int:
        return self.y + self.height


@dataclass
class AtlasFrame:
    canonical_path: str
    aliases: list[str]
    image: Image.Image
    pixel_digest: str

    @property
    def width(self) -> int:
        return self.image.width

    @property
    def height(self) -> int:
        return self.image.height

    @property
    def packed_width(self) -> int:
        return self.width + FRAME_PADDING * 2

    @property
    def packed_height(self) -> int:
        return self.height + FRAME_PADDING * 2


def source_paths() -> list[Path]:
    paths = [PUBLIC_DIRECTORY / relative_path for relative_path in SINGLE_ASSET_PATHS]
    for relative_directory in ASSET_DIRECTORIES:
        directory = PUBLIC_DIRECTORY / relative_directory
        if not directory.is_dir():
            raise FileNotFoundError(f"Missing runtime asset directory: {directory}")
        paths.extend(sorted(directory.rglob("*.png")))

    missing = [path for path in paths if not path.is_file()]
    if missing:
        raise FileNotFoundError(
            "Missing runtime atlas sources:\n"
            + "\n".join(f"- {path}" for path in missing)
        )
    return sorted(set(paths))


def relative_asset_path(path: Path) -> str:
    return path.relative_to(PUBLIC_DIRECTORY).as_posix()


def load_frames(paths: list[Path]) -> tuple[list[AtlasFrame], str]:
    frames_by_pixels: dict[tuple[int, int, str], AtlasFrame] = {}
    source_hasher = hashlib.sha256()

    for path in paths:
        relative_path = relative_asset_path(path)
        source_bytes = path.read_bytes()
        source_hasher.update(relative_path.encode("utf-8"))
        source_hasher.update(b"\0")
        source_hasher.update(hashlib.sha256(source_bytes).digest())

        with Image.open(io.BytesIO(source_bytes)) as source:
            image = source.convert("RGBA")
        pixel_digest = hashlib.sha256(image.tobytes()).hexdigest()
        duplicate_key = (image.width, image.height, pixel_digest)
        existing = frames_by_pixels.get(duplicate_key)
        if existing:
            existing.aliases.append(relative_path)
            continue

        frames_by_pixels[duplicate_key] = AtlasFrame(
            canonical_path=relative_path,
            aliases=[relative_path],
            image=image,
            pixel_digest=pixel_digest,
        )

    frames = list(frames_by_pixels.values())
    frames.sort(
        key=lambda frame: (
            -max(frame.packed_width, frame.packed_height),
            -(frame.packed_width * frame.packed_height),
            -min(frame.packed_width, frame.packed_height),
            frame.canonical_path,
        )
    )
    return frames, source_hasher.hexdigest()


def intersects(left: Rectangle, right: Rectangle) -> bool:
    return not (
        left.right <= right.x
        or right.right <= left.x
        or left.bottom <= right.y
        or right.bottom <= left.y
    )


def contains(outer: Rectangle, inner: Rectangle) -> bool:
    return (
        inner.x >= outer.x
        and inner.y >= outer.y
        and inner.right <= outer.right
        and inner.bottom <= outer.bottom
    )


def split_free_rectangle(free: Rectangle, used: Rectangle) -> list[Rectangle]:
    if not intersects(free, used):
        return [free]

    result: list[Rectangle] = []
    if used.x > free.x:
        result.append(Rectangle(free.x, free.y, used.x - free.x, free.height))
    if used.right < free.right:
        result.append(
            Rectangle(used.right, free.y, free.right - used.right, free.height)
        )
    if used.y > free.y:
        result.append(Rectangle(free.x, free.y, free.width, used.y - free.y))
    if used.bottom < free.bottom:
        result.append(
            Rectangle(free.x, used.bottom, free.width, free.bottom - used.bottom)
        )
    return [rectangle for rectangle in result if rectangle.width and rectangle.height]


def prune_free_rectangles(rectangles: list[Rectangle]) -> list[Rectangle]:
    unique = list(dict.fromkeys(rectangles))
    return [
        rectangle
        for index, rectangle in enumerate(unique)
        if not any(
            index != other_index and contains(other, rectangle)
            for other_index, other in enumerate(unique)
        )
    ]


def pack_frames(
    frames: list[AtlasFrame], width: int, height: int
) -> dict[str, Rectangle] | None:
    free_rectangles = [Rectangle(0, 0, width, height)]
    placements: dict[str, Rectangle] = {}

    for frame in frames:
        candidates: list[tuple[tuple[int, int, int, int], Rectangle]] = []
        for free in free_rectangles:
            if frame.packed_width > free.width or frame.packed_height > free.height:
                continue
            remaining_width = free.width - frame.packed_width
            remaining_height = free.height - frame.packed_height
            score = (
                min(remaining_width, remaining_height),
                max(remaining_width, remaining_height),
                free.y,
                free.x,
            )
            candidates.append(
                (
                    score,
                    Rectangle(
                        free.x,
                        free.y,
                        frame.packed_width,
                        frame.packed_height,
                    ),
                )
            )

        if not candidates:
            return None

        _, placement = min(candidates, key=lambda candidate: candidate[0])
        placements[frame.pixel_digest] = placement
        split_rectangles: list[Rectangle] = []
        for free in free_rectangles:
            split_rectangles.extend(split_free_rectangle(free, placement))
        free_rectangles = prune_free_rectangles(split_rectangles)

    return placements


def choose_layout(frames: list[AtlasFrame]) -> tuple[int, int, dict[str, Rectangle]]:
    required_area = sum(frame.packed_width * frame.packed_height for frame in frames)
    candidates: list[tuple[int, int]] = []
    for width in range(
        MIN_ATLAS_DIMENSION, MAX_ATLAS_DIMENSION + 1, ATLAS_DIMENSION_STEP
    ):
        for height in range(
            MIN_ATLAS_DIMENSION, MAX_ATLAS_DIMENSION + 1, ATLAS_DIMENSION_STEP
        ):
            if width * height < required_area:
                continue
            candidates.append((width, height))

    candidates.sort(
        key=lambda size: (
            size[0] * size[1],
            max(size),
            abs(math.log2(size[0] / size[1])),
            size[1],
            size[0],
        )
    )

    for width, height in candidates:
        placements = pack_frames(frames, width, height)
        if placements is not None:
            return width, height, placements

    raise RuntimeError(
        f"Runtime sprites do not fit within {MAX_ATLAS_DIMENSION}x"
        f"{MAX_ATLAS_DIMENSION} without rotation"
    )


def paste_with_extruded_edges(
    atlas: Image.Image, image: Image.Image, placement: Rectangle
) -> tuple[int, int]:
    x = placement.x + FRAME_PADDING
    y = placement.y + FRAME_PADDING
    atlas.paste(image, (x, y))

    atlas.paste(image.crop((0, 0, image.width, 1)), (x, y - 1))
    atlas.paste(
        image.crop((0, image.height - 1, image.width, image.height)),
        (x, y + image.height),
    )
    atlas.paste(image.crop((0, 0, 1, image.height)), (x - 1, y))
    atlas.paste(
        image.crop((image.width - 1, 0, image.width, image.height)),
        (x + image.width, y),
    )

    atlas.putpixel((x - 1, y - 1), image.getpixel((0, 0)))
    atlas.putpixel((x + image.width, y - 1), image.getpixel((image.width - 1, 0)))
    atlas.putpixel((x - 1, y + image.height), image.getpixel((0, image.height - 1)))
    atlas.putpixel(
        (x + image.width, y + image.height),
        image.getpixel((image.width - 1, image.height - 1)),
    )
    return x, y


def render_outputs() -> tuple[bytes, str, dict[str, int]]:
    paths = source_paths()
    frames, source_digest = load_frames(paths)
    width, height, placements = choose_layout(frames)
    atlas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    manifest_frames: dict[str, list[int]] = {}

    for frame in frames:
        x, y = paste_with_extruded_edges(
            atlas, frame.image, placements[frame.pixel_digest]
        )
        definition = [x, y, frame.width, frame.height]
        for alias in frame.aliases:
            manifest_frames[alias] = definition

    atlas_buffer = io.BytesIO()
    atlas.save(atlas_buffer, format="PNG", optimize=True, compress_level=9)

    manifest_json = json.dumps(
        dict(sorted(manifest_frames.items())), indent=2, ensure_ascii=False
    )
    manifest_source = f"""// Generated by scripts/build-runtime-atlas.py. Do not edit by hand.

export const RUNTIME_ATLAS_PATH = 'assets/runtime/runtime-atlas.png';
export const RUNTIME_ATLAS_WIDTH = {width};
export const RUNTIME_ATLAS_HEIGHT = {height};
export const RUNTIME_ATLAS_SOURCE_DIGEST = '{source_digest}';

export const RUNTIME_ATLAS_FRAMES = {manifest_json} as const satisfies Readonly<
  Record<string, readonly [x: number, y: number, width: number, height: number]>
>;
"""
    stats = {
        "source_count": len(paths),
        "unique_frame_count": len(frames),
        "duplicate_count": len(paths) - len(frames),
        "width": width,
        "height": height,
        "png_bytes": len(atlas_buffer.getvalue()),
    }
    return atlas_buffer.getvalue(), manifest_source, stats


def verify_file(path: Path, expected: bytes) -> bool:
    return path.is_file() and path.read_bytes() == expected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify that committed atlas outputs match their PNG sources",
    )
    args = parser.parse_args()

    atlas_bytes, manifest_source, stats = render_outputs()
    manifest_bytes = manifest_source.encode("utf-8")

    if args.check:
        stale = []
        if not verify_file(ATLAS_PATH, atlas_bytes):
            stale.append(ATLAS_PATH)
        if not verify_file(MANIFEST_PATH, manifest_bytes):
            stale.append(MANIFEST_PATH)
        if stale:
            raise SystemExit(
                "Runtime atlas outputs are missing or stale:\n"
                + "\n".join(f"- {path}" for path in stale)
                + "\nRun npm run sync:runtime-atlas --workspace @labyrinth/client."
            )
        action = "Verified"
    else:
        ATLAS_DIRECTORY.mkdir(parents=True, exist_ok=True)
        ATLAS_PATH.write_bytes(atlas_bytes)
        MANIFEST_PATH.write_text(manifest_source, encoding="utf-8", newline="\n")
        action = "Built"

    print(
        f"{action} {ATLAS_PATH} ({stats['width']}x{stats['height']}, "
        f"{stats['source_count']} source paths, {stats['unique_frame_count']} unique "
        f"frames, {stats['duplicate_count']} duplicates, "
        f"{stats['png_bytes'] / 1024:.1f} KiB)"
    )


if __name__ == "__main__":
    main()
