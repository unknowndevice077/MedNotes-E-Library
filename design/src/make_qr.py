# Brand-colored Play Store QR with the logo in the centre; verified with OpenCV before use.
import sys, segno, cv2
from PIL import Image, ImageDraw
url = 'https://play.google.com/store/apps/details?id=com.mednotes.elibrary'
q = segno.make(url, error='h')
m = [list(r) for r in q.matrix]; n = len(m); cell = 14; pad = 4 * cell; S = n * cell + 2 * pad
img = Image.new('RGBA', (S, S), (255, 255, 255, 255)); d = ImageDraw.Draw(img)
c1, c2 = (3, 105, 161), (4, 120, 87)          # deep blue -> deep green (dark enough to scan)
lerp = lambda t: tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))
for y in range(n):
    for x in range(n):
        if m[y][x]:
            X, Y = pad + x * cell, pad + y * cell
            d.rectangle([X, Y, X + cell - 1, Y + cell - 1], fill=lerp((x + y) / (2 * (n - 1))))
L = int(n * cell * float(sys.argv[1] if len(sys.argv) > 1 else 0.2)); c = S // 2
d.rounded_rectangle([c - L // 2 - 10, c - L // 2 - 10, c + L // 2 + 10, c + L // 2 + 10], radius=18, fill=(255, 255, 255))
img.alpha_composite(Image.open('logo-blue.png').resize((L, L), Image.LANCZOS), (c - L // 2, c - L // 2))
img.convert('RGB').save('qr-playstore-color.png', optimize=True)
cv = cv2.imread('qr-playstore-color.png')
for s in (1.0, 0.3):
    v, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.resize(cv, None, fx=s, fy=s, interpolation=cv2.INTER_AREA))
    print(f'scale {s}:', 'OK' if v == url else 'FAILED')
