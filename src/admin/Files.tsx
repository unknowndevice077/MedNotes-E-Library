import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, coverUrl } from '../lib/supabase';
import { must, useLoad } from '../lib/useLoad';
import { bytes, errMsg, pesoShort } from '../lib/format';
import { KIND_LABEL, KIND_TAG, kindFromName, type FileKind, type LibFile } from '../lib/types';
import { detectLength } from '../lib/fileInfo';
import { dropDraft, getDraft, saveDraft } from '../lib/drafts';

// the upload form survives a refresh: fields, the chosen file and the cover (see lib/drafts)
const DRAFT = 'admin-file-editor';
type Fields = { name: string; label: string; description: string; price: string; meta: string; published: boolean; is_free: boolean };
type Draft = { fileId: string | null; f: Fields; upload: File | null; cover: File | null };
import CategoryPicker from '../components/CategoryPicker';
import SubjectsManager from './Subjects';
import { reloadSubjects } from '../lib/subjects';
import { AdminLayout } from '../components/Layouts';
import { Modal, Toggle, useConfirm, useIsMobile, useToast } from '../components/ui';
import { Search, Upload } from '../components/Icons';
import { RowsSkeleton } from '../components/Skeletons';

const ACCEPT = '.epub,.pdf,.mp4,.webm,.mov,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'file';

export default function AdminFiles() {
  const toast = useToast();
  const confirm = useConfirm();
  const mobile = useIsMobile();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<FileKind | 'all'>('all');
  const [editing, setEditing] = useState<LibFile | 'new' | null>(null);
  const { data, loading, reload } = useLoad(async () => {
    const [f, s] = await Promise.all([
      supabase.from('files').select('*').order('created_at', { ascending: false }),
      supabase.from('purchases').select('file_id').eq('status', 'confirmed'),
    ]);
    const sales = new Map<string, number>();
    for (const r of must(s) as { file_id: string }[]) sales.set(r.file_id, (sales.get(r.file_id) ?? 0) + 1);
    return { files: must(f) as LibFile[], sales };
  });
  // after a refresh, reopen the upload that was in progress
  const [restore, setRestore] = useState<Draft | null>(null);
  useEffect(() => {
    if (!data || restore !== null) return;
    getDraft<Draft>(DRAFT).then((d) => {
      if (!d) return setRestore(null);
      const target = d.fileId ? data.files.find((x) => x.id === d.fileId) : 'new';
      if (!target) { void dropDraft(DRAFT); return; }
      setRestore(d); setEditing(target);
    });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [subjects, setSubjects] = useState(false);
  const shown = useMemo(() => (data?.files ?? []).filter((f) => (kind === 'all' || f.kind === kind)
    && (!q || `${f.name} ${f.label}`.toLowerCase().includes(q.toLowerCase()))), [data, q, kind]);

  async function remove(f: LibFile) {
    if (!(await confirm({ title: `Delete "${f.name}"?`, body: "Buyers lose access and this can't be undone.", confirmLabel: 'Delete file', danger: true }))) return;
    const paths = [f.storage_path].filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from('files').remove(paths);
    if (f.cover_path) await supabase.storage.from('covers').remove([f.cover_path]);
    const { error } = await supabase.from('files').delete().eq('id', f.id);
    if (error) return toast(error.message);
    toast('File deleted.'); reload();
  }

  return (
    <AdminLayout title="Files" actions={<>
      {!mobile && <label className="search" style={{ width: 280 }}><Search width={18} color="var(--slate-400)" /><input placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} /></label>}
      <button className="btn" onClick={() => setSubjects(true)}>Subjects &amp; categories</button>
      <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Upload file</button></>}>
      {subjects && <SubjectsManager labels={(data?.files ?? []).map((f) => f.label ?? '')} onClose={() => setSubjects(false)} onChanged={reload} />}
      <div className="chips">
        <button className={`chip${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>All {data?.files.length ?? ''}</button>
        {(['epub', 'pdf', 'video', 'image', 'docx', 'pptx', 'xlsx'] as FileKind[]).map((k) => <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
      </div>
      {loading ? <RowsSkeleton rows={8} /> : (
        <div className="table rtable">
          <div className="tr th hide-sm"><span style={{ width: 340 }}>Name</span><span style={{ width: 130 }}>Label</span><span style={{ width: 80 }}>Type</span><span style={{ width: 90 }}>Price</span><span style={{ width: 60 }}>Sales</span><span style={{ width: 130 }}>Status</span><span className="grow" /></div>
          {shown.map((f) => (
            <div key={f.id} className="tr">
              <div className="row" style={{ width: mobile ? '100%' : 340 }}>
                <span className="thumb"><img src={coverUrl(f.cover_path)} alt="" /></span>
                <div className="col grow" style={{ gap: 0 }}><b>{f.name}{!f.published && <span className="badge b-lock" style={{ marginLeft: 8 }}>Draft</span>}</b><span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{f.description}</span></div>
              </div>
              <span style={{ width: 130 }}>{f.label && <span className="badge b-blue">{f.label}</span>}</span>
              <span style={{ width: 80 }}>{KIND_TAG[f.kind]}</span>
              <b style={{ width: 90 }}>{f.is_free ? <span className="badge b-free">Free</span> : pesoShort(f.price)}</b>
              <span style={{ width: 60 }} className="r-sales">{data?.sales.get(f.id) ?? 0}<i className="r-sold"> sold</i></span>
              <span style={{ width: 130 }}>{f.published ? <span className="badge b-ok">Published</span> : <span className="badge b-lock">Hidden</span>}</span>
              <span className="grow" />
              <button className="btn btn-sm" onClick={() => setEditing(f)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => remove(f)}>Delete</button>
            </div>
          ))}
          {shown.length === 0 && <div className="tr muted">No files yet. Upload your first one.</div>}
        </div>
      )}
      {editing && <FileEditor file={editing === 'new' ? null : editing} restored={restore} onClose={() => { setEditing(null); setRestore(null); }} onSaved={() => { setEditing(null); setRestore(null); reload(); }} />}
    </AdminLayout>
  );
}

function FileEditor({ file, restored, onClose: close, onSaved: saved }: { file: LibFile | null; restored: Draft | null; onClose: () => void; onSaved: () => void }) {

  const toast = useToast();
  const [f, setF] = useState<Fields>(restored?.f ?? {
    name: file?.name ?? '', label: file?.label ?? '', description: file?.description ?? '', price: String(file?.price ?? ''),
    meta: file?.meta ?? '', published: file?.published ?? true, is_free: file?.is_free ?? false,
  });
  const [detecting, setDetecting] = useState<'' | 'busy' | 'done' | 'failed'>('');
  const [upload, setUpload] = useState<File | null>(restored?.upload ?? null);
  const [cover, setCover] = useState<File | null>(restored?.cover ?? null);
  // keep a draft while the form is open; cancelling or saving clears it
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; if (!restored) return; }
    const t = setTimeout(() => void saveDraft(DRAFT, { fileId: file?.id ?? null, f, upload, cover } satisfies Draft), 300);
    return () => clearTimeout(t);
  }, [f, upload, cover]); // eslint-disable-line react-hooks/exhaustive-deps
  const onClose = () => { void dropDraft(DRAFT); close(); };
  const onSaved = () => { void dropDraft(DRAFT); saved(); };
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const fileIn = useRef<HTMLInputElement>(null);
  const coverIn = useRef<HTMLInputElement>(null);
  const coverPreview = useMemo(() => (cover ? URL.createObjectURL(cover) : file?.cover_path ? coverUrl(file.cover_path) : null), [cover, file]);

  function pickFile(x?: File | null) {
    if (!x) return;
    setUpload(x);
    if (!f.name) setF((s) => ({ ...s, name: x.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }));
    // count pages / slides / sheets / running time from the file itself
    setDetecting('busy');
    detectLength(x, kindFromName(x.name, x.type)).then((meta) => {
      if (meta) { setF((s) => ({ ...s, meta })); setDetecting('done'); } else setDetecting('failed');
    });
  }

  async function save() {
    if (!f.name.trim()) return setErr('Give the file a name.');
    if (!f.is_free && (f.price === '' || Number.isNaN(Number(f.price)) || Number(f.price) <= 0)) return setErr('Enter a price, or turn on Free to read.');
    if (!file && !upload) return setErr('Choose the file to upload.');
    setErr('');
    try {
      const base = slug(f.name) + '-' + Date.now().toString(36);
      const row: Partial<LibFile> = { name: f.name.trim(), label: f.label.trim(), description: f.description.trim(), price: f.is_free ? 0 : Number(f.price), meta: f.meta.trim(), published: f.published, is_free: f.is_free };
      if (upload) {
        setBusy('Uploading file…');
        const ext = upload.name.split('.').pop()!.toLowerCase();
        const path = `${base}.${ext}`;
        const up = await supabase.storage.from('files').upload(path, upload, { contentType: upload.type || undefined });
        if (up.error) throw up.error;
        if (file?.storage_path) await supabase.storage.from('files').remove([file.storage_path]);
        Object.assign(row, { storage_path: path, kind: kindFromName(upload.name, upload.type), mime: upload.type || 'application/octet-stream', size_bytes: upload.size });
      }
      if (cover) {
        setBusy('Uploading cover…');
        const path = `${base}-cover.${cover.name.split('.').pop()}`;
        const up = await supabase.storage.from('covers').upload(path, cover, { contentType: cover.type });
        if (up.error) throw up.error;
        if (file?.cover_path) await supabase.storage.from('covers').remove([file.cover_path]);
        row.cover_path = path;
      }
      setBusy('Saving…');
      const res = file ? await supabase.from('files').update({ ...row, updated_at: new Date().toISOString() }).eq('id', file.id) : await supabase.from('files').insert(row);
      if (res.error) throw res.error;
      // a subject typed in here joins the Subjects & categories list
      if (row.label && !(await reloadSubjects()).some((x) => x.name.toLowerCase() === row.label!.toLowerCase())) { await supabase.from('subjects').insert({ name: row.label }); void reloadSubjects(); }
      toast(file ? 'File updated.' : 'File uploaded.');
      onSaved();
    } catch (e) { setErr(errMsg(e)); setBusy(''); }
  }

  return (
    <Modal onClose={busy ? undefined : onClose} width={780}>
      <div className="spread"><h2>{file ? 'Edit file' : 'Upload file'}</h2><button className="muted" style={{ fontSize: 22 }} onClick={onClose} aria-label="Close">×</button></div>
      {restored && <div className="note note-blue"><span>Your unsaved {file ? 'changes were' : 'upload was'} restored after the page reloaded. Save to finish, or Cancel to discard.</span></div>}
      {upload || file?.storage_path ? (
        <div className="attached" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); }}>
          <FilePreview upload={upload} file={file} coverSrc={coverPreview} />
          <div className="col grow" style={{ gap: 3, minWidth: 0 }}>
            <span className="badge b-ok" style={{ alignSelf: 'flex-start' }}>{upload ? (file ? 'New file attached' : 'File attached') : 'Current file'}</span>
            <b className="ellipsis">{upload ? upload.name : file!.name}</b>
            <span className="small muted">{KIND_LABEL[upload ? kindFromName(upload.name, upload.type) : file!.kind]} · {bytes(upload ? upload.size : file!.size_bytes)}{f.meta ? ` · ${f.meta}` : ''}</span>
            <span className="small muted">Stored privately. Buyers can only open it after you confirm their payment.</span>
            <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
              <button type="button" className="btn btn-sm" onClick={() => fileIn.current?.click()}><Upload width={15} /> Replace file</button>
              {upload && <button type="button" className="btn btn-sm" onClick={() => { setUpload(null); setDetecting(''); if (fileIn.current) fileIn.current.value = ''; }}>{file ? 'Keep the current file' : 'Remove'}</button>}
            </div>
          </div>
        </div>
      ) : (
        <div className="drop" style={{ minHeight: 110 }} onClick={() => fileIn.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); }}>
          <Upload />
          <b>Drop any file here: PDF, EPUB, video, images, Word, PowerPoint, Excel</b>
          <span className="small">Stored privately. Buyers can only open it after you confirm their payment.</span>
        </div>
      )}
      <input ref={fileIn} type="file" accept={ACCEPT} hidden onChange={(e) => pickFile(e.target.files?.[0])} />
      <div className="row" style={{ alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
        <div className="col" style={{ width: 170, gap: 8 }}>
          <span className="label">Front page (free preview)</span>
          <div className="cover" style={{ cursor: 'pointer' }} onClick={() => coverIn.current?.click()}>
            {coverPreview ? <img src={coverPreview} alt="" /> : <span className="center small muted" style={{ height: '100%', padding: 12, textAlign: 'center' }}>Add a cover image (3:4)</span>}
          </div>
          <button className="btn btn-sm" onClick={() => coverIn.current?.click()}>{coverPreview ? 'Replace image' : 'Choose image'}</button>
          <input ref={coverIn} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && setCover(e.target.files[0])} />
        </div>
        <div className="col grow" style={{ gap: 14, minWidth: 260 }}>
          <div className="field"><label htmlFor="fname">Name</label><input id="fname" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="row wrap">
            <div className="field grow" style={{ minWidth: 220 }}><label htmlFor="flabel">Subject / category</label>
              <CategoryPicker id="flabel" value={f.label || null} onChange={(v) => setF((s) => ({ ...s, label: v ?? '' }))} allowCustom placeholder="Search or type a subject" /></div>
            <div className="field" style={{ width: 210 }}><label htmlFor="fprice">Price (₱)</label>
              <input id="fprice" className="input" inputMode="decimal" value={f.is_free ? 'Free' : f.price} disabled={f.is_free} onChange={(e) => setF({ ...f, price: e.target.value })} />
              <label className="row small" style={{ gap: 8, marginTop: 4 }}><Toggle on={f.is_free} onChange={(v) => setF({ ...f, is_free: v, price: v ? '0' : f.price === '0' ? '' : f.price })} label="Free to read" />
                <span>Free to read{f.is_free ? ': anyone signed in can read it' : ''}</span></label></div>
          </div>
          <div className="field"><label htmlFor="fdesc">Description</label><textarea id="fdesc" className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="field"><label htmlFor="fmeta">Length (shown on the card)
            {detecting === 'busy' && <span className="small muted"> · counting…</span>}
            {detecting === 'done' && <span className="small detected"> · detected from the file</span>}
            {detecting === 'failed' && <span className="small muted"> · couldn't count this one, type it in</span>}</label>
            <input id="fmeta" className="input" value={f.meta} onChange={(e) => { setF({ ...f, meta: e.target.value }); setDetecting(''); }} placeholder="Filled in automatically when you choose a file" /></div>
          <div className="card setting stack-sm" style={{ padding: '12px 14px' }}>
            <div className="col" style={{ gap: 0 }}><b>Visibility</b><span className="small muted">{f.published ? 'Shown in the library' : 'Hidden from buyers; only admins can see it'}</span></div>
            <div className="seg" role="radiogroup" aria-label="Visibility">
              <button type="button" role="radio" aria-checked={f.published} className={f.published ? 'on' : ''} onClick={() => setF({ ...f, published: true })}>Published</button>
              <button type="button" role="radio" aria-checked={!f.published} className={!f.published ? 'on' : ''} onClick={() => setF({ ...f, published: false })}>Hidden (draft)</button>
            </div>
          </div>
        </div>
      </div>
      {err && <span className="error">{err}</span>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onClose} disabled={!!busy}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!!busy}>{busy || (file ? 'Save changes' : 'Upload & publish')}</button>
      </div>
    </Modal>
  );
}

const TILE: Partial<Record<FileKind, string>> = { epub: '#7c3aed', pdf: '#dc2626', video: '#0f172a', image: '#0891b2', docx: '#2563eb', pptx: '#ea580c', xlsx: '#16a34a' };

/** What's attached: the picture, the first frame of a video, the first page of a PDF, or a file-type tile. */
function FilePreview({ upload, file, coverSrc }: { upload: File | null; file: LibFile | null; coverSrc: string | null }) {
  const kind = upload ? kindFromName(upload.name, upload.type) : file?.kind ?? 'other';
  const url = useMemo(() => (upload && (kind === 'image' || kind === 'video') ? URL.createObjectURL(upload) : null), [upload, kind]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdfDone, setPdfDone] = useState(false);
  useEffect(() => {
    setPdfDone(false);
    if (!upload || kind !== 'pdf') return;
    let alive = true;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await upload.arrayBuffer()) }).promise;
        const page = await doc.getPage(1);
        const vp = page.getViewport({ scale: 180 / page.getViewport({ scale: 1 }).width });
        const c = canvas.current; if (!alive || !c) return;
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        if (alive) setPdfDone(true);
        void doc.destroy();
      } catch { /* falls back to the tile */ }
    })();
    return () => { alive = false; };
  }, [upload, kind]);

  if (url && kind === 'image') return <div className="attached-thumb"><img src={url} alt="" /></div>;
  if (url && kind === 'video') return <div className="attached-thumb"><video src={`${url}#t=0.5`} muted playsInline preload="metadata" /><span className="attached-play">▶</span></div>;
  if (upload && kind === 'pdf') return <div className="attached-thumb paper"><canvas ref={canvas} style={{ display: pdfDone ? 'block' : 'none' }} />{!pdfDone && <Tile kind={kind} />}</div>;
  if (!upload && coverSrc) return <div className="attached-thumb"><img src={coverSrc} alt="" /></div>;
  return <div className="attached-thumb"><Tile kind={kind} /></div>;
}

const Tile = ({ kind }: { kind: FileKind }) => (
  <span className="attached-tile" style={{ background: TILE[kind] ?? '#475569' }}>{KIND_TAG[kind]}</span>
);
