import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { pesoShort } from '../lib/format';
import { KIND_LABEL, type FileKind, type LibFile, type Purchase } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import { Cover, Empty, Loading } from '../components/ui';
import { Search } from '../components/Icons';

const KINDS: FileKind[] = ['epub', 'pdf', 'video', 'image', 'docx', 'pptx', 'xlsx'];

export default function Library() {
  const { session } = useAuth();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<FileKind | 'all'>('all');
  const [label, setLabel] = useState<string | null>(null);
  const [sort, setSort] = useState<'new' | 'price' | 'name'>('new');
  const { data, loading, error } = useLoad(async () => {
    const [files, mine] = await Promise.all([
      supabase.from('files').select('*').eq('published', true).order('created_at', { ascending: false }),
      supabase.from('purchases').select('file_id,status').eq('user_id', session!.user.id),
    ]);
    return { files: must(files) as LibFile[], mine: must(mine) as Pick<Purchase, 'file_id' | 'status'>[] };
  }, [session?.user.id]);

  const status = useMemo(() => {
    const m = new Map<string, Purchase['status']>();
    for (const p of data?.mine ?? []) if (m.get(p.file_id) !== 'confirmed') m.set(p.file_id, p.status);
    return m;
  }, [data]);
  const labels = useMemo(() => [...new Set((data?.files ?? []).map((f) => f.label).filter(Boolean))].sort(), [data]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (data?.files ?? []).filter((f) => (kind === 'all' || f.kind === kind) && (!label || f.label === label)
      && (!s || `${f.name} ${f.label} ${f.description}`.toLowerCase().includes(s)));
    if (sort === 'price') list.sort((a, b) => a.price - b.price);
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [data, q, kind, label, sort]);

  return (
    <ClientLayout>
      <div className="page">
        <div className="spread wrap">
          <div className="col" style={{ gap: 4 }}><h1>Library</h1><span className="muted">{data?.files.length ?? 0} files · free cover preview on every file</span></div>
          <div className="row">
            <label className="search" style={{ width: 'min(420px, 100%)' }}><Search width={18} color="var(--slate-400)" />
              <input placeholder="Search notes, books, lectures…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></label>
            <select className="input hide-sm" style={{ width: 160 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
              <option value="new">Newest</option><option value="price">Lowest price</option><option value="name">A–Z</option>
            </select>
          </div>
        </div>
        <div className="chips">
          <button className={`chip${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>All</button>
          {KINDS.map((k) => <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
          {labels.length > 0 && <span style={{ width: 16, flexShrink: 0 }} />}
          {labels.map((l) => <button key={l} className={`chip${label === l ? ' on' : ''}`} onClick={() => setLabel(label === l ? null : l)}>{l}</button>)}
        </div>
        {loading ? <Loading /> : error ? <Empty title="Couldn't load the library">{error}</Empty> : shown.length === 0 ? <Empty title="No files match">Try another search or filter.</Empty> : (
          <div className="grid">
            {shown.map((f) => {
              const st = status.get(f.id);
              return (
                <Link key={f.id} to={`/file/${f.id}`} className="bookcard">
                  <Cover file={f} locked={st !== 'confirmed'} owned={st === 'confirmed'} />
                  <h3 style={{ lineHeight: '20px' }}>{f.name}</h3>
                  <div className="spread">
                    <span className="small muted">{KIND_LABEL[f.kind]}{f.meta ? ` · ${f.meta}` : ''}</span>
                    {st === 'confirmed' ? <span className="badge b-ok">Unlocked</span> : st === 'pending' ? <span className="badge b-pending">Pending</span> : <span className="price">{pesoShort(f.price)}</span>}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </ClientLayout>
  );
}
