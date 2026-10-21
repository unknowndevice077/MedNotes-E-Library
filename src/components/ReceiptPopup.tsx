import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { slotReceipt, toReceipt } from '../lib/receipts';
import { downloadReceiptImage } from '../lib/receiptImage';
import type { DeviceOrder, Purchase } from '../lib/types';
import ReceiptCard from './ReceiptCard';
import { Modal } from './ui';
import { Download } from './Icons';
import { invalidateCounts } from './Layouts';

type Shown = { kind: 'file'; p: Purchase } | { kind: 'slot'; p: DeviceOrder };

const seenKey = (uid: string) => `mn.receipts.seen.${uid}`;
const readSeen = (uid: string): Set<string> | null => { try { const v = localStorage.getItem(seenKey(uid)); return v ? new Set(JSON.parse(v)) : null; } catch { return null; } };
const writeSeen = (uid: string, s: Set<string>) => { try { localStorage.setItem(seenKey(uid), JSON.stringify([...s].slice(-300))); } catch { /* private mode */ } };

/**
 * Pops the receipt up the moment the publisher confirms a payment (live), or on the next visit
 * if the buyer wasn't around. Each receipt pops up once per device.
 */
export default function ReceiptPopup() {
  const { session, profile, settings } = useAuth();
  const nav = useNavigate();
  const [queue, setQueue] = useState<Shown[]>([]);
  const shot = useRef<HTMLDivElement>(null);
  const uid = session?.user.id;

  useEffect(() => {
    if (!uid || profile?.role === 'admin') return;
    let alive = true;
    const load = async (only?: { table: 'purchases' | 'device_orders'; id: string }) => {
      const [f, s] = await Promise.all([
        !only || only.table === 'purchases'
          ? supabase.from('purchases').select('*, files(*)').eq('user_id', uid).eq('status', 'confirmed').order('confirmed_at', { ascending: false }).limit(20)
          : Promise.resolve({ data: [] }),
        !only || only.table === 'device_orders'
          ? supabase.from('device_orders').select('*').eq('user_id', uid).eq('status', 'confirmed').order('confirmed_at', { ascending: false }).limit(20)
          : Promise.resolve({ data: [] }),
      ]);
      if (!alive) return;
      const all: Shown[] = [...((f.data ?? []) as Purchase[]).map((p) => ({ kind: 'file' as const, p })), ...((s.data ?? []) as DeviceOrder[]).map((p) => ({ kind: 'slot' as const, p }))]
        .filter((x) => x.p.method !== 'Granted by admin' && x.p.receipt_no);
      let seen = readSeen(uid);
      // first time on this device: don't pop up old receipts, only new ones from now on
      if (!seen) { seen = new Set(all.filter((x) => x.p.id !== only?.id).map((x) => x.p.id)); writeSeen(uid, seen); }
      const fresh = all.filter((x) => !seen!.has(x.p.id));
      if (fresh.length) setQueue((q) => [...q, ...fresh.filter((x) => !q.some((y) => y.p.id === x.p.id))]);
    };
    load();
    const ch = supabase.channel(`receipt-popup-${uid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'purchases', filter: `user_id=eq.${uid}` }, (e) => {
        if ((e.new as Purchase).status === 'confirmed') { invalidateCounts(); load({ table: 'purchases', id: (e.new as Purchase).id }); }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'device_orders', filter: `user_id=eq.${uid}` }, (e) => {
        if ((e.new as DeviceOrder).status === 'confirmed') load({ table: 'device_orders', id: (e.new as DeviceOrder).id });
      }).subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [uid, profile?.role]);

  const cur = queue[0];
  if (!cur || !uid) return null;
  const close = () => {
    const seen = readSeen(uid) ?? new Set<string>();
    seen.add(cur.p.id); writeSeen(uid, seen);
    setQueue((q) => q.slice(1));
  };
  const r = cur.kind === 'file' ? toReceipt(cur.p, profile) : slotReceipt(cur.p, profile);
  return (
    <Modal onClose={close} width={560}>
      <div className="col" style={{ gap: 4, textAlign: 'center' }}>
        <h2>Payment confirmed</h2>
        <span className="muted">{cur.kind === 'file' ? 'Your file is ready to read. Here is your receipt.' : 'Your extra device slot is ready. Here is your receipt.'}</span>
      </div>
      <div ref={shot} className="receipt-shot popup-receipt"><ReceiptCard settings={settings} r={r} /></div>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn grow" onClick={() => shot.current && downloadReceiptImage(shot.current, `receipt-${r.receipt_no}`)}><Download width={18} /> Save as image</button>
        {cur.kind === 'file'
          ? <button className="btn btn-primary grow" onClick={() => { close(); nav(`/read/${cur.p.file_id}`); }}>Read now</button>
          : <button className="btn btn-primary grow" onClick={() => { close(); nav('/devices'); }}>My devices</button>}
      </div>
      <button className="link small" style={{ alignSelf: 'center' }} onClick={close}>Close</button>
    </Modal>
  );
}
