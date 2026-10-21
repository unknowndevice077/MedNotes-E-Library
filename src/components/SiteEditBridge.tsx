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
    const onMsg = (e: MessageEvent) => {
      if (!fromEditor(e)) return;
      const m = e.data as EditMsg;
      if (m?.type === 'mn-theme') preview(m.theme ?? {});
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
      e.preventDefault(); e.stopPropagation();
      const key = (e.target as Element | null)?.closest?.('[data-edit]')?.getAttribute('data-edit');
      if (key && e.type === 'click') tell({ type: 'mn-pick', key });
    };
    window.addEventListener('message', onMsg);
    // capture phase, so links, buttons, menus and forms never see the click
    for (const t of ['click', 'submit', 'auxclick', 'dblclick']) window.addEventListener(t, pick, true);
    tell({ type: 'mn-ready' });
    return () => {
      window.removeEventListener('message', onMsg);
      for (const t of ['click', 'submit', 'auxclick', 'dblclick']) window.removeEventListener(t, pick, true);
    };
  }, [nav, preview]);

  useEffect(() => { tell({ type: 'mn-page', path: loc.pathname }); }, [loc.pathname]);
  return null;
}

export default function SiteEditBridge() {
  return SITE_EDIT ? <Bridge /> : null;
}
