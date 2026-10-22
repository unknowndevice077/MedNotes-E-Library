// UI checks: visits every screen at phone, tablet, laptop and desktop sizes, saves a
// screenshot of each (tests/screenshots/ui/<size>/<page>.png) and runs layout checks:
// no sideways page scroll, nothing sticking out of the screen, no broken images,
// no clipped button/badge text, nothing covering a button, big-enough tap targets
// on phones, and no console errors.
// Needs the dev server (port 5173) and the local Supabase with the demo seed.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { dropUser, makeUser, root, service } from './helpers.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = join(root, 'tests', 'screenshots', 'ui');
const SIZES = {
  'small-phone': { width: 320, height: 640, isMobile: true, hasTouch: true },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  'large-phone': { width: 430, height: 932, isMobile: true, hasTouch: true },
  'phone-dark': { width: 390, height: 844, isMobile: true, hasTouch: true, dark: true },
  'phone-landscape': { width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true },
  'small-tablet': { width: 768, height: 1024, isMobile: true, hasTouch: true },
  tablet: { width: 820, height: 1180, isMobile: true, hasTouch: true },
  'tablet-landscape': { width: 1180, height: 820, isMobile: true, hasTouch: true, isLandscape: true },
  'small-laptop': { width: 1280, height: 720 },
  laptop: { width: 1366, height: 768 },
  desktop: { width: 1920, height: 1080 },
};
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const MARIA = { id: '33333333-0000-0000-0000-000000000001', email: 'maria.reyes@mednotes.test', password: 'DemoBuyer#2026' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser, admin, ids;
const report = {};

before(async () => {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--hide-scrollbars'] });
  admin = await makeUser('ui-admin', { admin: true });
  const { data: buys } = await service.from('purchases').select('id, file_id, status').eq('user_id', MARIA.id);
  const { data: files } = await service.from('files').select('id').eq('published', true);
  const owned = buys.filter((b) => b.status === 'confirmed');
  const pending = buys.find((b) => b.status === 'pending');
  const locked = files.find((f) => !buys.some((b) => b.file_id === f.id));
  assert.ok(owned.length && locked, 'demo seed is loaded (npm run db:reset)');
  ids = { owned: owned[0].file_id, receipt: owned[0].id, pending: pending?.file_id, pendingPay: pending?.id, locked: locked.id };
});
after(async () => {
  await browser?.close();
  await dropUser(admin);
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
});

/** Runs in the page: returns the layout problems on screen. */
function audit(isPhone) {
  const vw = document.documentElement.clientWidth;
  const out = { overflow: [], offscreen: [], brokenImages: [], clipped: [], covered: [], smallTargets: [], crowded: [] };
  const name = (el) => {
    const t = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}${t ? ` "${t}"` : ''}`;
  };
  const scrollsX = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
  const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0 && r.width > 0 && r.height > 0; };
  if (document.documentElement.scrollWidth > vw + 1) out.overflow.push(`page is ${document.documentElement.scrollWidth}px wide, screen is ${vw}px`);
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('svg') || el.closest('.watermark')) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !scrollsX(el)) out.offscreen.push(`${name(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`);
  }
  for (const img of document.images) if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) out.brokenImages.push(img.getAttribute('src').slice(0, 80));
  for (const el of document.querySelectorAll('.btn, .badge, .chip, .pill, .price-pill, .tab-ico, label, th, .nav a')) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    if (s.textOverflow === 'ellipsis') continue;
    if (el.scrollWidth > el.clientWidth + 2 && s.overflowX !== 'visible') out.clipped.push(name(el));
    else if (s.whiteSpace !== 'nowrap' && el.matches('.btn, .badge, .chip') && el.getBoundingClientRect().height > parseFloat(s.lineHeight || '20') * 2.2 + 20) out.clipped.push(`${name(el)} wraps onto 3+ lines`);
  }
  const scope = document.querySelector('.modal') ?? document; // with a dialog open, the page behind is meant to be covered
  for (const el of scope.querySelectorAll('button, a[href], input, select, textarea, [role=button]')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > vw || y > innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el) && !(el.htmlFor && hit.id === el.htmlFor) && !(el.labels && [...el.labels].some((l) => l.contains(hit)))) {
      // things scrolled under a sticky header or bottom bar are fine; anything else on top is a bug
      let p = hit, pinned = false;
      for (; p; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'sticky') { pinned = true; break; } }
      const pinnedSelf = (() => { for (let q = el; q; q = q.parentElement) { const pos = getComputedStyle(q).position; if (pos === 'fixed' || pos === 'sticky') return true; } return false; })();
      if (!pinned || pinnedSelf) out.covered.push(`${name(el)} is under ${name(hit)}`);
    }
    if (isPhone && !el.matches('input[type=checkbox], input[type=radio], input[type=file]') && (r.height < 32 || r.width < 32) && !el.closest('p, .small, .legal, footer, .breadcrumbs, .crumbs'))
      out.smallTargets.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  // buttons and badges that overlap, touch (closer than 6px on the same line) or stick out of their card / dialog
  const SKIP = '.seg, .rt-group, .stars, .tabbar, .edit-history, .chips, .pv-pop, .site-frame-wrap, .bottom-bar .price, .tl-dot';
  // with a dialog open, only the dialog counts (the page behind it is covered)
  const modal = [...document.querySelectorAll('.modal')].filter(visible).pop();
  const boxes = [...(modal ?? document).querySelectorAll('.btn, .badge, button.link, .price-pill, .icon-btn')]
    .filter((el) => visible(el) && !el.closest(SKIP) && !el.closest('.cover') && !el.closest('[aria-hidden="true"]'))
    .map((el) => ({ el, r: el.getBoundingClientRect() }));
  for (const { el } of boxes) if (el.matches('.btn, .icon-btn') && el.scrollWidth > el.clientWidth + 2) out.crowded.push(`${name(el)} text spills out of the button`);
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    const box = a.el.parentElement?.closest('.card, .modal, .note');
    if (box) {
      const c = box.getBoundingClientRect();
      if (a.r.left < c.left - 1 || a.r.right > c.right + 1) out.crowded.push(`${name(a.el)} sticks out of ${name(box)}`);
    }
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const vOverlap = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (vOverlap <= Math.min(a.r.height, b.r.height) * 0.5) continue; // not on the same line
      const hGap = Math.max(a.r.left, b.r.left) - Math.min(a.r.right, b.r.right);
      if (hGap < -1) out.crowded.push(`${name(a.el)} overlaps ${name(b.el)}`);
      else if (hGap < 6) out.crowded.push(`${name(a.el)} and ${name(b.el)} are ${Math.max(0, Math.round(hGap))}px apart`);
    }
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
  return out;
}

async function newPage(size) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const { dark, ...v } = SIZES[size];
  await page.setViewport({ deviceScaleFactor: 1, ...v });
  if (dark) {
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await page.evaluateOnNewDocument(() => { localStorage.setItem('mn.app-theme', 'dark'); localStorage.setItem('mn.admin-dark', '1'); });
  }
  if (v.isMobile) await page.setUserAgent(MOBILE_UA);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); // screenshots without half-finished animations
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 40[134]/.test(m.text())) page.errors.push(m.text()); });
  page.on('dialog', (d) => d.dismiss());
  return page;
}
async function signIn(page, user) {
  if (user.id === MARIA.id) await service.from('devices').delete().eq('user_id', MARIA.id); // free her device slots
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' });
  await page.type('#email', user.email);
  await page.type('#pw', user.password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), page.click('form button.btn-primary')]);
  await sleep(800);
}
async function check(page, size, name, path, { before: prep, wait = 900 } = {}) {
  if (path) await page.goto(BASE + path, { waitUntil: 'networkidle0' });
  await sleep(wait);
  if (prep) { await prep(page); await sleep(500); }
  mkdirSync(join(OUT, size), { recursive: true });
  await page.screenshot({ path: join(OUT, size, `${name}.png`), fullPage: true });
  const found = await page.evaluate(audit, SIZES[size].isMobile && SIZES[size].width < 600);
  found.consoleErrors = page.errors.splice(0);
  (report[size] ??= {})[name] = found;
  return found;
}
const clickText = (t, sel = 'button') => (page) => page.evaluate((s, x) => [...document.querySelectorAll(s)].find((e) => e.innerText.trim().includes(x))?.click(), sel, t);

for (const size of Object.keys(SIZES)) {
  describe(`${size} (${SIZES[size].width}px)`, () => {
    const screens = [];
    const add = (role, name, path, opts) => screens.push({ role, name, path, opts });
    add('anon', 'sign-in', '/sign-in');
    add('anon', 'sign-up', '/sign-up');
    add('anon', 'forgot-password', '/forgot-password');
    add('anon', 'privacy', '/privacy');
    add('anon', 'data-deletion', '/data-deletion');
    add('buyer', 'library', '/library');
    add('buyer', 'library-search', '/library?q=pharma');
    add('buyer', 'detail-owned', () => `/file/${ids.owned}`);
    add('buyer', 'detail-locked', () => `/file/${ids.locked}`);
    add('buyer', 'detail-pending', () => ids.pending && `/file/${ids.pending}`);
    add('buyer', 'checkout', () => `/checkout/${ids.locked}`, { wait: 1500 });
    add('buyer', 'my-files', '/my-files');
    add('buyer', 'payments', '/payments');
    add('buyer', 'payments-receipt-dialog', '/payments', { before: (p) => p.evaluate(() => [...document.querySelectorAll('.pay-row button')].find((b) => /OR-|Receipt/.test(b.innerText))?.click()) });
    add('buyer', 'help', '/help');
    add('buyer', 'help-new-ticket', '/help', { before: clickText('Report a bug', '.help-kind') });
    add('buyer', 'notifications', '/library', { before: (p) => p.click('.bell') });
    add('buyer', 'account-settings', '/account/settings');
    add('buyer', 'receipt', () => `/receipt/${ids.receipt}`);
    add('buyer', 'reader', () => `/read/${ids.owned}`, { wait: 3000 });
    // the five free samples cover every reader layout: PDF, slides, e-book, Word, Excel
    for (const [k, n] of [['pdf', 19], ['pptx', 20], ['epub', 21], ['docx', 22], ['xlsx', 23]]) add('buyer', `reader-${k}`, `/read/a0000000-0000-0000-0000-0000000000${n}`, { wait: 3000 });
    add('buyer', 'devices', '/devices');
    add('buyer', 'checkout-slot', '/checkout/slot/computer', { wait: 1500 });
    add('buyer', 'account', '/account');
    add('buyer', 'account-delete-dialog', '/account/settings', { before: clickText('Delete my account') });
    if (!SIZES[size].isMobile) add('buyer', 'user-menu', '/library', { before: (p) => p.click('.user-chip') });
    add('admin', 'admin-dashboard', '/admin');
    add('admin', 'admin-files', '/admin/files');
    add('admin', 'admin-upload-dialog', '/admin/files', { before: clickText('Upload file') });
    add('admin', 'admin-edit-dialog', '/admin/files', { before: clickText('Edit') });
    add('admin', 'admin-payments', '/admin/payments');
    add('admin', 'admin-users', '/admin/users');
    add('admin', 'admin-user-detail', `/admin/users/${MARIA.id}`);
    add('admin', 'admin-restrictions', '/admin/restrictions');
    if (SIZES[size].width < 761) add('admin', 'admin-more-menu', '/admin', { before: clickText('More', '.tabbar button') });
    add('admin', 'admin-settings', '/admin/settings');
    add('admin', 'admin-receipts', '/admin/receipts');
    add('admin', 'admin-receipts-design', '/admin/receipts?tab=design');
    add('admin', 'admin-appearance', '/admin/appearance', { wait: 2500 });
    add('admin', 'admin-appearance-style', '/admin/appearance', { wait: 1500, before: clickText('Colours & style', '[role=tab]') });
    add('admin', 'admin-logs', '/admin/logs');
    add('admin', 'admin-statistics', '/admin/statistics');
    add('admin', 'admin-payments-slots', '/admin/payments?type=slots');
    add('admin', 'admin-payment-detail', () => ids.pendingPay && `/admin/payments?id=${ids.pendingPay}`);
    add('admin', 'admin-reject-dialog', () => ids.pendingPay && `/admin/payments?id=${ids.pendingPay}`, { before: clickText('Reject') });
    add('admin', 'admin-support', '/admin/support');

    const pages = {};
    before(async () => {
      pages.anon = await newPage(size);
      pages.buyer = await newPage(size); await signIn(pages.buyer, MARIA);
      pages.admin = await newPage(size); await signIn(pages.admin, admin);
    });
    after(() => Promise.all(Object.values(pages).map((p) => p.browserContext().close())));

    for (const s of screens) {
      test(s.name, async (t) => {
        const path = typeof s.path === 'function' ? s.path() : s.path;
        if (!path) return t.skip('no data for this screen');
        const r = await check(pages[s.role], size, s.name, path, s.opts);
        // the hard failures; the rest is reported for review in report.json
        assert.deepEqual(r.overflow, [], 'sideways scroll');
        assert.deepEqual(r.offscreen, [], 'content outside the screen');
        assert.deepEqual(r.brokenImages, [], 'broken images');
        assert.deepEqual(r.covered, [], 'controls covered by something');
        assert.deepEqual(r.clipped, [], 'clipped labels');
        assert.deepEqual(r.crowded, [], 'buttons overlapping, touching or sticking out');
        assert.deepEqual(r.consoleErrors, [], 'console errors');
        if (r.smallTargets.length) t.diagnostic(`small tap targets: ${r.smallTargets.join('; ')}`);
      });
    }
  });
}
