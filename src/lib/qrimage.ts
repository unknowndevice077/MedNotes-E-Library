import QRCode from 'qrcode';
import jsQR from 'jsqr';

/** Reads the QR code inside an image file (e.g. the publisher's GCash QR screenshot). */
export async function decodeQrImage(file: Blob): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  // Scale big screenshots down; QR decoding doesn't need full resolution.
  const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/** PNG data URL for a QR payload. */
export const qrDataUrl = (payload: string, size = 480) =>
  QRCode.toDataURL(payload, { width: size, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#0F172A', light: '#FFFFFF' } });
