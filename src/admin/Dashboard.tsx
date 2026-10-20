import { Link } from 'react-router-dom';
import { supabase, coverUrl } from '../lib/supabase';
import { must, useLoad } from '../lib/useLoad';
import { ago, initials, peso, pesoShort } from '../lib/format';
import type { Purchase } from '../lib/types';
import { AdminLayout } from '../components/Layouts';
import RevenueChart from '../components/RevenueChart';
import { Loading } from '../components/ui';

interface Stats {
  revenue_month: number; revenue_last_month: number; pending: number; oldest_pending: string | null;
  users: number; users_week: number; files: number; files_by_kind: Record<string, number>;
  top: { id: string; name: string; cover_path: string | null; sold: number }[];
}

export default function Dashboard() {
  const { data, loading } = useLoad(async () => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [s, p, rev, users] = await Promise.all([
      supabase.rpc('admin_stats'),
      supabase.from('purchases').select('*, files(name,cover_path,kind), profiles!purchases_user_id_fkey(id,email,full_name,avatar_url)').eq('status', 'pending').order('created_at').limit(5),
      supabase.from('purchases').select('amount, confirmed_at').eq('status', 'confirmed').gte('confirmed_at', since),
      supabase.from('profiles').select('id, full_name, email, provider, created_at').order('created_at', { ascending: false }).limit(5),
    ]);
    return { stats: must(s) as Stats, pending: must(p) as Purchase[], revenue: must(rev) as { amount: number; confirmed_at: string }[], users: must(users) as { id: string; full_name: string; email: string; provider: string; created_at: string }[] };
  });
  if (loading || !data) return <AdminLayout title="Dashboard"><Loading /></AdminLayout>;
  const { stats, pending, revenue, users } = data;
  const change = stats.revenue_last_month ? Math.round(((stats.revenue_month - stats.revenue_last_month) / stats.revenue_last_month) * 100) : null;
  const kinds = Object.entries(stats.files_by_kind).map(([k, n]) => `${k.toUpperCase()} ${n}`).join(' · ');
  return (
    <AdminLayout title="Dashboard">
      <div className="row wrap" style={{ gap: 16, alignItems: 'stretch' }}>
        <div className="stat"><span className="muted">Revenue this month</span><span className="v" style={{ color: 'var(--green)' }}>{pesoShort(stats.revenue_month)}</span><span className="small muted">{change === null ? 'First month' : `${change >= 0 ? '+' : ''}${change}% vs last month`}</span></div>
        <Link to="/admin/payments" className="stat" style={{ background: stats.pending ? 'var(--amber-50)' : undefined, borderColor: stats.pending ? '#fde68a' : undefined, color: 'inherit' }}>
          <span className="muted">Payments to confirm</span><span className="v" style={{ color: 'var(--amber)' }}>{stats.pending}</span><span className="small muted">{stats.oldest_pending ? `Oldest: ${ago(stats.oldest_pending)}` : 'All caught up'}</span></Link>
        <Link to="/admin/users" className="stat" style={{ color: 'inherit' }}><span className="muted">Users</span><span className="v">{stats.users.toLocaleString()}</span><span className="small muted">{stats.users_week} new this week</span></Link>
        <Link to="/admin/files" className="stat" style={{ color: 'inherit' }}><span className="muted">Files</span><span className="v">{stats.files}</span><span className="small muted">{kinds || '—'}</span></Link>
      </div>
      <div className="row wrap" style={{ gap: 16, alignItems: 'stretch' }}>
        <div className="card col grow" style={{ minWidth: 340 }}><h3>Revenue</h3><RevenueChart rows={revenue} /></div>
        <div className="card col" style={{ width: 420, maxWidth: '100%' }}>
          <div className="spread"><h3>New buyers</h3><Link to="/admin/users" className="link">All users</Link></div>
          {users.map((u) => (
            <Link key={u.id} to={`/admin/users/${u.id}`} className="spread" style={{ color: 'inherit' }}>
              <span className="row"><span className="avatar">{initials(u.full_name, u.email)}</span><span className="col" style={{ gap: 0 }}><b>{u.full_name || u.email}</b><span className="small muted">{u.provider} · {ago(u.created_at)}</span></span></span>
            </Link>
          ))}
        </div>
      </div>
      <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div className="card col grow" style={{ minWidth: 320 }}>
          <div className="spread"><h3>Waiting for confirmation</h3><Link to="/admin/payments" className="link">View all</Link></div>
          {pending.length === 0 && <span className="muted">No payments waiting.</span>}
          {pending.map((p) => (
            <div key={p.id} className="spread">
              <div className="row"><span className="avatar">{initials(p.profiles?.full_name ?? '', p.profiles?.email)}</span>
                <div className="col" style={{ gap: 0 }}><b>{p.profiles?.full_name || p.profiles?.email}</b><span className="small muted">{p.files?.name} · {p.method}</span></div></div>
              <b>{peso(p.amount)}</b>
              <Link to={`/admin/payments?id=${p.id}`} className="btn btn-sm btn-green">Review</Link>
            </div>
          ))}
        </div>
        <div className="card col" style={{ width: 420, maxWidth: '100%' }}>
          <h3>Top sellers</h3>
          {stats.top.length === 0 && <span className="muted">No sales yet.</span>}
          {stats.top.map((t) => (
            <div key={t.id} className="spread"><span className="row"><span className="thumb"><img src={coverUrl(t.cover_path)} alt="" /></span>{t.name}</span><b>{t.sold} sold</b></div>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}
