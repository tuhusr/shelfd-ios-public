from collections import deque
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

from PIL import Image


SOURCE = Path(
    r"C:\Users\kingk\Desktop\websites\chat gpt edits\7\1. rank badges\rainbow\New folder\6sl1hn0l59lg1.png"
)
OUTPUT_DIR = SOURCE.parent / "cropped_badges"
ZIP_PATH = SOURCE.parent / "cropped_badges.zip"

ROWS = [
    ("copper", (297, 1328), [(207, 998), (1107, 1898), (2006, 2797), (2906, 3697), (3806, 4597)]),
    ("bronze", (1497, 2528), [(207, 998), (1106, 1897), (2005, 2796), (2904, 3695), (3806, 4597)]),
    ("silver", (2697, 3728), [(203, 994), (1106, 1897), (2005, 2796), (2910, 3701), (3806, 4597)]),
    ("gold", (3897, 4928), [(203, 994), (1106, 1897), (2009, 2800), (2912, 3703), (3806, 4597)]),
    ("platinum", (5097, 6128), [(207, 998), (1106, 1897), (2005, 2796), (2904, 3695), (3806, 4597)]),
    ("emerald", (6293, 7328), [(207, 998), (1106, 1897), (2010, 2801), (2905, 3696), (3809, 4600)]),
    ("diamond", (7489, 8528), [(207, 998), (1106, 1897), (2010, 2801), (2914, 3705), (3806, 4597)]),
    ("crimson", (8685, 9728), [(201, 992), (1106, 1897), (2005, 2796), (2916, 3707), (3809, 4600)]),
]
CHAMPION = ("champion", (9883, 11331), (1868, 2909))
DIVISIONS = [5, 4, 3, 2, 1]
BLACK = (0, 0, 0)


def make_background_transparent(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    visited = set()
    queue = deque()

    def enqueue(x: int, y: int) -> None:
        if (x, y) in visited:
            return
        if pixels[x, y][:3] != BLACK:
            return
        visited.add((x, y))
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                enqueue(nx, ny)

    return rgba


def crop_box(x_range: tuple[int, int], y_range: tuple[int, int]) -> tuple[int, int, int, int]:
    x0, x1 = x_range
    y0, y1 = y_range
    return (x0, y0, x1 + 1, y1 + 1)


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    source = Image.open(SOURCE)
    written = []

    for rank_name, y_range, x_ranges in ROWS:
        for division, x_range in zip(DIVISIONS, x_ranges):
            cropped = source.crop(crop_box(x_range, y_range))
            transparent = make_background_transparent(cropped)
            target = OUTPUT_DIR / f"{rank_name}_{division}.png"
            transparent.save(target)
            written.append(target)

    champion_name, champion_y, champion_x = CHAMPION
    champion = source.crop(crop_box(champion_x, champion_y))
    champion = make_background_transparent(champion)
    champion_target = OUTPUT_DIR / f"{champion_name}.png"
    champion.save(champion_target)
    written.append(champion_target)

    with ZipFile(ZIP_PATH, "w", compression=ZIP_DEFLATED) as archive:
        for path in written:
            archive.write(path, arcname=path.name)

    print(f"Wrote {len(written)} PNGs")
    print(ZIP_PATH)


if __name__ == "__main__":
    main()
