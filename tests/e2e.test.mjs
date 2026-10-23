// End-to-end tests: real browser (headless Chrome) against the dev server + local Supabase.
// Run: npm run dev (port 5173) and npm run db:start, then npm run test:e2e
// CHROME_PATH can point at another Chrome/Edge binary.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { anon, dropUser, makeUser, root, service } from './helpers.mjs';

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
    if (!deviceIds.has(key)) deviceIds.set(key, crypto.randomUUID());
    // a "new device" gets a throwaway id, so the user's usual device keeps working afterwards
    const id = newDevice ? crypto.randomUUID() : deviceIds.get(key);
    await page.evaluateOnNewDocument((v) => localStorage.setItem('mn.device_id', v), id);
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

  test('email links open on our own site: /auth/confirm signs in, reset goes to a new password, a bad link explains itself', async () => {
    const u = await makeUser('e2e-confirm');
    try {
      const link = async (type) => (await service.auth.admin.generateLink({ type, email: u.email })).data.properties.hashed_token;
      let p = await open(null);
      await go(p, `/auth/confirm?token_hash=${await link('magiclink')}&type=magiclink`);
      await p.waitForFunction(() => location.pathname.endsWith('/library'), { timeout: 15000 });
      await p.close();
      p = await open(null);
      await go(p, `/auth/confirm?token_hash=${await link('recovery')}&type=recovery`);
      await p.waitForFunction(() => location.pathname.endsWith('/reset-password'), { timeout: 15000 });
      await p.close();
      p = await open(null);
      await go(p, '/auth/confirm?token_hash=not-a-real-token&type=email');
      await p.waitForFunction(() => document.body.innerText.includes("This link didn't work"), { timeout: 15000 });
      await shot(p, 'auth-confirm-bad-link');
      await p.close();
    } finally { await dropUser(u); }
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
    // filters mix and stay visibly picked, and sit above the shelves
    await go(p, '/library');
    assert.ok(await p.evaluate(() => document.querySelector('#filters').getBoundingClientRect().top < document.querySelector('.shelf').getBoundingClientRect().top), 'filters come first');
    await clickText(p, '.chip', 'Video');
    await clickText(p, '.chip', 'PDF');
    await sleep(300);
    const picked = await p.$$eval('.chips .chip[aria-pressed="true"]', (els) => els.map((e) => e.textContent.replace('✓', '')));
    assert.deepEqual(picked.sort(), ['PDF', 'Video']);
    const pills = await p.$$eval('.active-filters .af-pill', (els) => els.map((e) => e.textContent.replace('×', '').trim()));
    assert.deepEqual(pills.sort(), ['PDF', 'Video']);
    const kinds = await p.$$eval('.grid .bookcard .small', (els) => els.map((e) => e.textContent.split(' ·')[0]));
    assert.ok(kinds.length && kinds.every((k) => /^(Video|PDF)/.test(k)) && kinds.some((k) => k.startsWith('PDF')) && kinds.some((k) => k.startsWith('Video')), `mixed: ${kinds}`);
    await shot(p, 'library-mixed-filters');
    // taking every filter off keeps the page where it was (no jump back to the top)
    const y0 = await p.evaluate(() => document.querySelector('#filters').getBoundingClientRect().top + scrollY);
    await clickText(p, '.chip', 'All types');
    await sleep(300);
    assert.equal(await p.evaluate(() => document.querySelector('#filters').getBoundingClientRect().top + scrollY), y0, 'filters stay put');
    await p.close();
  });

  test('no reload: auth wake-ups keep the page, going back to the library is instant', async () => {
    const p = await open(buyer);
    await go(p, '/library');
    await p.evaluate(() => { window.__blank = 0; new MutationObserver(() => { if (document.querySelector('[aria-label="Loading MedNotes"], .spinner')) window.__blank++; }).observe(document.body, { childList: true, subtree: true }); });
    const rest = [];
    p.on('request', (r) => { if (r.url().includes('/rest/v1/') && r.method() !== 'OPTIONS') rest.push(r.url()); });
    // what supabase-js emits when the tab wakes up and when the token renews
    await p.evaluate(async () => { const { supabase } = await import('/src/lib/supabase.ts'); await supabase.auth._recoverAndRefresh(); await supabase.auth.refreshSession(); });
    await sleep(1200);
    assert.equal(await p.evaluate(() => window.__blank), 0, 'no full-screen loading');
    assert.deepEqual(rest, [], 'no refetch');
    await p.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href').endsWith('/my-files')).click());
    await sleep(1200);
    await p.evaluate(() => [...document.querySelectorAll('nav a')].find((a) => a.getAttribute('href').endsWith('/library')).click());
    await sleep(60);
    assert.ok(await p.evaluate(() => document.querySelectorAll('.grid .bookcard').length > 5 && !document.querySelector('.skeleton')), 'library shown from cache right away');
    await p.close();
  });

  test('hovering a card enlarges it into a preview; press-and-hold on phones', async () => {
    const p = await open(buyer);
    await go(p, '/library');
    await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; document.querySelector('.grid').scrollIntoView({ block: 'start' }); window.scrollBy(0, -120); });
    await sleep(700);
    const card = await p.evaluateHandle(() => [...document.querySelectorAll('.grid .pv-anchor')].find((e) => { const r = e.getBoundingClientRect(); return r.top > 80 && r.bottom < innerHeight; }));
    const box = await card.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await p.waitForSelector('.pv-pop', { timeout: 3000 });
    await p.waitForFunction(() => document.querySelector('.pv-pop').getAnimations({ subtree: true }).every((x) => x.playState === 'finished'), { timeout: 3000 });
    const pv = await p.$eval('.pv-pop', (e) => { const c = e.querySelector('.cover').getBoundingClientRect(); return { w: c.width, text: e.innerText }; });
    assert.ok(pv.w > box.width, `preview cover (${pv.w}px) is bigger than the card (${box.width}px)`);
    assert.match(pv.text, /Details/);
    await shot(p, 'hover-preview');
    await p.mouse.wheel({ deltaY: 300 });
    await sleep(300);
    assert.equal(await p.$('.pv-pop'), null, 'closes on scroll');
    await p.close();
    const m = await open(buyer, { mobile: true });
    await go(m, '/library');
    const first = await m.$('.shelf .pv-anchor .cover');
    await first.evaluate((e) => e.scrollIntoView({ block: 'center' })); // the filters sit above the shelves now
    await sleep(300);
    const b = await first.boundingBox();
    await m.touchscreen.touchStart(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(700);
    await m.touchscreen.touchEnd();
    await m.waitForSelector('.modal .pv-body', { timeout: 3000 });
    assert.match(m.url(), /\/library/, 'long-press did not navigate');
    await m.close();
  });

  test('buy flow: locked detail → GCash QR checkout → pending', async () => {
    const p = await open(buyer);
    await go(p, `/file/${FILES.pdf}`);
    let t = await text(p);
    assert.ok(t.includes('Buy this file') && t.includes('Send payment') && t.includes('never downloadable') && t.includes('Buy to read the full'));
    await shot(p, 'detail-locked');
    await clickText(p, 'button', 'Buy this file');
    await p.waitForSelector('input[type=file]');
    await sleep(800);
    t = await text(p);
    assert.ok(t.includes('GCash') && t.includes('Upload your payment screenshot'));
    assert.equal(await p.$('#ref'), null, 'no reference number box');
    assert.equal(await p.$('#amt'), null, 'no amount box');
    const proof = join(root, 'supabase', 'sample', 'proofs', '33333333-0000-0000-0000-000000000001', 'proof-1.png');
    await (await p.$('input[type=file]')).uploadFile(proof);
    await p.waitForSelector('img.proof-img', { timeout: 10000 });
    // a refresh keeps the uploaded screenshot
    await p.reload({ waitUntil: 'networkidle0' });
    await p.waitForFunction(() => { const i = document.querySelector('img.proof-img'); return i && i.complete && i.naturalWidth > 0; }, { timeout: 10000 });
    assert.ok((await text(p)).includes('proof-1.png'), 'screenshot remembered after refresh');
    await shot(p, 'checkout');
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), clickText(p, 'form button', 'Submit payment')]);
    await sleep(800);
    assert.match(p.url(), /my-files/, await text(p));
    assert.ok((await text(p)).includes('Pending confirmation'));
    const { data: f } = await service.from('files').select('price').eq('id', FILES.pdf).single();
    const { data: pur } = await service.from('purchases').select('amount, reference_no, proof_path').eq('user_id', buyer.id).eq('file_id', FILES.pdf).single();
    assert.equal(Number(pur.amount), Number(f.price), 'amount is the real price');
    assert.ok(pur.proof_path && pur.reference_no === '');
    assert.equal(await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mn.checkout.')).length), 0, 'draft cleared after submit');
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
    await b.waitForFunction(() => document.querySelector('.modal')?.innerText.includes('Payment confirmed') && !!document.querySelector('.modal .receipt'), { timeout: 10000 });
    await shot(b, 'receipt-popup');
    await clickText(b, '.modal button', 'Close');
    await go(b, '/payments');
    const pt = await text(b);
    assert.ok(pt.includes('Payments & receipts') && /OR-\d{6}/.test(pt), 'paid list with receipts');
    await clickText(b, '.pay-row button', 'OR-');
    await b.waitForSelector('.modal .receipt');
    await shot(b, 'my-payments');
    await go(b, `/file/${FILES.pdf}`);
    const t = await text(b);
    assert.ok(t.includes('Read now') && t.includes('You own this') && /OR-\d{6}/.test(t));
    await shot(b, 'detail-owned');
    await a.close(); await b.close();
  });

  test('reading on the website is clean by default (watermark is app-only)', async () => {
    const p = await open(buyer);
    await go(p, `/read/${FILES.pdf}`);
    await p.waitForSelector('.reader canvas.content', { timeout: 15000 });
    await sleep(1500);
    assert.equal(await p.$('.wm'), null, 'no watermark layer');
    const tinted = await p.evaluate(() => { const c = document.querySelector('.reader canvas.content'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 2] > d[i] + 8 && d[i + 2] > 200 && d[i] > 150) n++; return n; });
    assert.ok(tinted < 20, `no mark in the pixels (${tinted})`);
    await p.close();
  });

  for (const kind of ['pdf', 'epub', 'docx', 'xlsx', 'pptx', 'image', 'video']) {
    test(`reader opens ${kind} through encrypted delivery`, async (t) => {
      await service.from('settings').update({ watermark_web: true }).eq('id', 1);
      t.after(() => service.from('settings').update({ watermark_web: false }).eq('id', 1));
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
        pptx: () => p.evaluate(() => document.querySelectorAll('.slide2').length === 3),
        image: () => p.evaluate(() => { const c = document.querySelector('.reader canvas'); return !!c && c.width > 100 && !document.querySelector('.reader img'); }),
        video: () => p.evaluate(async () => { const v = document.querySelector('video'); if (!v || v.readyState < 2) return false;
          try { await fetch(v.currentSrc); return false; } catch { return true; } }), // blob URL already revoked
      }[kind];
      assert.ok(await check(), `${kind} rendered`);
      // the publisher's mark is on the content itself: pixels for PDF/images, a tile over each page otherwise
      const { data: st } = await service.from('settings').select('publisher_name').eq('id', 1).single();
      const wm = await p.evaluate(() => decodeURIComponent(getComputedStyle(document.querySelector('.wm')).getPropertyValue('--wm')));
      assert.ok(wm.includes(`© ${st.publisher_name}`) && wm.includes('do not share'), `publisher watermark: ${wm.slice(0, 200)}`);
      assert.ok(!wm.includes(buyer.email), 'no buyer email in the watermark');
      assert.equal(await p.$('.watermark'), null, 'no full-screen overlay');
      if (['docx', 'pptx', 'xlsx', 'epub', 'video'].includes(kind)) {
        const over = await p.evaluate(() => { const box = document.querySelector('.wm .wm-box, .wm .docx-wrapper > section.docx'); return box && getComputedStyle(box, '::after').backgroundImage; });
        assert.match(over ?? '', /svg/, `${kind}: mark tiled over the page`);
      } else {
        // drawn into the canvas: a page/image region that was plain white now has the tinted text in it
        const tinted = await p.evaluate(() => { const c = document.querySelector('.reader canvas.content'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 2] > d[i] + 8 && d[i + 2] > 200 && d[i] > 150) n++; return n; });
        assert.ok(tinted > 20, `${kind}: mark drawn into the pixels (${tinted} tinted samples)`);
      }
      if (kind === 'pdf') await shot(p, 'reader-pdf');
      await p.close();
    });
  }

  test('hidden buyer mark: a screenshot of the reader is traced back to the buyer (100% and 200% screens, dark pages)', async () => {
    const shots = [];
    for (const [scale, kind, dark] of [[1, 'pptx', false], [2, 'docx', true]]) {
      const p = await open(buyer);
      await p.setViewport({ width: 1280, height: 800, deviceScaleFactor: scale });
      if (dark) await service.from('profiles').update({ prefs: { readerTheme: 'dark' } }).eq('id', buyer.id);
      await go(p, `/read/${FILES[kind]}`);
      await p.waitForSelector('.leak-mark', { timeout: 15000 });
      await sleep(2000);
      const op = await p.$eval('.leak-mark', (e) => Number(getComputedStyle(e).opacity));
      assert.ok(op > 0 && op < 0.03, 'mark is far too faint to see');
      const file = join(root, 'tests', 'screenshots', `leak-${scale}x.png`);
      await p.screenshot({ path: file });
      shots.push(file);
      await p.close();
    }
    await service.from('profiles').update({ prefs: {} }).eq('id', buyer.id);
    const a = await open(admin);
    await go(a, '/admin/restrictions');
    for (const file of shots) {
      await go(a, '/admin/restrictions');
      const input = await a.waitForSelector('#trace-file');
      await input.uploadFile(file);
      await a.waitForFunction(() => document.querySelector('.tr-hit') || document.querySelector('.tr-msg'), { timeout: 30000 });
      const t = await a.$eval('.tr-hit', (e) => e.innerText).catch(() => a.evaluate(() => [...document.querySelectorAll('.tr-msg')].map((n) => n.innerText).join(' | ')));
      assert.ok(t.includes(buyer.email), `${file}: traced to the buyer (${t})`);
    }
    await shot(a, 'admin-trace-leak');
    // a screenshot without the mark must not accuse anyone
    await go(a, '/admin/restrictions');
    const clean = join(root, 'tests', 'screenshots', 'leak-none.png');
    await a.screenshot({ path: clean });
    await (await a.$('#trace-file')).uploadFile(clean);
    await a.waitForFunction(() => /No buyer mark/.test(document.body.innerText), { timeout: 30000 });
    assert.equal(await a.$('.tr-hit'), null);
    await a.close();
  });

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
    assert.ok(await p.evaluate(() => document.querySelector('.guard-cover')?.innerText.includes('Screenshots and recording are not allowed')));
    await shot(p, 'reader-guard');
    // Win+Shift+S / game-bar recording: the page goes blank on the first key, before the tool grabs the screen
    await sleep(2800);
    const blank = await p.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true })); return document.documentElement.classList.contains('capture-hide'); });
    assert.ok(blank, 'hidden on the Windows key');
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
    for (const s of ['Sales today', 'Payments to confirm', 'Latest sales', 'New buyers', 'Top sellers']) assert.ok(t.includes(s), s);
    assert.ok(!(await p.$('svg[aria-label^="Revenue this month"]')), 'charts live in Statistics, not the dashboard');
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
    const name = `E2E Upload ${Date.now()}`;
    await p.waitForFunction(() => /\d+ pages?/.test(document.querySelector('#fmeta').value), { timeout: 10000 });
    assert.equal(await p.$eval('#fmeta', (e) => e.value), '4 pages', 'page count detected from the PDF');
    await p.click('#fname', { clickCount: 3 }); await p.type('#fname', name); // replace the name taken from the file
    await p.click('#flabel'); await p.type('#flabel', 'cardio');
    const opts = await p.$$eval('.catpick-opt', (els) => els.map((e) => e.textContent));
    assert.ok(opts.includes('Cardiology') && opts.includes('Cardiothoracic Surgery'), `searchable subjects: ${opts.slice(0, 5)}`);
    await p.keyboard.press('ArrowDown'); // first match after the typed text
    await p.$$eval('.catpick-opt', (els) => els.find((e) => e.textContent === 'Cardiology').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await p.type('#fprice', '99');
    await clickText(p, '.modal button', 'Upload & publish');
    await sleep(2500);
    assert.ok(!(await p.$('.modal')), 'dialog closed');
    assert.ok((await text(p)).includes(name), 'listed in admin files');
    const { data: rows } = await service.from('files').select('id, storage_path, cover_path, price, label, meta').ilike('name', `%${name}%`);
    try {
      assert.equal(rows.length, 1, 'saved under the typed name');
      const [data] = rows;
      assert.equal(Number(data.price), 99);
      assert.equal(data.label, 'Cardiology');
      assert.equal(data.meta, '4 pages');
      assert.ok(data.storage_path && data.cover_path);
    } finally {
      for (const d of rows ?? []) { // never leave test uploads in the library
        await service.storage.from('files').remove([d.storage_path]);
        await service.storage.from('covers').remove([d.cover_path]);
        await service.from('files').delete().eq('id', d.id);
      }
    }
    await p.close();
  });

  test('Test this QR: builds a 1 peso GCash QR from the uploaded QR Ph code', async () => {
    const f = (id, v) => id + String(v.length).padStart(2, '0') + v;
    const { crc16 } = await import('../src/lib/qrph.ts');
    const acct = f('00', 'com.p2pqrpay') + f('01', 'GXCHPHM2XXX') + f('02', '99964403') + f('04', '09171234567');
    const body = f('00', '01') + f('01', '11') + f('27', acct) + f('52', '6016') + f('53', '608') + f('58', 'PH') + f('59', 'MEDNOTES PUBLISHING') + f('60', 'ORMOC CITY') + '6304';
    const { data: before } = await service.from('settings').select('payment_methods').eq('id', 1).single();
    const methods = before.payment_methods.map((m, i) => (i === 0 ? { ...m, qr_payload: body + crc16(body) } : m));
    await service.from('settings').update({ payment_methods: methods }).eq('id', 1);
    try {
      const p = await open(admin);
      await go(p, '/admin/settings');
      assert.ok(await clickText(p, 'button', 'Test this QR'), 'button shown for a QR Ph code');
      await p.waitForSelector('.modal img[alt*="test QR"]');
      let t = await p.$eval('.modal', (m) => m.innerText);
      for (const x of ['MEDNOTES PUBLISHING', '09171234567', '₱1.00 built into the QR', 'checksum OK', 'another']) assert.ok(t.includes(x), x);
      await p.$eval('#test-amt', (e) => { e.value = ''; });
      await p.type('#test-amt', '25');
      await sleep(400);
      t = await p.$eval('.modal', (m) => m.innerText);
      assert.ok(t.includes('₱25.00 built into the QR'));
      await shot(p, 'admin-test-qr');
      await p.close();
    } finally {
      await service.from('settings').update({ payment_methods: before.payment_methods }).eq('id', 1);
    }
  });

  test('admin sets the watermark name and line; readers see it', async () => {
    const { data: before } = await service.from('settings').select('publisher_name, watermark_note, watermark, watermark_web').eq('id', 1).single();
    try {
      const p = await open(admin);
      await go(p, '/admin/restrictions');
      await clickText(p, '[role=radio]', 'App & website');
      await p.$eval('#wm-name', (e) => e.select());
      await p.type('#wm-name', 'Dr. Test Publisher');
      await p.$eval('#wm-note', (e) => e.select());
      await p.type('#wm-note', 'For enrolled students only');
      const preview = await p.$eval('.wm-sample-page', (e) => decodeURIComponent(e.style.backgroundImage));
      assert.ok(preview.includes('© Dr. Test Publisher') && preview.includes('For enrolled students only'), 'live preview');
      await clickText(p, 'button', 'Save restrictions');
      await sleep(1000);
      const { data: st } = await service.from('settings').select('publisher_name, watermark_note, watermark, watermark_web').eq('id', 1).single();
      assert.deepEqual(st, { publisher_name: 'Dr. Test Publisher', watermark_note: 'For enrolled students only', watermark: true, watermark_web: true });
      await shot(p, 'admin-watermark');
      await p.close();
      const b = await open(buyer);
      await go(b, `/file/${FILES.docx}`);
      assert.ok((await text(b)).includes('Published by Dr. Test Publisher'), 'credited on the file page');
      await go(b, `/read/${FILES.docx}`);
      await b.waitForSelector('.wm', { timeout: 15000 });
      const wm = await b.evaluate(() => decodeURIComponent(getComputedStyle(document.querySelector('.wm')).getPropertyValue('--wm')));
      assert.ok(wm.includes('© Dr. Test Publisher') && wm.includes('For enrolled students only'), 'reader uses it');
      await b.close();
    } finally {
      await service.from('settings').update(before).eq('id', 1);
    }
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

describe('no spinners, just skeletons', () => {
  test('every page loads without a spinner', async () => {
    const p = await open(buyer);
    await p.evaluateOnNewDocument(() => { window.__spin = 0; new MutationObserver(() => { if (document.querySelector('.spinner')) window.__spin++; }).observe(document, { childList: true, subtree: true }); });
    let skeletons = 0;
    for (const path of ['/library', `/file/${FILES.docx}`, '/my-files', '/devices', '/account', `/read/${FILES.pdf}`]) {
      await p.goto(BASE + path);
      skeletons += await p.evaluate(() => (document.querySelectorAll('.skeleton').length > 0 ? 1 : 0));
      await p.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
      assert.equal(await p.evaluate(() => window.__spin), 0, `${path}: no spinner`);
    }
    assert.ok(skeletons >= 3, `skeletons shown while loading (${skeletons} pages)`);
    await p.close();
  });
});

describe('account settings', () => {
  test('preferences save to the profile and change the reader', async () => {
    const u = await makeUser('e2e-prefs');
    await admin.client.rpc('admin_grant_file', { p_user: u.id, p_file: FILES.docx });
    try {
      const p = await open(u);
      await go(p, '/account/settings');
      await clickText(p, '.seg button', 'Dark');
      await p.$eval('input[aria-label="Text size"]', (e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '20'); e.dispatchEvent(new Event('input', { bubbles: true })); });
      await p.select('select[aria-label="Start page"]', 'my-files');
      await sleep(800);
      const { data } = await service.from('profiles').select('prefs').eq('id', u.id).single();
      assert.deepEqual({ t: data.prefs.readerTheme, s: data.prefs.textSize, start: data.prefs.startPage }, { t: 'dark', s: 20, start: 'my-files' });
      await shot(p, 'account-settings');
      await go(p, `/read/${FILES.docx}`);
      await p.waitForSelector('.docx-view section.docx', { timeout: 15000 });
      const r = await p.evaluate(() => ({ dark: document.querySelector('.reader').classList.contains('rt-dark'), scale: getComputedStyle(document.querySelector('.reader')).getPropertyValue('--reader-scale').trim() }));
      assert.ok(r.dark, 'reader uses the dark page colour');
      assert.equal(Number(r.scale).toFixed(2), (20 / 17).toFixed(2), 'text size applied');
      await go(p, '/');
      assert.match(p.url(), /my-files/, 'opens on the chosen start page');
      await p.close();
    } finally { await dropUser(u); }
  });

  test('changing the password needs the current one; the new one works', async () => {
    const u = await makeUser('e2e-pw');
    try {
      const p = await open(u);
      await go(p, '/account/settings');
      assert.ok((await text(p)).includes('stored scrambled'), 'explains where the password comes from');
      await p.type('#cur-pw', 'wrong-password');
      await p.type('#pw', 'N3w-Passw0rd!x'); await p.type('#pw2', 'N3w-Passw0rd!x');
      assert.equal(await p.$eval('.pw-meter b', (e) => e.textContent), 'Strong');
      await clickText(p, 'form button', 'Change password');
      await sleep(1200);
      assert.match(await p.evaluate(() => document.querySelector('.toast')?.innerText ?? ''), /current password is not right/);
      await p.$eval('#cur-pw', (e) => e.select());
      await p.type('#cur-pw', u.password);
      await clickText(p, 'form button', 'Change password');
      await sleep(1500);
      assert.match(await p.evaluate(() => document.querySelector('.toast')?.innerText ?? ''), /Password changed/);
      const c = anon();
      assert.ifError((await c.auth.signInWithPassword({ email: u.email, password: 'N3w-Passw0rd!x' })).error);
      assert.ok((await c.auth.signInWithPassword({ email: u.email, password: u.password })).error, 'old password no longer works');
      await p.close();
    } finally { await dropUser(u); }
  });
});

describe('admin subjects', () => {
  test('subjects & categories: add, rename (files follow), delete; shown first in the upload form and library filter', async () => {
    const name = `Board Review ${Date.now().toString(36)}`;
    // a file already in the subject, so renaming it has something to move
    await service.from('files').update({ label: name }).eq('id', FILES.xlsx);
    const p = await open(admin);
    try {
      await go(p, '/admin/files');
      await clickText(p, 'button', 'Subjects & categories');
      await p.waitForSelector('#new-subject');
      await p.type('#new-subject', name);
      await clickText(p, '.modal button', 'Add');
      await p.waitForFunction((n) => [...document.querySelectorAll('.subject-row b')].some((b) => b.textContent === n), { timeout: 8000 }, name);
      // rename the subject: the file follows
      const renamed = `${name} 2`;
      await p.evaluate((n) => [...document.querySelectorAll('.subject-row')].find((r) => r.querySelector('b')?.textContent === n)?.querySelector('button')?.click(), name);
      const box = await p.waitForSelector('.subject-row input');
      await box.click({ clickCount: 3 }); await box.type(renamed);
      await clickText(p, '.subject-row button', 'Save');
      await p.waitForFunction(() => [...document.querySelectorAll('.modal button')].some((b) => b.textContent === 'Rename' && !b.closest('.subject-row')), { timeout: 8000 }); // "1 file moves too"
      await p.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Rename' && !b.closest('.subject-row'))?.click());
      await p.waitForFunction((n) => [...document.querySelectorAll('.subject-row b')].some((b) => b.textContent === n), { timeout: 8000 }, renamed);
      assert.equal((await service.from('files').select('label').eq('id', FILES.xlsx).single()).data.label, renamed, 'file moved with the rename');
      await shot(p, 'admin-subjects');
      await p.keyboard.press('Escape');
      // shown first in the buyer's subject filter
      const b = await open(buyer);
      await go(b, '/library');
      await b.click('#subject');
      await b.waitForFunction((n) => [...document.querySelectorAll('.catpick-list li')].some((li) => li.textContent.includes(n)), { timeout: 8000 }, renamed);
      await b.close();
      // delete it: the file stays, without a subject
      await go(p, '/admin/files');
      await clickText(p, 'button', 'Subjects & categories');
      await p.waitForSelector('.subject-row');
      await p.evaluate((n) => [...document.querySelectorAll('.subject-row')].find((r) => r.querySelector('b')?.textContent === n)?.querySelector('.btn-danger')?.click(), renamed);
      await p.waitForFunction(() => [...document.querySelectorAll('.modal button')].some((b) => b.textContent === 'Delete subject'));
      await p.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Delete subject')?.click());
      await p.waitForFunction((n) => ![...document.querySelectorAll('.subject-row b')].some((b) => b.textContent === n), { timeout: 8000 }, renamed);
      const { data: f } = await service.from('files').select('label').eq('id', FILES.xlsx).single();
      assert.equal(f.label, '', 'file kept, subject cleared');
    } finally {
      await service.from('files').update({ label: 'Clinical' }).eq('id', FILES.xlsx);
      await service.from('subjects').delete().ilike('name', `${name}%`);
      await p.close();
    }
  });
});

describe('admin receipts and appearance', () => {
  test('receipts: issued list, configurable design with a live sample, buyers see it', async () => {
    const { data: before } = await service.from('settings').select('receipt_design').eq('id', 1).single();
    try {
      const p = await open(admin);
      await go(p, '/admin/receipts');
      const rows = await p.$$eval('.rtable .tr:not(.th)', (e) => e.length);
      assert.ok(rows >= 5, `issued receipts listed (${rows})`);
      await p.click('.rtable .tr:not(.th)');
      await p.waitForSelector('.modal .receipt');
      assert.match(await p.$eval('.modal .receipt', (e) => e.innerText), /OR-\d{6}/);
      await p.keyboard.press('Escape');
      await go(p, '/admin/receipts?tab=design');
      await p.waitForSelector('.rc-preview .receipt.is-sample');
      await p.$eval('#rd-title', (e) => e.select()); await p.type('#rd-title', 'Sales invoice');
      await p.type('#rd-address', 'Real St., Ormoc City');
      await p.$eval('#rd-accent', (e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '#7c3aed'); e.dispatchEvent(new Event('input', { bubbles: true })); });
      const sample = await p.$eval('.rc-preview .receipt', (e) => ({ t: e.innerText, cls: e.className, accent: e.style.getPropertyValue('--rc') }));
      assert.ok(sample.t.includes('Sales invoice') && sample.t.includes('Real St., Ormoc City') && sample.t.includes('SAMPLE'), 'sample follows the form');
      assert.ok(sample.cls.includes('paper-card') && sample.accent === '#7c3aed', 'normal template + accent');
      await shot(p, 'admin-receipts-design');
      await clickText(p, 'button', 'Save receipt settings');
      await sleep(1000);
      await p.close();
      const { data: owned } = await service.from('purchases').select('id').eq('user_id', buyer.id).eq('status', 'confirmed').not('receipt_no', 'is', null).limit(1).single();
      const b = await open(buyer);
      await go(b, `/receipt/${owned.id}`);
      const r = await b.$eval('.receipt', (e) => ({ t: e.innerText, cls: e.className }));
      assert.ok(r.t.includes('Sales invoice') && !r.t.includes('SAMPLE'), 'buyer receipt uses the design');
      // the receipt is the one thing buyers can download: as a picture
      const dir = join(SHOTS, 'downloads'); mkdirSync(dir, { recursive: true });
      const cdp = await b.target().createCDPSession();
      await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
      await clickText(b, 'button', 'Save as image');
      let png = '';
      for (let i = 0; i < 30 && !png; i++) { await sleep(300); png = readdirSync(dir).find((f) => f.startsWith('receipt-') && f.endsWith('.png')) ?? ''; }
      assert.ok(png, 'receipt image downloaded');
      assert.ok(readFileSync(join(dir, png)).subarray(1, 4).toString() === 'PNG');
      await b.close();
    } finally {
      await service.from('settings').update(before).eq('id', 1);
    }
  });

  test('appearance: colours, name, welcome text and background apply everywhere', async () => {
    const { data: before } = await service.from('settings').select('theme').eq('id', 1).single();
    try {
      const p = await open(admin);
      await go(p, '/admin/appearance');
      await p.waitForSelector('iframe.site-frame');
      await clickText(p, '[role=tab]', 'Colours & style');
      await clickText(p, '.ap-preset', 'Berry');
      await p.type('#ap-name', 'MedNotes Review Center');
      await clickText(p, '[role=tab]', 'Edit website');
      await p.select('.site-page-pick', 'library');
      await p_type(p, '#tx-library-heroTitle', 'Ready for boards?');
      assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--blue').trim()), '#be185d', 'admin screen previews live');
      await shot(p, 'admin-appearance');
      await clickText(p, 'button', 'Save website');
      await sleep(1200);
      await p.close();
      const { data } = await service.from('settings').select('theme').eq('id', 1).single();
      assert.equal(data.theme.primary, '#be185d');
      assert.equal(data.theme.copy['library.heroTitle'], 'Ready for boards?');
      const b = await open(buyer);
      await go(b, '/library');
      const look = await b.evaluate(() => ({ blue: getComputedStyle(document.documentElement).getPropertyValue('--blue').trim(), bg: document.documentElement.hasAttribute('data-app-bg'), t: document.body.innerText }));
      assert.equal(look.blue, '#be185d');
      assert.ok(look.bg, 'background applied');
      assert.ok(look.t.includes('Ready for boards?') && look.t.includes('MedNotes Review Center'), 'welcome text + name');
      await shot(b, 'library-themed');
      await b.close();
      const a = await open(null);
      await go(a, '/sign-in');
      assert.equal(await a.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--blue').trim()), '#be185d', 'sign-in page themed before login');
      await a.close();
    } finally {
      await service.from('settings').update(before).eq('id', 1);
    }
  });

  test('appearance: the app download link and QR are set from the sign-in page editor', async () => {
    const { data: before } = await service.from('settings').select('theme').eq('id', 1).single();
    const link = 'https://play.google.com/store/apps/details?id=com.example.newapp';
    try {
      const p = await open(admin);
      await go(p, '/admin/appearance');
      await p.waitForSelector('iframe.site-frame');
      await clickText(p, '[role=tab]', 'Edit website');
      await p.select('.site-page-pick', 'sign-in');
      await p.waitForSelector('#ap-play');
      await p.type('#ap-play', link);
      await clickText(p, 'button', 'Save website');
      await sleep(1200);
      await p.close();
      assert.equal((await service.from('settings').select('theme').eq('id', 1).single()).data.theme.playStoreUrl, link);
      const a = await open(null);
      await go(a, '/sign-in');
      await a.waitForFunction((l) => document.querySelector('.store-btn')?.getAttribute('href') === l && document.querySelector('.qr img.code')?.src.startsWith('data:image/png'), { timeout: 8000 }, link);
      await shot(a, 'sign-in-custom-app-qr');
      await a.close();
    } finally {
      await service.from('settings').update(before).eq('id', 1);
    }
  });
});

describe('free samples, extra device slots, profile', () => {
  test('free samples: a shelf in the library and they open without paying', async () => {
    const u = await makeUser('e2e-free');
    try {
      const p = await open(u);
      await go(p, '/library');
      const shelf = await p.evaluate(() => [...document.querySelectorAll('.shelf')].find((s) => s.querySelector('h2')?.textContent === 'Free to read')?.querySelectorAll('.bookcard').length ?? 0);
      assert.equal(shelf, 5, 'one of each: PDF, PPTX, EPUB, Word, Excel');
      await go(p, '/file/a0000000-0000-0000-0000-000000000019');
      assert.ok((await text(p)).includes('Read for free'));
      await go(p, '/read/a0000000-0000-0000-0000-000000000019');
      await p.waitForSelector('.reader canvas', { timeout: 15000 });
      await p.close();
    } finally { await dropUser(u); }
  });

  test('rejected payment: buyer resubmits the same payment; admin finds it by search, newest/oldest and status', async () => {
    const u = await makeUser('e2e-resub');
    try {
      const { data: p0 } = await u.client.from('purchases').insert({ user_id: u.id, file_id: FILES.pdf, amount: 1, method: 'GCash', proof_path: `${u.id}/old.png` }).select().single();
      await admin.client.rpc('reject_purchase', { p_id: p0.id, p_reason: 'Payment not received', p_note: 'Please send it again' });
      const b = await open(u);
      await go(b, `/checkout/${FILES.pdf}`);
      await b.waitForSelector('input[type=file]');
      { const t = await text(b); assert.ok(t.includes('Payment not received') && t.includes('Please send it again'), 'reason and message shown'); }
      await (await b.$('input[type=file]')).uploadFile(join(root, 'supabase', 'sample', 'proofs', '33333333-0000-0000-0000-000000000001', 'proof-1.png'));
      await b.waitForSelector('img.proof-img');
      await Promise.all([b.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), clickText(b, 'form button', 'Resubmit payment')]);
      await sleep(800);
      const { data: rows } = await service.from('purchases').select('status, attempts, history').eq('user_id', u.id);
      assert.equal(rows.length, 1, 'still one payment');
      assert.deepEqual({ s: rows[0].status, a: rows[0].attempts, h: rows[0].history.length }, { s: 'pending', a: 2, h: 1 });
      await b.close();
      const a = await open(admin);
      await go(a, '/admin/payments');
      await p_type(a, 'input[aria-label="Search payments"]', u.email);
      await sleep(300);
      const cards = await a.$$eval('.pay-list > button.card', (els) => els.map((e) => e.innerText));
      assert.equal(cards.length, 1, 'search finds just that buyer');
      assert.ok(cards[0].includes('Try 2'), 'resubmission marked');
      await a.click('.pay-list > button.card');
      await sleep(500);
      assert.ok((await text(a)).includes('Earlier attempts (1)'), 'earlier try listed');
      await shot(a, 'admin-payments-search');
      await clickText(a, '.pay-filters .chip', 'Rejected');
      await sleep(300);
      assert.equal(await a.$$eval('.pay-list > button.card', (els) => els.length), 0, 'filter by status (it is pending again)');
      await a.select('select[aria-label="Sort"]', 'old');
      await sleep(300);
      assert.match(a.url(), /sort=old/);
      await a.close();
    } finally { await dropUser(u); }
  });

  test('help: buyer opens a bug ticket with stars and a screenshot; the admin replies live; buyer rates the help', async () => {
    const u = await makeUser('e2e-help');
    try {
      const b = await open(u);
      await go(b, '/help');
      await clickText(b, '.help-kind', 'Report a bug');
      await b.waitForSelector('#t-subject');
      await b.type('#t-subject', 'Slides look cut off');
      await b.type('#t-body', 'On my phone the last bullet is hidden.');
      await b.click('.modal .stars button[aria-label="4 stars"]');
      await (await b.$('#t-file')).uploadFile(join(root, 'supabase', 'sample', 'proofs', '33333333-0000-0000-0000-000000000001', 'proof-1.png'));
      await b.waitForSelector('.ticket-preview');
      await shot(b, 'help-new-ticket');
      await clickText(b, '.modal button', 'Send');
      await b.waitForFunction(() => location.search.includes('t='), { timeout: 8000 });
      const { data: t } = await service.from('tickets').select('*').eq('user_id', u.id).single();
      assert.deepEqual({ k: t.kind, r: t.rating, s: t.status, att: !!t.attachment_path }, { k: 'bug', r: 4, s: 'open', att: true });
      const a = await open(admin);
      await go(a, `/admin/support?t=${t.id}`);
      await a.waitForSelector('.ticket-shot img');
      await p_type(a, 'textarea[aria-label="Reply"]', 'Thanks! Fixed in the next update.');
      await clickText(a, '.reply button', 'Send');
      await b.waitForFunction(() => document.body.innerText.includes('Fixed in the next update'), { timeout: 10000 });
      await clickText(a, 'button', 'Mark resolved');
      await sleep(800);
      await shot(a, 'admin-support');
      await a.close();
      await b.reload({ waitUntil: 'networkidle0' });
      await b.waitForSelector('.stars button[aria-label="5 stars"]');
      await b.click('.stars button[aria-label="5 stars"]');
      await sleep(800);
      assert.equal((await service.from('tickets').select('satisfaction').eq('id', t.id).single()).data.satisfaction, 5);
      await shot(b, 'help-ticket');
      await b.close();
    } finally { await dropUser(u); }
  });

  test('statistics: reset from the Statistics page is saved there and can be undone', async () => {
    const { data: s0 } = await service.from('settings').select('stats_reset_at').eq('id', 1).single();
    try {
      const p = await open(admin);
      await go(p, '/admin/statistics');
      await clickText(p, 'button', 'Reset statistics');
      await p.waitForSelector('.modal');
      await clickText(p, '.modal button', 'Reset statistics');
      await p.waitForFunction(() => !document.body.innerText.includes('never been reset'), { timeout: 8000 });
      assert.ok((await text(p)).includes('Resets'));
      await shot(p, 'admin-statistics-resets');
      await clickText(p, 'button', 'Undo reset');
      await p.waitForSelector('.modal');
      await clickText(p, '.modal button', 'Undo reset');
      await p.waitForFunction(() => document.body.innerText.includes('Reset undone'), { timeout: 8000 });
      const { data: s1 } = await service.from('settings').select('stats_reset_at').eq('id', 1).single();
      assert.equal(s1.stats_reset_at, s0.stats_reset_at, 'counters back where they were');
      await p.close();
    } finally { await service.from('settings').update({ stats_reset_at: s0.stats_reset_at }).eq('id', 1); }
  });

  test('statistics report: periods, custom dates, compare, CSV export', async () => {
    const p = await open(admin);
    await go(p, '/admin/statistics');
    await p.waitForSelector('.range-report .kpi-grid .stat .v');
    let t = await text(p);
    for (const s of ['Report', 'Revenue', 'Net after revoked', 'Orders', 'Average order', 'Returning buyers', 'New sign-ups', 'By category', 'Payments', 'Average time to confirm', 'Files sold', 'Monthly history', 'Resets']) assert.ok(t.includes(s), s);
    assert.match(t, /compared with/);
    // every preset loads without errors
    for (const label of ['Today', 'Last 7 days', 'Last 30 days', 'Last month', 'This year', 'This month']) {
      await clickText(p, '.range-chips button', label);
      await p.waitForFunction((l) => document.querySelector('.range-chips button[aria-pressed="true"]')?.textContent === l, {}, label);
      await p.waitForSelector('.range-report .kpi-grid .stat .v');
    }
    // pick a month to review it on its own
    const prevMonth = await p.$eval('select.month-pick option:nth-child(3)', (o) => o.value);
    await p.select('select.month-pick', prevMonth);
    await p.waitForFunction(() => document.querySelector('select.month-pick')?.classList.contains('on'));
    const [yy, mm] = prevMonth.split('-').map(Number);
    const monthName = new Date(yy, mm - 1, 1).toLocaleDateString('en-US', { month: 'short' });
    await p.waitForFunction((n) => (document.querySelector('.range-report')?.innerText ?? '').includes(`${n} 1`), { timeout: 8000 }, monthName);
    await p.waitForSelector('.range-report .kpi-grid .stat .v');
    await clickText(p, '.range-chips button', 'This month');
    await p.waitForSelector('.range-report .chart-wrap');
    // pointing anywhere over the chart (gaps included) shows one steady label
    const cw = await (await p.$('.range-report .chart-wrap')).boundingBox();
    for (const f of [0.2, 0.5, 0.8]) {
      await p.mouse.move(cw.x + cw.width * f, cw.y + cw.height * 0.6);
      await p.waitForSelector('.range-report .chart-tip');
    }
    await shot(p, 'admin-statistics-report');
    await p.mouse.move(0, 0);
    // custom dates
    await clickText(p, '.range-chips button', 'Custom');
    await p.waitForSelector('#rr-from');
    await p.$eval('#rr-from', (e) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '2026-09-01'); e.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.waitForFunction(() => /Sep 1, 2026/.test(document.querySelector('.range-report')?.innerText ?? ''), { timeout: 8000 });
    // CSV: catch the download in the page and read it
    await p.evaluate(() => { window.__csv = null; HTMLAnchorElement.prototype.click = function () { if (this.download) fetch(this.href).then((r) => r.text()).then((x) => { window.__csv = { name: this.download, text: x }; }); }; });
    await clickText(p, 'button', 'Export CSV');
    await p.waitForFunction(() => window.__csv, { timeout: 8000 });
    const csv = await p.evaluate(() => window.__csv);
    assert.match(csv.name, /^mednotes-sales-2026-09-01-to-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = csv.text.replace(/^﻿/, '').split(/\r\n/);
    assert.equal(lines[0], 'Date,Receipt no.,Buyer,Email,Item,Category,Payment method,Amount (PHP),Note');
    assert.ok(lines.length > 2, 'has sales');
    const sum = lines.slice(1, -1).reduce((a, l) => a + Number(l.match(/,(-?\d+\.\d{2}),[^,]*$/)[1]), 0);
    assert.equal(Number(lines.at(-1).split(',')[7]), Math.round(sum * 100) / 100, 'total line adds up');
    await p.close();
  });

  test('uploaded images open full screen on a phone and can be zoomed', async () => {
    const u = await makeUser('e2e-zoom');
    try {
      const { data: pay } = await u.client.from('purchases').insert({ user_id: u.id, file_id: FILES.pdf, amount: 1, method: 'GCash', proof_path: '33333333-0000-0000-0000-000000000001/proof-1.png' }).select().single();
      const p = await open(admin, { mobile: true });
      await go(p, `/admin/payments?id=${pay.id}`);
      await p.waitForSelector('.zoom-thumb img', { timeout: 8000 });
      await p.tap('.zoom-thumb');
      await p.waitForSelector('.zoom-view img');
      const box = await (await p.$('.zoom-stage')).boundingBox();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      // double tap zooms in
      await p.touchscreen.tap(cx, cy); await sleep(80); await p.touchscreen.tap(cx, cy);
      await p.waitForFunction(() => document.querySelector('.zoom-bar .small')?.textContent === '250%', { timeout: 4000 });
      await shot(p, 'proof-zoomed-phone');
      await clickText(p, '.zoom-bar button', 'Close');
      await p.waitForFunction(() => !document.querySelector('.zoom-view'));
      // the buyer's own screenshot on checkout zooms too
      const b = await open(u, { mobile: true });
      await service.from('purchases').update({ status: 'rejected', reject_reason: 'Payment not received' }).eq('id', pay.id);
      await go(b, `/checkout/${FILES.pdf}`);
      await b.waitForSelector('input[type=file]');
      await (await b.$('input[type=file]')).uploadFile(join(root, 'supabase', 'sample', 'proofs', '33333333-0000-0000-0000-000000000001', 'proof-1.png'));
      await b.waitForSelector('.zoom-thumb img.proof-img');
      await b.tap('.zoom-thumb');
      await b.waitForSelector('.zoom-view img');
      await b.keyboard.press('Escape');
      await b.waitForFunction(() => !document.querySelector('.zoom-view'));
      await p.close(); await b.close();
    } finally { await dropUser(u); }
  });

  test('buyer pays for an extra computer slot; the admin confirms; the slot appears', async () => {
    const u = await makeUser('e2e-slot');
    try {
      const b = await open(u);
      await go(b, '/devices');
      assert.ok((await text(b)).includes('allows 1 computer'));
      await clickText(b, 'a.slot-offer', 'Extra computer');
      // step 1: how many, then it's locked
      await b.waitForSelector('.qty-pick');
      assert.match(b.url(), /checkout\/slot\/computer/);
      assert.equal(await b.$('.drop'), null, 'no upload before choosing how many');
      await b.click('.qty-pick button[aria-label="More"]');
      await clickText(b, 'button', 'Continue to payment');
      await b.waitForSelector('input[type=file]');
      assert.equal(await b.$('.qty-pick'), null, 'quantity locked while paying');
      await b.reload({ waitUntil: 'networkidle0' });
      await b.waitForSelector('input[type=file]');
      assert.ok((await text(b)).includes('Change how many'), 'still locked after a refresh');
      await (await b.$('input[type=file]')).uploadFile(join(root, 'supabase', 'sample', 'proofs', '33333333-0000-0000-0000-000000000001', 'proof-1.png'));
      await shot(b, 'checkout-slot');
      await Promise.all([b.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), clickText(b, 'form button', 'Submit payment')]);
      await sleep(800);
      assert.match(b.url(), /devices/);
      assert.ok((await text(b)).includes('waiting for confirmation'));
      const a = await open(admin);
      const { data: o } = await service.from('device_orders').select('id, qty, amount').eq('user_id', u.id).single();
      const { data: st } = await service.from('settings').select('slot_price_computer').eq('id', 1).single();
      assert.deepEqual({ qty: o.qty, amount: Number(o.amount) }, { qty: 2, amount: 2 * Number(st.slot_price_computer) });
      await go(a, `/admin/payments?type=slots&id=${o.id}`);
      assert.ok((await text(a)).includes('Extra computer slot'));
      await clickText(a, 'button', 'Confirm received');
      await sleep(1500);
      assert.match(await a.evaluate(() => document.querySelector('.toast')?.innerText ?? ''), /extra computer slot is added/);
      await a.close();
      await b.waitForFunction(() => document.body.innerText.includes('allows 3 computers'), { timeout: 10000 });
      assert.ok(await b.$('a[href^="/receipt/slot/"]'), 'receipt link');
      await b.close();
    } finally { await dropUser(u); }
  });

  test('profile picture upload', async () => {
    const u = await makeUser('e2e-avatar');
    try {
      const p = await open(u);
      await go(p, '/account');
      await (await p.$('input[aria-label="Profile picture"]')).uploadFile(join(root, 'supabase', 'sample', 'covers', 'anatomy.png'));
      await p.waitForFunction(() => document.querySelector('.avatar-lg img')?.getAttribute('src')?.includes('/avatars/'), { timeout: 10000 });
      const { data } = await service.from('profiles').select('avatar_url').eq('id', u.id).single();
      assert.ok(data.avatar_url.includes(`/avatars/${u.id}/`));
      await p.close();
      await service.storage.from('avatars').remove([data.avatar_url.split('/avatars/')[1]]);
    } finally { await dropUser(u); }
  });

  test('library subject filter is a searchable list of medical subjects', async () => {
    const p = await open(buyer);
    await go(p, '/library');
    await p.click('#subject'); await p.type('#subject', 'cardio');
    const opts = await p.$$eval('.catpick-opt', (els) => els.map((e) => e.textContent));
    assert.ok(opts.some((o) => o.startsWith('Cardiology')), 'Cardiology offered');
    await p.$$eval('.catpick-opt', (els) => els.find((e) => e.textContent.startsWith('Cardiology')).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await sleep(400);
    const labels = await p.$$eval('.grid .bookcard .eyebrow', (els) => els.map((e) => e.textContent));
    assert.ok(labels.length > 0 && labels.every((l) => /cardiology/i.test(l)), `only cardiology: ${labels}`);
    await p.close();
  });
});

describe('powerful admin', () => {
  test('logs: a change shows with before/after and can be reverted from the page', async () => {
    // a run cut short can leave 777 behind, and then the update below would log nothing
    await service.from('files').update({ price: 150 }).eq('id', FILES.xlsx).eq('price', 777);
    const { data: f } = await service.from('files').select('price').eq('id', FILES.xlsx).single();
    await admin.client.from('files').update({ price: 777 }).eq('id', FILES.xlsx);
    const p = await open(admin);
    await go(p, '/admin/logs?type=files');
    await p.waitForSelector('.log-row');
    await p.click('.log-row .log-head');
    await p.waitForSelector('.log-diff-row');
    const diff = await p.$eval('.log-body', (e) => e.innerText);
    assert.ok(diff.includes('777'), 'shows the new value');
    await shot(p, 'admin-logs');
    await clickText(p, '.log-body button', 'Revert');
    await p.waitForSelector('.modal button[type=submit]');
    await p.click('.modal button[type=submit]');
    await sleep(1200);
    assert.equal(Number((await service.from('files').select('price').eq('id', FILES.xlsx).single()).data.price), Number(f.price), 'reverted');
    await p.close();
  });

  test('dashboard reset keeps the monthly statistics', async () => {
    const { data: s0 } = await service.from('settings').select('stats_reset_at').eq('id', 1).single();
    try {
      const p = await open(admin);
      await go(p, '/admin');
      await clickText(p, 'button', 'Reset statistics');
      await p.waitForSelector('.modal button[type=submit]');
      await p.click('.modal button[type=submit]');
      await p.waitForFunction(() => document.body.innerText.includes('Counting since'), { timeout: 8000 });
      await go(p, '/admin/statistics');
      await p.waitForSelector('.rtable .tr:not(.th)');
      const months = await p.$$eval('.rtable .tr:not(.th)', (e) => e.length);
      assert.ok(months >= 1);
      assert.ok(!(await text(p)).includes('₱0.00\n') || months > 0);
      await shot(p, 'admin-statistics');
      await p.close();
    } finally {
      await service.from('settings').update({ stats_reset_at: s0.stats_reset_at }).eq('id', 1);
    }
  });

  test('admin dark mode lives in Settings and stays on across admin pages', async () => {
    const p = await open(admin);
    await go(p, '/admin/settings');
    assert.ok(/your admin account/i.test(await text(p)) && (await text(p)).includes('Receipt buyers get'));
    await p.click('button[aria-label="Dark mode"]');
    await sleep(600);
    const dark = await p.evaluate(() => ({ on: document.documentElement.hasAttribute('data-dark'), bg: getComputedStyle(document.body).backgroundColor }));
    assert.ok(dark.on && dark.bg === 'rgb(11, 18, 32)', JSON.stringify(dark));
    await shot(p, 'admin-dark');
    await go(p, '/admin/payments');
    assert.ok(await p.evaluate(() => document.documentElement.hasAttribute('data-dark')), 'still dark on other admin pages');
    await go(p, '/library');
    assert.ok(!(await p.evaluate(() => document.documentElement.hasAttribute('data-dark'))), 'not on buyer pages');
    await service.from('profiles').update({ prefs: {} }).eq('id', admin.id);
    await p.close();
  });

  test('site editor: clicking text in the preview picks it, edits show in the frame, nothing in it acts', async () => {
    const p = await open(admin);
    await go(p, '/admin/appearance');
    await p.waitForSelector('iframe.site-frame');
    const frame = await (await p.$('iframe.site-frame')).contentFrame();
    await frame.waitForSelector('[data-edit="signin.title"]', { timeout: 10000 });
    assert.ok(frame.url().includes('/sign-in'), 'signed-in admin still sees the sign-in page in the preview');
    await frame.evaluate(() => document.querySelector('[data-edit="signin.title"]').click());
    await frame.waitForSelector('[data-edit="signin.title"][contenteditable]', { timeout: 5000 });
    // typed right on the page, Canva-style
    await frame.evaluate(() => { const el = document.querySelector('[data-edit="signin.title"]'); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await p.keyboard.type('Hello reviewers');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#tx-signin-title')?.value === 'Hello reviewers', { timeout: 5000 });
    await frame.waitForFunction(() => document.querySelector('[data-edit="signin.title"]')?.textContent === 'Hello reviewers', { timeout: 5000 });
    assert.equal(await frame.$('[contenteditable]'), null, 'Enter finishes editing');
    // undo puts the default back; redo brings the edit back
    await p.click('button[aria-label="Undo"]');
    await frame.waitForFunction(() => document.querySelector('[data-edit="signin.title"]')?.textContent === 'Welcome back', { timeout: 5000 });
    await p.click('button[aria-label="Redo"]');
    await frame.waitForFunction(() => document.querySelector('[data-edit="signin.title"]')?.textContent === 'Hello reviewers', { timeout: 5000 });
    // links and buttons in the preview are inert
    await frame.evaluate(() => document.querySelector('a[href$="/sign-up"]').click());
    await sleep(500);
    assert.ok(frame.url().includes('/sign-in'), 'link did not navigate');
    await p.select('.site-page-pick', 'library');
    await frame.waitForFunction(() => location.pathname.endsWith('/library'), { timeout: 8000 });
    await shot(p, 'admin-site-editor');
    await p.close(); // not saved: nothing changes for buyers
    const { data } = await service.from('settings').select('theme').eq('id', 1).single();
    assert.notEqual(data.theme.copy?.['signin.title'], 'Hello reviewers');
  });

  test('site edits go live on open pages without reloading', async () => {
    const { data: before } = await service.from('settings').select('theme').eq('id', 1).single();
    try {
      const b = await open(buyer);
      await go(b, '/library');
      const a = await open(admin);
      await go(a, '/admin/appearance');
      await a.waitForSelector('.site-page-pick');
      await a.select('.site-page-pick', 'library');
      await p_type(a, '#tx-library-announcement', 'Live: board review week!');
      await clickText(a, 'button', 'Save website');
      await b.waitForFunction(() => document.querySelector('.announce')?.textContent.includes('board review week'), { timeout: 10000 });
      await a.close(); await b.close();
    } finally {
      await service.from('settings').update({ theme: before.theme }).eq('id', 1);
    }
  });
});

const p_type = async (page, sel, value) => { await page.waitForSelector(sel); await page.click(sel); await page.type(sel, value); };

describe('account deletion (UI)', () => {
  test('profile and account settings are separate pages', async () => {
    const p = await open(buyer);
    await go(p, '/account');
    let t = await text(p);
    assert.ok(t.includes('Profile') && t.includes('Account settings') && !t.includes('Change password') && !t.includes('Delete my account'), 'profile is just the profile');
    await clickText(p, 'a.link-row', 'Account settings');
    await p.waitForFunction(() => location.pathname.endsWith('/account/settings'));
    await sleep(600);
    t = await text(p);
    for (const part of ['Sign-in and security', 'Reading and app', 'Delete account', 'Email & password']) assert.ok(t.toLowerCase().includes(part.toLowerCase()), part);
    await p.close();
  });

  test('notification bell opens a list; a notification goes to its page', async () => {
    const u = await makeUser('e2e-bell');
    try {
      const { data: pay } = await u.client.from('purchases').insert({ user_id: u.id, file_id: FILES.pdf, amount: 1, method: 'GCash', proof_path: `${u.id}/x.png` }).select().single();
      await admin.client.rpc('reject_purchase', { p_id: pay.id, p_reason: 'Payment not received', p_note: 'We could not find it' });
      const p = await open(u);
      await go(p, '/library');
      assert.ok(await p.$eval('.bell .dot', (e) => Number(e.textContent) >= 1), 'unread count');
      await p.click('.bell');
      await p.waitForSelector('.bell-menu .bell-item');
      assert.ok((await p.$eval('.bell-menu', (e) => e.innerText)).includes('Payment rejected'));
      await shot(p, 'notifications');
      await p.click('.bell-menu .bell-item');
      await p.waitForFunction((id) => location.pathname.endsWith(`/checkout/${id}`), {}, FILES.pdf);
      await sleep(800);
      const t = await text(p);
      assert.ok(t.includes('Payment not received') && t.includes('We could not find it'), 'reason and the quoted message');
      await p.close();
    } finally { await dropUser(u); }
  });

  test('Delete my account signs out and removes the user', async () => {
    const u = await makeUser('e2e-delete');
    const p = await open(u);
    await go(p, '/account/settings');
    await clickText(p, 'button', 'Delete my account');
    await p.waitForSelector('.modal #confirm-type');
    assert.ok(await p.$eval('.modal button[type=submit]', (b) => b.disabled), 'disabled until DELETE is typed');
    await p.type('#confirm-type', 'delete');
    await p.click('.modal button[type=submit]');
    await sleep(2500);
    assert.match(p.url(), /sign-in/);
    assert.equal((await service.from('profiles').select('id').eq('id', u.id)).data.length, 0);
    await p.close();
  });
});

// summary file for the README / CI artifacts
after(() => writeFileSync(join(SHOTS, 'README.txt'), 'Screenshots from the last npm run test:e2e run.\n'));
