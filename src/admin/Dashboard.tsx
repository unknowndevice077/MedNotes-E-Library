import { Link } from 'react-router-dom';
import { supabase, coverUrl } from '../lib/supabase';
import { must, useLoad } from '../lib/useLoad';
import { ago, dateTime, errMsg, initials, peso, pesoShort } from '../lib/format';
import type { Purchase } from '../lib/types';
import { AdminLayout } from '../components/Layouts';
import { useConfirm, useToast } from '../components/ui';
import { DashboardSkeleton } from '../components/Skeletons';

interface Stats {
  revenue_month: number; revenue_last_month: number; pending: number; oldest_pending: string | null;
  users: number; users_week: number; files: number; files_by_kind: Record<string, number>; since: string | null;
  top: { id: string; name: string; cover_path: string | null; sold: number }[];
}

export default function Dashboard() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, reload } = useLoad(async () => {
    const st = must(await supabase.rpc('admin_stats')) as Stats;
    // the dashboard is "what's happening now"; charts and history live in Statistics
    const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) + 'T00:00:00+08:00').toISOString();
    const [p, rev, slots, users, recent] = await Promise.all([
      supabase.from('purchases').select('*, files(name,cover_path,kind), profiles!purchases_user_id_fkey(id,email,full_name,avatar_url)').eq('status', 'pending').order('created_at').limit(5),
      supabase.from('purchases').select('amount').eq('status', 'confirmed').neq('method', 'Granted by admin').gte('confirmed_at', today),
      supabase.from('device_orders').select('amount').eq('status', 'confirmed').gte('confirmed_at', today),
      supabase.from('profiles').select('id, full_name, email, provider, created_at').order('created_at', { ascending: false }).limit(5),
      supabase.from('purchases').select('*, files(name,cover_path,kind), profiles!purchases_user_id_fkey(id,email,full_name,avatar_url)').eq('status', 'confirmed').order('confirmed_at', { ascending: false }).limit(6),
    ]);
    const todaySales = [...must(rev), ...must(slots)] as { amount: number }[];
    return { stats: st, pending: must(p) as Purchase[], recent: must(recent) as Purchase[],
      today: { total: todaySales.reduce((a, r) => a + Number(r.amount), 0), count: todaySales.length }, users: must(users) as { id: string; full_name: string; email: string; provider: string; created_at: string }[] };
  });
  async function resetStats() {
    if (!(await confirm({ title: 'Reset the dashboard statistics?', body: 'Revenue, top sellers and new-buyer counts start again from now. Every month stays in Statistics, and you can undo this from Logs.', confirmLabel: 'Reset statistics' }))) return;
    const { error } = await supabase.rpc('admin_reset_stats');
    if (error) return toast(errMsg(error));
    toast('Statistics reset. Monthly history is kept in Statistics.'); reload();
  }
  if (loading || !data) return <AdminLayout title="Dashboard"><DashboardSkeleton /></AdminLayout>;
  const { stats, pending, recent, today, users } = data;
  const change = stats.revenue_last_month ? Math.round(((stats.revenue_month - stats.revenue_last_month) / stats.revenue_last_month) * 100) : null;
  const kinds = Object.entries(stats.files_by_kind).map(([k, n]) => `${k.toUpperCase()} ${n}`).join(' · ');
  return (
    <AdminLayout title="Dashboard" subtitle={stats.since ? `Counting since ${dateTime(stats.since)}` : undefined}
      actions={<><Link to="/admin/statistics" className="btn">Statistics</Link><button className="btn" onClick={resetStats}>Reset statistics</button></>}>
      <div className="row wrap" style={{ gap: 16, alignItems: 'stretch' }}>
        <div className="stat"><span className="muted">Sales today</span><span className="v" style={{ color: 'var(--green)' }}>{pesoShort(today.total)}</span><span className="small muted">{today.count === 1 ? '1 sale' : `${today.count} sales`}</span></div>
        <div className="stat"><span className="muted">{stats.since && new Date(stats.since) > new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 8) + '01T00:00:00+08:00') ? 'Revenue since reset' : 'Revenue this month'}</span><span className="v" style={{ color: 'var(--green)' }}>{pesoShort(stats.revenue_month)}</span><span className="small muted">{change === null ? 'First month' : `${change >= 0 ? '+' : ''}${change}% vs last month`}</span></div>
        <Link to="/admin/payments" className="stat" style={{ background: stats.pending ? 'var(--amber-50)' : undefined, borderColor: stats.pending ? '#fde68a' : undefined, color: 'inherit' }}>
          <span className="muted">Payments to confirm</span><span className="v" style={{ color: 'var(--amber)' }}>{stats.pending}</span><span className="small muted">{stats.oldest_pending ? `Oldest: ${ago(stats.oldest_pending)}` : 'All caught up'}</span></Link>
        <Link to="/admin/users" className="stat" style={{ color: 'inherit' }}><span className="muted">Users</span><span className="v">{stats.users.toLocaleString()}</span><span className="small muted">{stats.users_week} new this week</span></Link>
        <Link to="/admin/files" className="stat" style={{ color: 'inherit' }}><span className="muted">Files</span><span className="v">{stats.files}</span><span className="small muted">{kinds || '—'}</span></Link>
      </div>
      <div className="row wrap" style={{ gap: 16, alignItems: 'stretch' }}>
        <div className="card col grow" style={{ minWidth: 'min(340px, 100%)' }}>
          <div className="spread"><h3>Latest sales</h3><Link to="/admin/statistics" className="link">Charts and history</Link></div>
          {recent.length === 0 && <span className="muted">No sales yet.</span>}
          {recent.map((p) => (
            <div key={p.id} className="spread" style={{ gap: 10 }}>
              <span className="row" style={{ minWidth: 0 }}><span className="thumb"><img src={coverUrl(p.files?.cover_path ?? null)} alt="" /></span>
                <span className="col" style={{ gap: 0, minWidth: 0 }}><b className="ellipsis">{p.files?.name}</b><span className="small muted ellipsis">{p.profiles?.full_name || p.profiles?.email} · {p.confirmed_at ? ago(p.confirmed_at) : ''}</span></span></span>
              <b>{p.method === 'Granted by admin' ? 'Granted' : peso(p.amount)}</b>
            </div>
          ))}
        </div>
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
        <div className="card col grow" style={{ minWidth: 'min(320px, 100%)' }}>
          <div className="spread"><h3>Waiting for confirmation</h3><Link to="/admin/payments" className="link">View all</Link></div>
          {pending.length === 0 && <span className="muted">No payments waiting.</span>}
          {pending.map((p) => (
            <div key={p.id} className="spread" style={{ flexWrap: 'wrap', rowGap: 8 }}>
              <div className="row" style={{ minWidth: 0, flex: '1 1 160px' }}><span className="avatar">{initials(p.profiles?.full_name ?? '', p.profiles?.email)}</span>
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
