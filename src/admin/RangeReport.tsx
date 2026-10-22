import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { must, useLoad } from '../lib/useLoad';
import { errMsg, peso, pesoShort } from '../lib/format';
import { useToast } from '../components/ui';
import { Bar } from '../components/Skeletons';

// Every date here is a Philippine calendar day, "YYYY-MM-DD"; ranges are [from, to) like the database.
const PH = 'Asia/Manila';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: PH });
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d: string, n: number) => { const x = new Date(d.slice(0, 7) + '-01T00:00:00Z'); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const ts = (d: string) => `${d}T00:00:00+08:00`;
const nice = (d: string, year = false) => new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });

export type Preset = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | 'year' | 'custom';
const PRESETS: [Preset, string][] = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['lastMonth', 'Last month'], ['year', 'This year'], ['custom', 'Custom']];

export function rangeFor(p: Preset, custom: { from: string; to: string }) {
  const t = today();
  const month0 = t.slice(0, 8) + '01';
  let from: string, to: string, prevFrom: string, prevTo: string;
  switch (p) {
    case 'today': from = t; to = addDays(t, 1); break;
    case '7d': from = addDays(t, -6); to = addDays(t, 1); break;
    case '30d': from = addDays(t, -29); to = addDays(t, 1); break;
    case 'month': from = month0; to = addMonths(month0, 1); break;
    case 'lastMonth': from = addMonths(month0, -1); to = month0; break;
    case 'year': from = t.slice(0, 4) + '-01-01'; to = `${Number(t.slice(0, 4)) + 1}-01-01`; break;
    default: from = custom.from; to = addDays(custom.to, 1);
  }
  // compared with the period just before it: the month before for months, the year before for years
  if (p === 'month' || p === 'lastMonth') { prevFrom = addMonths(from, -1); prevTo = from; }
  else if (p === 'year') { prevFrom = `${Number(from.slice(0, 4)) - 1}-01-01`; prevTo = from; }
  else { prevFrom = addDays(from, -daysBetween(from, to)); prevTo = from; }
  return { from, to, prevFrom, prevTo };
}

interface RangeStats {
  revenue: number; file_revenue: number; slot_revenue: number; orders: number; files_sold: number; slots_sold: number;
  buyers: number; returning_buyers: number; new_users: number; revoked_count: number; revoked_amount: number;
  submitted: number; confirmed: number; rejected: number; pending: number; avg_confirm_hours: number | null;
  by_category: { label: string; revenue: number; sold: number }[];
  by_file: { id: string; name: string; label: string; revenue: number; sold: number }[];
  daily: { day: string; revenue: number }[];
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
function change(cur: number, prev: number) {
  if (!prev) return cur ? { text: 'New this period', up: true } : { text: 'Same as before', up: null };
  const c = Math.round(((cur - prev) / prev) * 100);
  return { text: `${c >= 0 ? '+' : ''}${c}% vs before`, up: c === 0 ? null : c > 0 };
}
function hours(h: number | null) {
  if (h === null || h === undefined) return '—';
  if (h < 1 / 60) return 'Under a minute';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} hours`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

/** The report for one period: money, orders, buyers, what sold, how payments went, plus a CSV for the accountant. */
export default function RangeReport() {
  const [preset, setPreset] = useState<Preset>('month');
  const [custom, setCustom] = useState(() => ({ from: addDays(today(), -13), to: today() }));
  const r = rangeFor(preset, custom);
  const bad = preset === 'custom' && (!custom.from || !custom.to || custom.from > custom.to);
  const { data, loading } = useLoad(async () => {
    if (bad) return null;
    const [cur, prev] = await Promise.all([
      supabase.rpc('admin_range_stats', { p_from: ts(r.from), p_to: ts(r.to) }),
      supabase.rpc('admin_range_stats', { p_from: ts(r.prevFrom), p_to: ts(r.prevTo) }),
    ]);
    return { cur: must(cur) as RangeStats, prev: must(prev) as RangeStats };
  }, [r.from, r.to, bad], { cache: false });
  const [allFiles, setAllFiles] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const span = `${nice(r.from, true)} – ${nice(addDays(r.to, -1), true)}`;
  const prevSpan = `${nice(r.prevFrom)} – ${nice(addDays(r.prevTo, -1), true)}`;

  async function exportCsv() {
    setExporting(true);
    try {
      const rows = must(await supabase.rpc('admin_sales_export', { p_from: ts(r.from), p_to: ts(r.to) })) as
        { at: string; receipt_no: string | null; buyer: string | null; email: string | null; item: string; category: string | null; method: string | null; amount: number; note: string }[];
      const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const lines = [['Date', 'Receipt no.', 'Buyer', 'Email', 'Item', 'Category', 'Payment method', 'Amount (PHP)', 'Note']];
      for (const x of rows) {
        lines.push([new Date(x.at).toLocaleString('en-PH', { timeZone: PH }), x.receipt_no ?? '', x.buyer ?? '', x.email ?? '', x.item, x.category ?? '', x.method ?? '', Number(x.amount).toFixed(2), x.note]);
      }
      lines.push(['', '', '', '', '', '', 'Total', rows.reduce((a, x) => a + Number(x.amount), 0).toFixed(2), '']);
      // the BOM makes Excel read ₱ and accents correctly
      const blob = new Blob(['﻿' + lines.map((l) => l.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mednotes-sales-${r.from}-to-${addDays(r.to, -1)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(rows.length ? `Exported ${rows.length} line${rows.length === 1 ? '' : 's'}.` : 'No sales in this period, exported an empty sheet.');
    } catch (e) { toast(errMsg(e)); } finally { setExporting(false); }
  }

  const c = data?.cur, p = data?.prev;
  // up to two months: a bar per day; longer: a bar per month
  const bars = useMemo(() => {
    if (!c) return [];
    if (c.daily.length <= 62) return c.daily.map((d) => ({ key: d.day, label: nice(d.day), value: Number(d.revenue) }));
    const m = new Map<string, number>();
    for (const d of c.daily) m.set(d.day.slice(0, 7), (m.get(d.day.slice(0, 7)) ?? 0) + Number(d.revenue));
    return [...m].map(([k, v]) => ({ key: k, label: new Date(k + '-01T00:00:00').toLocaleDateString('en-PH', { month: 'short', year: '2-digit' }), value: v }));
  }, [c]);

  return (
    <div className="col range-report" style={{ gap: 16 }}>
      <div className="card col" style={{ gap: 12 }}>
        <div className="spread wrap" style={{ gap: 10 }}>
          <div className="col" style={{ gap: 2 }}><h3>Report</h3><span className="small muted">{bad ? 'Pick a start and end date' : `${span} · compared with ${prevSpan}`}</span></div>
          <button className="btn" onClick={exportCsv} disabled={exporting || bad}>{exporting ? 'Exporting…' : 'Export CSV'}</button>
        </div>
        <div className="chips range-chips" role="group" aria-label="Period">
          {PRESETS.map(([k, l]) => <button key={k} className={`chip soft${preset === k ? ' on' : ''}`} aria-pressed={preset === k} onClick={() => setPreset(k)}>{l}</button>)}
        </div>
        {preset === 'custom' && (
          <div className="row wrap" style={{ gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor="rr-from">From</label><input id="rr-from" type="date" className="input" value={custom.from} max={today()} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor="rr-to">To</label><input id="rr-to" type="date" className="input" value={custom.to} max={today()} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></div>
          </div>
        )}
      </div>

      {loading || !c || !p ? (bad ? null : <div className="kpi-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="stat"><Bar w={90} h={14} /><Bar w={120} h={26} /></div>)}</div>) : (
        <>
          <div className="kpi-grid">
            <Kpi name="Revenue" value={pesoShort(c.revenue)} sub={change(c.revenue, p.revenue)} green />
            <Kpi name="Net after revoked" value={pesoShort(c.revenue - c.revoked_amount)} note={c.revoked_count ? `${c.revoked_count} revoked · −${peso(c.revoked_amount)}` : 'Nothing revoked'} />
            <Kpi name="Orders" value={String(c.orders)} sub={change(c.orders, p.orders)} note={`${c.files_sold} files · ${c.slots_sold} slot orders`} />
            <Kpi name="Average order" value={c.orders ? peso(c.revenue / c.orders) : '—'} sub={p.orders && c.orders ? change(c.revenue / c.orders, p.revenue / p.orders) : undefined} />
            <Kpi name="Returning buyers" value={c.buyers ? `${pct(c.returning_buyers, c.buyers)}%` : '—'} note={`${c.returning_buyers} of ${c.buyers} buyer${c.buyers === 1 ? '' : 's'} bought before`} />
            <Kpi name="New sign-ups" value={String(c.new_users)} sub={change(c.new_users, p.new_users)} />
          </div>

          <div className="card col">
            <div className="spread"><h3>Revenue</h3><span className="small muted">{bars.length > 31 && c.daily.length > 62 ? 'By month' : 'By day'}</span></div>
            {c.revenue ? <BarChart bars={bars} /> : <span className="muted">No sales in this period.</span>}
          </div>

          <div className="row wrap" style={{ alignItems: 'stretch', gap: 16 }}>
            <div className="card col grow" style={{ minWidth: 'min(300px, 100%)', flexBasis: 360 }}>
              <h3>By category</h3>
              {!c.by_category.length ? <span className="muted">No file sales in this period.</span> : c.by_category.map((x) => (
                <div key={x.label} className="col" style={{ gap: 4 }}>
                  <div className="spread"><span>{x.label}</span><span className="small"><b>{peso(x.revenue)}</b> · {x.sold} sold</span></div>
                  <div className="meter"><i style={{ width: `${pct(Number(x.revenue), Number(c.file_revenue)) || 1}%` }} /></div>
                </div>
              ))}
            </div>
            <div className="card col grow" style={{ minWidth: 'min(300px, 100%)', flexBasis: 360 }}>
              <h3>Payments</h3>
              <div className="pay-stats">
                <span>Submitted</span><b>{c.submitted}</b>
                <span>Confirmed</span><b>{c.confirmed}</b>
                <span>Rejected</span><b>{c.rejected}{c.confirmed + c.rejected ? <span className="small muted"> · {pct(c.rejected, c.confirmed + c.rejected)}% of decided</span> : null}</b>
                <span>Still waiting</span><b>{c.pending}</b>
                <span>Average time to confirm</span><b>{hours(c.avg_confirm_hours)}</b>
                <span>Revoked after confirming</span><b>{c.revoked_count ? `${c.revoked_count} · −${peso(c.revoked_amount)}` : '0'}</b>
              </div>
            </div>
          </div>

          <div className="card col">
            <div className="spread"><h3>Files sold</h3>{c.by_file.length > 10 && <button className="link" onClick={() => setAllFiles(!allFiles)}>{allFiles ? 'Show top 10' : `Show all ${c.by_file.length}`}</button>}</div>
            {!c.by_file.length ? <span className="muted">No file sales in this period.</span> : (
              <div className="table rtable">
                <div className="tr th hide-sm"><span className="grow">File</span><span style={{ width: 140 }}>Category</span><span style={{ width: 80 }}>Sold</span><span style={{ width: 120 }}>Revenue</span></div>
                {(allFiles ? c.by_file : c.by_file.slice(0, 10)).map((f) => (
                  <div key={f.id} className="tr"><b className="grow">{f.name}</b><span style={{ width: 140 }} className="muted">{f.label || '—'}</span><span style={{ width: 80 }}>{f.sold} sold</span><b style={{ width: 120, color: 'var(--green)' }}>{peso(f.revenue)}</b></div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ name, value, sub, note, green }: { name: string; value: string; sub?: { text: string; up: boolean | null }; note?: string; green?: boolean }) {
  return (
    <div className="stat">
      <span className="muted">{name}</span>
      <span className="v" style={green ? { color: 'var(--green)' } : undefined}>{value}</span>
      {sub && <span className={`small delta${sub.up === true ? ' up' : sub.up === false ? ' down' : ''}`}>{sub.text}</span>}
      {note && <span className="small muted">{note}</span>}
    </div>
  );
}

function BarChart({ bars }: { bars: { key: string; label: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const n = bars.length, W = 760, H = 180, gap = n > 40 ? 2 : 4, bw = (W - gap * (n - 1)) / n;
  const h = hover !== null ? bars[hover] : null;
  const ticks = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="chart-wrap" onPointerMove={(e) => setHover(barAt(e, n))} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Revenue chart" style={{ width: '100%', height: 'auto', display: 'block' }}>
          {[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1="0" x2={W} y1={H - H * t} y2={H - H * t} style={{ stroke: 'var(--line)' }} />)}
          {hover !== null && <rect className="chart-band" x={hover * (bw + gap) - gap / 2} y={0} width={bw + gap} height={H} />}
          {bars.map((b, i) => {
            const bh = b.value ? Math.max(4, (b.value / max) * (H - 8)) : 2;
            return <rect key={b.key} x={i * (bw + gap)} y={H - bh} width={bw} height={bh} rx={Math.min(3, bw / 3)}
              style={{ fill: !b.value ? 'var(--line-strong, #cbd5e1)' : hover === i ? 'var(--blue-deep, #1d4ed8)' : 'var(--blue)' }} />;
          })}
        </svg>
        {h && <ChartTip x={(hover! + 0.5) / n} title={h.label} lines={[peso(h.value)]} />}
      </div>
      <div className="chart-x small muted">
        {ticks.map((i) => <span key={i} style={{ left: `${((i + 0.5) / n) * 100}%` }}>{bars[i]!.label}</span>)}
      </div>
    </div>
  );
}

/** Which bar the pointer is over, from its x position, so moving across gaps never "leaves" the chart. */
export function barAt(e: React.PointerEvent<HTMLElement>, n: number) {
  const r = e.currentTarget.getBoundingClientRect();
  return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
}

/** A small label that glides above the hovered bar. */
export function ChartTip({ x, title, lines }: { x: number; title: string; lines: string[] }) {
  return (
    <div className="chart-tip" style={{ left: `${x * 100}%`, transform: `translateX(${x < 0.15 ? '-10%' : x > 0.85 ? '-90%' : '-50%'})` }}>
      <b>{title}</b>{lines.map((l) => <span key={l}>{l}</span>)}
    </div>
  );
}
