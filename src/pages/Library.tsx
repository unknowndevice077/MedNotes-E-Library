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
import { editAttr, Tx, useText } from '../lib/theme';
import CategoryPicker from '../components/CategoryPicker';

const KINDS: FileKind[] = ['epub', 'pdf', 'video', 'image', 'docx', 'pptx', 'xlsx'];
type Status = Purchase['status'] | undefined;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function BookCard({ f, status: bought }: { f: LibFile; status: Status }) {
  const status: Status = f.is_free ? 'confirmed' : bought; // free samples read like owned files
  return (
    <PreviewCard f={f} status={status}>
    <Link to={`/file/${f.id}`} className="bookcard">
      <Cover file={f} locked={status !== 'confirmed'} owned={status === 'confirmed'} />
      <div className="col" style={{ gap: 4 }}>
        <span className="eyebrow">{f.label || KIND_LABEL[f.kind]}</span>
        <h3 className="clamp-2">{f.name}</h3>
        <div className="spread">
          <span className="small muted">{KIND_LABEL[f.kind]}{f.meta ? ` · ${f.meta}` : ''}</span>
          {f.is_free && bought !== 'confirmed' ? <span className="badge b-free">Free</span>
            : status === 'confirmed' ? <span className="badge b-ok">Owned</span>
            : status === 'pending' ? <span className="badge b-pending">Pending</span>
            : <span className="price-pill">{pesoShort(f.price)}</span>}
        </div>
      </div>
    </Link>
    </PreviewCard>
  );
}

function Shelf({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
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
  // several types and subjects can be picked at once; nothing picked = everything
  const [kinds, setKinds] = useState<FileKind[]>([]);
  const [labelsOn, setLabelsOn] = useState<string[]>([]);
  const toggleKind = (k: FileKind) => setKinds((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));
  const toggleLabel = (l: string) => setLabelsOn((a) => (a.includes(l) ? a.filter((x) => x !== l) : [...a, l]));
  const setLabel = (l: string | null) => setLabelsOn(l ? [l] : []);
  const [sort, setSort] = useState<'new' | 'price' | 'name'>('new');
  const [freeOnly, setFreeOnly] = useState(false);
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
  const labelCounts = useMemo(() => { const m = new Map<string, number>(); for (const f of data?.files ?? []) if (f.label) m.set(f.label, (m.get(f.label) ?? 0) + 1); return m; }, [data]);
  const owned = (data?.files ?? []).filter((f) => status.get(f.id) === 'confirmed');
  const pendingCount = (data?.files ?? []).filter((f) => status.get(f.id) === 'pending').length;
  const filtering = !!q || kinds.length > 0 || labelsOn.length > 0 || freeOnly;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (data?.files ?? []).filter((f) => (!kinds.length || kinds.includes(f.kind)) && (!labelsOn.length || labelsOn.includes(f.label)) && (!freeOnly || f.is_free)
      && (!s || `${f.name} ${f.label} ${f.description}`.toLowerCase().includes(s)));
    if (sort === 'price') list.sort((a, b) => a.price - b.price);
    if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [data, q, kinds, labelsOn, sort, freeOnly]);
  const setQ = (v: string) => { const n = new URLSearchParams(sp); if (v) n.set('q', v); else n.delete('q'); setSp(n, { replace: true }); };
  const first = profile?.full_name?.split(' ')[0];
  const topLabels = labels.slice(0, 3);
  const revealRef = useReveal<HTMLDivElement>();
  const t = useText();

  return (
    <ClientLayout>
      <div className="page library" ref={revealRef}>
        {t('library.announcement') && <div className="announce" role="status"><Tx k="library.announcement" /></div>}
        {!filtering && (
          <section className="hero-card">
            <div className="col" style={{ gap: 10, maxWidth: 560 }}>
              <span className="eyebrow light">{greeting()}{first ? `, ${first}` : ''}</span>
              <h1><Tx k="library.heroTitle" /></h1>
              <p><Tx k="library.heroText" /></p>
              {mobile && (
                <label className="search hero-search"><Search width={18} color="var(--slate-400)" />
                  <input placeholder={t('nav.search')} {...editAttr('nav.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" /></label>
              )}
            </div>
            <div className="hero-stats">
              <Link to="/my-files" className="hero-stat"><Book /><b>{owned.length}</b><span><Tx k="library.statUnlocked" /></span></Link>
              <Link to="/my-files" className="hero-stat"><Clock /><b>{pendingCount}</b><span><Tx k="library.statWaiting" /></span></Link>
              <div className="hero-stat"><b>{data?.files.length ?? '–'}</b><span><Tx k="library.statTotal" /></span></div>
            </div>
          </section>
        )}

        {!filtering && owned.length > 0 && (
          <Shelf title={<Tx k="library.continue" />} action={<Link to="/my-files" className="link row" style={{ gap: 4 }}><Tx k="nav.myFiles" /> <ArrowRight width={16} /></Link>}>
            {owned.slice(0, 8).map((f) => <BookCard key={f.id} f={f} status="confirmed" />)}
          </Shelf>
        )}
        {!filtering && data && data.files.some((f) => f.is_free) && (
          <Shelf title={<Tx k="library.free" />} action={<span className="small muted"><Tx k="library.freeSub" /></span>}>
            {data.files.filter((f) => f.is_free).map((f) => <BookCard key={f.id} f={f} status={status.get(f.id)} />)}
          </Shelf>
        )}
        {!filtering && data && (
          <Shelf title={<Tx k="library.new" />}>{data.files.filter((f) => !f.is_free).slice(0, 8).map((f) => <BookCard key={f.id} f={f} status={status.get(f.id)} />)}</Shelf>
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
                <h2>{q ? `Results for “${q}”` : filtering ? 'Filtered files' : <Tx k="library.all" />}</h2>
                <span className="small muted">{shown.length} file{shown.length === 1 ? '' : 's'}{filtering && <> · <button className="link" onClick={() => { setKinds([]); setLabelsOn([]); setQ(''); setFreeOnly(false); }}>Clear filters</button></>}</span>
              </div>
              <select className="input" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
                <option value="new">Newest first</option><option value="price">Lowest price</option><option value="name">A–Z</option>
              </select>
            </div>
            <div className="chips">
              <button className={`chip${!kinds.length ? ' on' : ''}`} aria-pressed={!kinds.length} onClick={() => setKinds([])}>All types</button>
              {KINDS.map((k) => <button key={k} className={`chip${kinds.includes(k) ? ' on' : ''}`} aria-pressed={kinds.includes(k)} onClick={() => toggleKind(k)}>{kinds.includes(k) && <span className="chip-check" aria-hidden>✓</span>}{KIND_LABEL[k]}</button>)}
              <button className={`chip soft${freeOnly ? ' on' : ''}`} aria-pressed={freeOnly} onClick={() => setFreeOnly(!freeOnly)}>{freeOnly && <span className="chip-check" aria-hidden>✓</span>}Free</button>
            </div>
            <div className="row wrap" style={{ gap: 10 }}>
              <div style={{ flex: '0 1 340px', minWidth: 220 }}><CategoryPicker id="subject" value={null} onChange={(l) => (l ? setLabelsOn((a) => (a.includes(l) ? a : [...a, l])) : setLabelsOn([]))} counts={labelCounts} allLabel="All subjects" placeholder="Add a subject" /></div>
              {[...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => <button key={l} className={`chip soft${labelsOn.includes(l) ? ' on' : ''}`} aria-pressed={labelsOn.includes(l)} onClick={() => toggleLabel(l)}>{labelsOn.includes(l) && <span className="chip-check" aria-hidden>✓</span>}{l}</button>)}
            </div>
            {filtering && (
              <div className="active-filters" aria-label="Filters in use">
                <span className="small muted">Showing:</span>
                {kinds.map((k) => <button key={k} className="af-pill" onClick={() => toggleKind(k)} aria-label={`Remove ${KIND_LABEL[k]}`}>{KIND_LABEL[k]} <span aria-hidden>×</span></button>)}
                {labelsOn.map((l) => <button key={l} className="af-pill" onClick={() => toggleLabel(l)} aria-label={`Remove ${l}`}>{l} <span aria-hidden>×</span></button>)}
                {freeOnly && <button className="af-pill" onClick={() => setFreeOnly(false)} aria-label="Remove Free">Free <span aria-hidden>×</span></button>}
                {q && <button className="af-pill" onClick={() => setQ('')} aria-label="Clear search">“{q}” <span aria-hidden>×</span></button>}
              </div>
            )}
          </div>
          {loading ? <SkeletonGrid /> : error ? <Empty title="Couldn't load the library">{error}</Empty>
            : shown.length === 0 ? <Empty title={<Tx k="library.empty" />}><Tx k="library.emptySub" /></Empty>
            : <div className="grid">{shown.map((f) => <BookCard key={f.id} f={f} status={status.get(f.id)} />)}</div>}
        </section>
      </div>
    </ClientLayout>
  );
}
