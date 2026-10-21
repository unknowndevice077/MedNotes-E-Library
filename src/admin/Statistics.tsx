import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { must, useLoad } from '../lib/useLoad';
import { dateTime, peso, pesoShort } from '../lib/format';
import { AdminLayout } from '../components/Layouts';
import { Empty, useConfirm, useToast } from '../components/ui';
import { DashboardSkeleton } from '../components/Skeletons';

interface Reset { id: number; at: string; since: string | null; revenue: number; files_sold: number; slot_revenue: number; slots_sold: number; new_users: number; profiles: { full_name: string; email: string } | null }
interface Month { month: string; revenue: number; sales: number; slot_revenue: number; slot_sales: number; new_users: number }

const label = (m: string, long = false) => new Date(m + 'T00:00:00').toLocaleDateString('en-PH', { month: long ? 'long' : 'short', year: long ? 'numeric' : '2-digit' });

/** Monthly totals kept forever: resetting the dashboard never clears these. */
export default function AdminStatistics() {
  const [range, setRange] = useState(12);
  const { data, loading } = useLoad(async () => (must(await supabase.rpc('admin_monthly_stats', { p_months: range })) as Month[]).reverse(), [range], { cache: false });
  const [hover, setHover] = useState<number | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const { data: resets, reload: reloadResets } = useLoad(async () =>
    must(await supabase.from('stats_resets').select('*, profiles(full_name, email)').order('at', { ascending: false }).limit(50)) as Reset[], [], { cache: false });
  async function resetStats() {
    if (!(await confirm({ title: 'Reset the dashboard statistics?', body: 'The dashboard counts start again from now. What it had counted is saved below under Resets, and every month stays in this chart.', confirmLabel: 'Reset statistics' }))) return;
    const { error } = await supabase.rpc('admin_reset_stats');
    if (error) return toast(error.message);
    toast('Dashboard reset. Saved under Resets on this page.'); reloadResets();
  }
  const total = (k: keyof Month) => (data ?? []).reduce((a, m) => a + Number(m[k]), 0);
  const income = (m: Month) => Number(m.revenue) + Number(m.slot_revenue);
  const max = Math.max(1, ...(data ?? []).map(income));
  const H = 200, W = 760, gap = 10, bw = data?.length ? (W - gap * (data.length - 1)) / data.length : 0;
  const h = hover !== null ? data?.[hover] : null;

  return (
    <AdminLayout title="Statistics" subtitle="Month by month, from the first sale. Resetting the dashboard doesn't touch this."
      actions={<><div className="seg">{[6, 12, 24].map((n) => <button key={n} className={range === n ? 'on' : ''} onClick={() => setRange(n)}>{n} months</button>)}</div>
        <button className="btn" onClick={resetStats}>Reset statistics</button></>}>
      {loading || !data ? <DashboardSkeleton /> : data.length === 0 ? <Empty title="No sales yet" /> : (
        <>
          <div className="row wrap" style={{ gap: 16 }}>
            <div className="stat"><span className="muted">Revenue</span><span className="v" style={{ color: 'var(--green)' }}>{pesoShort(total('revenue') + total('slot_revenue'))}</span><span className="small muted">Last {data.length} months</span></div>
            <div className="stat"><span className="muted">Files sold</span><span className="v">{total('sales')}</span><span className="small muted">{peso(total('revenue'))}</span></div>
            <div className="stat"><span className="muted">Extra device slots</span><span className="v">{total('slot_sales')}</span><span className="small muted">{peso(total('slot_revenue'))}</span></div>
            <div className="stat"><span className="muted">New buyers</span><span className="v">{total('new_users')}</span><span className="small muted">Sign-ups</span></div>
          </div>
          <div className="card col">
            <div className="spread"><h3>Revenue by month</h3><span className="small muted">{h ? `${label(h.month, true)}: ${peso(income(h))} · ${h.sales} files · ${h.slot_sales} slots` : 'Hover a month'}</span></div>
            <svg viewBox={`0 0 ${W} ${H + 24}`} role="img" aria-label="Revenue by month" style={{ width: '100%', height: 'auto' }}>
              {[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1="0" x2={W} y1={H - H * t} y2={H - H * t} stroke="#eef2f7" />)}
              {data.map((m, i) => {
                const files = (Number(m.revenue) / max) * (H - 8), slots = (Number(m.slot_revenue) / max) * (H - 8);
                return (
                  <g key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === i ? 1 : 0.5}>
                    <rect x={i * (bw + gap)} y={0} width={bw} height={H} fill="transparent" />
                    <rect x={i * (bw + gap)} y={H - files} width={bw} height={Math.max(files, income(m) ? 0 : 2)} rx={4} style={{ fill: income(m) ? 'var(--blue)' : '#e2e8f0' }} />
                    {slots > 0 && <rect x={i * (bw + gap)} y={H - files - slots} width={bw} height={slots} rx={4} style={{ fill: 'var(--green)' }} />}
                    <text x={i * (bw + gap) + bw / 2} y={H + 16} textAnchor="middle" fontSize="11" fill="#94a3b8">{label(m.month)}</text>
                  </g>
                );
              })}
            </svg>
            <div className="row small muted" style={{ gap: 14 }}><span className="row" style={{ gap: 6 }}><i className="legend" style={{ background: 'var(--blue)' }} />Files</span><span className="row" style={{ gap: 6 }}><i className="legend" style={{ background: 'var(--green)' }} />Device slots</span></div>
          </div>
          <div className="table rtable">
            <div className="tr th hide-sm"><span style={{ width: 160 }}>Month</span><span style={{ width: 140 }}>Revenue</span><span style={{ width: 110 }}>Files sold</span><span style={{ width: 120 }}>Slots sold</span><span style={{ width: 120 }}>New buyers</span></div>
            {[...data].reverse().map((m) => (
              <div key={m.month} className="tr">
                <b style={{ width: 160 }}>{label(m.month, true)}</b>
                <b style={{ width: 140, color: 'var(--green)' }}>{peso(income(m))}</b>
                <span style={{ width: 110 }}>{m.sales} files</span>
                <span style={{ width: 120 }}>{m.slot_sales} slots</span>
                <span style={{ width: 120 }}>{m.new_users} buyers</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="card col" style={{ gap: 10 }}>
        <h3>Resets</h3>
        {!resets?.length ? <span className="small muted">The dashboard has never been reset.</span> : resets.map((r) => (
          <div key={r.id} className="spread wrap" style={{ gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <span className="col" style={{ gap: 0 }}><b>{dateTime(r.at)}</b>
              <span className="small muted">by {r.profiles?.full_name || r.profiles?.email || 'an admin'} · counted {r.since ? `since ${dateTime(r.since)}` : 'from the start'}</span></span>
            <span className="small" style={{ textAlign: 'right' }}><b style={{ color: 'var(--green)' }}>{peso(Number(r.revenue) + Number(r.slot_revenue))}</b> · {r.files_sold} files · {r.slots_sold} slots · {r.new_users} new buyers</span>
          </div>
        ))}
      </div>
    </AdminLayout>
  );
}
