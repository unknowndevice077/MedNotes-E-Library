# Makes supabase/sample/payment-qr/gcash-demo.png: a clearly-labelled DEMO payment QR.
# The payload is plain text, not a real GCash/QR Ph code, so scanning it can't send money.
# Replace it in Admin → Settings with the publisher's real GCash QR before going live.
from pathlib import Path
import segno
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
out = root / 'supabase' / 'sample' / 'payment-qr'
out.mkdir(parents=True, exist_ok=True)
payload = 'MEDNOTES DEMO PAYMENT QR - not a real GCash account. Publisher: replace in Admin > Settings.'
qr = segno.make(payload, error='h')
m = qr.matrix
n, cell, pad = len(m), 14, 4
size = (n + pad * 2) * cell
W, H = size + 80, size + 210
img = Image.new('RGB', (W, H), 'white')
d = ImageDraw.Draw(img)
blue = (0, 82, 204)
d.rounded_rectangle([0, 0, W - 1, 110], radius=0, fill=blue)
try:
    bold = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 44)
    reg = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 26)
except OSError:
    bold = reg = ImageFont.load_default()
d.text((W / 2, 55), 'GCash · Scan to pay', fill='white', font=bold, anchor='mm')
ox, oy = 40, 130
for y, row in enumerate(m):
    for x, v in enumerate(row):
        if v:
            X, Y = ox + (x + pad) * cell, oy + (y + pad) * cell
            d.rectangle([X, Y, X + cell - 1, Y + cell - 1], fill=(15, 23, 42))
# DEMO stamp in the middle (H error correction keeps it scannable)
cx, cy = ox + size // 2, oy + size // 2
d.rounded_rectangle([cx - 120, cy - 44, cx + 120, cy + 44], radius=14, fill=(225, 29, 72))
d.text((cx, cy), 'DEMO', fill='white', font=bold, anchor='mm')
d.text((W / 2, oy + size + 30), 'MedNotes Publishing · 0917 123 4567', fill=(15, 23, 42), font=reg, anchor='mm')
d.text((W / 2, oy + size + 62), 'Sample QR for testing, not a real account', fill=(225, 29, 72), font=reg, anchor='mm')
img.save(out / 'gcash-demo.png', optimize=True)
print('wrote', out / 'gcash-demo.png', img.size)
