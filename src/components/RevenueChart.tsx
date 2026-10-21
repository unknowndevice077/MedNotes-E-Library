import { useMemo, useState } from 'react';
import { pesoShort } from '../lib/format';

// Philippine calendar day / month, so the chart lines up with Statistics (which counts PH months)
const PH = 'Asia/Manila';
const phDay = (t: Date | string) => new Date(t).toLocaleDateString('en-CA', { timeZone: PH }); // YYYY-MM-DD

/** Daily confirmed revenue for this month (Philippine time), as simple accessible SVG bars. */
export default function RevenueChart({ rows }: { rows: { amount: number; confirmed_at: string | null }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const { series, today, monthName } = useMemo(() => {
    const todayKey = phDay(new Date());
    const [y, m] = todayKey.split('-').map(Number) as [number, number];
    const days = new Date(y, m, 0).getDate();
    const out = Array.from({ length: days }, (_, i) => ({ day: i + 1, key: `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`, v: 0 }));
    for (const r of rows) {
      if (!r.confirmed_at) continue;
      const k = phDay(r.confirmed_at);
      const s = out.find((d) => d.key === k);
      if (s) s.v += Number(r.amount);
    }
    return { series: out, today: Number(todayKey.slice(8)), monthName: new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month: 'short' }) };
  }, [rows]);
  const max = Math.max(1, ...series.map((s) => s.v));
  const total = series.reduce((a, s) => a + s.v, 0);
  const days = series.length;
  const W = 640, H = 180, gap = 4, bw = (W - gap * (days - 1)) / days;
  const h = hover !== null ? series[hover]! : null;
  const ticks = [1, 8, 15, 22, days];
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="spread">
        <div className="col" style={{ gap: 0 }}><span className="small muted">This month</span><b style={{ fontSize: 22 }}>{pesoShort(total)}</b></div>
        <span className="small muted">{h ? `${monthName} ${h.day}: ${pesoShort(h.v)}` : 'Hover a bar for the day'}</span>
      </div>
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Revenue this month, total ${pesoShort(total)}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          <defs><linearGradient id="rev" x1="0" x2="0" y1="0" y2="1"><stop offset="0" style={{ stopColor: 'var(--blue)' }} /><stop offset="1" style={{ stopColor: 'var(--green)' }} /></linearGradient></defs>
          {[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1="0" x2={W} y1={H - H * t} y2={H - H * t} style={{ stroke: 'var(--line)' }} />)}
          {series.map((s, i) => {
            const bh = s.v ? Math.max(4, (s.v / max) * (H - 8)) : 2;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={s.day > today ? 0.35 : 1}>
                <rect x={i * (bw + gap)} y={0} width={bw} height={H} fill="transparent" />
                <rect x={i * (bw + gap)} y={H - bh} width={bw} height={bh} rx={3} style={{ fill: s.v ? 'url(#rev)' : 'var(--line-strong, #cbd5e1)' }} opacity={hover === null || hover === i ? 1 : 0.45} />
              </g>
            );
          })}
        </svg>
        {/* labels in HTML so they stay a normal size and never get cut off at the edges */}
        <div className="chart-x small muted">
          {ticks.map((d) => <span key={d} style={{ left: `${((d - 0.5) / days) * 100}%` }}>{monthName} {d}</span>)}
        </div>
      </div>
    </div>
  );
}
