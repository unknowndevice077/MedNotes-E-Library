import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { pesoShort } from '../lib/format';
import { KIND_LABEL, type FileKind, type LibFile, type Purchase } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import { Cover, Empty, useIsMobile } from '../components/ui';
import { ArrowRight, Book, Clock, Search } from '../components/Icons';
import { PreviewCard, useReveal } from '../components/BookPreview';

const KINDS: FileKind[] = ['epub', 'pdf', 'video', 'image', 'docx', 'pptx', 'xlsx'];
type Status = Purchase['status'] | undefined;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function BookCard({ f, status }: { f: LibFile; status: Status }) {
  return (
    <PreviewCard f={f} status={status}>
    <Link to={`/file/${f.id}`} className="bookcard">
      <Cover file={f} locked={status !== 'confirmed'} owned={status === 'confirmed'} />
      <div className="col" style={{ gap: 4 }}>
        <span className="eyebrow">{f.label || KIND_LABEL[f.kind]}</span>
        <h3 className="clamp-2">{f.name}</h3>
        <div className="spread">
          <span className="small muted">{KIND_LABEL[f.kind]}{f.meta ? ` · ${f.meta}` : ''}</span>
          {status === 'confirmed' ? <span className="badge b-ok">Unlocked</span>
            : status === 'pending' ? <span className="badge b-pending">Pending</span>
            : <span className="price-pill">{pesoShort(f.price)}</span>}
        </div>
      </div>
    </Link>
    </PreviewCard>
  );
}

function Shelf({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="shelf reveal">
      <div className="spread"><h2>{title}</h2>{action}</div>
      <div className="shelf-row">{children}</div>
    </section>
  );
}

function SkeletonGrid() {
  return <div className="grid">{Array.from({ length: 10 }, (_, i) => <div key={i} className="col" style={{ gap: 10 }}><div className="skeleton" style={{ aspectRatio: '3 / 4' }} /><div className="skeleton" style={{ height: 14, width: '60%' }} /><div className="skeleton" style={{ height: 18 }} /></div>)}</div>;
}

export default function Library() {
  const { session, profile } = useAuth();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
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
    const m = new Map<string, Status>();
    for (const p of data?.mine ?? []) if (m.get(p.file_id) !== 'confirmed') m.set(p.file_id, p.status === 'rejected' ? undefined : p.status);
    return m;
  }, [data]);
  const labels = useMemo(() => [...new Set((data?.files ?? []).map((f) => f.label).filter(Boolean))].sort(), [data]);
  const owned = (data?.files ?? []).filter((f) => status.get(f.id) === 'confirmed');
  const pendingCount = (data?.files ?? []).filter((f) => status.get(f.id) === 'pending').length;
  const filtering = !!q || kind !== 'all' || !!label;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (data?.files ?? []).filter((f) => (kind === 'all' || f.kind === kind) && (!label || f.label === label)
      && (!s || `${f.name} ${f.label} ${f.description}`.toLowerCase().includes(s)));
    if (sort === 'price') list.sort((a, b) => a.price - b.price);
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [data, q, kind, label, sort]);
  const setQ = (v: string) => { const n = new URLSearchParams(sp); if (v) n.set('q', v); else n.delete('q'); setSp(n, { replace: true }); };
  const first = profile?.full_name?.split(' ')[0];
  const topLabels = labels.slice(0, 3);
  const revealRef = useReveal<HTMLDivElement>();

  return (
    <ClientLayout>
      <div className="page library" ref={revealRef}>
        {!filtering && (
          <section className="hero-card">
            <div className="col" style={{ gap: 10, maxWidth: 560 }}>
              <span className="eyebrow light">{greeting()}{first ? `, ${first}` : ''}</span>
              <h1>What are you reviewing today?</h1>
              <p>Preview any cover for free. Unlock a file once, then read it on your computer and phone.</p>
              {mobile && (
                <label className="search hero-search"><Search width={18} color="var(--slate-400)" />
                  <input placeholder="Search notes, books, lectures…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></label>
              )}
            </div>
            <div className="hero-stats">
              <Link to="/my-files" className="hero-stat"><Book /><b>{owned.length}</b><span>Unlocked</span></Link>
              <Link to="/my-files" className="hero-stat"><Clock /><b>{pendingCount}</b><span>Waiting</span></Link>
              <div className="hero-stat"><b>{data?.files.length ?? '–'}</b><span>In library</span></div>
            </div>
          </section>
        )}

        {!filtering && owned.length > 0 && (
          <Shelf title="Continue reading" action={<Link to="/my-files" className="link row" style={{ gap: 4 }}>My files <ArrowRight width={16} /></Link>}>
            {owned.slice(0, 8).map((f) => <BookCard key={f.id} f={f} status="confirmed" />)}
          </Shelf>
        )}
        {!filtering && data && (
          <Shelf title="New arrivals">{data.files.slice(0, 8).map((f) => <BookCard key={f.id} f={f} status={status.get(f.id)} />)}</Shelf>
        )}
        {!filtering && data && topLabels.map((l) => (
          <Shelf key={l} title={l} action={<button className="link row" style={{ gap: 4 }} onClick={() => setLabel(l)}>See all <ArrowRight width={16} /></button>}>
            {data.files.filter((f) => f.label === l).slice(0, 8).map((f) => <BookCard key={f.id} f={f} status={status.get(f.id)} />)}
          </Shelf>
        ))}

        <section className="col reveal" style={{ gap: 16 }}>
          <div className="filterbar">
            <div className="spread wrap" style={{ gap: 12 }}>
              <div className="col" style={{ gap: 2 }}>
                <h2>{q ? `Results for “${q}”` : label ? label : 'All files'}</h2>
                <span className="small muted">{shown.length} file{shown.length === 1 ? '' : 's'}{filtering && <> · <button className="link" onClick={() => { setKind('all'); setLabel(null); setQ(''); }}>Clear filters</button></>}</span>
              </div>
              <select className="input" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
                <option value="new">Newest first</option><option value="price">Lowest price</option><option value="name">A–Z</option>
              </select>
            </div>
            <div className="chips">
              <button className={`chip${kind === 'all' ? ' on' : ''}`} onClick={() => setKind('all')}>All types</button>
              {KINDS.map((k) => <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}
            </div>
            {labels.length > 0 && (
              <div className="chips">
                <button className={`chip soft${!label ? ' on' : ''}`} onClick={() => setLabel(null)}>All subjects</button>
                {labels.map((l) => <button key={l} className={`chip soft${label === l ? ' on' : ''}`} onClick={() => setLabel(label === l ? null : l)}>{l}</button>)}
              </div>
            )}
          </div>
          {loading ? <SkeletonGrid /> : error ? <Empty title="Couldn't load the library">{error}</Empty>
            : shown.length === 0 ? <Empty title="No files match">Try another search or filter.</Empty>
            : <div className="grid">{shown.map((f) => <BookCard key={f.id} f={f} status={status.get(f.id)} />)}</div>}
        </section>
      </div>
    </ClientLayout>
  );
}
