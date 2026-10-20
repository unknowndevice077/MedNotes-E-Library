import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { coverUrl } from '../lib/supabase';
import { KIND_TAG, type LibFile, type PurchaseStatus } from '../lib/types';
import { asset, isNative } from '../lib/platform';
import { safeImage, useTheme } from '../lib/theme';
import { Check, Clock, Lock } from './Icons';

export function Logo({ light, short, size = 36 }: { light?: boolean; short?: boolean; size?: number }) {
  // logo + name can be replaced in Admin → Appearance
  const { theme, storeName } = useTheme();
  const custom = safeImage(theme.logo);
  return (
    <span className={`logo${light ? ' light' : ''}`}>
      <span className={light ? 'tile' : ''}><img src={custom || asset('logo.png')} alt="" style={{ width: size, height: size, objectFit: 'contain' }} /></span>
      {storeName ? <span><b>{short ? storeName.split(' ')[0] : storeName}</b></span> : <span>Med<b>Notes</b>{!short && <> <i>E-Library</i></>}</span>}
    </span>
  );
}

export function Cover({ file, owned, locked, showTag = true }: { file: Pick<LibFile, 'cover_path' | 'kind' | 'name'>; owned?: boolean; locked?: boolean; showTag?: boolean }) {
  return (
    <div className="cover">
      <img src={coverUrl(file.cover_path)} alt={file.name} loading="lazy" decoding="async" width={300} height={400} />
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

export interface ConfirmOptions { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; typeToConfirm?: string }
const ConfirmCtx = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);
/** In-app replacement for window.confirm / prompt: `if (!(await confirm({ title }))) return;` */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const ask = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => { setTyped(''); setReq({ ...o, resolve }); }), []);
  const done = (v: boolean) => { req?.resolve(v); setReq(null); };
  const ok = !req?.typeToConfirm || typed.trim().toUpperCase() === req.typeToConfirm;
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {req && (
        <Modal onClose={() => done(false)} width={440}>
          <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); if (ok) done(true); }}>
            <h2>{req.title}</h2>
            {req.body && <div className="muted">{req.body}</div>}
            {req.typeToConfirm && (
              <div className="field"><label htmlFor="confirm-type">Type <b>{req.typeToConfirm}</b> to confirm</label>
                <input id="confirm-type" className="input" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} /></div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="btn" onClick={() => done(false)}>Cancel</button>
              <button type="submit" className={`btn ${req.danger ? 'btn-danger-solid' : 'btn-primary'}`} disabled={!ok} autoFocus={!req.typeToConfirm}>{req.confirmLabel ?? 'Confirm'}</button>
            </div>
          </form>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

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
