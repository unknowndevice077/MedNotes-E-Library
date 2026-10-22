// Data-flow tests: change something in one place (mostly through the admin screens) and check it
// lands in the database AND shows up right everywhere else in the app: library, search, subject
// filter, file page, checkout, reader, My files, payments, receipts, notifications, dashboard,
// statistics. And that it disappears from the places it should.
// Needs the dev server (5173) and the local Supabase with the demo seed. Run: npm run test:flows
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { dropUser, makeUser, root, service } from './helpers.mjs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = join(root, 'tests', 'screenshots', 'flows');
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SAMPLE = (f) => join(root, 'supabase', 'sample', f);
const tag = Date.now().toString(36);

let browser, admin, owner, stranger;
const pages = [];

async function open(user, { mobile = false } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  pages.push(page);
  if (user) {
    user.device ??= crypto.randomUUID();
    await page.evaluateOnNewDocument((v) => localStorage.setItem('mn.device_id', v), user.device);
  }
  if (mobile) await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  else await page.setViewport({ width: 1440, height: 900 });
  page.on('dialog', (d) => d.accept());
  if (user) {
    await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' });
    await page.type('#email', user.email);
    await page.type('#pw', user.password);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}), page.click('form button.btn-primary')]);
    await sleep(800);
  }
  return page;
}
const go = async (p, path) => { await p.goto(BASE + path, { waitUntil: 'networkidle0' }); await sleep(700); };
const text = (p) => p.evaluate(() => document.body.innerText);
const shot = (p, name) => p.screenshot({ path: join(SHOTS, `${name}.png`) });
/** Clicks the first visible element matching `sel` whose text includes `t`; fails loudly if there isn't one. */
async function click(p, sel, t) {
  const ok = await p.evaluate((s, x) => {
    const shown = [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null);
    // an exact label wins over one that merely contains it ("Reject" vs the "Rejected" filter)
    const el = shown.find((e) => e.innerText.trim() === x) ?? shown.find((e) => e.innerText.trim().includes(x));
    el?.click(); return !!el;
  }, sel, t);
  assert.ok(ok, `no "${t}" in ${sel}`);
}
async function waitText(p, t, timeout = 8000) {
  await p.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t).catch(() => {});
  assert.ok((await text(p)).includes(t), `page shows "${t}"`);
}
async function noText(p, t) { assert.ok(!(await text(p)).includes(t), `page should not show "${t}"`); }
async function setInput(p, sel, value) {
  await p.$eval(sel, (e, v) => {
    const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(e, v);
    e.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
const row = async (id) => (await service.from('files').select('*').eq('id', id).single()).data;
const objectExists = async (bucket, name) => {
  const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
  const { data } = await service.storage.from(bucket).list(dir, { search: name.slice(name.lastIndexOf('/') + 1) });
  return !!data?.some((o) => `${dir ? dir + '/' : ''}${o.name}` === name);
};

// A throwaway book with its own copy of the PDF and cover, so editing or deleting it never touches the demo files.
async function makeBook(name, extra = {}) {
  const id = crypto.randomUUID();
  const storage_path = `flows/${id}.pdf`, cover_path = `flows/${id}.png`;
  await service.storage.from('files').upload(storage_path, readFileSync(SAMPLE('files/anatomy-atlas-upper-limb.pdf')), { contentType: 'application/pdf' });
  await service.storage.from('covers').upload(cover_path, readFileSync(SAMPLE('covers/anatomy.png')), { contentType: 'image/png' });
  const { error } = await service.from('files').insert({ id, name, label: 'Anatomy', description: 'Flow test book.', price: 199, kind: 'pdf', mime: 'application/pdf', storage_path, cover_path, meta: '4 pages', published: true, ...extra });
  assert.ifError(error);
  return id;
}
async function dropBook(id) {
  const f = await row(id);
  if (!f) return;
  if (f.storage_path?.startsWith('flows/')) await service.storage.from('files').remove([f.storage_path]);
  if (f.cover_path?.startsWith('flows/')) await service.storage.from('covers').remove([f.cover_path]);
  await service.from('files').delete().eq('id', id);
}
async function own(user, fileId) {
  const { data, error } = await user.client.from('purchases').insert({ user_id: user.id, file_id: fileId, amount: 1, method: 'GCash', proof_path: `${user.id}/p.png` }).select().single();
  assert.ifError(error);
  assert.ifError((await admin.client.rpc('confirm_purchase', { p_id: data.id, p_note: '' })).error);
  return data.id;
}
// the library search box on the home page; results replace the shelves
async function searchLibrary(p, q) {
  // the top search bar takes you to /library?q=… when you press Enter
  await go(p, '/library');
  await p.click('input[aria-label="Search the library"]');
  await p.type('input[aria-label="Search the library"]', q);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => location.search.includes('q='), { timeout: 5000 });
  await sleep(800);
}
/** Waits until a database read returns something truthy. */
async function until(fn, what, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) assert.fail(`timed out waiting for ${what}`); await sleep(300); }
}
const payStatus = (id, status) => until(async () => (await service.from('purchases').select('status').eq('id', id).single()).data?.status === status, `payment ${status}`);
const cardNames = (p) => p.$$eval('.bookcard', (els) => els.map((e) => e.innerText));

async function openBell(p) {
  await p.evaluate(() => [...document.querySelectorAll('.bell')].find((e) => e.offsetParent !== null).click());
  await p.waitForSelector('.bell-menu', { timeout: 8000 });
}
async function openEditor(p, name) {
  await go(p, '/admin/files');
  await p.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 8000 }, name);
  const ok = await p.evaluate((n) => {
    const r = [...document.querySelectorAll('.tr')].find((e) => e.innerText.includes(n));
    const b = r && [...r.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Edit');
    b?.click(); return !!b;
  }, name);
  assert.ok(ok, `Edit button for ${name}`);
  await p.waitForSelector('.modal #fname');
}
async function saveEditor(p) {
  await click(p, '.modal button', 'Save changes');
  await p.waitForFunction(() => !document.querySelector('.modal #fname'), { timeout: 15000 });
  await sleep(400);
}

before(async () => {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  [admin, owner, stranger] = await Promise.all([makeUser('flow-admin', { admin: true }), makeUser('flow-owner'), makeUser('flow-stranger')]);
});
after(async () => {
  for (const p of pages) await p.close().catch(() => {});
  await browser?.close();
  await Promise.all([admin, owner, stranger].map((u) => dropUser(u)));
  const { data } = await service.from('files').select('id').like('storage_path', 'flows/%');
  for (const f of data ?? []) await dropBook(f.id);
});

describe('books: an admin edit lands everywhere', () => {
  test('editing name, subject, price, description and length shows up in the library, search, subject filter, file page and checkout', async () => {
    const oldName = `Flow Atlas ${tag}`, newName = `Flow Renamed ${tag}`, subject = `Flowology ${tag}`;
    const id = await makeBook(oldName);
    try {
      const a = await open(admin);
      await openEditor(a, oldName);
      await setInput(a, '#fname', newName);
      await setInput(a, '#fdesc', 'Edited description for the flow test.');
      await setInput(a, '#fprice', '275');
      await setInput(a, '#fmeta', '12 pages');
      // a brand-new subject, typed into the picker
      await a.click('#flabel');
      await a.type('#flabel', subject);
      await a.keyboard.press('Enter');
      await shot(a, 'edit-book');
      await saveEditor(a);

      const f = await row(id);
      assert.deepEqual({ name: f.name, label: f.label, price: Number(f.price), description: f.description, meta: f.meta, is_free: f.is_free },
        { name: newName, label: subject, price: 275, description: 'Edited description for the flow test.', meta: '12 pages', is_free: false }, 'database row');
      await waitText(a, newName); // admin list
      await noText(a, oldName);

      const b = await open(stranger);
      await searchLibrary(b, newName);
      const found = await cardNames(b);
      assert.equal(found.length, 1, 'search finds it once');
      assert.ok(found[0].includes('275'), 'card shows the new price');
      await searchLibrary(b, oldName);
      assert.equal((await cardNames(b)).length, 0, 'old name no longer found');

      // the new subject appears in the subject filter and lists only this book
      await go(b, '/library');
      await b.click('#subject');
      await b.type('#subject', subject);
      await b.keyboard.press('Enter');
      await sleep(500);
      const bySubject = await cardNames(b);
      assert.equal(bySubject.length, 1, 'one book in the new subject');
      assert.ok(bySubject[0].includes(newName));

      await go(b, `/file/${id}`);
      for (const s of [newName, subject, 'Edited description for the flow test.', '12 pages', '275']) await waitText(b, s);
      await go(b, `/checkout/${id}`);
      await waitText(b, '275');
      await noText(b, '199');
      await shot(b, 'edited-book-checkout');
    } finally { await dropBook(id); }
  });

  test('a price change does not change a payment already sent; the receipt keeps the price the buyer saw', async () => {
    const name = `Flow Price ${tag}`;
    const id = await makeBook(name);
    const u = await makeUser('flow-price');
    try {
      const { data: pay } = await u.client.from('purchases').insert({ user_id: u.id, file_id: id, amount: 1, method: 'GCash', proof_path: `${u.id}/p.png` }).select().single();
      assert.equal(Number(pay.amount), 199, 'payment takes the current price');
      const a = await open(admin);
      await openEditor(a, name);
      await setInput(a, '#fprice', '350');
      await saveEditor(a);
      assert.equal(Number((await row(id)).price), 350);
      assert.equal(Number((await service.from('purchases').select('amount').eq('id', pay.id).single()).data.amount), 199, 'sent payment unchanged');
      await go(a, `/admin/payments?id=${pay.id}`);
      await waitText(a, '199');
      await waitText(a, 'price is now');
      await click(a, 'button', 'Confirm received');
      await payStatus(pay.id, 'confirmed');
      const { data: done } = await service.from('purchases').select('status, amount, receipt_no').eq('id', pay.id).single();
      assert.equal(done.status, 'confirmed');
      assert.ok(done.receipt_no, 'receipt number');
      const b = await open(u);
      await go(b, `/receipt/${pay.id}`);
      await waitText(b, done.receipt_no);
      await waitText(b, '199');
      await go(b, '/my-files');
      await waitText(b, name);
    } finally { await dropUser(u); await dropBook(id); }
  });

  test('Free to read on: no price, on the free shelf and filter, opens without paying; off again: locked and gone from free', async () => {
    const name = `Flow Free ${tag}`;
    const id = await makeBook(name);
    try {
      const a = await open(admin);
      await openEditor(a, name);
      await a.evaluate(() => [...document.querySelectorAll('.modal [role=switch], .modal button')].find((e) => /Free to read/.test(e.getAttribute('aria-label') ?? ''))?.click());
      await sleep(200);
      assert.equal(await a.$eval('#fprice', (e) => e.disabled), true, 'price box turns off');
      await saveEditor(a);
      let f = await row(id);
      assert.equal(f.is_free, true); assert.equal(Number(f.price), 0);

      const b = await open(stranger);
      await go(b, '/library');
      await click(b, '.chip', 'Free');
      await sleep(400);
      assert.ok((await cardNames(b)).some((c) => c.includes(name)), 'in the Free filter');
      await go(b, `/file/${id}`);
      await waitText(b, 'Free to read');
      await click(b, 'button, a', 'Read for free');
      await b.waitForSelector('.reader canvas.content', { timeout: 20000 });
      await shot(b, 'free-book-reading');

      // back to paid
      await openEditor(a, name);
      await a.evaluate(() => [...document.querySelectorAll('.modal [role=switch], .modal button')].find((e) => /Free to read/.test(e.getAttribute('aria-label') ?? ''))?.click());
      await setInput(a, '#fprice', '150');
      await saveEditor(a);
      f = await row(id);
      assert.equal(f.is_free, false); assert.equal(Number(f.price), 150);
      await go(b, '/library');
      await click(b, '.chip', 'Free');
      await sleep(400);
      assert.ok(!(await cardNames(b)).some((c) => c.includes(name)), 'gone from the Free filter');
      await go(b, `/file/${id}`);
      await noText(b, 'Read for free');
      await waitText(b, '150');
      await go(b, `/read/${id}`);
      await sleep(2500);
      assert.equal(await b.$('.reader canvas.content'), null, 'reader no longer opens without paying');
    } finally { await dropBook(id); }
  });

  test('Hidden (draft): gone from the library, search and its link for others; buyers who paid keep it; publishing brings it back', async () => {
    const name = `Flow Hidden ${tag}`;
    const id = await makeBook(name);
    try {
      await own(owner, id);
      const a = await open(admin);
      await openEditor(a, name);
      await click(a, '.modal [role=radio]', 'Hidden');
      await saveEditor(a);
      assert.equal((await row(id)).published, false);
      await waitText(a, 'Hidden'); // admin still sees it, marked

      const s = await open(stranger);
      await searchLibrary(s, name);
      assert.equal((await cardNames(s)).length, 0, 'not in search');
      await go(s, `/file/${id}`);
      await waitText(s, "This file isn't available");
      await go(s, `/checkout/${id}`);
      await waitText(s, "This file isn't available");

      const o = await open(owner);
      await searchLibrary(o, name);
      assert.equal((await cardNames(o)).length, 0, 'not in the library for the owner either');
      await go(o, '/my-files');
      await waitText(o, name);
      await go(o, `/read/${id}`);
      await o.waitForSelector('.reader canvas.content', { timeout: 20000 });

      await openEditor(a, name);
      await click(a, '.modal [role=radio]', 'Published');
      await saveEditor(a);
      await searchLibrary(s, name);
      assert.equal((await cardNames(s)).length, 1, 'back in search');
    } finally { await dropBook(id); }
  });

  test('replacing the cover and the file: new ones show, old ones are removed from storage, owners still read it', async () => {
    const name = `Flow Swap ${tag}`;
    const id = await makeBook(name);
    try {
      await own(owner, id);
      const before = await row(id);
      const a = await open(admin);
      await openEditor(a, name);
      const [coverIn] = await a.$$('.modal input[type=file][accept^="image"]');
      await coverIn.uploadFile(SAMPLE('covers/antibiotics.png'));
      const fileIn = await a.$('.modal input[type=file]:not([accept^="image"])');
      await fileIn.uploadFile(SAMPLE('files/anatomy-atlas-upper-limb.pdf'));
      await sleep(1500);
      await saveEditor(a);
      const f = await row(id);
      assert.notEqual(f.cover_path, before.cover_path, 'new cover');
      assert.notEqual(f.storage_path, before.storage_path, 'new file');
      assert.equal(await objectExists('covers', before.cover_path), false, 'old cover removed');
      assert.equal(await objectExists('files', before.storage_path), false, 'old file removed');
      assert.equal(await objectExists('files', f.storage_path), true, 'new file stored');

      const o = await open(owner);
      await searchLibrary(o, name);
      const src = await o.$eval('.bookcard img', (e) => e.src);
      assert.ok(src.includes(encodeURIComponent(f.cover_path).replace(/%2F/g, '/')) || src.includes(f.cover_path), 'card shows the new cover');
      await go(o, `/read/${id}`);
      await o.waitForSelector('.reader canvas.content', { timeout: 20000 });
    } finally { await dropBook(id); }
  });

  test('deleting a book: gone from the library, My files and the admin list; its files are removed; statistics do not count it as a refund', async () => {
    const name = `Flow Delete ${tag}`;
    const id = await makeBook(name);
    try {
      await own(owner, id);
      const before = await row(id);
      const win = { p_from: new Date(Date.now() - 600000).toISOString(), p_to: new Date(Date.now() + 600000).toISOString() };
      const s0 = (await admin.client.rpc('admin_range_stats', win)).data;
      const a = await open(admin);
      await go(a, '/admin/files');
      await a.waitForFunction((n) => document.body.innerText.includes(n), {}, name);
      await a.evaluate((n) => [...[...document.querySelectorAll('.tr')].find((e) => e.innerText.includes(n)).querySelectorAll('button')].find((x) => x.innerText.trim() === 'Delete').click(), name);
      await a.waitForSelector('.modal');
      await click(a, '.modal button', 'Delete');
      await a.waitForFunction((n) => !document.body.innerText.includes(n), { timeout: 8000 }, name);
      assert.equal(await row(id), null, 'row gone');
      assert.equal((await service.from('purchases').select('id').eq('file_id', id)).data.length, 0, 'purchases gone');
      assert.equal(await objectExists('files', before.storage_path), false, 'file removed');
      assert.equal(await objectExists('covers', before.cover_path), false, 'cover removed');
      const s1 = (await admin.client.rpc('admin_range_stats', win)).data;
      assert.equal(s1.revoked_count, s0.revoked_count, 'not a refund');
      const o = await open(owner);
      await go(o, '/my-files');
      await noText(o, name);
      await searchLibrary(o, name);
      assert.equal((await cardNames(o)).length, 0);
    } finally { await dropBook(id); }
  });

  test('a new upload through the admin lands in the library with the right type, length and subject', async () => {
    const name = `Flow Upload ${tag}`;
    const a = await open(admin);
    await go(a, '/admin/files');
    await click(a, 'button', 'Upload file');
    await a.waitForSelector('.modal #fname');
    const fileIn = await a.$('.modal input[type=file]:not([accept^="image"])');
    await fileIn.uploadFile(SAMPLE('files/microbiology-slides.pptx'));
    await sleep(1500);
    await setInput(a, '#fname', name);
    await a.click('#flabel'); await a.type('#flabel', 'Microbiology'); await a.keyboard.press('Enter');
    await setInput(a, '#fprice', '99');
    await click(a, '.modal button', 'Upload & publish');
    await a.waitForFunction(() => !document.querySelector('.modal #fname'), { timeout: 20000 });
    const { data: f } = await service.from('files').select('*').eq('name', name).single();
    try {
      assert.equal(f.kind, 'pptx'); assert.equal(f.label, 'Microbiology'); assert.equal(Number(f.price), 99); assert.equal(f.published, true);
      assert.ok(f.meta, 'length filled in');
      const b = await open(stranger);
      await searchLibrary(b, name);
      const c = await cardNames(b);
      assert.equal(c.length, 1);
      assert.ok(c[0].includes('99'));
    } finally {
      await service.storage.from('files').remove([f.storage_path]);
      if (f.cover_path) await service.storage.from('covers').remove([f.cover_path]);
      await service.from('files').delete().eq('id', f.id);
    }
  });
});

describe('payments: one decision updates every screen', () => {
  test('buyer pays → admin dashboard, payments list and buyer bell show it waiting; confirm → My files, receipts, bell, statistics', async () => {
    const name = `Flow Pay ${tag}`;
    const id = await makeBook(name);
    const u = await makeUser('flow-pay');
    try {
      const st0 = (await admin.client.rpc('admin_stats')).data;
      const b = await open(u);
      await go(b, `/checkout/${id}`);
      await b.waitForSelector('input[type=file]');
      await (await b.$('input[type=file]')).uploadFile(SAMPLE('proofs/33333333-0000-0000-0000-000000000001/proof-1.png'));
      await b.waitForSelector('.proof-img');
      await click(b, 'button', 'Submit');
      await b.waitForFunction(() => /waiting|confirm/i.test(document.body.innerText), { timeout: 10000 });
      const { data: pay } = await service.from('purchases').select('*').eq('user_id', u.id).eq('file_id', id).single();
      assert.equal(pay.status, 'pending'); assert.equal(Number(pay.amount), 199); assert.ok(pay.proof_path, 'proof stored');

      const st1 = (await admin.client.rpc('admin_stats')).data;
      assert.equal(st1.pending, st0.pending + 1, 'dashboard waiting count');
      const a = await open(admin);
      await go(a, '/admin/payments');
      await waitText(a, name);
      await go(b, '/library');
      await openBell(b);
            assert.match(await b.$eval('.bell-menu', (e) => e.innerText), /Waiting for confirmation/);
      await go(b, '/payments');
      await waitText(b, name);

      await go(a, `/admin/payments?id=${pay.id}`);
      await click(a, 'button', 'Confirm received');
      await payStatus(pay.id, 'confirmed');
      const { data: done } = await service.from('purchases').select('*').eq('id', pay.id).single();
      assert.equal(done.status, 'confirmed'); assert.ok(done.receipt_no); assert.ok(done.confirmed_at);
      assert.equal((await admin.client.rpc('admin_stats')).data.pending, st0.pending, 'waiting count back down');

      await go(b, '/my-files');
      await waitText(b, name);
      await go(b, '/payments');
      await waitText(b, done.receipt_no);
      await openBell(b);
            assert.match(await b.$eval('.bell-menu', (e) => e.innerText), /Payment confirmed/);
      await go(b, `/file/${id}`);
      await waitText(b, 'Read now');
      await go(a, '/admin/receipts');
      await waitText(a, done.receipt_no);
      const win = { p_from: new Date(Date.now() - 600000).toISOString(), p_to: new Date(Date.now() + 600000).toISOString() };
      const rep = (await admin.client.rpc('admin_range_stats', win)).data;
      assert.ok(rep.by_file.some((x) => x.id === id && Number(x.revenue) === 199), 'statistics list the sale');
    } finally { await dropUser(u); await dropBook(id); }
  });

  test('reject with a reason → buyer sees it on the file, checkout, payments and bell; resubmitting reuses the same payment', async () => {
    const name = `Flow Reject ${tag}`;
    const id = await makeBook(name);
    const u = await makeUser('flow-rej');
    try {
      const { data: pay } = await u.client.from('purchases').insert({ user_id: u.id, file_id: id, amount: 1, method: 'GCash', proof_path: `${u.id}/p.png` }).select().single();
      const a = await open(admin);
      await go(a, `/admin/payments?id=${pay.id}`);
      await click(a, 'button', 'Reject…');
      await a.waitForSelector('.modal');
      await click(a, '.modal button, .modal .chip', 'different amount');
      const note = a.$('.modal textarea');
      if (await note) await setInput(a, '.modal textarea', 'Please send the full amount');
      await click(a, '.modal button', 'Reject & notify buyer');
      await a.waitForFunction(() => !document.querySelector('.modal'), { timeout: 8000 });
      const { data: r } = await service.from('purchases').select('*').eq('id', pay.id).single();
      assert.equal(r.status, 'rejected'); assert.ok(r.reject_reason);

      const b = await open(u);
      for (const path of [`/file/${id}`, `/checkout/${id}`, '/payments']) {
        await go(b, path);
        await waitText(b, r.reject_reason);
      }
      await openBell(b);
            assert.match(await b.$eval('.bell-menu', (e) => e.innerText), /rejected/i);

      await go(b, `/checkout/${id}`);
      await b.waitForSelector('input[type=file]');
      await (await b.$('input[type=file]')).uploadFile(SAMPLE('proofs/33333333-0000-0000-0000-000000000001/proof-1.png'));
      await b.waitForSelector('.proof-img');
      await click(b, 'button', 'Resubmit payment');
      await payStatus(pay.id, 'pending');
      const { data: all } = await service.from('purchases').select('id, status').eq('user_id', u.id).eq('file_id', id);
      assert.equal(all.length, 1, 'still one payment');
      assert.equal(all[0].id, pay.id); assert.equal(all[0].status, 'pending');
    } finally { await dropUser(u); await dropBook(id); }
  });
});

describe('users: admin actions reach the buyer', () => {
  test('grant access → in My files and readable, not counted as revenue; revoke → gone and locked, counted as revoked if paid', async () => {
    const name = `Flow Grant ${tag}`;
    const id = await makeBook(name);
    const u = await makeUser('flow-grant');
    try {
      const win = { p_from: new Date(Date.now() - 600000).toISOString(), p_to: new Date(Date.now() + 600000).toISOString() };
      const r0 = (await admin.client.rpc('admin_range_stats', win)).data;
      const a = await open(admin);
      await go(a, `/admin/users/${u.id}`);
      await click(a, 'button', 'Grant file access');
      await a.waitForSelector('.modal');
      await a.waitForFunction((n) => document.querySelector('.modal')?.innerText.includes(n), { timeout: 8000 }, name);
      await click(a, '.modal button', name);
      await sleep(1000);
      const { data: g } = await service.from('purchases').select('*').eq('user_id', u.id).eq('file_id', id).single();
      assert.equal(g.status, 'confirmed'); assert.equal(g.method, 'Granted by admin');
      const r1 = (await admin.client.rpc('admin_range_stats', win)).data;
      assert.equal(Number(r1.revenue), Number(r0.revenue), 'a grant is not revenue');

      const b = await open(u);
      await go(b, '/my-files');
      await waitText(b, name);
      await go(b, `/read/${id}`);
      await b.waitForSelector('.reader canvas.content', { timeout: 20000 });

      await go(a, `/admin/users/${u.id}`);
      await a.waitForFunction((n) => document.body.innerText.includes(n), {}, name);
      await click(a, 'button', 'Revoke');
      await a.waitForSelector('.modal');
      await click(a, '.modal button', 'Revoke');
      await sleep(1200);
      assert.equal((await service.from('purchases').select('id').eq('user_id', u.id).eq('file_id', id)).data.length, 0);
      await go(b, '/my-files');
      await noText(b, name);
      await go(b, `/file/${id}`);
      await noText(b, 'Read now');

      // a paid one that gets revoked is counted as revoked
      await own(u, id);
      const r2 = (await admin.client.rpc('admin_range_stats', win)).data;
      await go(a, `/admin/users/${u.id}`);
      await a.waitForFunction((n) => document.body.innerText.includes(n), {}, name);
      await click(a, 'button', 'Revoke');
      await a.waitForSelector('.modal');
      await click(a, '.modal button', 'Revoke');
      await sleep(1200);
      const r3 = (await admin.client.rpc('admin_range_stats', win)).data;
      assert.equal(r3.revoked_count, r2.revoked_count + 1, 'revoked');
      assert.equal(Number(r3.revoked_amount) - Number(r2.revoked_amount), 199);
    } finally { await dropUser(u); await dropBook(id); }
  });

  test('suspend → the buyer cannot open files; reactivate → they can again', async () => {
    const name = `Flow Suspend ${tag}`;
    const id = await makeBook(name);
    const u = await makeUser('flow-susp');
    try {
      await own(u, id);
      const b = await open(u);
      await go(b, `/read/${id}`);
      await b.waitForSelector('.reader canvas.content', { timeout: 20000 });

      const a = await open(admin);
      await go(a, `/admin/users/${u.id}`);
      await click(a, 'button', 'Suspend');
      await a.waitForSelector('.modal');
      await click(a, '.modal button', 'Suspend user');
      await sleep(1000);
      assert.equal((await service.from('profiles').select('suspended').eq('id', u.id).single()).data.suspended, true);
      await go(a, '/admin/users');
      await waitText(a, 'Suspended');

      await go(b, `/read/${id}`);
      await sleep(3000);
      assert.equal(await b.$('.reader canvas.content'), null, 'cannot read while suspended');
      await waitText(b, 'suspended');

      await go(a, `/admin/users/${u.id}`);
      await click(a, 'button', 'Reactivate');
      await a.waitForSelector('.modal');
      await click(a, '.modal button', 'Reactivate');
      await sleep(1000);
      await go(b, `/read/${id}`);
      await b.waitForSelector('.reader canvas.content', { timeout: 20000 });
    } finally { await dropUser(u); await dropBook(id); }
  });

  test('a buyer renaming themselves shows the new name on the admin users list and payments', async () => {
    const u = await makeUser('flow-name');
    const id = await makeBook(`Flow Name ${tag}`);
    try {
      await u.client.from('purchases').insert({ user_id: u.id, file_id: id, amount: 1, method: 'GCash', proof_path: `${u.id}/p.png` });
      const b = await open(u);
      await go(b, '/account');
      const nameInput = await b.$('#nm');
      assert.ok(nameInput, 'name field on the profile page');
      const sel = await b.evaluate((e) => '#' + e.id, nameInput);
      await setInput(b, sel, `Renamed Buyer ${tag}`);
      await click(b, 'button', 'Save');
      await sleep(1000);
      assert.equal((await service.from('profiles').select('full_name').eq('id', u.id).single()).data.full_name, `Renamed Buyer ${tag}`);
      const a = await open(admin);
      await go(a, '/admin/users');
      await waitText(a, `Renamed Buyer ${tag}`);
      await go(a, '/admin/payments');
      await waitText(a, `Renamed Buyer ${tag}`);
    } finally { await dropUser(u); await dropBook(id); }
  });
});

describe('store settings reach the buyer', () => {
  test('turning a payment method off in Settings hides it at checkout; on again shows it', async () => {
    const { data: s0 } = await service.from('settings').select('payment_methods').eq('id', 1).single();
    const name = `Flow Method ${tag}`;
    const id = await makeBook(name);
    try {
      const target = s0.payment_methods.find((m) => m.enabled && m.name !== 'GCash') ?? s0.payment_methods.find((m) => m.enabled);
      const a = await open(admin);
      await go(a, '/admin/settings');
      await a.waitForSelector('input[aria-label="Method name"]');
      await a.evaluate((n) => {
        const card = [...document.querySelectorAll('input[aria-label="Method name"]')].find((i) => i.value === n).closest('.card');
        card.querySelector('[role=switch], .toggle, button[aria-pressed]')?.click();
      }, target.name);
      await click(a, 'button', 'Save settings');
      await sleep(1200);
      const { data: s1 } = await service.from('settings').select('payment_methods').eq('id', 1).single();
      assert.equal(s1.payment_methods.find((m) => m.name === target.name).enabled, false, 'saved off');

      const b = await open(stranger);
      await go(b, `/checkout/${id}`);
      await sleep(800);
      const methods = await b.evaluate(() => document.body.innerText);
      assert.ok(!methods.includes(target.name) || !new RegExp(`\\b${target.name}\\b`).test(methods.split('Send payment to')[1] ?? ''), `${target.name} hidden at checkout`);

      await service.from('settings').update({ payment_methods: s0.payment_methods }).eq('id', 1);
      await go(b, `/checkout/${id}`);
      await waitText(b, target.name);
    } finally {
      await service.from('settings').update({ payment_methods: s0.payment_methods }).eq('id', 1);
      await dropBook(id);
    }
  });

  test('store name and support email changes show on open pages and the privacy page', async () => {
    const { data: s0 } = await service.from('settings').select('store_name, support_email').eq('id', 1).single();
    try {
      const b = await open(stranger);
      await go(b, '/library');
      const a = await open(admin);
      await go(a, '/admin/settings');
      await a.waitForSelector('#sn');
      await setInput(a, '#sn', `Flow Store ${tag}`);
      await setInput(a, '#se', `help-${tag}@mednotes.example`);
      await click(a, 'button', 'Save settings');
      await sleep(1200);
      const { data: s1 } = await service.from('settings').select('store_name, support_email').eq('id', 1).single();
      assert.equal(s1.store_name, `Flow Store ${tag}`);
      await b.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 8000 }, `Flow Store ${tag}`).catch(() => {});
      await waitText(b, `Flow Store ${tag}`); // live, without reloading
      const p = await open(null);
      await go(p, '/privacy');
      await waitText(p, `help-${tag}@mednotes.example`);
    } finally { await service.from('settings').update(s0).eq('id', 1); }
  });

  test('device limit: lowering computers to 1 blocks a second computer; the admin reset lets the buyer in again', async () => {
    const { data: s0 } = await service.from('settings').select('computer_slots').eq('id', 1).single();
    const u = await makeUser('flow-dev');
    try {
      await service.from('settings').update({ computer_slots: 1 }).eq('id', 1);
      const first = await open(u);
      await go(first, '/library');
      assert.equal((await service.from('devices').select('id').eq('user_id', u.id)).data.length, 1, 'first computer registered');
      const second = await open({ ...u, device: crypto.randomUUID() });
      await go(second, '/library');
      await waitText(second, 'device');
      assert.equal((await service.from('devices').select('id').eq('user_id', u.id)).data.length, 1, 'second not added');

      const a = await open(admin);
      await go(a, `/admin/users/${u.id}`);
      await click(a, 'button', 'Reset all devices');
      await sleep(1000);
      assert.equal((await service.from('devices').select('id').eq('user_id', u.id)).data.length, 0, 'devices cleared');
      const third = await open({ ...u, device: crypto.randomUUID() });
      await go(third, '/library');
      assert.equal((await service.from('devices').select('id').eq('user_id', u.id)).data.length, 1, 'new computer registered after reset');
    } finally { await service.from('settings').update(s0).eq('id', 1); await dropUser(u); }
  });
});

describe('help desk: both sides stay in step', () => {
  test('buyer ticket → admin list; admin reply and status → buyer thread and bell', async () => {
    const u = await makeUser('flow-help');
    try {
      const { data: t } = await u.client.from('tickets').insert({ user_id: u.id, kind: 'bug', subject: `Flow ticket ${tag}`, body: 'Something broke', rating: 3 }).select().single();
      const a = await open(admin);
      await go(a, '/admin/support');
      await waitText(a, `Flow ticket ${tag}`);
      await go(a, `/admin/support?t=${t.id}`);
      await a.waitForSelector('textarea');
      await setInput(a, 'textarea', 'Fixed it, thanks!');
      await click(a, 'button', 'Send');
      await sleep(1200);
      const { data: msgs } = await service.from('ticket_messages').select('body').eq('ticket_id', t.id);
      assert.ok(msgs.some((m) => m.body === 'Fixed it, thanks!'), 'reply stored');
      const b = await open(u);
      await go(b, '/library');
      await openBell(b);
            assert.ok((await b.$eval('.bell-menu', (e) => e.innerText)).includes(`Flow ticket ${tag}`), 'bell shows the reply');
      await go(b, `/help?t=${t.id}`);
      await waitText(b, 'Fixed it, thanks!');
    } finally { await dropUser(u); }
  });
});
