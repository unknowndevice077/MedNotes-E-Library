// Click-through audit: opens every page as a buyer and as an admin, at computer and phone size, and
// presses every button and link one by one (fresh page each time). Fails on crashes, console errors,
// failed requests and blank pages. Buttons that change data are skipped here; the e2e suite covers them.
// Needs the dev server (5173) and the local Supabase with the demo seed. Report: tests/screenshots/clickall.json
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { dropUser, makeUser, root, service } from './helpers.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MARIA = { id: '33333333-0000-0000-0000-000000000001', email: 'maria.reyes@mednotes.test', password: 'DemoBuyer#2026' };
const SIZES = { computer: { width: 1366, height: 800 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
// anything that pays, deletes, signs out or saves is left to the e2e suite
const UNSAFE = /delete|remove|sign (it )?out|log ?out|reject|confirm|reset|revert|save|submit|resubmit|grant|suspend|clear|upload|replace|send|apply|publish|change (email|password)|set password|buy|continue to payment|done|mark|undo|edit record|restore/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser, admin;
const report = {};
// the page list is built before the tests are declared, so look the demo ids up first
const { data: buys } = await service.from('purchases').select('id, file_id, status').eq('user_id', MARIA.id);
const owned = buys.find((b) => b.status === 'confirmed');
const { data: paid } = await service.from('files').select('id').eq('published', true).eq('is_free', false);
const ids = { owned: owned.file_id, receipt: owned.id, locked: paid.find((f) => !buys.some((b) => b.file_id === f.id)).id };

before(async () => {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  admin = await makeUser('click-admin', { admin: true });
});
after(async () => {
  await browser?.close();
  await dropUser(admin);
  mkdirSync(join(root, 'tests', 'screenshots'), { recursive: true });
  writeFileSync(join(root, 'tests', 'screenshots', 'clickall.json'), JSON.stringify(report, null, 2));
});

const PAGES = {
  buyer: () => ['/library', `/file/${ids.locked}`, `/file/${ids.owned}`, '/file/a0000000-0000-0000-0000-000000000019', `/checkout/${ids.locked}`,
    '/my-files', '/payments', '/help', `/receipt/${ids.receipt}`, '/devices', '/checkout/slot/computer', '/account',
    '/read/a0000000-0000-0000-0000-000000000019', '/read/a0000000-0000-0000-0000-000000000020', '/read/a0000000-0000-0000-0000-000000000021',
    '/read/a0000000-0000-0000-0000-000000000022', '/read/a0000000-0000-0000-0000-000000000023', '/privacy', '/data-deletion'],
  admin: () => ['/admin', '/admin/files', '/admin/payments', '/admin/payments?type=slots', '/admin/users', `/admin/users/${MARIA.id}`,
    '/admin/receipts', '/admin/receipts?tab=design', '/admin/statistics', '/admin/support', '/admin/logs', '/admin/restrictions', '/admin/appearance', '/admin/settings'],
  anon: () => ['/sign-in', '/sign-up', '/forgot-password', '/privacy', '/data-deletion'],
};

async function context(role, size) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setViewport(SIZES[size]);
  if (role !== 'anon') {
    if (role === 'buyer') await service.from('devices').delete().eq('user_id', MARIA.id);
    const u = role === 'buyer' ? MARIA : admin;
    await p.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' });
    await p.type('#email', u.email); await p.type('#pw', u.password);
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), p.click('form button.btn-primary')]);
    await sleep(600);
  }
  return { ctx, p };
}

/** Every visible, enabled control on the page, deduplicated by what it says and where it goes. */
function controls(unsafeSrc) {
  const unsafe = new RegExp(unsafeSrc, 'i');
  const seen = new Set();
  const out = [];
  const all = [...document.querySelectorAll('button, a[href], [role=tab], [role=radio], [role=switch], summary')];
  all.forEach((el, i) => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none' || el.disabled) return;
    const label = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    const href = el.getAttribute('href') || '';
    if (unsafe.test(label) || /^mailto:|^tel:|^https?:\/\/(?!localhost)/.test(href)) return;
    if (el.closest('iframe, .site-frame')) return;
    const key = `${el.tagName}|${label}|${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ i, label: label || `(${el.tagName.toLowerCase()} ${el.className})`, href });
  });
  return out.slice(0, 45);
}

for (const size of Object.keys(SIZES)) {
  for (const role of ['anon', 'buyer', 'admin']) {
    describe(`${role} · ${size}`, () => {
      let ctx, p;
      before(async () => { ({ ctx, p } = await context(role, size)); });
      after(() => ctx?.close());
      for (const path of PAGES[role]()) {
        test(path, async () => {
          const problems = [];
          const watch = (pg) => {
            pg.removeAllListeners('pageerror'); pg.removeAllListeners('console'); pg.removeAllListeners('response'); pg.removeAllListeners('dialog');
            pg.on('pageerror', (e) => problems.push(`crash: ${e.message}`));
            pg.on('console', (m) => { if (m.type() === 'error' && !/favicon|status of 40[134]|ERR_ABORTED|net::ERR/.test(m.text())) problems.push(`console: ${m.text().slice(0, 160)}`); });
            pg.on('response', (r) => { const u = r.url(); if (r.status() >= 500 || (r.status() >= 400 && /\/rest\/v1\/|\/rpc\//.test(u) && r.request().method() === 'GET')) problems.push(`HTTP ${r.status()} ${u.replace(/\?.*/, '').slice(-80)}`); });
            pg.on('dialog', (d) => d.dismiss());
          };
          watch(p);
          await p.goto(BASE + path, { waitUntil: 'networkidle0' });
          await sleep(900);
          const list = await p.evaluate(controls, UNSAFE.source);
          const clicked = [];
          for (const c of list) {
            if (p.url() !== BASE + path) { await p.goto(BASE + path, { waitUntil: 'networkidle0' }); await sleep(500); }
            const ok = await p.evaluate((i) => {
              const el = [...document.querySelectorAll('button, a[href], [role=tab], [role=radio], [role=switch], summary')][i];
              if (!el) return false;
              el.scrollIntoView({ block: 'center' }); el.click(); return true;
            }, c.i).catch(() => false);
            await sleep(450);
            const after = await p.evaluate(() => ({ url: location.pathname + location.search, text: document.body.innerText.trim().length, modal: !!document.querySelector('.modal') })).catch(() => null);
            if (after && after.text < 20) problems.push(`blank page after "${c.label}" → ${after.url}`);
            clicked.push(`${c.label}${ok ? '' : ' (gone after reload)'}${after && after.url !== path ? ` → ${after.url}` : ''}`);
            if (after?.modal) await p.keyboard.press('Escape').catch(() => undefined);
            // pages opened in a new tab (target=_blank) are closed again
            for (const extra of (await ctx.pages()).filter((x) => x !== p)) await extra.close();
          }
          (report[`${role} · ${size}`] ??= {})[path] = { clicked, problems };
          assert.deepEqual(problems, [], `${path}: ${problems.join('; ')}`);
        });
      }
    });
  }
}
