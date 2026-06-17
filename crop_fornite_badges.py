from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


SOURCE = Path(
    r"C:\Users\kingk\Desktop\websites\chat gpt edits\7\1. rank badges\fornite\Screenshot 2026-05-29 091220.png"
)
OUTPUT_DIR = SOURCE.parent / "fornite ranked badges"
PADDING = 6

# Approximate center coordinates and radii for simple circular icon crops.
BADGES = [
    ("bronze_3", (55, 61, 27)),
    ("bronze_2", (56, 121, 24)),
    ("bronze_1", (56, 181, 18)),
    ("silver_3", (147, 61, 24)),
    ("silver_2", (148, 121, 22)),
    ("silver_1", (149, 181, 17)),
    ("gold_3", (240, 61, 24)),
    ("gold_2", (241, 121, 22)),
    ("gold_1", (242, 181, 18)),
    ("platinum_3", (332, 62, 25)),
    ("platinum_2", (333, 122, 23)),
    ("platinum_1", (334, 181, 18)),
    ("diamond_3", (424, 61, 24)),
    ("diamond_2", (425, 121, 22)),
    ("diamond_1", (426, 181, 18)),
    ("elite", (515, 61, 29)),
    ("champion", (608, 61, 29)),
    ("unreal", (698, 60, 31)),
]


def refine_center(source: Image.Image, center_x: int, center_y: int, radius: int) -> tuple[int, int]:
    search_radius = radius + 14
    x0 = max(0, center_x - search_radius)
    y0 = max(0, center_y - search_radius)
    x1 = min(source.width, center_x + search_radius)
    y1 = min(source.height, center_y + search_radius)

    crop = np.array(source.crop((x0, y0, x1, y1)).convert("RGB")).astype(np.int16)
    border = np.concatenate([crop[0], crop[-1], crop[:, 0], crop[:, -1]], axis=0)
    background = np.median(border, axis=0)
    distance = np.linalg.norm(crop - background, axis=2)
    mask = distance > 35

    ys, xs = np.where(mask)
    if len(xs) == 0 or len(ys) == 0:
        return center_x, center_y

    refined_x = int(round(x0 + (xs.min() + xs.max()) / 2.0))
    refined_y = int(round(y0 + (ys.min() + ys.max()) / 2.0))
    return refined_x, refined_y


def circular_crop(source: Image.Image, center_x: int, center_y: int, radius: int) -> Image.Image:
    size = radius * 2
    box = (center_x - radius, center_y - radius, center_x + radius, center_y + radius)
    crop = source.crop(box).convert("RGBA")

    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, size - 1, size - 1), fill=255)
    crop.putalpha(mask)

    canvas = Image.new("RGBA", (size + PADDING * 2, size + PADDING * 2), (0, 0, 0, 0))
    canvas.paste(crop, (PADDING, PADDING), crop)
    return canvas


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    source = Image.open(SOURCE)

    for name, (center_x, center_y, radius) in BADGES:
        center_x, center_y = refine_center(source, center_x, center_y, radius)
        output = circular_crop(source, center_x, center_y, radius)
        output.save(OUTPUT_DIR / f"{name}.png")

    print(f"Wrote {len(BADGES)} PNGs")
    print(OUTPUT_DIR)


if __name__ == "__main__":
    main()
