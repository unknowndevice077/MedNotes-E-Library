import { useMemo } from 'react';
import { useAuth } from './auth';
import type { Settings } from './types';

// The publisher's mark on every file: the name and second line the admin sets in Restrictions
// (falls back to the receipt business name + support email). Burned into PDF/image pixels, tiled over the rest.
export interface Mark { name: string; line: string; tile: string; tileDark: string }

export function publisherOf(s: Partial<Settings> | null | undefined) {
  return { name: s?.publisher_name?.trim() || s?.receipt_business?.trim() || s?.store_name?.trim() || 'MedNotes', contact: s?.support_email?.trim() || '' };
}

/** Second watermark line: the admin's own text, or "Licensed copy · do not share · <support email>". */
export function watermarkLine(s: Partial<Settings> | null | undefined) {
  const { contact } = publisherOf(s);
  return s?.watermark_note?.trim() || `Licensed copy · do not share${contact ? ` · ${contact}` : ''}`;
}

export const markTile = (s: Partial<Settings> | null | undefined, dark = false) =>
  tileSvg(publisherOf(s).name, watermarkLine(s), dark ? '#ffffff' : '#0369a1', dark ? 0.16 : 0.13);

/** The publisher name for "Published by …" labels. */
export function usePublisher() {
  const { settings } = useAuth();
  return publisherOf(settings);
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function tileSvg(name: string, line: string, color: string, alpha: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="380" height="240"><g transform="rotate(-24 190 120)" fill="${color}" fill-opacity="${alpha}" font-family="Inter,Segoe UI,Arial,sans-serif" text-anchor="middle">`
    + `<text x="190" y="116" font-size="22" font-weight="800">© ${esc(name)}</text><text x="190" y="138" font-size="11" font-weight="600">${esc(line)}</text></g></svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

export function useMark(): Mark | null {
  const { settings } = useAuth();
  return useMemo(() => {
    if (settings?.watermark === false) return null;
    return { name: publisherOf(settings).name, line: watermarkLine(settings), tile: markTile(settings), tileDark: markTile(settings, true) };
  }, [settings]);
}

/** Draws the mark into a rendered page or image, so it's part of the pixels, not a layer on top. */
export function stampCanvas(c: HTMLCanvasElement, m: Mark | null) {
  if (!m) return;
  const ctx = c.getContext('2d')!;
  const size = Math.max(14, Math.round(c.width / 30));
  const stepX = size * 17, stepY = size * 9;
  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((-24 * Math.PI) / 180);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(3, 105, 161, 0.12)';
  const reach = Math.hypot(c.width, c.height);
  for (let y = -reach / 2; y < reach / 2; y += stepY) {
    for (let x = -reach / 2 + ((y / stepY) % 2 ? stepX / 2 : 0); x < reach / 2; x += stepX) {
      ctx.font = `800 ${size}px Inter, "Segoe UI", Arial, sans-serif`;
      ctx.fillText(`© ${m.name}`, x, y);
      ctx.font = `600 ${Math.round(size * 0.48)}px Inter, "Segoe UI", Arial, sans-serif`;
      ctx.fillText(m.line, x, y + size * 0.95);
    }
  }
  ctx.restore();
}
