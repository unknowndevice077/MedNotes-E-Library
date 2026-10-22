import { Tx } from '../lib/theme';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { dateOnly, peso } from '../lib/format';
import { slotReceipt, toReceipt } from '../lib/receipts';
import { downloadReceiptImage } from '../lib/receiptImage';
import { KIND_LABEL, type DeviceOrder, type Purchase, type PurchaseStatus } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import ReceiptCard from '../components/ReceiptCard';
import SentProof from '../components/SentProof';
import { Empty, Modal, RejectNote, StatusBadge, Thumb, useIsMobile } from '../components/ui';
import { Download, Laptop, Phone, Receipt } from '../components/Icons';
import { RowsSkeleton } from '../components/Skeletons';

type Row = { kind: 'file'; p: Purchase } | { kind: 'slot'; p: DeviceOrder };
type Tab = 'all' | PurchaseStatus;
const TABS: [Tab, string][] = [['all', 'All'], ['confirmed', 'Paid'], ['pending', 'Waiting'], ['rejected', 'Rejected']];

/** Everything the buyer has paid for (files and extra devices), with each receipt. */
export default function MyPayments() {
  const { session, profile, settings } = useAuth();
  const mobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('all');
  const [open, setOpen] = useState<Row | null>(null);
  const shot = useRef<HTMLDivElement>(null);
  const { data, loading, error } = useLoad(async () => {
    const [f, s] = await Promise.all([
      supabase.from('purchases').select('*, files(*)').eq('user_id', session!.user.id).order('created_at', { ascending: false }),
      supabase.from('device_orders').select('*').eq('user_id', session!.user.id).order('created_at', { ascending: false }),
    ]);
    const rows: Row[] = [...(must(f) as Purchase[]).map((p) => ({ kind: 'file' as const, p })), ...((s.data ?? []) as DeviceOrder[]).map((p) => ({ kind: 'slot' as const, p }))];
    return rows.sort((a, b) => b.p.created_at.localeCompare(a.p.created_at));
  }, [session?.user.id]);

  const rows = (data ?? []).filter((r) => tab === 'all' || r.p.status === tab);
  const count = (t: Tab) => (data ?? []).filter((r) => t === 'all' || r.p.status === t).length;
  const paid = (data ?? []).filter((r) => r.p.status === 'confirmed').reduce((a, r) => a + Number(r.p.amount), 0);
  const name = (r: Row) => (r.kind === 'file' ? r.p.files?.name ?? 'File' : `Extra ${r.p.kind} slot${r.p.qty > 1 ? ` ×${r.p.qty}` : ''}`);
  const receipt = open && (open.kind === 'file' ? toReceipt(open.p, profile) : slotReceipt(open.p, profile));

  return (
    <ClientLayout back="/account" title="Payments">
      <div className="page" style={{ maxWidth: 980 }}>
        {!mobile && <div className="col" style={{ gap: 4 }}><Link to="/account" className="link small">‹ <Tx k="nav.account" /></Link><h1>Payments & receipts</h1><span className="muted">Every file and extra device you paid for, with your receipts.</span></div>}
        <div className="row wrap" style={{ gap: 12 }}>
          <div className="stat"><span className="muted">Total paid</span><span className="v" style={{ color: 'var(--green)' }}>{peso(paid)}</span></div>
          <div className="stat"><span className="muted">Receipts</span><span className="v">{count('confirmed')}</span></div>
          {count('pending') > 0 && <div className="stat"><span className="muted">Waiting</span><span className="v">{count('pending')}</span></div>}
        </div>
        <div className="seg" role="tablist">
          {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}<i>{count(k)}</i></button>)}
        </div>
        {loading ? <RowsSkeleton rows={4} /> : error ? <Empty title="Couldn't load your payments">{error}</Empty> : rows.length === 0 ? (
          <Empty title="No payments here">Browse the <Link to="/library" className="link">library</Link> to get your first file.</Empty>
        ) : (
          <div className="col" style={{ gap: 10 }}>
            {rows.map((r) => (
              <div key={r.p.id} className="card row pay-row" style={{ padding: 12 }}>
                {r.kind === 'file' ? <Thumb file={r.p.files} /> : <span className="slot-ico">{r.p.kind === 'computer' ? <Laptop /> : <Phone />}</span>}
                <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
                  <b className="ellipsis">{name(r)}</b>
                  <span className="small muted">{r.kind === 'file' && r.p.files ? KIND_LABEL[r.p.files.kind] : 'Device access'} · {peso(r.p.amount)} · {dateOnly(r.p.created_at)}</span>
                  <span className="row wrap" style={{ gap: 6 }}><StatusBadge status={r.p.status} /></span>
                  {r.p.status === 'rejected' && <><RejectNote compact reason={r.p.reject_reason} note={r.p.note_to_buyer} /><SentProof p={r.p} /></>}
                </div>
                {r.p.status === 'confirmed' && r.p.receipt_no && <button className="btn btn-sm" onClick={() => setOpen(r)}><Receipt width={16} /> {mobile ? 'Receipt' : r.p.receipt_no}</button>}
                {r.p.status === 'rejected' && <Link className="btn btn-sm btn-primary" to={r.kind === 'file' ? `/checkout/${r.p.file_id}` : `/checkout/slot/${r.p.kind}`}>Resubmit</Link>}
              </div>
            ))}
          </div>
        )}
      </div>
      {open && receipt && (
        <Modal onClose={() => setOpen(null)} width={560}>
          <div ref={shot} className="receipt-shot popup-receipt"><ReceiptCard settings={settings} r={receipt} /></div>
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn grow" onClick={() => shot.current && downloadReceiptImage(shot.current, `receipt-${receipt.receipt_no}`)}><Download width={18} /> Save as image</button>
            <Link className="btn grow" to={open.kind === 'file' ? `/receipt/${open.p.id}` : `/receipt/slot/${open.p.id}`}>Full page / print</Link>
            <button className="btn btn-primary grow" onClick={() => setOpen(null)}>Done</button>
          </div>
        </Modal>
      )}
    </ClientLayout>
  );
}
