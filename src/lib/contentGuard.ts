// Web-side screen protection for the reader. Browsers can't truly block screenshots, so this
// removes the content from view whenever capture is likely: the window loses focus (snipping
// tools, screen recorders, Alt-Tab), DevTools looks open, Print Screen is pressed, or printing
// starts. Also blocks the inspect / save / print / view-source shortcuts. On Android, the app
// additionally sets FLAG_SECURE (see screenGuard.ts), which the OS enforces.
import { useEffect, useState } from 'react';
import { isNative } from './platform';

export type GuardReason = 'focus' | 'devtools' | 'capture' | null;

const BLOCKED = (e: KeyboardEvent) => {
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  return k === 'f12'
    || (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(k)) // DevTools
    || (mod && e.altKey && ['i', 'j', 'c'].includes(k)) // DevTools (macOS)
    || (mod && ['s', 'p', 'u'].includes(k)); // save, print, view source
};

/** Heuristic: docked DevTools makes the inner viewport much smaller than the window. */
function devtoolsOpen() {
  if (isNative || matchMedia('(pointer: coarse)').matches) return false;
  const w = window.outerWidth - window.innerWidth * (window.visualViewport?.scale ?? 1);
  const h = window.outerHeight - window.innerHeight * (window.visualViewport?.scale ?? 1);
  return w > 240 || h > 260;
}

export function useContentGuard(active: boolean): GuardReason {
  const [reason, setReason] = useState<GuardReason>(null);
  useEffect(() => {
    if (!active) return;
    let captureTimer: number | undefined;
    const check = () => {
      if (devtoolsOpen()) return setReason('devtools');
      if (document.visibilityState === 'hidden' || !document.hasFocus()) return setReason('focus');
      setReason((r) => (r === 'capture' ? r : null));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (BLOCKED(e)) { e.preventDefault(); e.stopPropagation(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        setReason('capture');
        navigator.clipboard?.writeText('').catch(() => undefined); // drop the captured image from the clipboard where allowed
        clearTimeout(captureTimer);
        captureTimer = window.setTimeout(() => { setReason(null); check(); }, 2500);
      }
    };
    const onPrint = () => setReason('capture');
    const onAfterPrint = () => { setReason(null); check(); };
    const blockDrag = (e: DragEvent) => e.preventDefault();
    window.addEventListener('blur', check);
    window.addEventListener('focus', check);
    window.addEventListener('resize', check);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('beforeprint', onPrint);
    window.addEventListener('afterprint', onAfterPrint);
    document.addEventListener('dragstart', blockDrag);
    const t = window.setInterval(check, 1000);
    check();
    return () => {
      clearInterval(t); clearTimeout(captureTimer);
      window.removeEventListener('blur', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('resize', check);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('beforeprint', onPrint);
      window.removeEventListener('afterprint', onAfterPrint);
      document.removeEventListener('dragstart', blockDrag);
    };
  }, [active]);
  return active ? reason : null;
}

export const guardMessage: Record<Exclude<GuardReason, null>, { title: string; body: string }> = {
  focus: { title: 'Content hidden', body: 'Your file is hidden while MedNotes is not the active window. Click here to keep reading.' },
  devtools: { title: 'Close developer tools', body: 'Paid files are hidden while browser developer tools are open.' },
  capture: { title: 'Screenshots are not allowed', body: 'This file is protected. The content will come back in a moment.' },
};
