import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { peso } from '../lib/format';
import { isNative } from '../lib/platform';
import { listSaved } from '../lib/offline';
import { KIND_LABEL, type Purchase } from '../lib/types';
import { ClientLayout, invalidateCounts } from '../components/Layouts';
import SentProof from '../components/SentProof';
import { Empty, RejectNote, StatusBadge, Thumb, useIsMobile, useToast } from '../components/ui';
import { Clock, Download, Receipt } from '../components/Icons';
import { RowsSkeleton } from '../components/Skeletons';
import { Tx } from '../lib/theme';

export default function MyFiles() {
  const { session } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const mobile = useIsMobile();
  const [savedCount, setSavedCount] = useState(0);
  const { data, loading, error, reload } = useLoad(async () =>
    must(await supabase.from('purchases').select('*, files(*)').eq('user_id', session!.user.id).order('created_at', { ascending: false })) as Purchase[],
  [session?.user.id]);

  useEffect(() => { if (isNative) listSaved().then((l) => setSavedCount(l.length)); }, []);
  // Live updates: tell the buyer the moment the publisher confirms or rejects.
  useEffect(() => {
    const ch = supabase.channel('my-purchases')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'purchases', filter: `user_id=eq.${session!.user.id}` }, (p) => {
        const row = p.new as Purchase;
        toast(row.status === 'confirmed' ? `Payment confirmed · receipt ${row.receipt_no}` : row.status === 'rejected' ? 'A payment was rejected. See the reason below.' : 'Payment updated');
        invalidateCounts(); reload();
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, reload, toast]);

  // one row per file: the confirmed purchase wins, else the newest
  const rows = (() => {
    const by = new Map<string, Purchase>();
    for (const p of data ?? []) { const cur = by.get(p.file_id); if (!cur || (p.status === 'confirmed' && cur.status !== 'confirmed')) by.set(p.file_id, p); }
    return [...by.values()];
  })();
  const pending = rows.filter((r) => r.status === 'pending').length;
  const [tab, setTab] = useState<'all' | Purchase['status']>('all');
  const counts = { all: rows.length, confirmed: rows.filter((r) => r.status === 'confirmed').length, pending, rejected: rows.filter((r) => r.status === 'rejected').length };
  const visible = tab === 'all' ? rows : rows.filter((r) => r.status === tab);

  return (
    <ClientLayout title={<Tx k="myfiles.title" />}>
      <div className="page">
        <div className="spread wrap" style={{ gap: 10 }}>
          {!mobile && <div className="col" style={{ gap: 4 }}><h1><Tx k="myfiles.title" /></h1><span className="muted"><Tx k="myfiles.sub" /></span></div>}
          <Link to="/payments" className="btn btn-sm"><Receipt width={16} /> Payments & receipts</Link>
        </div>
        <div className="seg" role="tablist">
          {([['all', 'All'], ['confirmed', 'Owned'], ['pending', 'Waiting'], ['rejected', 'Rejected']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}<i>{counts[k]}</i></button>
          ))}
        </div>
        {pending > 0 && <div className="note note-amber"><Clock /><span><b>{pending} payment{pending > 1 ? 's are' : ' is'} waiting for the publisher's confirmation.</b> We'll update this page and your receipt appears here as soon as it's confirmed.</span></div>}
        {isNative && <Link to="/saved" className="note note-blue" style={{ alignItems: 'center' }}><Download /><b className="grow">Saved for offline · {savedCount} file{savedCount === 1 ? '' : 's'}</b>→</Link>}
        {loading ? <RowsSkeleton rows={4} /> : error ? <Empty title="Couldn't load your files">{error}</Empty> : visible.length === 0 ? (
          <Empty title={rows.length ? 'Nothing here' : <Tx k="myfiles.empty" />}>Browse the <Link to="/library" className="link">library</Link> and get your first file.</Empty>
        ) : mobile ? (
          <div className="col">
            {visible.map((r) => (
              <div key={r.id} className="card row" style={{ padding: 12 }}>
                <Thumb file={r.files} />
                <div className="col grow" style={{ gap: 4 }}>
                  <b>{r.files?.name}</b>
                  {r.status === 'confirmed' && r.receipt_no ? <Link to={`/receipt/${r.id}`} className="row small link" style={{ gap: 6 }}><Receipt width={14} /> Receipt {r.receipt_no}</Link>
                    : <span><StatusBadge status={r.status} /></span>}
                  {r.status === 'rejected' && <><RejectNote compact reason={r.reject_reason} note={r.note_to_buyer} /><SentProof p={r} /></>}
                </div>
                {r.status === 'confirmed' && <button className="btn btn-sm btn-primary" onClick={() => nav(`/file/${r.file_id}`)}>Open</button>}
                {r.status === 'rejected' && <button className="btn btn-sm" onClick={() => nav(`/checkout/${r.file_id}`)}>Resubmit</button>}
              </div>
            ))}
          </div>
        ) : (
          <div className="table">
            <div className="tr th"><span style={{ width: 380 }}>File</span><span style={{ width: 120 }}>Paid</span><span style={{ width: 280 }}>Status</span><span style={{ width: 150 }}>Receipt</span><span className="grow" /></div>
            {visible.map((r) => (
              <div key={r.id} className="tr">
                <div className="row" style={{ width: 380 }}><Thumb file={r.files} /><div className="col" style={{ gap: 0 }}><b>{r.files?.name}</b><span className="small muted">{r.files ? KIND_LABEL[r.files.kind] : ''}</span></div></div>
                <span style={{ width: 120 }}>{peso(r.amount)}</span>
                <span className="col" style={{ width: 280, gap: 4 }}><StatusBadge status={r.status} />{r.status === 'rejected' && <><RejectNote compact reason={r.reject_reason} note={r.note_to_buyer} /><SentProof p={r} /></>}</span>
                <span style={{ width: 150 }}>{r.receipt_no ? <Link to={`/receipt/${r.id}`} className="row link" style={{ gap: 6 }}><Receipt width={16} />{r.receipt_no}</Link> : <span className="muted">—</span>}</span>
                <span className="grow" />
                {r.status === 'confirmed' && <button className="btn btn-sm btn-primary" onClick={() => nav(`/file/${r.file_id}`)}>Open</button>}
                {r.status === 'pending' && <button className="btn btn-sm" disabled>Locked</button>}
                {r.status === 'rejected' && <button className="btn btn-sm" onClick={() => nav(`/checkout/${r.file_id}`)}>Resubmit proof</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </ClientLayout>
  );
}
