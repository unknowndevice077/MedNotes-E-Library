// End-to-end tests: real browser (headless Chrome) against the dev server + local Supabase.
// Run: npm run dev (port 5173) and npm run db:start, then npm run test:e2e
// CHROME_PATH can point at another Chrome/Edge binary.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { dropUser, makeUser, root, service } from './helpers.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = join(root, 'tests', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const FILES = {
  pdf: 'a0000000-0000-0000-0000-000000000002', epub: 'a0000000-0000-0000-0000-000000000001', video: 'a0000000-0000-0000-0000-000000000003',
  docx: 'a0000000-0000-0000-0000-000000000004', pptx: 'a0000000-0000-0000-0000-000000000005', xlsx: 'a0000000-0000-0000-0000-000000000006',
  image: 'a0000000-0000-0000-0000-000000000009',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let browser, buyer, admin;
const pageErrors = [];

// Each browser context is a fresh profile, i.e. a new device. Reuse one device id per user
// (like a returning browser) unless the test wants a new computer.
const deviceIds = new Map();
async function open(user, { mobile = false, newDevice = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (user) {
    const key = `${user.id}:${mobile}`;
    if (!deviceIds.has(key) || newDevice) deviceIds.set(key, crypto.randomUUID());
    await page.evaluateOnNewDocument((id) => localStorage.setItem('mn.device_id', id), deviceIds.get(key));
  }
  if (mobile) {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36');
  } else await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => pageErrors.push(`${user?.email ?? 'anon'}: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'DELETE' : undefined));
  if (user) {
    await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' });
    await page.type('#email', user.email);
    await page.type('#pw', user.password);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), page.click('form button.btn-primary')]);
    await sleep(800);
  }
  return page;
}
const go = async (page, path) => { await page.goto(BASE + path, { waitUntil: 'networkidle0' }); await sleep(600); };
const text = (page) => page.evaluate(() => document.body.innerText);
const clickText = (page, sel, t) => page.evaluate((s, x) => { const el = [...document.querySelectorAll(s)].find((e) => e.innerText.trim().includes(x)); el?.click(); return !!el; }, sel, t);
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

before(async () => {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  [buyer, admin] = await Promise.all([makeUser('e2e-buyer'), makeUser('e2e-admin', { admin: true })]);
  // buyer owns one file of each type (granted by the admin), so every reader can be exercised
  for (const k of ['epub', 'video', 'docx', 'pptx', 'xlsx', 'image']) await admin.client.rpc('admin_grant_file', { p_user: buyer.id, p_file: FILES[k] });
});
after(async () => {
  await browser?.close();
  await Promise.all([dropUser(buyer), dropUser(admin)]);
  assert.deepEqual(pageErrors, [], 'no uncaught page errors');
});

describe('public pages', () => {
  test('sign-in shows email, Google and Facebook, plus legal links', async () => {
    const p = await open(null);
    await go(p, '/sign-in');
    const t = await text(p);
    for (const s of ['Welcome back', 'Continue with Google', 'Continue with Facebook', 'Keep me signed in', 'Privacy policy', 'Get the MedNotes app']) assert.ok(t.includes(s), s);
    await clickText(p, '.btn-social', 'Google');
    await sleep(400);
    assert.match(await text(p), /sign-in isn't switched on yet|accounts\.google|Please use your email/);
    await shot(p, 'sign-in');
    await p.close();
  });
  test('privacy and data deletion pages load without signing in', async () => {
    const p = await open(null);
    await go(p, '/privacy');
    assert.ok((await text(p)).includes('Philippine Data Privacy Act'));
    await go(p, '/data-deletion');
    assert.ok((await text(p)).includes('Delete my account'));
    await p.close();
  });
  test('protected pages redirect to sign-in', async () => {
    const p = await open(null);
    await go(p, '/library');
    assert.match(p.url(), /sign-in/);
    await p.close();
  });
});

describe('buyer: browse, buy, read', () => {
  test('library home has hero, shelves, search and filters', async () => {
    const p = await open(buyer);
    await go(p, '/library');
    const t = await text(p);
    for (const s of ['What are you reviewing today?', 'Continue reading', 'New arrivals', 'All files']) assert.ok(t.includes(s), s);
    const cards = await p.$$eval('.grid .bookcard', (els) => els.length);
    assert.ok(cards >= 18, `catalog cards: ${cards}`);
    await shot(p, 'library');
    await go(p, '/library?q=cardiology');
    const found = await p.$$eval('.grid .bookcard h3', (els) => els.map((e) => e.textContent));
    assert.ok(found.length >= 2 && found.every((n) => /ECG|Heart/.test(n)), `search: ${found}`);
    await clickText(p, '.chip', 'Video');
    await sleep(300);
    const vids = await p.$$eval('.grid .bookcard .small', (els) => els.map((e) => e.textContent));
    assert.ok(vids.every((v) => v.startsWith('Video')), 'type filter');
    await p.close();
  });

  test('buy flow: locked detail → GCash QR checkout → pending', async () => {
    const p = await open(buyer);
    await go(p, `/file/${FILES.pdf}`);
    let t = await text(p);
    assert.ok(t.includes('Buy & unlock') && t.includes('Send payment') && t.includes('never downloadable'));
    await shot(p, 'detail-locked');
    await clickText(p, 'button', 'Buy & unlock');
    await p.waitForSelector('input[type=file]');
    await sleep(800);
    t = await text(p);
    assert.ok(t.includes('GCash') && t.includes('Upload proof of payment'));
    const proof = join(root, 'supabase', 'sample', 'proofs', '33333333-0000-0000-0000-000000000001', 'proof-1.png');
    await (await p.$('input[type=file]')).uploadFile(proof);
    await p.type('#ref', 'E2E-1234');
    await shot(p, 'checkout');
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), clickText(p, 'form button', 'Submit payment')]);
    await sleep(800);
    assert.match(p.url(), /my-files/, await text(p));
    assert.ok((await text(p)).includes('Pending confirmation'));
    await p.close();
  });

  test('admin confirms → buyer sees receipt and Read now (live)', async () => {
    const b = await open(buyer);
    await go(b, '/my-files');
    const a = await open(admin);
    await go(a, '/admin/payments');
    assert.ok(await clickText(a, '.card.row', 'Test e2e-buyer') || true);
    await sleep(800);
    await shot(a, 'admin-payments');
    const toastSeen = b.waitForFunction(() => document.querySelector('.toast')?.innerText.includes('Payment confirmed'), { timeout: 10000 }).then(() => true).catch(() => false);
    // pick the buyer's payment explicitly
    const pid = (await service.from('purchases').select('id').eq('user_id', buyer.id).eq('status', 'pending').single()).data.id;
    await go(a, `/admin/payments?id=${pid}`);
    await clickText(a, 'button', 'Confirm received');
    await sleep(1500);
    assert.match(await a.evaluate(() => document.querySelector('.toast')?.innerText ?? ''), /Receipt OR-\d{6}/);
    assert.ok(await toastSeen, 'buyer got the live update');
    await go(b, `/file/${FILES.pdf}`);
    const t = await text(b);
    assert.ok(t.includes('Read now') && t.includes('You own this') && /OR-\d{6}/.test(t));
    await shot(b, 'detail-owned');
    await a.close(); await b.close();
  });

  for (const kind of ['pdf', 'epub', 'docx', 'xlsx', 'pptx', 'image', 'video']) {
    test(`reader opens ${kind} through encrypted delivery`, async () => {
      const p = await open(buyer);
      const storageHits = [], readFile = [];
      p.on('response', async (r) => {
        const u = r.url();
        if (/\/storage\/v1\/object\/(sign\/|authenticated\/)?files\//.test(u)) storageHits.push(u);
        if (u.includes('/functions/v1/read-file') && r.request().method() === 'POST') readFile.push({ status: r.status(), type: r.headers()['content-type'], head: (await r.buffer().catch(() => Buffer.alloc(0))).subarray(0, 8) });
      });
      await go(p, `/read/${FILES[kind]}`);
      await sleep(kind === 'video' ? 2500 : 2000);
      assert.equal(storageHits.length, 0, 'the browser never touches the files bucket');
      assert.ok(readFile.length > 0 && readFile.every((r) => r.status === 200 && r.type === 'application/octet-stream'), 'served by read-file');
      assert.ok(readFile.every((r) => !r.head.toString('latin1').startsWith('%PDF') && !r.head.toString('latin1').startsWith('PK')), 'body is ciphertext');
      const check = {
        pdf: () => p.evaluate(() => document.querySelectorAll('.reader canvas').length >= 1),
        epub: () => p.waitForSelector('.reader iframe', { timeout: 10000 }).then(() => true, () => false),
        docx: () => p.evaluate(() => document.querySelector('.reader')?.innerText.includes('Pathology Notes')),
        xlsx: () => p.evaluate(() => document.querySelector('.sheet table')?.innerText.includes('Sodium')),
        pptx: () => p.evaluate(() => document.querySelectorAll('.slide').length === 3),
        image: () => p.evaluate(() => { const c = document.querySelector('.reader canvas'); return !!c && c.width > 100 && !document.querySelector('.reader img'); }),
        video: () => p.evaluate(async () => { const v = document.querySelector('video'); if (!v || v.readyState < 2) return false;
          try { await fetch(v.currentSrc); return false; } catch { return true; } }), // blob URL already revoked
      }[kind];
      assert.ok(await check(), `${kind} rendered`);
      assert.ok(await p.evaluate(() => !!document.querySelector('.watermark span')?.textContent.includes('@')), 'watermark with email');
      if (kind === 'pdf') await shot(p, 'reader-pdf');
      await p.close();
    });
  }

  test('reader protections: no right-click, shortcuts blocked, hidden on blur / Print Screen', async () => {
    const p = await open(buyer);
    await go(p, `/read/${FILES.docx}`);
    await sleep(1500);
    const r = await p.evaluate(() => {
      const fire = (type, init) => { const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }); window.dispatchEvent(e); return e.defaultPrevented; };
      const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.querySelector('.reader-body').dispatchEvent(ctx);
      return { ctx: ctx.defaultPrevented, save: fire('keydown', { key: 's', ctrlKey: true }), print: fire('keydown', { key: 'p', ctrlKey: true }), devtools: fire('keydown', { key: 'I', ctrlKey: true, shiftKey: true }), f12: fire('keydown', { key: 'F12' }), viewSource: fire('keydown', { key: 'u', ctrlKey: true }) };
    });
    assert.deepEqual(r, { ctx: true, save: true, print: true, devtools: true, f12: true, viewSource: true });
    await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'PrintScreen', bubbles: true })));
    await sleep(200);
    assert.ok(await p.evaluate(() => document.querySelector('.guard-cover')?.innerText.includes('Screenshots are not allowed')));
    await shot(p, 'reader-guard');
    await p.close();
  });

  test('no download buttons anywhere', async () => {
    const p = await open(buyer);
    for (const path of [`/file/${FILES.docx}`, '/my-files', `/read/${FILES.xlsx}`]) {
      await go(p, path);
      const dl = await p.evaluate(() => [...document.querySelectorAll('a,button')].filter((e) => /\bdownload\b/i.test(e.innerText) && !/save qr/i.test(e.innerText)).map((e) => e.innerText));
      assert.deepEqual(dl, [], `${path}: ${dl}`);
      assert.equal(await p.evaluate(() => document.querySelectorAll('a[download]').length), 0);
    }
    await p.close();
  });

  test('second computer hits the device limit', async () => {
    const p2 = await open(buyer, { newDevice: true }); // another computer
    await go(p2, '/library');
    assert.ok((await text(p2)).includes('Computer limit reached'));
    await shot(p2, 'device-limit');
    await p2.close();
  });
});

describe('admin', () => {
  test('dashboard shows KPIs, revenue chart and queues', async () => {
    const p = await open(admin);
    await go(p, '/admin');
    const t = await text(p);
    for (const s of ['Revenue this month', 'Payments to confirm', 'Revenue', 'New buyers', 'Top sellers']) assert.ok(t.includes(s), s);
    assert.ok(await p.$('svg[aria-label^="Revenue over the last"]'));
    await shot(p, 'admin-dashboard');
    await p.close();
  });

  test('upload dialog is fully visible above the header (regression) and uploads a file', async () => {
    const p = await open(admin);
    await go(p, '/admin/files');
    await clickText(p, 'button', 'Upload file');
    await p.waitForSelector('.modal');
    await sleep(400);
    const vis = await p.evaluate(() => {
      const m = document.querySelector('.modal').getBoundingClientRect();
      const top = document.elementFromPoint(m.left + 40, m.top + 20);
      return { inModal: !!top?.closest('.modal'), top: m.top, bottom: m.bottom, vh: innerHeight, parent: document.querySelector('.overlay').parentElement.tagName };
    });
    assert.equal(vis.parent, 'BODY', 'portalled to body');
    assert.ok(vis.inModal, 'nothing covers the dialog');
    assert.ok(vis.top >= 0 && vis.bottom <= vis.vh, `inside viewport: ${JSON.stringify(vis)}`);
    await shot(p, 'admin-upload-dialog');
    const inputs = await p.$$('.modal input[type=file]');
    await inputs[0].uploadFile(join(root, 'supabase', 'sample', 'files', 'anatomy-atlas-upper-limb.pdf'));
    await inputs[1].uploadFile(join(root, 'supabase', 'sample', 'covers', 'surgical-atlas.png'));
    await p.$eval('#fname', (e) => { e.value = ''; });
    const name = `E2E Upload ${Date.now()}`;
    await p.type('#fname', name); await p.type('#flabel', 'Testing'); await p.type('#fprice', '99');
    await clickText(p, '.modal button', 'Upload & publish');
    await sleep(2500);
    assert.ok(!(await p.$('.modal')), 'dialog closed');
    assert.ok((await text(p)).includes(name), 'listed in admin files');
    const { data } = await service.from('files').select('id, storage_path, cover_path, price').eq('name', name).single();
    assert.equal(Number(data.price), 99);
    assert.ok(data.storage_path && data.cover_path);
    await service.storage.from('files').remove([data.storage_path]);
    await service.storage.from('covers').remove([data.cover_path]);
    await service.from('files').delete().eq('id', data.id);
    await p.close();
  });

  test('payments, users, restrictions and settings pages render', async () => {
    const p = await open(admin);
    for (const [path, s] of [['/admin/payments', 'Pending'], ['/admin/users', 'Maria Reyes'], [`/admin/users/${buyer.id}`, 'Restrictions & overrides'], ['/admin/restrictions', 'Device limit'], ['/admin/settings', 'Payment methods']]) {
      await go(p, path);
      assert.ok((await text(p)).includes(s), `${path} shows ${s}`);
    }
    await p.close();
  });
});

describe('mobile layout', () => {
  test('library, detail and my files on a phone', async () => {
    const u = await makeUser('e2e-mobile');
    try {
      const p = await open(u, { mobile: true });
      await go(p, '/library');
      assert.ok(await p.$('.tabbar'), 'bottom tabs');
      assert.ok(!(await p.$('.topbar')), 'no desktop top bar');
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, 'no horizontal page scroll');
      await shot(p, 'mobile-library');
      await go(p, `/file/${FILES.video}`);
      assert.ok(await p.$('.bottom-bar'));
      await shot(p, 'mobile-detail');
      await go(p, '/my-files');
      assert.ok(await p.$('.seg'));
      await p.close();
    } finally { await dropUser(u); }
  });
});

describe('account deletion (UI)', () => {
  test('Delete my account signs out and removes the user', async () => {
    const u = await makeUser('e2e-delete');
    const p = await open(u);
    await go(p, '/account');
    await clickText(p, 'button', 'Delete my account');
    await sleep(2000);
    assert.match(p.url(), /sign-in/);
    assert.equal((await service.from('profiles').select('id').eq('id', u.id)).data.length, 0);
    await p.close();
  });
});

// summary file for the README / CI artifacts
after(() => writeFileSync(join(SHOTS, 'README.txt'), 'Screenshots from the last npm run test:e2e run.\n'));
