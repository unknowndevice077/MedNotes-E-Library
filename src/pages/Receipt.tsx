import { useRef } from 'react';
import { useMatch, useNavigate, useParams } from 'react-router-dom';
import { downloadReceiptImage } from '../lib/receiptImage';
import { Download } from '../components/Icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import type { DeviceOrder, Purchase } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import { Empty } from '../components/ui';
import ReceiptCard from '../components/ReceiptCard';
import { ReceiptSkeleton } from '../components/Skeletons';

export { slotReceipt, toReceipt } from '../lib/receipts';
import { slotReceipt, toReceipt } from '../lib/receipts';

export default function ReceiptPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { settings, profile } = useAuth();
  const isSlot = !!useMatch('/receipt/slot/:id');
  const shot = useRef<HTMLDivElement>(null);
  const { data, loading } = useLoad(async () => (isSlot
    ? { slot: must(await supabase.from('device_orders').select('*, profiles!device_orders_user_id_fkey(id,email,full_name,avatar_url)').eq('id', id!).single()) as DeviceOrder }
    : { file: must(await supabase.from('purchases').select('*, files(*), profiles!purchases_user_id_fkey(id,email,full_name,avatar_url)').eq('id', id!).single()) as Purchase }), [id, isSlot]);
  const p = data?.file ?? data?.slot ?? null;

  if (loading) return <ClientLayout back title="Receipt"><div className="page"><ReceiptSkeleton /></div></ClientLayout>;
  if (!p || p.status !== 'confirmed') return <ClientLayout back title="Receipt"><div className="page"><Empty title="No receipt yet">Receipts are issued once the publisher confirms the payment.</Empty></div></ClientLayout>;
  const buyer = p.profiles ?? profile;
  const r = data?.file ? toReceipt(data.file, buyer) : slotReceipt(data!.slot!, buyer);

  return (
    <ClientLayout back title="Receipt" hideTabs>
      <style>{`@media print { .topbar, .mobile-top, .tabbar, .no-print { display: none !important; } body { background: #fff; } .receipt { box-shadow: none !important; border: none !important; } }`}</style>
      <div className="page center" style={{ minHeight: 'calc(100vh - 72px)' }}>
        <div className="col" style={{ gap: 14, width: '100%', alignItems: 'center' }}>
          <div ref={shot} className="receipt-shot"><ReceiptCard settings={settings} r={r} /></div>
          <div className="btn-row no-print" style={{ width: '100%', maxWidth: 540 }}>
            <button className="btn grow" onClick={() => shot.current && downloadReceiptImage(shot.current, `receipt-${r.receipt_no}`)}><Download width={18} /> Save as image</button>
            <button className="btn grow" onClick={() => window.print()}>Save as PDF / Print</button>
            {data?.file ? <button className="btn btn-primary grow" onClick={() => nav(`/file/${data.file!.file_id}`)}>Open file</button>
              : <button className="btn btn-primary grow" onClick={() => nav('/devices')}>My devices</button>}</div>
        </div>
      </div>
    </ClientLayout>
  );
}
