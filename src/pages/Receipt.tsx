import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { dateTime, peso } from '../lib/format';
import { KIND_LABEL, type Purchase } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import { Empty, Loading, Logo } from '../components/ui';
import { Check } from '../components/Icons';

export default function ReceiptPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { settings, profile } = useAuth();
  const { data: p, loading } = useLoad(async () =>
    must(await supabase.from('purchases').select('*, files(*), profiles!purchases_user_id_fkey(id,email,full_name,avatar_url)').eq('id', id!).single()) as Purchase, [id]);

  if (loading) return <ClientLayout back title="Receipt"><Loading /></ClientLayout>;
  if (!p || p.status !== 'confirmed') return <ClientLayout back title="Receipt"><div className="page"><Empty title="No receipt yet">Receipts are issued once the publisher confirms the payment.</Empty></div></ClientLayout>;
  const buyer = p.profiles ?? profile;

  return (
    <ClientLayout back title="Receipt" hideTabs>
      <style>{`@media print { .topbar, .mobile-top, .tabbar, .no-print { display: none !important; } body { background: #fff; } .receipt { box-shadow: none !important; border: none !important; } }`}</style>
      <div className="page center" style={{ minHeight: 'calc(100vh - 72px)' }}>
        <div className="card col receipt" style={{ width: '100%', maxWidth: 540, padding: 36, gap: 16, boxShadow: 'var(--shadow)' }}>
          <div className="spread"><Logo /><span className="badge b-ok"><Check /> PAID</span></div>
          <div className="col" style={{ gap: 2 }}><h2>Official receipt</h2><span className="small muted">{p.receipt_no} · Issued {dateTime(p.confirmed_at)}</span></div>
          <div className="col" style={{ gap: 8, borderTop: '1px dashed var(--line-strong)', borderBottom: '1px dashed var(--line-strong)', padding: '16px 0' }}>
            <div className="spread"><span className="muted">Billed to</span><span>{buyer?.full_name || buyer?.email}</span></div>
            <div className="spread"><span className="muted">Email</span><span>{buyer?.email}</span></div>
            <div className="spread"><span className="muted">Item</span><span style={{ textAlign: 'right' }}>{p.files?.name} ({p.files ? KIND_LABEL[p.files.kind] : ''})</span></div>
            <div className="spread"><span className="muted">Payment</span><span>{p.method}{p.reference_no ? ` · ${p.reference_no}` : ''}</span></div>
            <div className="spread"><span className="muted">Confirmed by</span><span>{settings?.receipt_business}</span></div>
            {settings?.receipt_tin && <div className="spread"><span className="muted">TIN</span><span>{settings.receipt_tin}</span></div>}
          </div>
          <div className="spread"><b>Total paid</b><b style={{ fontSize: 24, color: 'var(--green)' }}>{peso(p.amount)}</b></div>
          {p.note_to_buyer && <span className="small muted">{p.note_to_buyer}</span>}
          <span className="small muted" style={{ textAlign: 'center' }}>{settings?.receipt_footer}</span>
          <div className="row no-print"><button className="btn grow" onClick={() => window.print()}>Save as PDF / Print</button><button className="btn btn-primary grow" onClick={() => nav(`/file/${p.file_id}`)}>Open file</button></div>
        </div>
      </div>
    </ClientLayout>
  );
}
