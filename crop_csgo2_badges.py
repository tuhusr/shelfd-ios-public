from pathlib import Path

from PIL import Image


SOURCE = Path(
    r"C:\Users\kingk\Desktop\websites\chat gpt edits\7\1. rank badges\csgo 2\Screenshot 2026-05-29 090331.png"
)
OUTPUT_DIR = SOURCE.parent / "CSGO2 ranked badges"
PADDING = 8

BADGES = [
    ("silver_1", (10, 8, 141, 57)),
    ("gold_nova_1", (197, 8, 143, 57)),
    ("master_guardian_elite", (408, 8, 142, 57)),
    ("silver_2", (10, 89, 141, 57)),
    ("gold_nova_2", (197, 89, 142, 57)),
    ("distinguished_master_guardian", (408, 88, 142, 58)),
    ("silver_3", (10, 173, 141, 57)),
    ("gold_nova_3", (197, 173, 142, 57)),
    ("legendary_eagle", (408, 173, 142, 57)),
    ("silver_4", (10, 258, 141, 57)),
    ("gold_nova_master", (197, 258, 142, 57)),
    ("legendary_eagle_master", (408, 258, 142, 57)),
    ("silver_elite", (10, 339, 141, 58)),
    ("master_guardian_1", (198, 339, 142, 57)),
    ("supreme_master_first_class", (407, 339, 142, 57)),
    ("silver_elite_master", (10, 421, 141, 57)),
    ("master_guardian_2", (197, 421, 142, 57)),
    ("the_global_elite", (408, 421, 141, 57)),
]


def add_transparent_margin(image: Image.Image, padding: int) -> Image.Image:
    rgba = image.convert("RGBA")
    canvas = Image.new("RGBA", (rgba.width + padding * 2, rgba.height + padding * 2), (0, 0, 0, 0))
    canvas.paste(rgba, (padding, padding))
    return canvas


def main() -> None:
    OUTPUT_DIR.mkdir(exist_ok=True)
    source = Image.open(SOURCE)

    written = []
    for name, (x, y, w, h) in BADGES:
        cropped = source.crop((x, y, x + w, y + h))
        output = add_transparent_margin(cropped, PADDING)
        target = OUTPUT_DIR / f"{name}.png"
        output.save(target)
        written.append(target)

    print(f"Wrote {len(written)} PNGs")
    print(OUTPUT_DIR)


if __name__ == "__main__":
    main()
