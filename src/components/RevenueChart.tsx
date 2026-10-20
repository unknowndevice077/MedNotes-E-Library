import { useMemo, useState } from 'react';
import { pesoShort } from '../lib/format';

/** Daily confirmed revenue for the last `days` days, as simple accessible SVG bars. */
export default function RevenueChart({ rows, days = 30 }: { rows: { amount: number; confirmed_at: string | null }[]; days?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (days - 1));
    const out = Array.from({ length: days }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return { d, v: 0 }; });
    for (const r of rows) {
      if (!r.confirmed_at) continue;
      const i = Math.floor((new Date(r.confirmed_at).getTime() - start.getTime()) / 86400000);
      if (i >= 0 && i < days) out[i]!.v += Number(r.amount);
    }
    return out;
  }, [rows, days]);
  const max = Math.max(1, ...series.map((s) => s.v));
  const total = series.reduce((a, s) => a + s.v, 0);
  const W = 640, H = 180, gap = 4, bw = (W - gap * (days - 1)) / days;
  const fmt = (d: Date) => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
  const h = hover !== null ? series[hover]! : null;
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="spread">
        <div className="col" style={{ gap: 0 }}><span className="small muted">Last {days} days</span><b style={{ fontSize: 22 }}>{pesoShort(total)}</b></div>
        <span className="small muted">{h ? `${fmt(h.d)}: ${pesoShort(h.v)}` : 'Hover a bar for the day'}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={`Revenue over the last ${days} days, total ${pesoShort(total)}`} style={{ width: '100%', height: 'auto' }}>
        <defs><linearGradient id="rev" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0284c7" /><stop offset="1" stopColor="#059669" /></linearGradient></defs>
        {[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1="0" x2={W} y1={H - H * t} y2={H - H * t} stroke="#eef2f7" />)}
        {series.map((s, i) => {
          const bh = s.v ? Math.max(4, (s.v / max) * (H - 8)) : 2;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={i * (bw + gap)} y={0} width={bw} height={H} fill="transparent" />
              <rect x={i * (bw + gap)} y={H - bh} width={bw} height={bh} rx={3} fill={s.v ? 'url(#rev)' : '#e2e8f0'} opacity={hover === null || hover === i ? 1 : 0.45} />
            </g>
          );
        })}
        {[0, Math.floor(days / 2), days - 1].map((i) => (
          <text key={i} x={i * (bw + gap) + bw / 2} y={H + 16} textAnchor="middle" fontSize="11" fill="#94a3b8">{fmt(series[i]!.d)}</text>
        ))}
      </svg>
    </div>
  );
}
