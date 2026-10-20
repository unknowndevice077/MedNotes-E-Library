import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { deviceLabel, isNative } from '../lib/platform';
import { errMsg } from '../lib/format';
import { isSaved, listSaved, offlineExpired, readOffline } from '../lib/offline';
import type { FileKind, LibFile } from '../lib/types';
import { Loading } from '../components/ui';
import { fetchSecureFile } from '../lib/secureFile';
import { guardMessage, useContentGuard } from '../lib/contentGuard';
import { blockScreenshots } from '../lib/screenGuard';
import { Back } from '../components/Icons';

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

export default function Reader() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { profile, settings, session } = useAuth();
  const [src, setSrc] = useState<Source | null>(null);
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState(0);
  const guard = useContentGuard(!!src);
  const email = profile?.email ?? session?.user.email ?? '';

  useEffect(() => {
    loadSource(id!, sp.get('offline') === '1', settings?.offline_days ?? 30, setProgress).then(setSrc).catch((e) => setErr(errMsg(e)));
  }, [id, sp, settings?.offline_days]);

  // Android: block screenshots/recording only while paid content is on screen (Restrictions setting).
  useEffect(() => {
    if (settings?.block_screenshots === false) return;
    blockScreenshots(true);
    return () => { blockScreenshots(false); };
  }, [settings?.block_screenshots]);

  const mark = `${email} · ${deviceLabel()}`;
  return (
    <div className="reader" onContextMenu={(e) => e.preventDefault()}>
      <div className="reader-top">
        <button onClick={() => nav(-1)} aria-label="Back" className="row" style={{ gap: 6, fontWeight: 600 }}><Back width={22} /><span style={{ maxWidth: '60vw', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src?.name ?? 'Opening…'}</span></button>
        <span className="grow" />
        <span className="badge b-lock hide-sm">Read in MedNotes only</span>
      </div>
      <div className="reader-body">
        {err ? <div className="page"><div className="note note-red">{err}</div></div>
          : !src ? <Loading label={progress > 0 && progress < 1 ? `Opening securely… ${Math.round(progress * 100)}%` : 'Opening your file securely…'} />
          : <div className={guard ? 'guarded' : ''} aria-hidden={!!guard}><Render src={src} /></div>}
        {guard && (
          <div className="guard-cover" role="alert" onClick={() => window.focus()}>
            <div className="guard-card"><b>{guardMessage[guard].title}</b><span>{guardMessage[guard].body}</span></div>
          </div>
        )}
      </div>
      {(settings?.watermark ?? true) && src && (
        <div className="watermark" aria-hidden>{Array.from({ length: 24 }, (_, i) => <span key={i}>{mark}</span>)}</div>
      )}
    </div>
  );
}

function Render({ src }: { src: Source }) {
  switch (src.kind) {
    case 'epub': return <Epub blob={src.blob!} />;
    case 'pdf': return <Pdf blob={src.blob!} />;
    case 'video': return <Video src={src} />;
    case 'image': return <ImageView blob={src.blob!} />;
    case 'docx': return <Docx blob={src.blob!} />;
    case 'xlsx': return <Sheet blob={src.blob!} />;
    case 'pptx': return <Slides blob={src.blob!} />;
    default: return <div className="page"><div className="note note-slate">This file type can't be previewed in the reader.</div></div>;
  }
}


function Epub({ blob }: { blob: Blob }) {
  const el = useRef<HTMLDivElement>(null);
  const rendition = useRef<{ prev: () => void; next: () => void; display: (h?: string) => void } | null>(null);
  const [toc, setToc] = useState<{ href: string; label: string }[]>([]);
  useEffect(() => {
    let book: { destroy: () => void } | null = null;
    (async () => {
      const ePub = (await import('epubjs')).default;
      const b = ePub(await blob.arrayBuffer());
      book = b;
      const r = b.renderTo(el.current!, { width: '100%', height: '100%', flow: 'scrolled-doc', allowScriptedContent: false });
      r.themes.default({ body: { 'font-family': 'Inter, system-ui, sans-serif !important', 'line-height': '1.7', 'font-size': '17px', padding: '0 8px', 'user-select': 'none' } });
      rendition.current = r;
      await r.display();
      const nav = await b.loaded.navigation;
      setToc(nav.toc.map((t: { href: string; label: string }) => ({ href: t.href, label: t.label.trim() })));
    })();
    return () => book?.destroy();
  }, [blob]);
  return (
    <div className="reader-page col" style={{ height: 'calc(100% - 48px)', padding: 0, gap: 0 }}>
      {toc.length > 0 && (
        <select className="input" style={{ borderRadius: 0, border: 'none', borderBottom: '1px solid var(--line)' }} onChange={(e) => rendition.current?.display(e.target.value)} aria-label="Chapters">
          {toc.map((t) => <option key={t.href} value={t.href}>{t.label}</option>)}
        </select>
      )}
      <div ref={el} style={{ flex: 1, minHeight: 0 }} />
      <div className="spread" style={{ padding: 10, borderTop: '1px solid var(--line)' }}>
        <button className="btn btn-sm" onClick={() => rendition.current?.prev()}>← Previous</button>
        <button className="btn btn-sm" onClick={() => rendition.current?.next()}>Next →</button>
      </div>
    </div>
  );
}

type PdfDoc = import('pdfjs-dist').PDFDocumentProxy;

function Pdf({ blob }: { blob: Blob }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  useEffect(() => {
    let alive = true;
    let loaded: PdfDoc | null = null;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      loaded = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl: import.meta.env.BASE_URL + 'pdfjs/standard_fonts/' }).promise;
      if (alive) setDoc(loaded); else loaded.destroy();
    })();
    return () => { alive = false; loaded?.destroy(); };
  }, [blob]);
  if (!doc) return <Loading />;
  return <div style={{ padding: '0 12px 24px' }}>{Array.from({ length: doc.numPages }, (_, i) => <PdfPage key={i} doc={doc} n={i + 1} />)}</div>;
}

function PdfPage({ doc, n }: { doc: PdfDoc; n: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let alive = true;
    doc.getPage(n).then((page) => {
      if (!alive || !canvas.current) return;
      const width = Math.min(820, canvas.current.parentElement?.clientWidth || 820);
      const vp = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * (window.devicePixelRatio || 1) });
      canvas.current.width = vp.width; canvas.current.height = vp.height;
      task = page.render({ canvasContext: canvas.current.getContext('2d')!, viewport: vp });
      task.promise.catch(() => undefined);
    });
    return () => { alive = false; task?.cancel(); };
  }, [doc, n]);
  return <div className="reader-page"><canvas ref={canvas} style={{ width: '100%', display: 'block' }} aria-label={`Page ${n}`} /></div>;
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
    <div className="center" style={{ height: '100%', background: '#0b1220' }}>
      <video ref={ref} controls autoPlay playsInline controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback
        onContextMenu={(e) => e.preventDefault()} style={{ maxWidth: '100%', maxHeight: '100%' }} />
    </div>
  );
}

/** Images are painted onto a canvas: no <img> element or URL to "Save image as". */
function ImageView({ blob }: { blob: Blob }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    createImageBitmap(blob).then((bmp) => {
      const c = ref.current; if (!c) return;
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
    });
  }, [blob]);
  return <div className="center" style={{ padding: 16 }}><canvas ref={ref} style={{ maxWidth: '100%', borderRadius: 8 }} /></div>;
}

function Docx({ blob }: { blob: Blob }) {
  const el = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    import('docx-preview').then(({ renderAsync }) => renderAsync(blob, el.current!, undefined, { inWrapper: true, ignoreLastRenderedPageBreak: true }))
      .catch((e) => setErr('Could not render this Word file: ' + errMsg(e)));
  }, [blob]);
  return <div style={{ padding: 12 }}>{err && <div className="note note-red">{err}</div>}<div ref={el} /></div>;
}

function Sheet({ blob }: { blob: Blob }) {
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
    <div className="page">
      <div className="chips">{sheets.map((s, i) => <button key={s.name} className={`chip${i === active ? ' on' : ''}`} onClick={() => setActive(i)}>{s.name}</button>)}</div>
      {sheets[active] && <div className="sheet" style={{ overflow: 'auto' }} dangerouslySetInnerHTML={{ __html: sheets[active].html }} />}
    </div>
  );
}

/** PowerPoint: rebuilds each slide's text from the .pptx (works offline, no third-party viewer). */
function Slides({ blob }: { blob: Blob }) {
  const [slides, setSlides] = useState<string[][]>([]);
  useEffect(() => {
    (async () => {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(blob);
      const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
      const out: string[][] = [];
      for (const n of names) {
        const xml = new DOMParser().parseFromString(await zip.file(n)!.async('string'), 'application/xml');
        const paras = [...xml.getElementsByTagName('a:p')].map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join('')).filter((t) => t.trim());
        out.push(paras);
      }
      setSlides(out);
    })();
  }, [blob]);
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      {slides.map((paras, i) => (
        <div key={i} className="slide col" style={{ gap: 10 }}>
          <b style={{ fontSize: 'clamp(18px, 3vw, 30px)' }}>{paras[0]}</b>
          <ul style={{ paddingLeft: 22, color: 'var(--slate-700)', fontSize: 'clamp(13px, 1.8vw, 18px)' }}>{paras.slice(1).map((t, j) => <li key={j}>{t}</li>)}</ul>
          <span className="small muted" style={{ position: 'absolute', right: 14, bottom: 10 }}>{i + 1} / {slides.length}</span>
        </div>
      ))}
    </div>
  );
}
