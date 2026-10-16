# Generates Android launcher icons and splash screens from design/logo-blue.png.
# usage: python scripts/android_icons.py   (run from the repo root)
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
res = root / 'android' / 'app' / 'src' / 'main' / 'res'
logo = Image.open(root / 'design' / 'logo-blue.png').convert('RGBA')
WHITE = (255, 255, 255, 255)
dens = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

def centered(size, scale, bg=WHITE, radius=None):
    img = Image.new('RGBA', (size, size), bg)
    if radius is not None:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255) if radius else ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
        img.putalpha(mask)
    s = int(size * scale)
    img.alpha_composite(logo.resize((s, s), Image.LANCZOS), ((size - s) // 2, (size - s) // 2))
    return img

for name, k in dens.items():
    d = res / f'mipmap-{name}'
    d.mkdir(exist_ok=True)
    centered(int(48 * k), 0.78, radius=int(48 * k * 0.18)).save(d / 'ic_launcher.png')
    centered(int(48 * k), 0.7, radius=0).save(d / 'ic_launcher_round.png')
    # adaptive foreground: 108dp canvas, logo inside the 66dp safe zone
    centered(int(108 * k), 0.58, bg=(0, 0, 0, 0)).save(d / 'ic_launcher_foreground.png')

# splash: white with the logo in the middle
for folder in res.glob('drawable*'):
    p = folder / 'splash.png'
    if p.exists():
        w, h = Image.open(p).size
        img = Image.new('RGBA', (w, h), WHITE)
        s = int(min(w, h) * 0.32)
        img.alpha_composite(logo.resize((s, s), Image.LANCZOS), ((w - s) // 2, (h - s) // 2))
        img.convert('RGB').save(p)
print('icons and splash generated')
