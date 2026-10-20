import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { KIND_LABEL, type Purchase } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import { Empty } from '../components/ui';
import ReceiptCard, { type ReceiptData } from '../components/ReceiptCard';
import { ReceiptSkeleton } from '../components/Skeletons';

/** Shapes a confirmed purchase for ReceiptCard (also used by Admin → Receipts). */
export function toReceipt(p: Purchase, buyer?: { full_name?: string | null; email?: string | null } | null): ReceiptData {
  return {
    receipt_no: p.receipt_no ?? '', issued_at: p.confirmed_at, buyer_name: buyer?.full_name ?? '', buyer_email: buyer?.email ?? '',
    item: p.files?.name ?? '', kind: p.files ? KIND_LABEL[p.files.kind] : '', method: p.method, reference: p.reference_no,
    amount: Number(p.amount), note: p.note_to_buyer,
  };
}

export default function ReceiptPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { settings, profile } = useAuth();
  const { data: p, loading } = useLoad(async () =>
    must(await supabase.from('purchases').select('*, files(*), profiles!purchases_user_id_fkey(id,email,full_name,avatar_url)').eq('id', id!).single()) as Purchase, [id]);

  if (loading) return <ClientLayout back title="Receipt"><div className="page"><ReceiptSkeleton /></div></ClientLayout>;
  if (!p || p.status !== 'confirmed') return <ClientLayout back title="Receipt"><div className="page"><Empty title="No receipt yet">Receipts are issued once the publisher confirms the payment.</Empty></div></ClientLayout>;
  const buyer = p.profiles ?? profile;

  return (
    <ClientLayout back title="Receipt" hideTabs>
      <style>{`@media print { .topbar, .mobile-top, .tabbar, .no-print { display: none !important; } body { background: #fff; } .receipt { box-shadow: none !important; border: none !important; } }`}</style>
      <div className="page center" style={{ minHeight: 'calc(100vh - 72px)' }}>
        <div className="col" style={{ gap: 14, width: '100%', alignItems: 'center' }}>
          <ReceiptCard settings={settings} r={toReceipt(p, buyer)} />
          <div className="row no-print" style={{ width: '100%', maxWidth: 540 }}><button className="btn grow" onClick={() => window.print()}>Save as PDF / Print</button><button className="btn btn-primary grow" onClick={() => nav(`/file/${p.file_id}`)}>Open file</button></div>
        </div>
      </div>
    </ClientLayout>
  );
}
