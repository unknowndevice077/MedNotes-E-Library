import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { isNative } from '../lib/platform';
import { errMsg } from '../lib/format';
import { isSaved, listSaved, offlineExpired, readOffline } from '../lib/offline';
import { KIND_LABEL, type FileKind, type LibFile, type UserPrefs } from '../lib/types';
import { useIsMobile } from '../components/ui';
import { fetchSecureFile } from '../lib/secureFile';
import { guardMessage, useContentGuard } from '../lib/contentGuard';
import { blockScreenshots } from '../lib/screenGuard';
import { Back, Expand, Minus, Moon, Plus, Sun } from '../components/Icons';
import { stampCanvas, useMark, usePublisher, type Mark } from '../lib/watermark';
import { usePrefs } from '../lib/prefs';
import { ReaderSkeleton } from '../components/Skeletons';
import { STRENGTH, TILE, markTile } from '../lib/leakMark';

type Source = { kind: FileKind; name: string; mime: string; blob?: Blob; url?: string };

async function loadSource(id: string, preferOffline: boolean, offlineDays: number, onProgress: (p: number) => void): Promise<Source> {
  if (isNative && (preferOffline || (await isSaved(id)))) {
    const meta = (await listSaved()).find((f) => f.id === id);
    if (meta) {
      if (preferOffline && (await offlineExpired(offlineDays))) throw new Error('Saved files are locked until this phone goes online once.');
      return { kind: meta.kind, name: meta.name, mime: meta.mime, blob: await readOffline(id) };
    }
  }
  const { data: file, error } = await supabase.from('files').select('*').eq('id', id).single<LibFile>();
  if (error || !file) throw new Error(error?.message ?? 'File not found');
  if (!file.storage_path) throw new Error('The publisher has not uploaded this file yet.');
  // Encrypted, ownership- and device-checked delivery; no storage URL ever reaches the browser.
  const blob = await fetchSecureFile(file.id, file.mime, (done, total) => onProgress(total ? done / total : 0));
  return { kind: file.kind, name: file.name, mime: file.mime, blob };
}

const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const PAGED: FileKind[] = ['pdf', 'pptx'];
const THEMES: UserPrefs['readerTheme'][] = ['light', 'sepia', 'dark'];

/** What the viewers need for zoom and pages. */
interface View {
  zoom: number; fit: number; mark: Mark | null;
  onPages: (n: number) => void;
}

export default function Reader() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const mobile = useIsMobile();
  const { settings, session } = useAuth();
  const { prefs, save: savePrefs } = usePrefs();
  // hidden buyer mark: invisible, but any screenshot of the reader can be traced to this account
  const leak = useMemo(() => (session ? markTile(session.user.id) : null), [session?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [src, setSrc] = useState<Source | null>(null);
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState(0);
  const guard = useContentGuard(!!src);

  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(0);
  const [page, setPageNo] = useState(1);
  const [fit, setFit] = useState(800);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSource(id!, sp.get('offline') === '1', settings?.offline_days ?? 30, setProgress).then(setSrc).catch((e) => setErr(errMsg(e)));
  }, [id, sp, settings?.offline_days]);

  // Android: block screenshots/recording only while paid content is on screen (Restrictions setting).
  useEffect(() => {
    if (settings?.block_screenshots === false) return;
    blockScreenshots(true);
    return () => { blockScreenshots(false); };
  }, [settings?.block_screenshots]);

  // the width pages fit to at 100%
  useLayoutEffect(() => {
    const el = body.current; if (!el) return;
    const ro = new ResizeObserver(() => setFit(Math.max(260, Math.min(el.clientWidth - (mobile ? 16 : 64), 900))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [mobile]);

  // which page is in view (PDF pages and slides carry data-page)
  const track = useCallback(() => {
    const el = body.current; if (!el) return;
    const line = el.getBoundingClientRect().top + el.clientHeight * 0.35;
    let n = 1;
    for (const p of el.querySelectorAll<HTMLElement>('[data-page]')) { if (p.getBoundingClientRect().top <= line) n = Number(p.dataset.page); else break; }
    setPageNo(n);
  }, []);
  const goTo = (n: number) => body.current?.querySelector(`[data-page="${Math.min(Math.max(1, n), pages)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  const mark = useMark();
  const publisher = usePublisher();
  const kind = src?.kind;
  const zoomable = !!kind && kind !== 'video';
  const step = (dir: 1 | -1) => {
    if (kind === 'epub') return void savePrefs({ textSize: Math.min(26, Math.max(13, prefs.textSize + dir)) });
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))]!);
  };
  const cycleTheme = () => savePrefs({ readerTheme: THEMES[(THEMES.indexOf(prefs.readerTheme) + 1) % THEMES.length] });
  const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => undefined);
  // keyboard: +/- zoom
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('textarea, input, select')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') step(1);
      else if (e.key === '-') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Ctrl + wheel zooms the document instead of the whole page
  useEffect(() => {
    const el = body.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { if (!e.ctrlKey) return; e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const view: View = { zoom, fit, mark, onPages: setPages };
  const zoomLabel = kind === 'epub' ? `${prefs.textSize}px` : `${Math.round(zoom * 100)}%`;

  return (
    <div className={`reader rt-${prefs.readerTheme}`} style={{ '--reader-scale': prefs.textSize / 17 } as React.CSSProperties} onContextMenu={(e) => e.preventDefault()}>
      <header className="reader-top">
        <button onClick={() => nav(-1)} aria-label="Back" className="rt-btn"><Back width={22} /></button>
        <div className="rt-title">
          <b>{src?.name ?? 'Opening…'}</b>
          {src && <span>{KIND_LABEL[src.kind]} · by {publisher.name}</span>}
        </div>
        <span className="grow" />
        {kind && PAGED.includes(kind) && pages > 0 && !mobile && (
          <div className="rt-group rt-pages">
            <input aria-label="Page" inputMode="numeric" value={page} onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')); if (n) goTo(n); }} />
            <span>/ {pages}</span>
          </div>
        )}
        {zoomable && !mobile && (
          <div className="rt-group">
            <button className="rt-btn" onClick={() => step(-1)} aria-label="Zoom out" title="Zoom out (−)"><Minus /></button>
            <button className="rt-zoom" onClick={() => (kind === 'epub' ? savePrefs({ textSize: 17 }) : setZoom(1))} title="Reset">{zoomLabel}</button>
            <button className="rt-btn" onClick={() => step(1)} aria-label="Zoom in" title="Zoom in (+)"><Plus /></button>
          </div>
        )}
        <div className="rt-group">
          <button className="rt-btn" onClick={cycleTheme} aria-label={`Page colour: ${prefs.readerTheme}`} title="Page colour">{prefs.readerTheme === 'dark' ? <Moon /> : <Sun />}</button>
          {!mobile && !isNative && <button className="rt-btn" onClick={fullscreen} aria-label="Full screen" title="Full screen"><Expand /></button>}
        </div>
      </header>
      <div className="reader-main">
        <div className="reader-body" ref={body} onScroll={track}>
          {err ? <div className="page"><div className="note note-red">{err}</div></div>
            : !src ? <ReaderSkeleton progress={progress} label={progress > 0 && progress < 1 ? `Opening securely… ${Math.round(progress * 100)}%` : 'Opening your file securely…'} />
            : <div className={guard ? 'guarded' : ''} aria-hidden={!!guard} style={{ height: '100%' }}><Render src={src} view={view} /></div>}
          {guard && (
            <div className="guard-cover" role="alert" onClick={() => window.focus()}>
              <div className="guard-card"><b>{guardMessage[guard].title}</b><span>{guardMessage[guard].body}</span></div>
            </div>
          )}
        </div>
        {leak && src && <div className="leak-mark" aria-hidden style={{ backgroundImage: `url("${leak}")`, backgroundSize: `${TILE}px`, opacity: STRENGTH }} />}
      </div>
    </div>
  );
}

// Watermark (when the admin turns it on for this platform): drawn into PDF/image pixels,
// tiled over each page box (.wm-box) for the HTML-rendered types.
function Render({ src, view }: { src: Source; view: View }) {
  const { mark } = view;
  const style = mark ? ({ '--wm': mark.tile, '--wm-dark': mark.tileDark } as React.CSSProperties) : undefined;
  const body = (() => {
    switch (src.kind) {
      case 'epub': return <Epub blob={src.blob!} />;
      case 'pdf': return <Pdf blob={src.blob!} view={view} />;
      case 'video': return <Video src={src} />;
      case 'image': return <ImageView blob={src.blob!} view={view} />;
      case 'docx': return <Docx blob={src.blob!} view={view} />;
      case 'xlsx': return <Sheet blob={src.blob!} view={view} />;
      case 'pptx': return <Slides blob={src.blob!} view={view} />;
      default: return <div className="page"><div className="note note-slate">This file type can't be previewed in the reader.</div></div>;
    }
  })();
  return <div className={mark ? 'wm' : undefined} style={{ ...style, height: '100%' }}>{body}</div>;
}

const EPUB_COLORS = { light: ['#ffffff', '#1f2937'], sepia: ['#f4ecd8', '#433422'], dark: ['#111827', '#e5e7eb'] } as const;
type Rendition = { prev: () => void; next: () => void; display: (h?: string) => Promise<void>; themes: { override: (k: string, v: string) => void; default: (s: object) => void }; on: (e: string, f: (l: { start: { href: string; index: number } }) => void) => void };

/** E-books: real pages with a two-page spread on wide screens, arrows or ←/→ to turn. */
function Epub({ blob }: { blob: Blob }) {
  const el = useRef<HTMLDivElement>(null);
  const { prefs } = usePrefs();
  const mobile = useIsMobile();
  const rendition = useRef<Rendition | null>(null);
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  const [toc, setToc] = useState<{ href: string; label: string }[]>([]);
  const [at, setAt] = useState({ href: '', index: 0, total: 1 });
  // page colour + text size follow the reader's own settings, even while a book is open
  useEffect(() => {
    const r = rendition.current; if (!r) return;
    const [bg, fg] = EPUB_COLORS[prefs.readerTheme];
    r.themes.override('background', bg); r.themes.override('color', fg); r.themes.override('font-size', `${prefs.textSize}px`);
  }, [prefs.readerTheme, prefs.textSize]);
  useEffect(() => {
    let book: { destroy: () => void } | null = null;
    let alive = true;
    (async () => {
      const ePub = (await import('epubjs')).default;
      const data = await blob.arrayBuffer();
      if (!alive) return; // closed (or re-mounted) while loading: don't render a second copy
      const b = ePub(data);
      book = b;
      const r = b.renderTo(el.current!, { width: '100%', height: '100%', flow: 'paginated', spread: mobile ? 'none' : 'auto', minSpreadWidth: 900, allowScriptedContent: false }) as unknown as Rendition;
      r.themes.default({ body: { 'font-family': 'Georgia, "Iowan Old Style", serif !important', 'line-height': '1.75', padding: '0 12px', 'user-select': 'none' }, 'h1, h2, h3': { 'font-family': 'Inter, system-ui, sans-serif !important', 'line-height': '1.3' } });
      rendition.current = r;
      const [bg, fg] = EPUB_COLORS[prefsRef.current.readerTheme];
      r.themes.override('background', bg); r.themes.override('color', fg); r.themes.override('font-size', `${prefsRef.current.textSize}px`);
      const total = (b as unknown as { spine: { length: number } }).spine.length || 1;
      r.on('relocated', (l) => setAt({ href: l.start.href, index: l.start.index, total }));
      await r.display();
      const nav = await b.loaded.navigation;
      setToc(nav.toc.map((t: { href: string; label: string }) => ({ href: t.href, label: t.label.trim() })));
    })();
    return () => { alive = false; book?.destroy(); };
  }, [blob, mobile]);
  const chapter = toc.find((t) => at.href && t.href.split('#')[0]!.endsWith(at.href.split('/').pop()!));
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('textarea, input, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') rendition.current?.next();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') rendition.current?.prev();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="epub-view">
      <div className="epub-stage">
        <button className="epub-turn" onClick={() => rendition.current?.prev()} aria-label="Previous page">‹</button>
        <div className="epub-book wm-box"><div ref={el} style={{ height: '100%' }} /></div>
        <button className="epub-turn" onClick={() => rendition.current?.next()} aria-label="Next page">›</button>
      </div>
      <div className="epub-foot">
        {toc.length > 0 && (
          <select className="input" value={chapter?.href ?? ''} onChange={(e) => rendition.current?.display(e.target.value)} aria-label="Chapters">
            {!chapter && <option value="">Contents</option>}
            {toc.map((t) => <option key={t.href} value={t.href}>{t.label}</option>)}
          </select>
        )}
        {at.total > 1 ? (
          <>
            <div className="epub-progress" aria-label="Progress through the book"><span style={{ width: `${Math.round(((at.index + 1) / at.total) * 100)}%` }} /></div>
            <span className="small muted">Part {at.index + 1} of {at.total}</span>
          </>
        ) : <span className="grow" />}
        <span className="small muted hide-sm">← → to turn pages</span>
      </div>
    </div>
  );
}

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

function Pdf({ blob, view }: { blob: Blob; view: View }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [ratio, setRatio] = useState(1.414);
  useEffect(() => {
    let alive = true;
    let loaded: PdfDoc | null = null;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      loaded = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl: import.meta.env.BASE_URL + 'pdfjs/standard_fonts/' }).promise;
      const first = (await loaded.getPage(1)).getViewport({ scale: 1 });
      if (!alive) return loaded.destroy();
      setRatio(first.height / first.width); setDoc(loaded); view.onPages(loaded.numPages);
    })();
    return () => { alive = false; loaded?.destroy(); };
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc) return <ReaderSkeleton progress={1} label="Preparing pages…" />;
  const width = Math.round(view.fit * view.zoom);
  return <div className="pdf-pages">{Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} width={width} ratio={ratio} view={view} />)}</div>;
}

/** One page: drawn only when near the screen, redrawn when the zoom changes. */
function PdfPage({ doc, n, width, ratio, view }: { doc: PdfDoc; n: number; width: number; ratio: number; view: View }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(n <= 2);
  const [h, setH] = useState(Math.round(width * ratio));
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => { if (e!.isIntersecting) setNear(true); }, { rootMargin: '1200px 0px' });
    io.observe(box.current!);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let alive = true;
    doc.getPage(n).then((page) => {
      if (!alive || !canvas.current) return;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (width / base.width) * Math.min(2, window.devicePixelRatio || 1) });
      setH(Math.round(width * (base.height / base.width)));
      canvas.current.width = vp.width; canvas.current.height = vp.height;
      task = page.render({ canvasContext: canvas.current.getContext('2d')!, viewport: vp });
      task.promise.then(() => { if (alive && canvas.current) stampCanvas(canvas.current, view.mark); }).catch(() => undefined);
    });
    return () => { alive = false; task?.cancel(); };
  }, [doc, n, width, near, view.mark]);
  return (
    <div ref={box} className="reader-page pdf-page" data-page={n} style={{ width, height: h }}>
      <canvas ref={canvas} className="content" style={{ width: '100%', height: '100%', display: 'block' }} aria-label={`Page ${n}`} />
      <span className="page-no">{n}</span>
    </div>
  );
}

function Video({ src }: { src: Source }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v || !src.blob) return;
    const u = URL.createObjectURL(src.blob);
    v.src = u;
    // Drop the blob: URL once the player has the data, so it can't be opened or saved from DevTools.
    const drop = () => URL.revokeObjectURL(u);
    v.addEventListener('loadeddata', drop, { once: true });
    return () => { drop(); v.removeAttribute('src'); v.load(); };
  }, [src.blob]);
  return (
    <div className="video-stage wm-box wm-dark">
      <video ref={ref} controls autoPlay playsInline controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback
        onContextMenu={(e) => e.preventDefault()} />
    </div>
  );
}

/** Images are painted onto a canvas: no <img> element or URL to "Save image as". */
function ImageView({ blob, view }: { blob: Blob; view: View }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(0.75);
  useEffect(() => {
    createImageBitmap(blob).then((bmp) => {
      const c = ref.current; if (!c) return;
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      stampCanvas(c, view.mark);
      setRatio(bmp.height / bmp.width);
    });
  }, [blob, view.mark]);
  const width = Math.round(view.fit * view.zoom);
  return (
    <div className="pdf-pages">
      <div className="reader-page pdf-page" style={{ width, height: Math.round(width * ratio) }}>
        <canvas ref={ref} className="content" style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </div>
  );
}

function Docx({ blob, view }: { blob: Blob; view: View }) {
  const el = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    import('docx-preview').then(({ renderAsync }) => renderAsync(blob, el.current!, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true }))
      .catch((e) => setErr('Could not render this Word file: ' + errMsg(e)));
  }, [blob]);
  return <div className="docx-view">{err && <div className="note note-red">{err}</div>}<div ref={el} className="reader-zoom" style={{ zoom: view.zoom * Math.min(1, view.fit / 820) }} /></div>;
}

/** Spreadsheets: Excel-style grid with row numbers, frozen header and sheet tabs at the bottom. */
function Sheet({ blob, view }: { blob: Blob; view: View }) {
  const [sheets, setSheets] = useState<{ name: string; html: string }[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    (async () => {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await blob.arrayBuffer());
      setSheets(wb.SheetNames.map((n) => ({ name: n, html: XLSX.utils.sheet_to_html(wb.Sheets[n]!, { header: '', footer: '' }) })));
    })();
  }, [blob]);
  return (
    <div className="sheet-view">
      {sheets[active] && <div className="sheet-scroll wm-box"><div className="sheet reader-zoom" style={{ zoom: view.zoom }} dangerouslySetInnerHTML={{ __html: sheets[active].html }} /></div>}
      {sheets.length > 0 && (
        <div className="sheet-tabs" role="tablist">
          {sheets.map((s, i) => <button key={s.name} role="tab" aria-selected={i === active} className={i === active ? 'on' : ''} onClick={() => setActive(i)}>{s.name}</button>)}
        </div>
      )}
    </div>
  );
}

type Slide = { title: string; lines: string[]; images: string[] };

/** PowerPoint: rebuilds each slide (title, bullets, pictures) from the .pptx, works offline. */
function Slides({ blob, view }: { blob: Blob; view: View }) {
  const [slides, setSlides] = useState<Slide[]>([]);
  useEffect(() => {
    const urls: string[] = [];
    (async () => {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(blob);
      const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
      const out: Slide[] = [];
      for (const n of names) {
        const xml = new DOMParser().parseFromString(await zip.file(n)!.async('string'), 'application/xml');
        const paras = [...xml.getElementsByTagName('a:p')].map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join('')).filter((t) => t.trim());
        // pictures: r:embed ids on a:blip, resolved through the slide's .rels
        const images: string[] = [];
        const rels = await zip.file(n.replace('slides/', 'slides/_rels/') + '.rels')?.async('string');
        if (rels) {
          const map = new Map([...new DOMParser().parseFromString(rels, 'application/xml').getElementsByTagName('Relationship')].map((r) => [r.getAttribute('Id'), r.getAttribute('Target')]));
          for (const blip of [...xml.getElementsByTagName('a:blip')].slice(0, 2)) {
            const target = map.get(blip.getAttribute('r:embed'));
            const file = target && zip.file('ppt/' + target.replace(/^\.\.\//, ''));
            if (file && /\.(png|jpe?g|gif|webp)$/i.test(target!)) { const u = URL.createObjectURL(await file.async('blob')); urls.push(u); images.push(u); }
          }
        }
        out.push({ title: paras[0] ?? '', lines: paras.slice(1), images });
      }
      setSlides(out); view.onPages(out.length);
    })();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [blob]); // eslint-disable-line react-hooks/exhaustive-deps
  const width = Math.round(Math.min(view.fit, 1000) * view.zoom);
  return (
    <div className="pdf-pages">
      {slides.map((s, i) => {
        return (
          <div key={i} className="slide2 wm-box" data-page={i + 1} style={{ width, height: Math.round(width * 9 / 16), fontSize: width / 48 }}>
            <div className={`slide2-body${s.images.length ? ' with-pic' : ''}`}>
              <div className="col" style={{ gap: '0.6em', minWidth: 0 }}>
                {s.title && <h2>{s.title}</h2>}
                {s.lines.length > 0 && <ul>{s.lines.map((t, j) => <li key={j}>{t}</li>)}</ul>}
              </div>
              {s.images.length > 0 && <div className="slide2-pics">{s.images.map((u) => <div key={u} style={{ backgroundImage: `url("${u}")` }} />)}</div>}
            </div>
            <span className="page-no">{i + 1} / {slides.length}</span>
          </div>
        );
      })}
    </div>
  );
}
