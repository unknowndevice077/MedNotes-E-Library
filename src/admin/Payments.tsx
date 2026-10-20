import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { ago, dateTime, errMsg, initials, peso } from '../lib/format';
import type { DeviceOrder, Purchase, PurchaseStatus } from '../lib/types';
import { AdminLayout, invalidateCounts } from '../components/Layouts';
import { Empty, Modal, StatusBadge, useIsMobile, useToast } from '../components/ui';
import { Check, Receipt } from '../components/Icons';
import { Bar, RowsSkeleton } from '../components/Skeletons';

const REASONS = ["Amount doesn't match the price", 'Payment not received / reference not found', 'Proof is unreadable'];

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
  const [tab, setTab] = useState<PurchaseStatus>('pending');
  const type = sp.get('type') === 'slots' ? 'slots' : 'files';
  const go = (params: Record<string, string>) => setSp({ ...(type === 'slots' ? { type } : {}), ...params });
  const { data, loading, error, reload } = useLoad(async (): Promise<Pay[]> => {
    if (type === 'slots') {
      const rows = must(await supabase.from('device_orders').select('*, profiles!device_orders_user_id_fkey(id,email,full_name,avatar_url)').eq('status', tab)
        .order('created_at', { ascending: tab === 'pending' }).limit(200)) as DeviceOrder[];
      return rows.map((o) => asPay(o, Number(o.kind === 'computer' ? settings?.slot_price_computer : settings?.slot_price_phone) || 0));
    }
    return must(await supabase.from('purchases').select('*, files(*), profiles!purchases_user_id_fkey(id,email,full_name,avatar_url)').eq('status', tab)
      .order('created_at', { ascending: tab === 'pending' }).limit(200)) as Pay[];
  }, [tab, type]);
  const selectedId = sp.get('id') ?? (mobile ? null : data?.[0]?.id);
  const sel = data?.find((p) => p.id === selectedId) ?? null;
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
    <div className="col pay-list" style={{ width: mobile ? '100%' : 420, flexShrink: 0, gap: 10 }}>
      {(data ?? []).map((p) => (
        <button key={p.id} className="card row" onClick={() => go({ id: p.id })}
          style={{ padding: 14, textAlign: 'left', border: p.id === selectedId ? '2px solid var(--blue)' : undefined }}>
          <span className="avatar">{initials(p.profiles?.full_name ?? '', p.profiles?.email)}</span>
          <div className="col grow" style={{ gap: 0 }}><b>{p.profiles?.full_name || p.profiles?.email}</b><span className="small muted">{p.files?.name}</span></div>
          <div className="col" style={{ gap: 0, alignItems: 'flex-end' }}><b>{peso(p.amount)}</b><span className="small muted">{ago(p.created_at)}</span></div>
        </button>
      ))}
      {data?.length === 0 && <Empty title={tab === 'pending' ? 'All caught up' : 'Nothing here'}>{tab === 'pending' ? 'No payments are waiting for confirmation.' : ''}</Empty>}
    </div>
  );

  const detail = sel && (
    <div className="card col grow" style={{ gap: 16, minWidth: 0 }}>
      <div className="spread"><h3>Payment from {sel.profiles?.full_name || sel.profiles?.email}</h3><StatusBadge status={sel.status} reason={sel.reject_reason} /></div>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
        <a href={proofUrl ?? undefined} target="_blank" rel="noreferrer" style={{ width: 240, flexShrink: 0 }}>
          {sel.proof_path ? (proofUrl ? (sel.proof_path.endsWith('.pdf') ? <div className="drop">Open proof (PDF)</div> : <img src={proofUrl} alt="Proof of payment" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--line)' }} />) : <Bar h={320} r={12} />)
            : <div className="note note-slate">No proof uploaded{sel.method === 'Granted by admin' ? ' (granted by admin)' : ''}.</div>}
        </a>
        <div className="col grow" style={{ gap: 10, minWidth: 240 }}>
          <div className="spread"><span className="muted">{sel.slot ? 'Order' : 'File'}</span><b>{sel.files?.name}</b></div>
          <div className="spread"><span className="muted">Price</span><b>{peso(sel.files?.price ?? 0)}</b></div>
          <div className="spread"><span className="muted">Amount sent</span><b style={{ color: priceOk ? undefined : 'var(--red)' }}>{peso(sel.amount)} {priceOk ? <Check width={14} color="var(--green)" /> : '(short)'}</b></div>
          <div className="spread"><span className="muted">Method</span><b>{sel.method}</b></div>
          <div className="spread"><span className="muted">Reference no.</span><b>{sel.reference_no || '—'}</b></div>
          <div className="spread"><span className="muted">Email</span><b>{sel.profiles?.email}</b></div>
          <div className="spread"><span className="muted">Submitted</span><b>{dateTime(sel.created_at)}</b></div>
          {sel.receipt_no && <div className="spread"><span className="muted">Receipt</span><b>{sel.receipt_no}</b></div>}
          {sel.status === 'pending' && (
            <>
              <div className="note note-blue" style={{ background: 'var(--green-50)', borderColor: '#bbf7d0', color: 'var(--green-deep)' }}><Receipt /><span>Confirming creates receipt <b>{nextReceipt}</b>, shows it to the buyer and {sel.slot ? `adds ${sel.slot.qty} ${sel.slot.kind} slot${sel.slot.qty > 1 ? 's' : ''} to their account` : 'unlocks the file on their devices'}.</span></div>
              <div className="field"><label htmlFor="note">Note to buyer (optional)</label><input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Thank you for your purchase!" /></div>
            </>
          )}
        </div>
      </div>
      {sel.status === 'pending' && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-danger" onClick={() => setRejecting(true)} disabled={busy}>Reject…</button>
          <button className="btn btn-green" onClick={confirm} disabled={busy}><Check /> Confirm received & send receipt</button>
        </div>
      )}
    </div>
  );

  return (
    <AdminLayout title="Payments" actions={<div className="row wrap" style={{ gap: 8 }}>
      <div className="seg">{(['files', 'slots'] as const).map((k) => <button key={k} className={type === k ? 'on' : ''} onClick={() => setSp(k === 'slots' ? { type: k } : {})}>{k === 'files' ? 'Files' : 'Device slots'}</button>)}</div>
      <div className="chips">{(['pending', 'confirmed', 'rejected'] as PurchaseStatus[]).map((t) => (
      <button key={t} className={`chip${tab === t ? ' on' : ''}`} onClick={() => { setTab(t); go({}); }}>{t[0]!.toUpperCase() + t.slice(1)}</button>))}</div></div>}>
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
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  async function go() {
    const { error } = await supabase.rpc(p.slot ? 'reject_device_order' : 'reject_purchase', { p_id: p.id, p_reason: reason, p_note: msg });
    if (error) return setErr(errMsg(error));
    toast('Payment rejected. The buyer sees the reason and can resubmit.');
    onDone();
  }
  return (
    <Modal onClose={onClose}>
      <h2>Reject this payment?</h2>
      <span className="muted">{p.profiles?.full_name || p.profiles?.email} · {p.files?.name} · {peso(p.amount)}</span>
      <div className="col" style={{ gap: 8 }}>
        <span className="label">Reason (sent to the buyer)</span>
        {REASONS.map((r) => (
          <label key={r} className="card row" style={{ padding: 12, cursor: 'pointer', border: reason === r ? '2px solid var(--blue)' : undefined }}>
            <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />{r}
          </label>
        ))}
      </div>
      <div className="field"><label htmlFor="msg">Message</label><textarea id="msg" className="input" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="e.g. We received ₱400 instead of ₱450. Please send the balance and upload the new proof." /></div>
      {err && <span className="error">{err}</span>}
      <div className="row"><button className="btn grow" onClick={onClose}>Cancel</button><button className="btn btn-danger-solid grow" onClick={go}>Reject & notify buyer</button></div>
    </Modal>
  );
}
