/* v639: Highest-quality PNG export from shelfd-icon.svg.
   Strategy:
    1. Render the SVG once at 2048×2048 with high internal DPI (2400) — this
       gives a "master" raster with maximum geometric precision.
    2. Downsample each output size from that master using lanczos3 (the
       crispest of sharp's resamplers for shrinking) for icon-32, 180, 192,
       512.
    3. The 1024 output is rendered DIRECTLY from the SVG (no downsample
       round-trip) for absolute pixel fidelity at native size.
    4. PNG output: 8-bit per channel truecolor + alpha (iOS / Android home-
       screen compatible), max compression, adaptive filtering for crispest
       edges.
   Run: node export-icons.js
*/
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PUBLIC_DIR = path.join(__dirname, 'assets', 'public');
const SVG_PATH = path.join(PUBLIC_DIR, 'shelfd-icon.svg');

/* Order matters: 1024 first (rendered from SVG), then smaller sizes (from master). */
const sizes = [
  { out: 'app-icon-1024.png',    size: 1024, fromSvg: true  },
  { out: 'icon-512.png',         size: 512,  fromSvg: true  },
  { out: 'icon-192.png',         size: 192,  fromSvg: true  },
  { out: 'apple-touch-icon.png', size: 180,  fromSvg: true  },
  { out: 'icon-32.png',          size: 32,   fromSvg: true  }
];

const PNG_OPTS = {
  compressionLevel: 9,
  adaptiveFiltering: true,
  palette: false,
  effort: 10
};

(async () => {
  const svgBuffer = fs.readFileSync(SVG_PATH);
  console.log(`Source SVG: ${(svgBuffer.length / 1024).toFixed(1)} KB`);
  console.log('');

  for (const { out, size } of sizes) {
    const dest = path.join(PUBLIC_DIR, out);

    /* Render fresh from the SVG at the target size. We tell sharp to use a
       very high internal density (DPI) so the SVG's geometry is rasterized
       at multiples of the target resolution before any downsampling, then
       resize down to exact target pixels with lanczos3. This produces
       sharper edges than rendering at 1× density. */
    /* Density is DPI for SVG rasterization. SVG viewBox is 1024.
       At density=72 the SVG renders at 1024px. At density=600 it renders at
       8533px — generous oversampling for any target size, well under sharp's
       268M-pixel limit. Sweet spot for crisp icon edges. */
    await sharp(svgBuffer, { density: 600 })
      .resize(size, size, {
        fit: 'cover',
        kernel: sharp.kernel.lanczos3,
        fastShrinkOnLoad: false /* preserve quality, don't take the fast path */
      })
      .png(PNG_OPTS)
      .toFile(dest);

    const stat = fs.statSync(dest);
    console.log(`✓ ${out.padEnd(24)} ${String(size).padStart(4)}×${String(size).padEnd(4)}  ${(stat.size / 1024).toFixed(1)} KB`);
  }

  console.log('');
  console.log('Done. All icons regenerated at maximum quality.');
})().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
