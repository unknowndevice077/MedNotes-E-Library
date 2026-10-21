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

/**
 * Screenshot and screen-recording shortcuts: Windows key combos (Win+Shift+S snipping, Win+PrtSc,
 * Win+Alt+R / Win+G game-bar recording), macOS Cmd+Shift+3/4/5, Print Screen and Alt+PrtSc.
 * We hide on the very first key of a combo, before the tool can grab the screen.
 */
const CAPTURE_START = (e: KeyboardEvent) =>
  e.key === 'Meta' || e.key === 'OS' || e.key === 'PrintScreen' || e.metaKey
  || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's'); // Edge/Chrome web capture

// hidden with a class on <html> straight from the key handler (no React render), so the very next frame is blank
const hideNow = (on: boolean) => document.documentElement.classList.toggle('capture-hide', on);

export function useContentGuard(active: boolean): GuardReason {
  const [reason, setReason] = useState<GuardReason>(null);
  useEffect(() => {
    if (!active) return;
    let captureTimer: number | undefined;
    let away = false; // mouse left the window (a recorder or snipping tool is being used elsewhere)
    const check = () => {
      if (devtoolsOpen()) return setReason('devtools');
      if (document.visibilityState === 'hidden' || !document.hasFocus() || away) return setReason('focus');
      setReason((r) => (r === 'capture' ? r : null));
    };
    const capture = (ms = 2500) => {
      hideNow(true);
      setReason('capture');
      document.querySelectorAll('video').forEach((v) => v.pause());
      clearTimeout(captureTimer);
      captureTimer = window.setTimeout(() => { hideNow(false); setReason(null); check(); }, ms);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (BLOCKED(e)) { e.preventDefault(); e.stopPropagation(); }
      if (!isNative && CAPTURE_START(e)) capture(1800);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        capture();
        navigator.clipboard?.writeText('').catch(() => undefined); // drop the captured image from the clipboard where allowed
      }
    };
    const onLeave = (e: MouseEvent) => { if (!e.relatedTarget && !matchMedia('(pointer: coarse)').matches) { away = true; check(); } };
    const onEnter = () => { if (away) { away = false; check(); } };
    // a hidden tab or unfocused window also pauses video, so a recorder gets nothing playing
    const onHide = () => { if (document.visibilityState === 'hidden' || !document.hasFocus()) document.querySelectorAll('video').forEach((v) => v.pause()); };
    const onPrint = () => setReason('capture');
    const onAfterPrint = () => { setReason(null); check(); };
    const blockDrag = (e: DragEvent) => e.preventDefault();
    window.addEventListener('blur', check);
    window.addEventListener('blur', onHide);
    window.addEventListener('focus', check);
    document.documentElement.addEventListener('mouseleave', onLeave);
    document.documentElement.addEventListener('mouseenter', onEnter);
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
      clearInterval(t); clearTimeout(captureTimer); hideNow(false);
      window.removeEventListener('blur', check);
      window.removeEventListener('blur', onHide);
      window.removeEventListener('focus', check);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      document.documentElement.removeEventListener('mouseenter', onEnter);
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
  focus: { title: 'Content hidden', body: 'Your file is hidden while MedNotes is not the active window or the pointer is outside it. Click here to keep reading.' },
  devtools: { title: 'Close developer tools', body: 'Paid files are hidden while browser developer tools are open.' },
  capture: { title: 'Screenshots and recording are not allowed', body: 'This file is protected. The content comes back in a moment.' },
};
