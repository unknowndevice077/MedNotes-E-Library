import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { Close, Eraser, Marker, Pen, Trash, Undo } from './Icons';

// Notes + drawings in the reader. Strokes are stored per page in 0..1 page coordinates, so they
// stay put at any zoom or screen size. Saved to reader_notes (only the buyer can read their row),
// with a local copy so notes still work offline in the app.

export interface Stroke { t: 'pen' | 'hl'; c: string; w: number; p: number[] }
export type Ink = Record<string, Stroke[]>;
export interface Tool { mode: 'pen' | 'hl' | 'erase'; color: string; size: number }

export const COLORS = ['#0f172a', '#dc2626', '#2563eb', '#16a34a', '#f59e0b'];
export const HL_COLORS = ['#fde047', '#86efac', '#93c5fd', '#f9a8d4'];

const local = (id: string) => `mn.notes.${id}`;
const NONE: Stroke[] = [];

export function useReaderNotes(fileId: string) {
  const { session } = useAuth();
  const [body, setBodyState] = useState('');
  const [ink, setInkState] = useState<Ink>({});
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle');
  const latest = useRef({ body: '', ink: {} as Ink });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const history = useRef<Ink[]>([]);

  useEffect(() => {
    let alive = true;
    try {
      const cached = JSON.parse(localStorage.getItem(local(fileId)) || 'null');
      if (cached) { latest.current = cached; setBodyState(cached.body ?? ''); setInkState(cached.ink ?? {}); }
    } catch { /* private mode */ }
    if (!session) return;
    supabase.from('reader_notes').select('body, ink').eq('file_id', fileId).maybeSingle().then(({ data }) => {
      if (!alive || !data) return;
      latest.current = { body: data.body ?? '', ink: (data.ink ?? {}) as Ink };
      setBodyState(latest.current.body); setInkState(latest.current.ink);
    });
    return () => { alive = false; };
  }, [fileId, session]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!session) return;
    setStatus('saving');
    const { error } = await supabase.from('reader_notes').upsert({ file_id: fileId, user_id: session.user.id, ...latest.current, updated_at: new Date().toISOString() });
    setStatus(error ? 'offline' : 'saved');
  }, [fileId, session]);

  const queue = useCallback(() => {
    try { localStorage.setItem(local(fileId), JSON.stringify(latest.current)); } catch { /* full or private */ }
    clearTimeout(timer.current);
    setStatus('saving');
    timer.current = setTimeout(flush, 900);
  }, [fileId, flush]);
  // save what's pending when the reader closes
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush(); } }, [flush]);

  const setBody = (v: string) => { latest.current = { ...latest.current, body: v }; setBodyState(v); queue(); };
  const setInk = (next: Ink) => {
    history.current = [...history.current.slice(-49), latest.current.ink];
    latest.current = { ...latest.current, ink: next }; setInkState(next); queue();
  };
  const setPage = (key: string, strokes: Stroke[]) => {
    const next = { ...latest.current.ink };
    if (strokes.length) next[key] = strokes; else delete next[key];
    setInk(next);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    latest.current = { ...latest.current, ink: prev }; setInkState(prev); queue();
  };
  const canUndo = history.current.length > 0;
  return { body, setBody, ink, setPage, setInk, undo, canUndo, status };
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  if (s.p.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = s.c; ctx.lineWidth = Math.max(1, s.w * w);
  if (s.t === 'hl') { ctx.globalAlpha = 0.38; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'butt'; }
  ctx.beginPath();
  ctx.moveTo(s.p[0]! * w, s.p[1]! * h);
  if (s.p.length === 2) ctx.lineTo(s.p[0]! * w + 0.1, s.p[1]! * h);
  for (let i = 2; i < s.p.length; i += 2) ctx.lineTo(s.p[i]! * w, s.p[i + 1]! * h);
  ctx.stroke();
  ctx.restore();
}

/** A drawing layer over one page (or the sketch pad). Draws only while `active`. */
export function InkLayer({ strokes, onChange, active, tool }: { strokes: Stroke[] | undefined; onChange: (s: Stroke[]) => void; active: boolean; tool: Tool }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const live = useRef<Stroke | null>(null);
  const list = strokes ?? NONE;

  useLayoutEffect(() => {
    const c = canvas.current!.parentElement!;
    const ro = new ResizeObserver(() => setSize({ w: c.clientWidth, h: c.clientHeight }));
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const paint = useCallback(() => {
    const c = canvas.current; if (!c || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr)) { c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr); }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    for (const s of list) drawStroke(ctx, s, size.w, size.h);
    if (live.current) drawStroke(ctx, live.current, size.w, size.h);
  }, [list, size]);
  useEffect(paint, [paint]);

  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
  };
  const erase = (x: number, y: number) => {
    const reach = 14 / Math.max(1, size.w);
    const keep = list.filter((s) => { for (let i = 0; i < s.p.length; i += 2) if (Math.hypot(s.p[i]! - x, (s.p[i + 1]! - y) * (size.h / size.w)) < reach + s.w / 2) return false; return true; });
    if (keep.length !== list.length) onChange(keep);
  };
  const down = (e: React.PointerEvent) => {
    if (!active || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    if (tool.mode === 'erase') { erase(x, y); live.current = { t: 'pen', c: '', w: 0, p: [] }; return; }
    const hl = tool.mode === 'hl';
    live.current = { t: hl ? 'hl' : 'pen', c: tool.color, w: (hl ? tool.size * 4.5 : tool.size) / 1000, p: [x, y] };
    paint();
  };
  const move = (e: React.PointerEvent) => {
    if (!live.current) return;
    const [x, y] = at(e);
    if (tool.mode === 'erase') return erase(x, y);
    const p = live.current.p;
    // skip points closer than ~1px, keeps saved drawings small
    if (Math.hypot(x - p[p.length - 2]!, y - p[p.length - 1]!) * size.w < 1.2) return;
    p.push(Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000);
    paint();
  };
  const up = () => {
    const s = live.current; live.current = null;
    if (s && s.p.length) onChange([...list, s]);
  };

  return (
    <canvas ref={canvas} className={`ink${active ? ' on' : ''}${active && tool.mode === 'erase' ? ' erasing' : ''}`}
      style={{ width: size.w, height: size.h }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
  );
}

/** Pen / highlighter / eraser, colours, size, undo. */
export function DrawBar({ tool, setTool, onUndo, canUndo, onClear, onDone }: { tool: Tool; setTool: (t: Tool) => void; onUndo: () => void; canUndo: boolean; onClear?: () => void; onDone?: () => void }) {
  const colors = tool.mode === 'hl' ? HL_COLORS : COLORS;
  const pickMode = (mode: Tool['mode']) => setTool({ ...tool, mode, color: mode === 'hl' ? (HL_COLORS.includes(tool.color) ? tool.color : HL_COLORS[0]!) : mode === 'pen' ? (COLORS.includes(tool.color) ? tool.color : COLORS[1]!) : tool.color });
  return (
    <div className="drawbar" role="toolbar" aria-label="Drawing tools">
      <button type="button" className={tool.mode === 'pen' ? 'on' : ''} onClick={() => pickMode('pen')} aria-label="Pen" title="Pen"><Pen /></button>
      <button type="button" className={tool.mode === 'hl' ? 'on' : ''} onClick={() => pickMode('hl')} aria-label="Highlighter" title="Highlighter"><Marker /></button>
      <button type="button" className={tool.mode === 'erase' ? 'on' : ''} onClick={() => pickMode('erase')} aria-label="Eraser" title="Eraser"><Eraser /></button>
      <span className="drawbar-sep" />
      {tool.mode !== 'erase' && colors.map((c) => <button key={c} type="button" className={`swatch-btn${tool.color === c ? ' on' : ''}`} style={{ '--sw': c } as React.CSSProperties} onClick={() => setTool({ ...tool, color: c })} aria-label={`Colour ${c}`} />)}
      {tool.mode !== 'erase' && (
        <span className="drawbar-sizes">
          {[2, 4, 7].map((n) => <button key={n} type="button" className={tool.size === n ? 'on' : ''} onClick={() => setTool({ ...tool, size: n })} aria-label={`Size ${n}`}><i style={{ width: n + 3, height: n + 3 }} /></button>)}
        </span>
      )}
      <span className="drawbar-sep" />
      <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo /></button>
      {onClear && <button type="button" onClick={onClear} aria-label="Clear drawings" title="Clear all drawings"><Trash /></button>}
      {onDone && <button type="button" className="drawbar-done" onClick={onDone} aria-label="Stop drawing"><Close /> Done</button>}
    </div>
  );
}
