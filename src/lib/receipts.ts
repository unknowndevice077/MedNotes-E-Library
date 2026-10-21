import { KIND_LABEL, type DeviceOrder, type Purchase } from './types';
import type { ReceiptData } from '../components/ReceiptCard';

/** Shapes a confirmed purchase for ReceiptCard (also used by Admin → Receipts). */
export function toReceipt(p: Purchase, buyer?: { full_name?: string | null; email?: string | null } | null): ReceiptData {
  return {
    receipt_no: p.receipt_no ?? '', issued_at: p.confirmed_at, buyer_name: buyer?.full_name ?? '', buyer_email: buyer?.email ?? '',
    item: p.files?.name ?? '', kind: p.files ? KIND_LABEL[p.files.kind] : '', method: p.method, reference: p.reference_no,
    amount: Number(p.amount), note: p.note_to_buyer,
  };
}

/** Shapes a confirmed extra-device-slot order for ReceiptCard. */
export function slotReceipt(o: DeviceOrder, buyer?: { full_name?: string | null; email?: string | null } | null): ReceiptData {
  return {
    receipt_no: o.receipt_no ?? '', issued_at: o.confirmed_at, buyer_name: buyer?.full_name ?? '', buyer_email: buyer?.email ?? '',
    item: `Extra ${o.kind} slot${o.qty > 1 ? ` ×${o.qty}` : ''}`, kind: 'Device access', method: o.method, reference: o.reference_no,
    amount: Number(o.amount), note: o.note_to_buyer,
  };
}
