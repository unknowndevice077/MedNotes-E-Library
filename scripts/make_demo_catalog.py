# Generates covers + a few sample images for the extra demo catalog (supabase/seed.sql "demo catalog").
# Covers are original artwork (gradient, title, specialty), not copies of real books.
# usage: python scripts/make_demo_catalog.py
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import random, textwrap

root = Path(__file__).resolve().parent.parent
covers = root / 'supabase' / 'sample' / 'covers'
files = root / 'supabase' / 'sample' / 'files'
proofs = root / 'supabase' / 'sample' / 'proofs'
for d in (covers, files, proofs): d.mkdir(parents=True, exist_ok=True)

def font(size, bold=True):
    for f in (['C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/arialbd.ttf'] if bold else ['C:/Windows/Fonts/segoeui.ttf', 'C:/Windows/Fonts/arial.ttf']):
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    return ImageFont.load_default()

CATALOG = [
    ('micro-review', 'Clinical Microbiology Review', 'Microbiology', 'EPUB', ((109, 40, 217), (30, 27, 75))),
    ('renal-physio', 'Renal Physiology Notes', 'Physiology', 'PDF', ((2, 132, 199), (12, 74, 110))),
    ('biochem-pathways', 'Biochemistry Pathways Chart', 'Biochemistry', 'IMAGE', ((234, 88, 12), (124, 45, 18))),
    ('peds-milestones', 'Pediatric Milestones Lecture', 'Pediatrics', 'VIDEO', ((219, 39, 119), (80, 7, 36))),
    ('ob-review', 'Obstetrics Quick Review', 'OB-GYN', 'DOCX', ((190, 24, 93), (88, 28, 135))),
    ('surgical-atlas', 'Surgical Instruments Atlas', 'Surgery', 'PDF', ((71, 85, 105), (15, 23, 42))),
    ('antibiotics', 'Antibiotics Cheat Sheet', 'Pharmacology', 'XLSX', ((5, 150, 105), (6, 78, 59))),
    ('nclex-set-1', 'NCLEX Practice Set 1', 'Nursing', 'PDF', ((14, 165, 233), (3, 105, 161))),
    ('neuro-slides', 'Neuroanatomy Slides', 'Anatomy', 'PPTX', ((124, 58, 237), (49, 46, 129))),
    ('ecg-strips', 'ECG Practice Strips', 'Cardiology', 'IMAGE', ((220, 38, 38), (127, 29, 29))),
    ('heart-sounds', 'Heart Sounds Lecture', 'Cardiology', 'VIDEO', ((225, 29, 72), (76, 5, 25))),
    ('public-health', 'Public Health Case Studies', 'Community Health', 'EPUB', ((22, 163, 74), (20, 83, 45))),
]

def cover(slug, title, label, tag, colors):
    W, H = 600, 800
    top, bottom = colors
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    rnd = random.Random(slug)
    over = Image.new('RGBA', (W, H), (0, 0, 0, 0)); o = ImageDraw.Draw(over)
    for _ in range(6):
        r = rnd.randint(60, 220); x = rnd.randint(-80, W); y = rnd.randint(180, H)
        o.ellipse([x - r, y - r, x + r, y + r], outline=(255, 255, 255, 38), width=6)
    img = Image.alpha_composite(img.convert('RGBA'), over); d = ImageDraw.Draw(img)
    d.text((48, 120), label.upper(), font=font(26), fill=(255, 255, 255, 210))
    y = 170
    for line in textwrap.wrap(title, 14):
        d.text((48, y), line, font=font(64), fill='white'); y += 76
    d.rectangle([48, y + 18, 150, y + 24], fill=(255, 255, 255))
    d.text((48, H - 80), 'MEDNOTES PRESS', font=font(22), fill=(255, 255, 255, 180))
    img.convert('RGB').save(covers / f'{slug}.png', optimize=True)

for c in CATALOG: cover(*c)

# Sample IMAGE-type files (charts) for the image reader.
def chart(path, title, color, rows):
    W, H = 1400, 900
    img = Image.new('RGB', (W, H), 'white'); d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 110], fill=color); d.text((40, 30), title, font=font(48), fill='white')
    for i, (a, b) in enumerate(rows):
        y = 170 + i * 110
        d.rounded_rectangle([60, y, 640, y + 80], radius=18, fill=(241, 245, 249), outline=color, width=3)
        d.text((90, y + 22), a, font=font(30), fill=(15, 23, 42))
        d.line([(640, y + 40), (760, y + 40)], fill=color, width=6)
        d.rounded_rectangle([760, y, 1340, y + 80], radius=18, fill=(241, 245, 249), outline=color, width=3)
        d.text((790, y + 22), b, font=font(30, False), fill=(15, 23, 42))
    d.text((40, H - 50), 'MedNotes sample image - demo data', font=font(22, False), fill=(100, 116, 139))
    img.save(path, optimize=True)

chart(files / 'biochem-pathways.png', 'Glycolysis at a glance', (234, 88, 12),
      [('Glucose', 'Hexokinase (ATP used)'), ('Fructose-1,6-BP', 'PFK-1: rate-limiting'), ('Glyceraldehyde-3-P', 'NADH produced'), ('Pyruvate', 'Net 2 ATP, 2 NADH'), ('Lactate / Acetyl-CoA', 'Anaerobic / aerobic fate')])
chart(files / 'ecg-strips.png', 'ECG practice strips', (220, 38, 38),
      [('Strip 1', 'Sinus rhythm, 72 bpm'), ('Strip 2', 'Atrial fibrillation'), ('Strip 3', 'First-degree AV block'), ('Strip 4', 'Ventricular tachycardia'), ('Strip 5', 'ST elevation, inferior')])

# Clearly-marked dummy proof-of-payment screenshots for the pending demo payments.
def proof(path, amount, ref):
    img = Image.new('RGB', (540, 960), (245, 248, 255)); d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 540, 150], fill=(0, 82, 204)); d.text((40, 50), 'Payment sent', font=font(40), fill='white')
    d.text((40, 220), f'PHP {amount:,.2f}', font=font(64), fill=(15, 23, 42))
    d.text((40, 320), 'To: MedNotes Publishing', font=font(30, False), fill=(51, 65, 85))
    d.text((40, 370), f'Ref No. {ref}', font=font(30, False), fill=(51, 65, 85))
    d.rounded_rectangle([40, 760, 500, 880], radius=16, fill=(254, 226, 226))
    d.text((60, 795), 'SAMPLE - TEST DATA ONLY', font=font(30), fill=(185, 28, 28))
    img.save(path, optimize=True)

for uid, amount, ref in [('33333333-0000-0000-0000-000000000001', 450, '8821 4407 3312'), ('33333333-0000-0000-0000-000000000002', 600, '7712 9921 0044'),
                         ('33333333-0000-0000-0000-000000000003', 350, '5510 2288 1930'), ('33333333-0000-0000-0000-000000000004', 280, '9031 4471 2205')]:
    (proofs / uid).mkdir(exist_ok=True)
    proof(proofs / uid / 'proof-1.png', amount, ref)
print('demo catalog assets generated:', len(CATALOG), 'covers, 2 images, 4 proofs')
