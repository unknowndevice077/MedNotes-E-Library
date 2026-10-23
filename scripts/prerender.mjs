// After `vite build`: give GitHub Pages a real page (HTTP 200) for each app route, and
// pre-render the privacy / data-deletion pages to static HTML so Google's and Meta's
// reviewers (and crawlers without JavaScript) see the policy text.
// Usage: VITE_BASE=/MedNotes-E-Library/ node scripts/prerender.mjs
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const base = process.env.VITE_BASE || '/';
const shell = readFileSync(join(dist, 'index.html'), 'utf8');

// Plain SPA routes: same app shell, but served with 200 instead of the 404 fallback.
for (const r of ['sign-in', 'sign-up', 'forgot-password', 'reset-password', 'auth/confirm', 'library', 'my-files', 'devices', 'account', 'saved', 'admin']) {
  mkdirSync(join(dist, r), { recursive: true });
  writeFileSync(join(dist, r, 'index.html'), shell);
}
copyFileSync(join(dist, 'index.html'), join(dist, '404.html'));

// Node has no browser storage; the app's Supabase client expects it.
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
globalThis.localStorage ??= mem();
globalThis.sessionStorage ??= mem();

// Contact details for the pages, from the same public RPC the live pages call.
const env = Object.fromEntries(
  readFileSync(join(root, '.env.production'), 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const contact = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/public_contact`, {
  method: 'POST', headers: { apikey: env.VITE_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: '{}',
}).then((r) => (r.ok ? r.json() : null)).catch(() => null);

const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom', mode: 'production', logLevel: 'error' });
try {
  const legal = await vite.ssrLoadModule('/src/pages/Legal.tsx');
  if (contact) legal.presetContact(contact);
  const pages = [
    ['privacy', legal.Privacy, 'Privacy policy · MedNotes E-Library'],
    ['data-deletion', legal.DataDeletion, 'Delete your data · MedNotes E-Library'],
  ];
  for (const [route, Page, title] of pages) {
    const html = renderToStaticMarkup(
      React.createElement(MemoryRouter, { basename: base.replace(/\/$/, '') || '/', initialEntries: [base + route] }, React.createElement(Page)),
    );
    const out = shell.replace('<div id="root"></div>', `<div id="root">${html}</div>`).replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
    mkdirSync(join(dist, route), { recursive: true });
    writeFileSync(join(dist, route, 'index.html'), out);
    console.log(`prerendered /${route} (${html.length} chars, contact ${contact ? 'included' : 'missing'})`);
  }
} finally {
  await vite.close();
}
process.exit(0); // the app's Supabase client keeps timers alive
