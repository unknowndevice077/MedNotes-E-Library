import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { must, useLoad } from '../lib/useLoad';
import { ago, errMsg, initials } from '../lib/format';
import { AdminLayout } from '../components/Layouts';
import { Empty, useIsMobile, useToast } from '../components/ui';
import { RowsSkeleton } from '../components/Skeletons';
import { Search } from '../components/Icons';
import { KINDS, kindLabel, Stars, StatusPill, STATUS_LABEL, Thread, type Ticket, type TicketKind, type TicketStatus } from '../components/Tickets';

type Filter = 'active' | TicketStatus | 'all';
const FILTERS: Filter[] = ['active', 'open', 'answered', 'resolved', 'closed', 'all'];

/** Support inbox: every buyer ticket, live, with replies, status and the buyers' star ratings. */
export default function AdminSupport() {
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const mobile = useIsMobile();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<TicketKind | 'all'>('all');
  const filter = (FILTERS.includes(sp.get('status') as Filter) ? sp.get('status') : 'active') as Filter;
  const { data, loading, reload } = useLoad(async () =>
    must(await supabase.from('tickets').select('*, profiles(full_name, email)').order('updated_at', { ascending: false }).limit(1000)) as Ticket[], [], { cache: false });
  useEffect(() => {
    const ch = supabase.channel('admin-tickets').on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => reload()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);

  const count = (f: Filter) => (data ?? []).filter((t) => f === 'all' || (f === 'active' ? t.status === 'open' || t.status === 'answered' : t.status === f)).length;
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((t) => (filter === 'all' || (filter === 'active' ? t.status === 'open' || t.status === 'answered' : t.status === filter))
      && (kind === 'all' || t.kind === kind)
      && (!s || `${t.subject} ${t.body} ${t.profiles?.full_name ?? ''} ${t.profiles?.email ?? ''}`.toLowerCase().includes(s)));
  }, [data, filter, kind, q]);
  const rated = (data ?? []).filter((t) => t.rating);
  const avg = rated.length ? rated.reduce((a, t) => a + t.rating!, 0) / rated.length : 0;
  const helped = (data ?? []).filter((t) => t.satisfaction);
  const avgHelp = helped.length ? helped.reduce((a, t) => a + t.satisfaction!, 0) / helped.length : 0;
  const selId = sp.get('t') ?? (mobile ? null : list[0]?.id);
  const sel = (data ?? []).find((t) => t.id === selId) ?? null;
  const go = (params: Record<string, string>) => setSp({ ...(filter !== 'active' ? { status: filter } : {}), ...params });

  async function setStatus(status: TicketStatus) {
    if (!sel) return;
    const { error } = await supabase.from('tickets').update({ status }).eq('id', sel.id);
    if (error) return toast(errMsg(error));
    toast(`Marked ${STATUS_LABEL[status].toLowerCase()}.`); reload();
  }

  const inbox = (
    <div className="col pay-list" style={{ width: mobile ? '100%' : 440, flexShrink: 0, gap: 10 }}>
      <div className="pay-filters">
        <label className="search"><Search width={17} color="var(--slate-400)" />
          <input placeholder="Search subject, message, name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tickets" /></label>
        <div className="chips">{FILTERS.map((f) => (
          <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setSp(f === 'active' ? {} : { status: f })}>
            {f === 'active' ? 'Needs reply' : f === 'all' ? 'All' : STATUS_LABEL[f]} <i className="chip-n">{count(f)}</i></button>))}</div>
        <select className="input" style={{ height: 36 }} aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as TicketKind | 'all')}>
          <option value="all">All types</option>{KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}
        </select>
      </div>
      {list.map((t) => (
        <button key={t.id} className="card row" onClick={() => go({ t: t.id })} style={{ padding: 14, textAlign: 'left', border: t.id === selId ? '2px solid var(--blue)' : undefined }}>
          <span className="avatar">{initials(t.profiles?.full_name ?? '', t.profiles?.email)}</span>
          <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
            <b className="ellipsis">{t.unread_admin && <i className="unread-dot" aria-label="New" />}{t.subject}</b>
            <span className="small muted ellipsis">{t.profiles?.full_name || t.profiles?.email} · {kindLabel(t.kind)}</span>
            <span className="row" style={{ gap: 6 }}><StatusPill s={t.status} />{t.rating && <Stars value={t.rating} size={13} />}</span>
          </div>
          <span className="small muted" style={{ flexShrink: 0 }}>{ago(t.updated_at)}</span>
        </button>
      ))}
      {list.length === 0 && <Empty title={q ? 'No tickets match' : filter === 'active' ? 'All caught up' : 'Nothing here'}>{filter === 'active' && !q ? 'No buyer is waiting for a reply.' : ''}</Empty>}
    </div>
  );

  const detail = sel && (
    <div className="card col grow" style={{ gap: 14, minWidth: 0 }}>
      <div className="spread wrap" style={{ gap: 10 }}>
        <div className="col" style={{ gap: 2 }}><h3 style={{ margin: 0 }}>{sel.subject}</h3>
          <span className="small muted">{kindLabel(sel.kind)} · from <Link className="link" to={`/admin/users/${sel.user_id}`}>{sel.profiles?.full_name || sel.profiles?.email}</Link>{sel.page ? ` · came from ${sel.page}` : ''}</span></div>
        <StatusPill s={sel.status} />
      </div>
      {sel.satisfaction && <div className="row small" style={{ gap: 6 }}>Buyer rated the help <Stars value={sel.satisfaction} size={15} /></div>}
      <Thread key={sel.id} ticket={sel} asAdmin onChanged={reload} />
      <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {sel.status !== 'resolved' && <button className="btn btn-green" onClick={() => setStatus('resolved')}>Mark resolved</button>}
        {sel.status !== 'closed' && <button className="btn" onClick={() => setStatus('closed')}>Close</button>}
        {(sel.status === 'resolved' || sel.status === 'closed') && <button className="btn" onClick={() => setStatus('open')}>Reopen</button>}
      </div>
    </div>
  );

  return (
    <AdminLayout title="Support" subtitle={rated.length ? `App rating ${avg.toFixed(1)} ★ from ${rated.length} buyer${rated.length > 1 ? 's' : ''}${helped.length ? ` · help rated ${avgHelp.toFixed(1)} ★` : ''}` : 'Bug reports, feedback and questions from buyers'}>
      {loading && !data ? <RowsSkeleton rows={5} /> : mobile ? (sel ? <>{detail}<button className="btn" onClick={() => go({})}>← All tickets</button></> : inbox) : (
        <div className="row pay-split" style={{ alignItems: 'flex-start', gap: 20 }}>{inbox}{detail ?? <div className="grow" />}</div>
      )}
    </AdminLayout>
  );
}
