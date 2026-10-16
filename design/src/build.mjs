// Builds self-contained HTML boards for html_to_figma: inlines common.css and icon placeholders.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'out');
mkdirSync(out, { recursive: true });

// Official logo (stethoscope + open book), prepared from logo-source.jpg by prep_logo.py.
const logoPng = readFileSync(join(here, '..', 'logo-blue.png')).toString('base64');
const s = (body, color = 'currentColor', w = 2) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const icons = {
  LOCK: s('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', '#FFFFFF'),
  LOCKD: s('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', '#334155'),
  SEARCH: s('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', '#94A3B8'),
  UPLOAD: s('<path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/>', '#0284C7'),
  CHECK: s('<path d="m5 12 5 5 9-10"/>', '#059669', 2.5),
  CHECKW: s('<path d="m5 12 5 5 9-10"/>', '#FFFFFF', 2.5),
  CLOCK: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', '#B45309'),
  LAPTOP: s('<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>', '#0284C7'),
  PHONE: s('<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>', '#059669'),
  RECEIPT: s('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>', '#0284C7'),
  DOWNLOAD: s('<path d="M12 4v12"/><path d="m6 10 6 6 6-6"/><path d="M4 20h16"/>', '#FFFFFF'),
  HOME: s('<path d="M4 11 12 4l8 7v9H4z"/>'),
  BOOK: s('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/>'),
  DEV: s('<rect x="7" y="2.5" width="10" height="19" rx="2"/>'),
  USER: s('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  GRID: s('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  FILES: s('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  PAY: s('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/>'),
  USERS: s('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>'),
  SHIELD: s('<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>'),
  COG: s('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  BELL: s('<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>', '#475569'),
  BACK: s('<path d="m15 18-6-6 6-6"/>', '#0F172A'),
  PLAY: '<svg width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#FFFFFF" opacity="0.9"/><path d="M26 20v24l20-12z" fill="#0284C7"/></svg>',
  GOOGLE: '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>',
  FB: '<svg width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path fill="#FFFFFF" d="M13.4 20v-6.2h2.1l.3-2.4h-2.4V9.9c0-.7.2-1.2 1.2-1.2h1.3V6.6c-.2 0-1-.1-1.9-.1-1.9 0-3.2 1.2-3.2 3.3v1.8H8.7v2.4h2.1V20z"/></svg>',
};

const sizes = {
  LOGO: 36, LOCK: 16, LOCKD: 14, CHECK: 14, CHECKW: 18, CLOCK: 16, SEARCH: 18, UPLOAD: 28,
  LAPTOP: 26, PHONE: 26, RECEIPT: 18, DOWNLOAD: 18, BELL: 22, BACK: 22, PLAY: 64,
  HOME: 22, BOOK: 22, DEV: 22, USER: 22, GOOGLE: 20, FB: 20,
};

const css = readFileSync(join(here, 'common.css'), 'utf8');
let seq = 0;
for (const name of process.argv.slice(2)) {
  let body = readFileSync(join(here, `${name}.html`), 'utf8');
  // {{NAME}} or {{NAME:size}}: Figma's importer ignores CSS sizing on <svg>, so bake the size in.
  body = body.replace(/\{\{(\w+)(?::(\d+))?\}\}/g, (m, k, size) => {
    const px = size ?? sizes[k] ?? 20;
    if (k === 'LOGO') return `<img src="data:image/png;base64,${logoPng}" width="${px}" height="${px}" alt="MedNotes logo">`;
    if (!(k in icons)) throw new Error(`unknown icon ${k} in ${name}`);
    // Gradient ids must be unique per inline copy or every repeat after the first renders blank.
    const uid = `u${++seq}`;
    const svg = icons[k].replace(/id="(\w+)"/g, `id="$1-${uid}"`).replace(/url\(#(\w+)\)/g, `url(#$1-${uid})`);
    // The importer also ignores viewBox scaling, so scale the contents explicitly.
    const parts = svg.match(/^<svg([^>]*)>([\s\S]*)<\/svg>$/);
    const vb = parts[1].match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    const scale = px / Number(vb[1]);
    const attrs = parts[1].replace(/\s(width|height|viewBox|xmlns)="[^"]*"/g, '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}"${attrs}><g transform="scale(${scale})">${parts[2]}</g></svg>`;
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><style>${css}</style></head><body>${body}</body></html>`;
  writeFileSync(join(out, `${name}.html`), html);
  console.log(`built ${name}.html (${html.length} bytes)`);
}
