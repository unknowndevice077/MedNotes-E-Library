# Turns the supplied JPG logo into clean transparent PNGs (blue + white) for the design and app.
import sys
from PIL import Image
src, outdir = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
w, h = im.size
px = im.load()
# Sample the logo blue from the darkest pixels.
dark = sorted((sum(px[x, y]), px[x, y]) for x in range(0, w, 4) for y in range(0, h, 4))[:200]
blue = tuple(sum(c[1][i] for c in dark) // len(dark) for i in range(3))
lum_blue = 0.299 * blue[0] + 0.587 * blue[1] + 0.114 * blue[2]
mask = Image.new("L", (w, h))
mp = mask.load()
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        a = (255 - lum) / (255 - lum_blue)
        mp[x, y] = max(0, min(255, int(round(a * 255))))
bbox = mask.point(lambda v: 255 if v > 40 else 0).getbbox()
mask = mask.crop(bbox)
side = int(max(mask.size) * 1.08)
sq = Image.new("L", (side, side))
sq.paste(mask, ((side - mask.width) // 2, (side - mask.height) // 2))
for name, color in (("logo-blue", blue), ("logo-white", (255, 255, 255))):
    img = Image.new("RGBA", (side, side), color + (0,))
    img.putalpha(sq)
    img.resize((512, 512), Image.LANCZOS).save(f"{outdir}/{name}.png")
    img.resize((160, 160), Image.LANCZOS).save(f"{outdir}/{name}-160.png", optimize=True)
print("blue", "#%02X%02X%02X" % blue, "bbox", bbox, "side", side)
