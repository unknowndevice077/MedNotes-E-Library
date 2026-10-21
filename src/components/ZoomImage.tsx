import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

/** An image you can tap to see full screen: pinch or double-tap to zoom, drag to look around. */
export default function ZoomImage({ src, alt, className, style }: { src: string; alt: string; className?: string; style?: CSSProperties }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="zoom-thumb" onClick={() => setOpen(true)} aria-label={`${alt}: tap to zoom`}>
        <img src={src} alt={alt} className={className} style={style} />
        <span className="zoom-hint" aria-hidden="true">Tap to zoom</span>
      </button>
      {open && <Viewer src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

function Viewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ d: number; s: number; x: number; y: number; mx: number; my: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);

  const clamp = (s: number) => Math.min(6, Math.max(1, s));
  const snapshot = () => {
    const p = [...pts.current.values()];
    const mx = p.reduce((a, q) => a + q.x, 0) / p.length, my = p.reduce((a, q) => a + q.y, 0) / p.length;
    const d = p.length > 1 ? Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y) : 0;
    start.current = { d, s: t.s, x: t.x, y: t.y, mx, my };
  };

  const down = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    snapshot();
  };
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !start.current) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...pts.current.values()], st = start.current;
    const mx = p.reduce((a, q) => a + q.x, 0) / p.length, my = p.reduce((a, q) => a + q.y, 0) / p.length;
    const s = p.length > 1 && st.d ? clamp(st.s * (Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y) / st.d)) : st.s;
    setT(s === 1 ? { s, x: 0, y: 0 } : { s, x: st.x + mx - st.mx, y: st.y + my - st.my });
  };
  const up = (e: React.PointerEvent) => {
    const wasOne = pts.current.size === 1;
    const st = start.current;
    pts.current.delete(e.pointerId);
    if (pts.current.size) { snapshot(); return; }
    start.current = null;
    // a tap (not a drag): double-tap toggles zoom around the tapped spot
    if (wasOne && st && Math.hypot(e.clientX - st.mx, e.clientY - st.my) < 8) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        if (t.s > 1) setT({ s: 1, x: 0, y: 0 });
        else { const cx = window.innerWidth / 2, cy = window.innerHeight / 2; setT({ s: 2.5, x: (cx - e.clientX) * 1.5, y: (cy - e.clientY) * 1.5 }); }
      } else lastTap.current = now;
    }
  };
  const wheel = (e: React.WheelEvent) => {
    const s = clamp(t.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    setT(s === 1 ? { s, x: 0, y: 0 } : { ...t, s });
  };

  return createPortal(
    <div className="zoom-view" role="dialog" aria-modal="true" aria-label={alt}>
      <div className="zoom-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }} />
      </div>
      <div className="zoom-bar">
        <button type="button" className="btn btn-sm" onClick={() => setT({ s: clamp(t.s / 1.5), x: t.s / 1.5 <= 1 ? 0 : t.x, y: t.s / 1.5 <= 1 ? 0 : t.y })} aria-label="Zoom out">−</button>
        <span className="small">{Math.round(t.s * 100)}%</span>
        <button type="button" className="btn btn-sm" onClick={() => setT({ ...t, s: clamp(t.s * 1.5) })} aria-label="Zoom in">+</button>
        <a className="btn btn-sm" href={src} target="_blank" rel="noreferrer">Open original</a>
        <button type="button" className="btn btn-sm btn-primary" onClick={onClose}>Close</button>
      </div>
    </div>,
    document.body,
  );
}
