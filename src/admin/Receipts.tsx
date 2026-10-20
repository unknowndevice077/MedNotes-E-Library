import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { dateTime, peso } from '../lib/format';
import type { Purchase, ReceiptDesign } from '../lib/types';
import { AdminLayout } from '../components/Layouts';
import { Empty, Modal, Toggle } from '../components/ui';
import { Receipt, Search } from '../components/Icons';
import { FormSkeleton, RowsSkeleton } from '../components/Skeletons';
import ReceiptCard, { RECEIPT_DEFAULTS, sampleReceipt } from '../components/ReceiptCard';
import { toReceipt } from '../pages/Receipt';
import { useSettingsForm } from './Restrictions';

const PRINT_CSS = `@media print { body * { visibility: hidden !important; } .print-me, .print-me * { visibility: visible !important; }
  .print-me { position: absolute; left: 0; top: 0; width: 100%; } .print-me .receipt { box-shadow: none !important; border: none !important; } }`;

function Issued() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Purchase | null>(null);
  const { settings } = useAuth();
  const { data, loading } = useLoad(async () =>
    must(await supabase.from('purchases').select('*, files(name, kind), profiles!purchases_user_id_fkey(email, full_name)')
      .eq('status', 'confirmed').not('receipt_no', 'is', null).order('confirmed_at', { ascending: false }).limit(500)) as Purchase[]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter((p) => !s || `${p.receipt_no} ${p.profiles?.full_name} ${p.profiles?.email} ${p.files?.name} ${p.reference_no}`.toLowerCase().includes(s));
  }, [data, q]);
  const total = shown.reduce((a, p) => a + Number(p.amount), 0);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="spread wrap" style={{ gap: 12 }}>
        <label className="search" style={{ maxWidth: 380, flex: 1 }}><Search width={18} color="var(--slate-400)" />
          <input placeholder="Receipt no., buyer, file or GCash ref" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search receipts" /></label>
        <span className="small muted">{shown.length} receipt{shown.length === 1 ? '' : 's'} · {peso(total)}</span>
      </div>
      {loading ? <RowsSkeleton rows={6} thumb={false} /> : shown.length === 0 ? <Empty title="No receipts yet">Receipts appear here when you confirm a payment.</Empty> : (
        <div className="table rtable">
          <div className="tr th hide-sm"><span style={{ width: 130 }}>Receipt</span><span style={{ width: 240 }}>Buyer</span><span style={{ width: 240 }}>File</span><span style={{ width: 110 }}>Amount</span><span style={{ width: 170 }}>Issued</span><span className="grow" /></div>
          {shown.map((p) => (
            <div key={p.id} className="tr" style={{ cursor: 'pointer' }} onClick={() => setOpen(p)}>
              <b style={{ width: 130 }}>{p.receipt_no}</b>
              <div className="col" style={{ width: 240, gap: 0, minWidth: 0 }}><span className="ellipsis">{p.profiles?.full_name || p.profiles?.email}</span><span className="small muted ellipsis">{p.profiles?.email}</span></div>
              <span style={{ width: 240 }} className="ellipsis">{p.files?.name}</span>
              <b style={{ width: 110 }}>{peso(p.amount)}</b>
              <span style={{ width: 170 }} className="small muted">{dateTime(p.confirmed_at)}</span>
              <span className="grow" />
              <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setOpen(p); }}><Receipt width={15} /> View</button>
            </div>
          ))}
        </div>
      )}
      {open && (
        <Modal onClose={() => setOpen(null)} width={600}>
          <style>{PRINT_CSS}</style>
          <div className="print-me"><ReceiptCard settings={settings} r={toReceipt(open, open.profiles)} /></div>
          <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => setOpen(null)}>Close</button><button className="btn btn-primary" onClick={() => window.print()}>Print / Save as PDF</button></div>
        </Modal>
      )}
    </div>
  );
}

function Design() {
  const { s, set, save, loading } = useSettingsForm();
  if (loading || !s) return <FormSkeleton cards={2} />;
  const d = { ...RECEIPT_DEFAULTS, ...(s.receipt_design ?? {}) };
  const setD = (patch: Partial<ReceiptDesign>) => set({ receipt_design: { ...(s.receipt_design ?? {}), ...patch } });
  const text = (id: keyof ReceiptDesign, label: string, placeholder = '', max = 120) => (
    <div className="field grow" style={{ minWidth: 200 }}><label htmlFor={`rd-${id}`}>{label}</label>
      <input id={`rd-${id}`} className="input" value={String(d[id] ?? '')} placeholder={placeholder} maxLength={max} onChange={(e) => setD({ [id]: e.target.value })} /></div>
  );
  return (
    <div className="row wrap rc-design" style={{ alignItems: 'flex-start', gap: 24 }}>
      <style>{PRINT_CSS}</style>
      <div className="col grow" style={{ gap: 16, minWidth: 300, flexBasis: 420 }}>
        <div className="card col">
          <h3>Business details</h3>
          <div className="row wrap" style={{ gap: 12 }}>
            <div className="field grow" style={{ minWidth: 200 }}><label htmlFor="rb">Business name on receipt</label><input id="rb" className="input" value={s.receipt_business} onChange={(e) => set({ receipt_business: e.target.value })} /></div>
            <div className="field" style={{ width: 200 }}><label htmlFor="tin">TIN (optional)</label><input id="tin" className="input" value={s.receipt_tin} onChange={(e) => set({ receipt_tin: e.target.value })} /></div>
          </div>
          <div className="row wrap" style={{ gap: 12 }}>{text('address', 'Business address', 'e.g. Real St., Ormoc City, Leyte')}{text('contact', 'Contact line', 'e.g. 0917 123 4567 · hello@example.com')}</div>
        </div>
        <div className="card col">
          <h3>Look</h3>
          <div className="row wrap" style={{ gap: 12 }}>
            {text('title', 'Receipt title', 'Official receipt', 40)}
            <div className="field"><label htmlFor="rd-accent">Accent colour</label><input id="rd-accent" type="color" className="color-input" value={d.accent} onChange={(e) => setD({ accent: e.target.value })} /></div>
            <div className="field" style={{ width: 170 }}><label htmlFor="rd-paper">Paper</label>
              <select id="rd-paper" className="input" value={d.paper} onChange={(e) => setD({ paper: e.target.value as ReceiptDesign['paper'] })}>
                <option value="card">Card (screen)</option><option value="a5">A5 page</option><option value="thermal">Thermal slip (58 mm)</option>
              </select></div>
          </div>
          <div className="setting"><b>Show logo</b><Toggle on={d.showLogo} onChange={(v) => setD({ showLogo: v })} label="Show logo" /></div>
          <div className="setting"><b>Show TIN</b><Toggle on={d.showTin} onChange={(v) => setD({ showTin: v })} label="Show TIN" /></div>
          <div className="setting"><b>Show GCash reference no.</b><Toggle on={d.showReference} onChange={(v) => setD({ showReference: v })} label="Show reference" /></div>
          <div className="setting"><b>Show buyer's email</b><Toggle on={d.showBuyerEmail} onChange={(v) => setD({ showBuyerEmail: v })} label="Show buyer email" /></div>
          <div className="field"><label htmlFor="rf">Footer note</label><input id="rf" className="input" value={s.receipt_footer} onChange={(e) => set({ receipt_footer: e.target.value })} /></div>
        </div>
        <div className="card col">
          <h3>Numbering</h3>
          <div className="row wrap" style={{ gap: 12 }}>
            <div className="field" style={{ width: 140 }}><label htmlFor="rp">Prefix</label><input id="rp" className="input" value={s.receipt_prefix} maxLength={8} onChange={(e) => set({ receipt_prefix: e.target.value })} /></div>
            <div className="field" style={{ width: 160 }}><label htmlFor="rn">Next number</label><input id="rn" className="input" inputMode="numeric" value={s.receipt_next} onChange={(e) => set({ receipt_next: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} /></div>
          </div>
          <span className="small muted">Next receipt: <b>{s.receipt_prefix}{String(s.receipt_next).padStart(6, '0')}</b>. Numbers never repeat.</span>
        </div>
        <div className="row"><button className="btn" onClick={() => set({ receipt_design: {} })}>Reset look</button><button className="btn btn-primary grow" onClick={() => save()}>Save receipt settings</button></div>
      </div>
      <div className="col rc-preview" style={{ gap: 12, flexBasis: 420, flexGrow: 1 }}>
        <span className="eyebrow">Live sample</span>
        <div className="print-me"><ReceiptCard settings={s} r={sampleReceipt(s)} sample /></div>
        <button className="btn" onClick={() => window.print()}>Print sample</button>
      </div>
    </div>
  );
}

export default function AdminReceipts() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'design' ? 'design' : 'issued';
  return (
    <AdminLayout title="Receipts" subtitle="Every receipt you've issued, and how they look"
      actions={<div className="seg">{(['issued', 'design'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setSp(t === 'issued' ? {} : { tab: t })}>{t === 'issued' ? 'Issued' : 'Design & sample'}</button>)}</div>}>
      {tab === 'issued' ? <Issued /> : <Design />}
    </AdminLayout>
  );
}
