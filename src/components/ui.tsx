import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { coverUrl } from '../lib/supabase';
import { KIND_TAG, type LibFile, type PurchaseStatus } from '../lib/types';
import { asset, isNative } from '../lib/platform';
import { Check, Clock, Lock } from './Icons';

export function Logo({ light, short, size = 36 }: { light?: boolean; short?: boolean; size?: number }) {
  return (
    <span className={`logo${light ? ' light' : ''}`}>
      <span className={light ? 'tile' : ''}><img src={asset('logo.png')} alt="" style={{ width: size, height: size }} /></span>
      <span>Med<b>Notes</b>{!short && <> <i>E-Library</i></>}</span>
    </span>
  );
}

export function Cover({ file, owned, locked, showTag = true }: { file: Pick<LibFile, 'cover_path' | 'kind' | 'name'>; owned?: boolean; locked?: boolean; showTag?: boolean }) {
  return (
    <div className="cover">
      <img src={coverUrl(file.cover_path)} alt={file.name} loading="lazy" />
      {showTag && <span className="tag">{KIND_TAG[file.kind]}</span>}
      {locked && <span className="lockpill"><Lock color="#fff" /></span>}
      {owned && !locked && <span className="corner badge b-ok">Owned</span>}
    </div>
  );
}

export function Thumb({ file }: { file?: Pick<LibFile, 'cover_path' | 'name'> | null }) {
  return <span className="thumb"><img src={coverUrl(file?.cover_path)} alt="" /></span>;
}

export function StatusBadge({ status, reason }: { status: PurchaseStatus; reason?: string }) {
  if (status === 'confirmed') return <span className="badge b-ok"><Check /> Confirmed · Unlocked</span>;
  if (status === 'pending') return <span className="badge b-pending"><Clock /> Pending confirmation</span>;
  return <span className="badge b-red">Rejected{reason ? `: ${reason}` : ''}</span>;
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      className={`toggle${on ? ' on' : ''}`} onClick={() => onChange?.(!on)} />
  );
}

export function Modal({ children, onClose, width = 520 }: { children: ReactNode; onClose?: () => void; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  // Portal to <body>: an animated/transformed ancestor would otherwise trap the fixed overlay
  // under the sticky headers (the admin upload dialog bug).
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: width }}>{children}</div>
    </div>,
    document.body,
  );
}

export function Loading({ label }: { label?: string }) {
  return <div className="center col" style={{ padding: 48 }}><div className="spinner" />{label && <span className="muted">{label}</span>}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="card col center" style={{ padding: 40, textAlign: 'center' }}><h3>{title}</h3>{children && <div className="muted">{children}</div>}</div>;
}

const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = useCallback((m: string) => { setMsg(m); setTimeout(() => setMsg((cur) => (cur === m ? null : cur)), 3200); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

/** Phone-sized layout: always in the Android app, and in narrow browser windows. */
export function useIsMobile() {
  const q = '(max-width: 760px)';
  const [m, setM] = useState(() => isNative || window.matchMedia(q).matches);
  useEffect(() => {
    if (isNative) return;
    const mq = window.matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return m;
}
