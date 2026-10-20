import type { ReceiptDesign, Settings } from '../lib/types';
import { dateTime, peso } from '../lib/format';
import { Logo } from './ui';
import { Check } from './Icons';

export interface ReceiptData {
  receipt_no: string; issued_at: string | null;
  buyer_name: string; buyer_email: string;
  item: string; kind: string; method: string; reference: string; amount: number; note?: string;
}

export const RECEIPT_DEFAULTS: Required<ReceiptDesign> = {
  title: 'Official receipt', accent: '#059669', showLogo: true, address: '', contact: '',
  showTin: true, showReference: true, showBuyerEmail: true, footer: '', paper: 'card',
};

/** A fake but realistic receipt for the admin's live preview. */
export function sampleReceipt(s: Pick<Settings, 'receipt_prefix' | 'receipt_next'>): ReceiptData {
  return {
    receipt_no: `${s.receipt_prefix}${String(s.receipt_next).padStart(6, '0')}`, issued_at: new Date().toISOString(),
    buyer_name: 'Juan Dela Cruz (sample)', buyer_email: 'juan@example.com', item: 'Pharmacology Made Easy', kind: 'EPUB',
    method: 'GCash', reference: '8821 4407 3312', amount: 450, note: 'Thank you for your purchase!',
  };
}

/**
 * The receipt buyers see and print. Its look comes from Admin → Receipts (settings.receipt_design);
 * the business name, TIN and footer come from the same page.
 */
export default function ReceiptCard({ r, settings, sample }: {
  r: ReceiptData; settings: Pick<Settings, 'receipt_business' | 'receipt_tin' | 'receipt_footer' | 'receipt_design'> | null; sample?: boolean;
}) {
  const d = { ...RECEIPT_DEFAULTS, ...(settings?.receipt_design ?? {}) };
  const footer = d.footer || settings?.receipt_footer || '';
  return (
    <div className={`card col receipt paper-card${sample ? ' is-sample' : ''}`} style={{ '--rc': d.accent } as React.CSSProperties}>
      <div className="rc-band" />
      <div className="spread">{d.showLogo ? <Logo /> : <b className="rc-biz">{settings?.receipt_business}</b>}<span className="badge rc-paid"><Check /> PAID</span></div>
      <div className="col" style={{ gap: 2 }}>
        <h2>{d.title}</h2>
        <span className="small muted">{r.receipt_no} · Issued {dateTime(r.issued_at)}</span>
      </div>
      <div className="col rc-from small">
        <b>{settings?.receipt_business}</b>
        {d.address && <span className="muted">{d.address}</span>}
        {d.contact && <span className="muted">{d.contact}</span>}
        {d.showTin && settings?.receipt_tin && <span className="muted">TIN {settings.receipt_tin}</span>}
      </div>
      <div className="col rc-lines">
        <div className="spread"><span className="muted">Billed to</span><span>{r.buyer_name || r.buyer_email}</span></div>
        {d.showBuyerEmail && <div className="spread"><span className="muted">Email</span><span>{r.buyer_email}</span></div>}
        <div className="spread"><span className="muted">Item</span><span style={{ textAlign: 'right' }}>{r.item}{r.kind ? ` (${r.kind})` : ''}</span></div>
        <div className="spread"><span className="muted">Payment</span><span>{r.method}{d.showReference && r.reference ? ` · ${r.reference}` : ''}</span></div>
      </div>
      <div className="spread rc-total"><b>Total paid</b><b>{peso(r.amount)}</b></div>
      {r.note && <span className="small muted">{r.note}</span>}
      {footer && <span className="small muted" style={{ textAlign: 'center' }}>{footer}</span>}
      {sample && <span className="rc-sample-mark" aria-hidden>SAMPLE</span>}
    </div>
  );
}
