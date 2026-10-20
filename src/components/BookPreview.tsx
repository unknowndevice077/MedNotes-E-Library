import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { pesoShort } from '../lib/format';
import { KIND_LABEL, type LibFile, type Purchase } from '../lib/types';
import { Cover, Modal } from './ui';
import { Eye, Lock } from './Icons';

type Status = Purchase['status'] | undefined;
const HOVER_DELAY = 380; // ms the pointer rests on a card before it enlarges
const PRESS_DELAY = 450; // ms press-and-hold on touch screens
const W = 600, H = 380;

const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function PreviewBody({ f, status, onGo }: { f: LibFile; status: Status; onGo?: () => void }) {
  const owned = status === 'confirmed';
  return (
    <div className="pv-body">
      <div className="pv-cover"><Cover file={f} locked={!owned} owned={owned} /></div>
      <div className="col pv-info">
        <span className="eyebrow">{f.label || KIND_LABEL[f.kind]}</span>
        <h3>{f.name}</h3>
        <span className="small muted">{KIND_LABEL[f.kind]}{f.meta ? ` · ${f.meta}` : ''}</span>
        {f.description && <p className="pv-desc">{f.description}</p>}
        <span className="grow" />
        <div className="row" style={{ gap: 8 }}>
          {owned ? <Link to={`/read/${f.id}`} className="btn btn-primary btn-sm" onClick={onGo}>Read now</Link>
            : status === 'pending' ? <span className="badge b-pending">Waiting for confirmation</span>
            : <Link to={`/file/${f.id}`} className="btn btn-primary btn-sm" onClick={onGo}><Lock width={14} color="#fff" /> Unlock · {pesoShort(f.price)}</Link>}
          <Link to={`/file/${f.id}`} className="btn btn-sm" onClick={onGo}><Eye width={15} /> Details</Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps a library card: resting the pointer on it enlarges it into a preview (bigger cover,
 * description, actions); on phones a press-and-hold opens the same preview.
 */
export function PreviewCard({ f, status, children }: { f: LibFile; status: Status; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const leave = useRef<number>();
  const pressed = useRef(false);
  const [pos, setPos] = useState<{ left: number; top: number; w: number; ox: number; oy: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const nav = useNavigate();

  const close = useCallback(() => { window.clearTimeout(timer.current); setPos(null); }, []);
  const open = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(W, window.innerWidth - 24);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const left = Math.min(Math.max(12, cx - w / 2), window.innerWidth - w - 12);
    const top = Math.min(Math.max(76, cy - H / 2), Math.max(76, window.innerHeight - H - 12));
    setPos({ left, top, w, ox: cx - left, oy: cy - top }); // grow out of the card's centre
  }, []);

  useEffect(() => {
    if (!pos) return;
    const off = () => close();
    window.addEventListener('scroll', off, { passive: true, capture: true });
    window.addEventListener('resize', off);
    window.addEventListener('blur', off);
    return () => { window.removeEventListener('scroll', off, { capture: true }); window.removeEventListener('resize', off); window.removeEventListener('blur', off); };
  }, [pos, close]);
  useEffect(() => () => { window.clearTimeout(timer.current); window.clearTimeout(leave.current); }, []);

  return (
    <div
      ref={ref}
      className={`pv-anchor${pos ? ' pv-active' : ''}`}
      onPointerEnter={(e) => { if (e.pointerType !== 'mouse') return; window.clearTimeout(leave.current); timer.current = window.setTimeout(open, HOVER_DELAY); }}
      onPointerLeave={(e) => { if (e.pointerType !== 'mouse') return; window.clearTimeout(timer.current); leave.current = window.setTimeout(close, 120); }}
      onTouchStart={() => { pressed.current = false; timer.current = window.setTimeout(() => { pressed.current = true; navigator.vibrate?.(10); setSheet(true); }, PRESS_DELAY); }}
      onTouchMove={() => window.clearTimeout(timer.current)}
      onTouchEnd={() => window.clearTimeout(timer.current)}
      onClickCapture={(e) => { if (pressed.current) { e.preventDefault(); e.stopPropagation(); pressed.current = false; } }}
      onContextMenu={(e) => { if (pressed.current || !finePointer()) e.preventDefault(); }}
    >
      {children}
      {pos && createPortal(
        <div className="pv-pop" role="dialog" aria-label={`${f.name} preview`}
          style={{ left: pos.left, top: pos.top, width: pos.w, minHeight: H, transformOrigin: `${pos.ox}px ${pos.oy}px` }}
          onMouseEnter={() => window.clearTimeout(leave.current)}
          onMouseLeave={() => { leave.current = window.setTimeout(close, 120); }}
          onClick={(e) => { if ((e.target as HTMLElement).closest('a')) return; close(); nav(`/file/${f.id}`); }}>
          <PreviewBody f={f} status={status} onGo={close} />
        </div>,
        document.body,
      )}
      {sheet && (
        <Modal onClose={() => setSheet(false)} width={460}>
          <PreviewBody f={f} status={status} onGo={() => setSheet(false)} />
        </Modal>
      )}
    </div>
  );
}

/** Adds `in` to `.reveal` children as they scroll into view (fade + rise). */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = () => [...root.querySelectorAll<HTMLElement>('.reveal:not(.in)')];
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const show = () => els().forEach((e) => e.classList.add('in'));
      show();
      const mo = new MutationObserver(show); mo.observe(root, { childList: true, subtree: true });
      return () => mo.disconnect();
    }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    const watch = () => els().forEach((e) => io.observe(e));
    watch();
    const mo = new MutationObserver(watch); mo.observe(root, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);
  return ref;
}
