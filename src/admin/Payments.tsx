import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { ago, dateTime, errMsg, initials, peso } from '../lib/format';
import type { DeviceOrder, PayAttempt, Purchase, PurchaseStatus } from '../lib/types';
import { AdminLayout, invalidateCounts } from '../components/Layouts';
import { Empty, Modal, RejectNote, StatusBadge, useIsMobile, useToast } from '../components/ui';
import { Check, Receipt, Search } from '../components/Icons';
import { Bar, RowsSkeleton } from '../components/Skeletons';
import ZoomImage from '../components/ZoomImage';

const REASONS = ['The screenshot shows a different amount', 'Payment not received', 'Screenshot is unreadable or not a payment', 'Sent to the wrong account'];
const OTHER = 'Other reason';
type Filter = 'all' | PurchaseStatus;
const FILTERS: Filter[] = ['all', 'pending', 'confirmed', 'rejected'];

// Extra-device-slot orders are shown like file payments; `slot` marks them so the right RPCs are used.
type Pay = Purchase & { slot?: DeviceOrder };
const asPay = (o: DeviceOrder, unit: number): Pay => ({
  ...(o as unknown as Purchase), file_id: '', slot: o,
  files: { name: `Extra ${o.kind} slot${o.qty > 1 ? ` ×${o.qty}` : ''}`, price: unit * o.qty } as Purchase['files'],
});

export default function Payments() {
  const [sp, setSp] = useSearchParams();
  const toast = useToast();
  const mobile = useIsMobile();
  const { settings } = useAuth();
  const type = sp.get('type') === 'slots' ? 'slots' : 'files';
  const tab = (FILTERS.includes(sp.get('status') as Filter) ? sp.get('status') : 'all') as Filter;
  const sort = sp.get('sort') === 'old' ? 'old' : 'new';
  const [q, setQ] = useState('');
  // keeps type / status / sort in the address, so a refresh or the back button lands on the same view
  const go = (params: Record<string, string>) => setSp({ ...(type === 'slots' ? { type } : {}), ...(tab !== 'all' ? { status: tab } : {}), ...(sort === 'old' ? { sort } : {}), ...params });
  const { data: all, loading, error, reload } = useLoad(async (): Promise<Pay[]> => {
    if (type === 'slots') {
      const rows = must(await supabase.from('device_orders').select('*, profiles!device_orders_user_id_fkey(id,email,full_name,avatar_url)')
        .order('created_at', { ascending: false }).limit(1000)) as DeviceOrder[];
      return rows.map((o) => asPay(o, Number(o.kind === 'computer' ? settings?.slot_price_computer : settings?.slot_price_phone) || 0));
    }
    return must(await supabase.from('purchases').select('*, files(*), profiles!purchases_user_id_fkey(id,email,full_name,avatar_url)')
      .order('created_at', { ascending: false }).limit(1000)) as Pay[];
  }, [type]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, pending: 0, confirmed: 0, rejected: 0 };
    for (const p of all ?? []) { c.all++; c[p.status]++; }
    return c;
  }, [all]);
  const data = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = (all ?? []).filter((p) => (tab === 'all' || p.status === tab)
      && (!s || `${p.profiles?.full_name ?? ''} ${p.profiles?.email ?? ''} ${p.files?.name ?? ''} ${p.receipt_no ?? ''} ${p.method}`.toLowerCase().includes(s)));
    return sort === 'old' ? [...list].reverse() : list;
  }, [all, tab, q, sort]);
  const selectedId = sp.get('id') ?? (mobile ? null : data[0]?.id);
  const sel = (all ?? []).find((p) => p.id === selectedId) ?? null;
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProofUrl(null); setNote('');
    if (sel?.proof_path) supabase.storage.from('proofs').createSignedUrl(sel.proof_path, 600).then(({ data: d }) => setProofUrl(d?.signedUrl ?? null));
  }, [sel?.id, sel?.proof_path]);

  async function confirm() {
    if (!sel) return;
    setBusy(true);
    const { data: r, error } = await supabase.rpc(sel.slot ? 'confirm_device_order' : 'confirm_purchase', { p_id: sel.id, p_note: note });
    setBusy(false);
    if (error) return toast(error.message);
    toast(sel.slot ? `Confirmed. Receipt ${r.receipt_no} issued and the extra ${sel.slot.kind} slot is added.` : `Confirmed. Receipt ${r.receipt_no} issued and the file is unlocked for the buyer.`);
    invalidateCounts(); go({}); reload();
  }

  const nextReceipt = settings ? `${settings.receipt_prefix}${String(settings.receipt_next).padStart(6, '0')}` : 'a new receipt';
  const priceOk = sel ? Number(sel.amount) >= Number(sel.files?.price ?? 0) : true;

  const list = (
    <div className="col pay-list" style={{ width: mobile ? '100%' : 440, flexShrink: 0, gap: 10 }}>
      <div className="pay-filters">
        <label className="search"><Search width={17} color="var(--slate-400)" />
          <input placeholder="Search name, email, file or receipt no." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search payments" /></label>
        <div className="spread wrap" style={{ gap: 8 }}>
          <div className="chips">{FILTERS.map((t) => (
            <button key={t} className={`chip${tab === t ? ' on' : ''}`} onClick={() => setSp({ ...(type === 'slots' ? { type } : {}), ...(t !== 'all' ? { status: t } : {}), ...(sort === 'old' ? { sort } : {}) })}>
              {t === 'all' ? 'All' : t[0]!.toUpperCase() + t.slice(1)} <i className="chip-n">{counts[t]}</i></button>))}</div>
          <select className="input" style={{ width: 140, height: 36 }} aria-label="Sort" value={sort}
            onChange={(e) => setSp({ ...(type === 'slots' ? { type } : {}), ...(tab !== 'all' ? { status: tab } : {}), ...(e.target.value === 'old' ? { sort: 'old' } : {}) })}>
            <option value="new">Newest first</option><option value="old">Oldest first</option>
          </select>
        </div>
      </div>
      {data.map((p) => (
        <button key={p.id} className="card row" onClick={() => go({ id: p.id })}
          style={{ padding: 14, textAlign: 'left', border: p.id === selectedId ? '2px solid var(--blue)' : undefined }}>
          <span className="avatar">{initials(p.profiles?.full_name ?? '', p.profiles?.email)}</span>
          <div className="col grow" style={{ gap: 2, minWidth: 0 }}><b className="ellipsis">{p.profiles?.full_name || p.profiles?.email}</b><span className="small muted ellipsis">{p.files?.name}</span>
            <span className="row" style={{ gap: 6 }}><StatusBadge status={p.status} />{(p.attempts ?? 1) > 1 && <span className="badge b-pending">Try {p.attempts}</span>}</span></div>
          <div className="col" style={{ gap: 0, alignItems: 'flex-end', flexShrink: 0 }}><b>{peso(p.amount)}</b><span className="small muted">{ago(p.created_at)}</span></div>
        </button>
      ))}
      {data.length === 0 && <Empty title={q ? 'No payments match' : tab === 'pending' ? 'All caught up' : 'Nothing here'}>{q ? 'Try another name or email.' : tab === 'pending' ? 'No payments are waiting for confirmation.' : ''}</Empty>}
    </div>
  );

  const detail = sel && (
    <div className="card col grow" style={{ gap: 16, minWidth: 0 }}>
      <div className="spread"><h3>Payment from {sel.profiles?.full_name || sel.profiles?.email}</h3><StatusBadge status={sel.status} /></div>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div className="proof-big" style={{ width: 240, maxWidth: '100%', flexShrink: 0 }}>
          {sel.proof_path ? (proofUrl ? (sel.proof_path.endsWith('.pdf') ? <a className="drop" href={proofUrl} target="_blank" rel="noreferrer">Open proof (PDF)</a> : <ZoomImage src={proofUrl} alt="Proof of payment" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--line)' }} />) : <Bar h={320} r={12} />)
            : <div className="note note-slate">No proof uploaded{sel.method === 'Granted by admin' ? ' (granted by admin)' : ''}.</div>}
        </div>
        <div className="col grow" style={{ gap: 10, minWidth: 240 }}>
          <div className="spread"><span className="muted">{sel.slot ? 'Order' : 'File'}</span><b>{sel.files?.name}</b></div>
          <div className="spread"><span className="muted">Price</span><b>{peso(sel.files?.price ?? 0)}</b></div>
          <div className="spread"><span className="muted">Amount due</span><b style={{ color: priceOk ? undefined : 'var(--red)' }}>{peso(sel.amount)} {priceOk ? <Check width={14} color="var(--green)" /> : '(short)'}</b></div>
          <div className="spread"><span className="muted">Method</span><b>{sel.method}</b></div>
          {sel.reference_no && <div className="spread"><span className="muted">Reference no.</span><b>{sel.reference_no}</b></div>}
          <div className="spread"><span className="muted">Email</span><b>{sel.profiles?.email}</b></div>
          <div className="spread"><span className="muted">Submitted</span><b>{dateTime(sel.created_at)}</b></div>
          {sel.receipt_no && <div className="spread"><span className="muted">Receipt</span><b>{sel.receipt_no}</b></div>}
          {sel.status === 'rejected' && <><RejectNote reason={sel.reject_reason} note={sel.note_to_buyer} /><span className="small muted">The buyer sees this and can resubmit; it comes back here as the same payment.</span></>}
          {(sel.history?.length ?? 0) > 0 && <Attempts list={sel.history!} />}
          {sel.status === 'pending' && (
            <>
              <div className="note note-blue" style={{ background: 'var(--green-50)', borderColor: '#bbf7d0', color: 'var(--green-deep)' }}><Receipt /><span>Confirming creates receipt <b>{nextReceipt}</b>, shows it to the buyer and {sel.slot ? `adds ${sel.slot.qty} ${sel.slot.kind} slot${sel.slot.qty > 1 ? 's' : ''} to their account` : 'unlocks the file on their devices'}.</span></div>
              <div className="field"><label htmlFor="note">Note to buyer (optional)</label><input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Thank you for your purchase!" /></div>
            </>
          )}
        </div>
      </div>
      {sel.status === 'pending' && (
        <div className="row wrap pay-actions" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-danger" onClick={() => setRejecting(true)} disabled={busy}>Reject…</button>
          <button className="btn btn-green" onClick={confirm} disabled={busy}><Check /> Confirm received & send receipt</button>
        </div>
      )}
    </div>
  );

  return (
    <AdminLayout title="Payments" actions={<div className="row wrap" style={{ gap: 8 }}>
      <div className="seg">{(['files', 'slots'] as const).map((k) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setSp(k === 'slots' ? { type: k } : {})}>{k === 'files' ? 'Files' : 'Device slots'}</button>)}</div>
</div>}>
      {loading ? <RowsSkeleton rows={5} /> : error ? <Empty title="Couldn't load payments">{error}</Empty> : mobile ? (sel ? <>{detail}<button className="btn" onClick={() => go({})}>← All payments</button></> : list) : (
        <div className="row pay-split" style={{ alignItems: 'flex-start', gap: 20 }}>{list}{detail ?? <div className="grow" />}</div>
      )}
      {rejecting && sel && <RejectModal p={sel} onClose={() => setRejecting(false)} onDone={() => { setRejecting(false); invalidateCounts(); go({}); reload(); }} />}
    </AdminLayout>
  );
}

function RejectModal({ p, onClose, onDone }: { p: Pay; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState(REASONS[0]!);
  const [custom, setCustom] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const other = reason === OTHER;
  const finalReason = (other ? custom : reason).trim();
  async function go() {
    if (!finalReason) return setErr('Type the reason.');
    const { error } = await supabase.rpc(p.slot ? 'reject_device_order' : 'reject_purchase', { p_id: p.id, p_reason: finalReason, p_note: msg.trim() });
    if (error) return setErr(errMsg(error));
    toast('Payment rejected. The buyer sees your reason and message, and can resubmit.');
    onDone();
  }
  return (
    <Modal onClose={onClose}>
      <h2>Reject this payment?</h2>
      <span className="muted">{p.profiles?.full_name || p.profiles?.email} · {p.files?.name} · {peso(p.amount)}</span>
      <div className="col" style={{ gap: 8 }}>
        <span className="label">Reason</span>
        <div className="chips">{[...REASONS, OTHER].map((r) => <button key={r} type="button" className={`chip${reason === r ? ' on' : ''}`} onClick={() => setReason(r)}>{r}</button>)}</div>
        {other && <input className="input" autoFocus maxLength={120} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Type the reason" aria-label="Your reason" />}
      </div>
      <div className="field"><label htmlFor="msg">Message to the buyer (optional)</label>
        <textarea id="msg" className="input" maxLength={500} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. We received ₱400 instead of ₱450. Please send the balance and upload the new screenshot." /></div>
      <div className="col" style={{ gap: 6 }}>
        <span className="label">The buyer will see</span>
        <div className="reject-preview"><span className="badge b-red">Rejected</span><RejectNote reason={finalReason || '…'} note={msg.trim() || null} /></div>
      </div>
      {err && <span className="error">{err}</span>}
      <div className="btn-row"><button className="btn grow" onClick={onClose}>Cancel</button><button className="btn btn-danger-solid grow" onClick={go}>Reject & notify buyer</button></div>
    </Modal>
  );
}

/** Earlier screenshots for the same payment (each one was rejected, then the buyer resubmitted). */
function Attempts({ list }: { list: PayAttempt[] }) {
  const open = async (path: string | null) => {
    if (!path) return;
    const { data } = await supabase.storage.from('proofs').createSignedUrl(path, 600);
    if (data) window.open(data.signedUrl, '_blank', 'noopener');
  };
  return (
    <div className="col" style={{ gap: 6, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <b className="small">Earlier attempts ({list.length})</b>
      {list.map((a, i) => (
        <div key={i} className="spread small" style={{ gap: 8 }}>
          <span className="col" style={{ gap: 0 }}><span>Try {i + 1} · {dateTime(a.submitted_at)} · {a.method}</span><span className="muted">Rejected: {a.reject_reason || '—'}</span></span>
          {a.proof_path && <button className="link" onClick={() => open(a.proof_path)}>Screenshot</button>}
        </div>
      ))}
    </div>
  );
}
