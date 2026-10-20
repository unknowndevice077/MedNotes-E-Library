import type { FileKind } from './types';

// Works out the "length" shown on a file's card (pages, slides, sheets, running time) from the
// file itself, in the admin's browser, before it is uploaded. Heavy readers load only when needed.

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function duration(sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${Math.max(1, m)} min`;
}

async function zip(file: Blob) {
  const JSZip = (await import('jszip')).default;
  return JSZip.loadAsync(file);
}

async function pdf(file: Blob) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const n = doc.numPages;
  await doc.destroy();
  return plural(n, 'page');
}

async function pptx(file: Blob) {
  const z = await zip(file);
  return plural(Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, 'slide');
}

async function docx(file: Blob) {
  const z = await zip(file);
  // Word stores its own page count when it saves the file; otherwise estimate ~350 words a page
  const app = await z.file('docProps/app.xml')?.async('string');
  const pages = Number(app?.match(/<Pages>(\d+)<\/Pages>/)?.[1]);
  if (pages > 0) return plural(pages, 'page');
  const xml = (await z.file('word/document.xml')?.async('string')) ?? '';
  const words = xml.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return plural(Math.max(1, Math.ceil(words / 350)), 'page');
}

async function xlsx(file: Blob) {
  const z = await zip(file);
  const wb = (await z.file('xl/workbook.xml')?.async('string')) ?? '';
  return plural(Math.max(1, (wb.match(/<sheet\b/g) ?? []).length), 'sheet');
}

async function epub(file: Blob) {
  const z = await zip(file);
  const container = (await z.file('META-INF/container.xml')?.async('string')) ?? '';
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1] ?? '';
  const opf = (await z.file(opfPath)?.async('string')) ?? '';
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const ids = [...opf.matchAll(/<itemref[^>]*idref="([^"]+)"/g)].map((m) => m[1]);
  let chars = 0;
  for (const id of ids) {
    const href = opf.match(new RegExp(`<item[^>]*id="${id}"[^>]*href="([^"]+)"`))?.[1] ?? opf.match(new RegExp(`<item[^>]*href="([^"]+)"[^>]*id="${id}"`))?.[1];
    const html = href ? await z.file(base + decodeURIComponent(href))?.async('string') : '';
    chars += (html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').length;
  }
  const pages = Math.max(1, Math.round(chars / 1800)); // a printed page holds roughly 1,800 characters
  return `${plural(ids.length, 'chapter')} · ~${plural(pages, 'page')}`;
}

function video(file: Blob) {
  return new Promise<string>((resolve) => {
    const v = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (s: string) => { URL.revokeObjectURL(url); resolve(s); };
    v.preload = 'metadata';
    v.onloadedmetadata = () => done(duration(v.duration));
    v.onerror = () => done('');
    setTimeout(() => done(''), 8000);
    v.src = url;
  });
}

async function image(file: Blob) {
  const bmp = await createImageBitmap(file);
  const s = `1 image · ${bmp.width}×${bmp.height}`;
  bmp.close();
  return s;
}

/** e.g. "96 pages", "62 slides", "4 sheets", "2h 14m", "12 chapters · ~240 pages"; '' if it can't tell. */
export async function detectLength(file: Blob, kind: FileKind): Promise<string> {
  try {
    switch (kind) {
      case 'pdf': return await pdf(file);
      case 'pptx': return await pptx(file);
      case 'docx': return await docx(file);
      case 'xlsx': return await xlsx(file);
      case 'epub': return await epub(file);
      case 'video': return await video(file);
      case 'image': return await image(file);
      default: return '';
    }
  } catch {
    return '';
  }
}
