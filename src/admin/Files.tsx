import { useMemo, useRef, useState } from 'react';
import { supabase, coverUrl } from '../lib/supabase';
import { must, useLoad } from '../lib/useLoad';
import { bytes, errMsg, pesoShort } from '../lib/format';
import { KIND_LABEL, KIND_TAG, kindFromName, type FileKind, type LibFile } from '../lib/types';
import { AdminLayout } from '../components/Layouts';
import { Loading, Modal, Toggle, useConfirm, useIsMobile, useToast } from '../components/ui';
import { Search, Upload } from '../components/Icons';

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
      <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Upload file</button></>}>
      <div className="chips">
        <button className={`chip${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>All {data?.files.length ?? ''}</button>
        {(['epub', 'pdf', 'video', 'image', 'docx', 'pptx', 'xlsx'] as FileKind[]).map((k) => <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
      </div>
      {loading ? <Loading /> : (
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
              <b style={{ width: 90 }}>{pesoShort(f.price)}</b>
              <span style={{ width: 60 }} className="r-sales">{data?.sales.get(f.id) ?? 0}<i className="r-sold"> sold</i></span>
              <span style={{ width: 130 }}>{f.published ? <span className="badge b-ok">Published</span> : <span className="badge b-lock">Draft</span>}</span>
              <span className="grow" />
              <button className="btn btn-sm" onClick={() => setEditing(f)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => remove(f)}>Delete</button>
            </div>
          ))}
          {shown.length === 0 && <div className="tr muted">No files yet. Upload your first one.</div>}
        </div>
      )}
      {editing && <FileEditor file={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </AdminLayout>
  );
}

function FileEditor({ file, onClose, onSaved }: { file: LibFile | null; onClose: () => void; onSaved: () => void }) {

  const toast = useToast();
  const [f, setF] = useState({
    name: file?.name ?? '', label: file?.label ?? '', description: file?.description ?? '', price: String(file?.price ?? ''),
    meta: file?.meta ?? '', published: file?.published ?? true,
  });
  const [upload, setUpload] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const fileIn = useRef<HTMLInputElement>(null);
  const coverIn = useRef<HTMLInputElement>(null);
  const coverPreview = useMemo(() => (cover ? URL.createObjectURL(cover) : file?.cover_path ? coverUrl(file.cover_path) : null), [cover, file]);

  function pickFile(x?: File | null) {
    if (!x) return;
    setUpload(x);
    if (!f.name) setF((s) => ({ ...s, name: x.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }));
  }

  async function save() {
    if (!f.name.trim()) return setErr('Give the file a name.');
    if (f.price === '' || Number.isNaN(Number(f.price))) return setErr('Enter a price (0 for free).');
    if (!file && !upload) return setErr('Choose the file to upload.');
    setErr('');
    try {
      const base = slug(f.name) + '-' + Date.now().toString(36);
      const row: Partial<LibFile> = { name: f.name.trim(), label: f.label.trim(), description: f.description.trim(), price: Number(f.price), meta: f.meta.trim(), published: f.published };
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
      toast(file ? 'File updated.' : 'File uploaded.');
      onSaved();
    } catch (e) { setErr(errMsg(e)); setBusy(''); }
  }

  return (
    <Modal onClose={busy ? undefined : onClose} width={780}>
      <div className="spread"><h2>{file ? 'Edit file' : 'Upload file'}</h2><button className="muted" style={{ fontSize: 22 }} onClick={onClose} aria-label="Close">×</button></div>
      <div className="drop" style={{ minHeight: 110 }} onClick={() => fileIn.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); }}>
        <Upload />
        <b>{upload ? `${upload.name} · ${bytes(upload.size)}` : file ? `Current: ${file.storage_path ?? 'none'} · drop a new file to replace it` : 'Drop any file here: PDF, EPUB, video, images, Word, PowerPoint, Excel'}</b>
        <span className="small">Stored privately. Buyers can only open it after you confirm their payment.</span>
      </div>
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
            <div className="field grow"><label htmlFor="flabel">Label / category</label><input id="flabel" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="e.g. Pharmacology" /></div>
            <div className="field" style={{ width: 150 }}><label htmlFor="fprice">Price (₱)</label><input id="fprice" className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor="fdesc">Description</label><textarea id="fdesc" className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="field"><label htmlFor="fmeta">Length (shown on the card)</label><input id="fmeta" className="input" value={f.meta} onChange={(e) => setF({ ...f, meta: e.target.value })} placeholder="e.g. 320 pages, 2h 14m, 62 slides" /></div>
          <div className="note note-blue"><span>Buyers can only view this file inside MedNotes. It is never downloadable.</span></div>
          <div className="card setting" style={{ padding: '12px 14px' }}><div className="col" style={{ gap: 0 }}><b>Published</b><span className="small muted">Visible in the library</span></div><Toggle on={f.published} onChange={(v) => setF({ ...f, published: v })} label="Published" /></div>
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
