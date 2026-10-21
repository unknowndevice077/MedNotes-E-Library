import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../lib/theme';
import { SITE_EDIT } from '../lib/siteText';
import type { Theme } from '../lib/types';

// Runs inside the Admin → Appearance preview frame. The editor (same origin, our parent window)
// sends the draft look and which page to show; clicks here only pick text, so nothing in the
// preview can buy, sign out or submit anything.
export type EditMsg =
  | { type: 'mn-theme'; theme: Theme }
  | { type: 'mn-nav'; path: string }
  | { type: 'mn-focus'; key: string | null };

const fromEditor = (e: MessageEvent) => e.origin === window.location.origin && e.source === window.parent;
const tell = (msg: object) => window.parent.postMessage(msg, window.location.origin);

function Bridge() {
  const { preview } = useTheme();
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    document.documentElement.classList.add('site-edit');
    // while a text is being typed in place, hold the editor's echo back so React doesn't move the caret
    let editing: HTMLElement | null = null;
    let held: Theme | null = null;
    const finish = () => {
      if (!editing) return;
      editing.removeAttribute('contenteditable');
      editing.classList.remove('editing');
      tell({ type: 'mn-edit-done', key: editing.getAttribute('data-edit') });
      editing = null;
      if (held) { preview(held); held = null; }
    };
    const startEdit = (el: HTMLElement) => {
      if (editing === el) return;
      finish();
      editing = el;
      el.setAttribute('contenteditable', 'plaintext-only');
      el.classList.add('editing');
      el.focus();
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
    };
    const onInput = (e: Event) => {
      const el = e.target as HTMLElement;
      if (el === editing) tell({ type: 'mn-edit', key: el.getAttribute('data-edit'), text: (el.textContent ?? '').replace(/\s+/g, ' ').trimStart() });
    };
    const onKey = (e: KeyboardEvent) => {
      if (!editing) return;
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); editing.blur(); }
    };
    const onBlur = (e: FocusEvent) => { if (e.target === editing) finish(); };
    const onMsg = (e: MessageEvent) => {
      if (!fromEditor(e)) return;
      const m = e.data as EditMsg;
      if (m?.type === 'mn-theme') { if (editing) held = m.theme ?? {}; else preview(m.theme ?? {}); }
      else if (m?.type === 'mn-nav' && typeof m.path === 'string' && /^\/[^/]/.test(m.path)) nav(m.path);
      else if (m?.type === 'mn-focus') {
        document.querySelectorAll('.edit-on').forEach((el) => el.classList.remove('edit-on'));
        if (!m.key) return;
        const els = document.querySelectorAll(`[data-edit="${CSS.escape(m.key)}"]`);
        els.forEach((el) => el.classList.add('edit-on'));
        els[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };
    const pick = (e: Event) => {
      const target = (e.target as Element | null)?.closest?.('[data-edit]') as HTMLElement | null;
      if (target && target === editing) return; // clicks inside the text being typed just move the caret
      e.preventDefault(); e.stopPropagation();
      if (!target || e.type !== 'click') return;
      tell({ type: 'mn-pick', key: target.getAttribute('data-edit') });
      // text is typed over in place; input boxes (their hint text) are edited in the side panel
      if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') startEdit(target);
    };
    window.addEventListener('message', onMsg);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusout', onBlur, true);
    // capture phase, so links, buttons, menus and forms never see the click
    for (const t of ['click', 'submit', 'auxclick', 'dblclick']) window.addEventListener(t, pick, true);
    tell({ type: 'mn-ready' });
    return () => {
      window.removeEventListener('message', onMsg);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusout', onBlur, true);
      for (const t of ['click', 'submit', 'auxclick', 'dblclick']) window.removeEventListener(t, pick, true);
    };
  }, [nav, preview]);

  useEffect(() => { tell({ type: 'mn-page', path: loc.pathname }); }, [loc.pathname]);
  return null;
}

export default function SiteEditBridge() {
  return SITE_EDIT ? <Bridge /> : null;
}
