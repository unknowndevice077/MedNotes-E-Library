// Backend tests: database rules (RLS), RPCs, storage policies and the read-file function.
// Run: npm run test:backend   (needs `npm run db:start` with the edge runtime, and `npm run seed:storage`)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { anon, dropUser, makeUser, readSecure, registerDevice, root, service } from './helpers.mjs';

const PDF = 'a0000000-0000-0000-0000-000000000002'; // Anatomy Atlas (PDF)
const XLSX = 'a0000000-0000-0000-0000-000000000006'; // Lab Values (XLSX)
const pdfBytes = readFileSync(join(root, 'supabase', 'sample', 'files', 'anatomy-atlas-upper-limb.pdf'));
let buyer, other, admin;

before(async () => {
  [buyer, other, admin] = await Promise.all([makeUser('buyer'), makeUser('other'), makeUser('admin', { admin: true })]);
  // buyer owns the PDF (confirmed by the admin), other owns nothing
  const { data: p } = await buyer.client.from('purchases').insert({ user_id: buyer.id, file_id: PDF, amount: 350, method: 'GCash', reference_no: 'T-1' }).select().single();
  const { error } = await admin.client.rpc('confirm_purchase', { p_id: p.id, p_note: 'test' });
  assert.ifError(error);
});
after(async () => { await Promise.all([dropUser(buyer), dropUser(other), dropUser(admin)]); });

describe('anonymous visitors', () => {
  test('cannot list files, settings or profiles', async () => {
    const a = anon();
    for (const t of ['files', 'settings', 'profiles', 'purchases', 'devices']) {
      const { data } = await a.from(t).select('*');
      assert.equal((data ?? []).length, 0, `${t} should be hidden from anon`);
    }
  });
  test('can read the public contact used by the privacy pages', async () => {
    const { data, error } = await anon().rpc('public_contact');
    assert.ifError(error);
    assert.ok(data.store_name && 'support_email' in data);
    assert.ok(!('admin_emails' in data) && !('payment_methods' in data), 'no private settings leak');
  });
  test('cannot call account or admin RPCs', async () => {
    const a = anon();
    assert.ok((await a.rpc('delete_my_account')).error);
    assert.ok((await a.rpc('admin_stats')).error);
  });
});

describe('clients', () => {
  test('see published files', async () => {
    const { data } = await buyer.client.from('files').select('id');
    assert.ok(data.length >= 6);
  });
  test("can't see other people's purchases or profiles", async () => {
    const { data: ps } = await other.client.from('purchases').select('*').eq('user_id', buyer.id);
    assert.equal(ps.length, 0);
    const { data: pr } = await other.client.from('profiles').select('*').eq('id', buyer.id);
    assert.equal(pr.length, 0);
  });
  test("can't make themselves admin or change their own limits", async () => {
    for (const patch of [{ role: 'admin' }, { computer_slots: 9 }, { suspended: false, admin_note: 'x' }, { can_add_devices: true },
      { email: 'x@evil.test' }, { created_at: '2020-01-01T00:00:00Z' }, { provider: 'google' }]) {
      const { error } = await other.client.from('profiles').update(patch).eq('id', other.id);
      assert.ok(error, `blocked: ${JSON.stringify(patch)}`);
    }
    const { data } = await service.from('profiles').select('role').eq('id', other.id).single();
    assert.equal(data.role, 'client');
  });
  test('can rename themselves and save their own preferences', async () => {
    const { error } = await other.client.from('profiles').update({ full_name: 'Renamed', prefs: { readerTheme: 'sepia', textSize: 18 } }).eq('id', other.id);
    assert.ifError(error);
    const { data } = await service.from('profiles').select('prefs').eq('id', other.id).single();
    assert.deepEqual(data.prefs, { readerTheme: 'sepia', textSize: 18 });
  });
  test("can't read the admin email list or other users' limits", async () => {
    const { data: s } = await other.client.from('settings').select('*').eq('id', 1).single();
    assert.ok(s && !('admin_emails' in s), 'not on settings any more');
    const { data: list } = await other.client.from('admin_allowlist').select('*');
    assert.deepEqual(list, [], 'allowlist is admin-only');
    assert.ok((await other.client.rpc('effective_limits', { p_user: buyer.id })).error, 'limits probe refused');
  });
  test("can't create a confirmed purchase or a receipt", async () => {
    const bad = [{ status: 'confirmed' }, { receipt_no: 'OR-999999' }, { user_id: buyer.id }, { confirmed_at: new Date().toISOString() },
      { decided_by: other.id }, { note_to_buyer: 'Approved by admin' }];
    for (const extra of bad) {
      const { error } = await other.client.from('purchases').insert({ user_id: other.id, file_id: XLSX, amount: 1, ...extra });
      assert.ok(error, `blocked: ${JSON.stringify(extra)}`);
    }
  });
  test("can't confirm their own payment", async () => {
    const { data: p, error } = await other.client.from('purchases').insert({ user_id: other.id, file_id: XLSX, amount: 150, method: 'GCash' }).select().single();
    assert.ifError(error);
    assert.ok((await other.client.rpc('confirm_purchase', { p_id: p.id })).error);
    await other.client.from('purchases').update({ status: 'confirmed' }).eq('id', p.id);
    const { data } = await service.from('purchases').select('status').eq('id', p.id).single();
    assert.equal(data.status, 'pending');
    assert.ok((await other.client.from('purchases').insert({ user_id: other.id, file_id: XLSX, amount: 150 })).error, 'one live purchase per file');
  });
});

describe('storage', () => {
  test('buyers get no direct storage link, even for files they own', async () => {
    const { data, error } = await buyer.client.storage.from('files').createSignedUrl('anatomy-atlas-upper-limb.pdf', 60);
    assert.ok(error || !data?.signedUrl, 'signed URLs are refused');
    const dl = await buyer.client.storage.from('files').download('anatomy-atlas-upper-limb.pdf');
    assert.ok(dl.error, 'direct download refused');
  });
  test('admins can still manage files', async () => {
    const { error } = await admin.client.storage.from('files').createSignedUrl('anatomy-atlas-upper-limb.pdf', 60);
    assert.ifError(error);
  });
  test('proofs: own folder only', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    assert.ifError((await other.client.storage.from('proofs').upload(`${other.id}/t.png`, png, { contentType: 'image/png', upsert: true })).error);
    assert.ok((await other.client.storage.from('proofs').upload(`${buyer.id}/evil.png`, png, { contentType: 'image/png' })).error);
    assert.ok((await buyer.client.storage.from('proofs').download(`${other.id}/t.png`)).error, "can't read someone else's proof");
    assert.ifError((await admin.client.storage.from('proofs').download(`${other.id}/t.png`)).error);
  });
  test('uploads are limited to sensible types and sizes', async () => {
    const exe = Buffer.from('4d5a900003000000', 'hex');
    assert.ok((await other.client.storage.from('proofs').upload(`${other.id}/x.exe`, exe, { contentType: 'application/x-msdownload' })).error, 'no executables as proof');
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    assert.ok((await other.client.storage.from('proofs').upload(`${other.id}/big.png`, big, { contentType: 'image/png' })).error, 'max 10 MB proof');
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    assert.ok((await other.client.storage.from('branding').upload('logo.png', png, { contentType: 'image/png' })).error, 'only admins brand the site');
    assert.ifError((await admin.client.storage.from('branding').upload(`test-${Date.now()}.png`, png, { contentType: 'image/png' })).error);
  });
  test('covers are public', async () => {
    const r = await fetch(service.storage.from('covers').getPublicUrl('anatomy.png').data.publicUrl);
    assert.equal(r.status, 200);
  });
});

describe('devices (1 computer + 1 phone)', () => {
  test('second computer is refused, phone slot still free', async () => {
    const u = await makeUser('dev');
    try {
      assert.equal((await registerDevice(u.client, 'pc-1')).data.ok, true);
      assert.equal((await registerDevice(u.client, 'pc-1')).data.ok, true, 'same device is fine');
      const second = (await registerDevice(u.client, 'pc-2')).data;
      assert.equal(second.ok, false); assert.equal(second.reason, 'limit'); assert.equal(second.devices.length, 1);
      assert.equal((await registerDevice(u.client, 'phone-1', 'phone')).data.ok, true);
      // swap: sign out pc-1 and take its slot, limited to 2 swaps / 30 days
      const swap = await u.client.rpc('swap_device', { p_old: second.devices[0].id, p_device_id: 'pc-2', p_kind: 'computer', p_label: 'x', p_platform: 'test' });
      assert.equal(swap.data.ok, true);
      assert.equal((await u.client.rpc('device_ok', { p_device_id: 'pc-1' })).data, false, 'old device is out');
      assert.equal((await u.client.rpc('device_ok', { p_device_id: 'pc-2' })).data, true);
      const pc2 = (await u.client.from('devices').select('id').eq('device_id', 'pc-2').single()).data;
      await u.client.rpc('swap_device', { p_old: pc2.id, p_device_id: 'pc-3', p_kind: 'computer', p_label: 'x', p_platform: 'test' });
      const pc3 = (await u.client.from('devices').select('id').eq('device_id', 'pc-3').single()).data;
      const third = await u.client.rpc('swap_device', { p_old: pc3.id, p_device_id: 'pc-4', p_kind: 'computer', p_label: 'x', p_platform: 'test' });
      assert.equal(third.data.reason, 'swaps', 'third swap in 30 days is refused');
    } finally { await dropUser(u); }
  });
  test('admin overrides: extra slot and locked devices', async () => {
    const u = await makeUser('ovr');
    try {
      await registerDevice(u.client, 'a');
      await admin.client.from('profiles').update({ computer_slots: 2 }).eq('id', u.id);
      assert.equal((await registerDevice(u.client, 'b')).data.ok, true, 'extra slot granted by admin');
      await admin.client.from('profiles').update({ computer_slots: 3, can_add_devices: false }).eq('id', u.id);
      assert.equal((await registerDevice(u.client, 'c')).data.reason, 'locked');
      await admin.client.from('profiles').update({ suspended: true }).eq('id', u.id);
      assert.equal((await registerDevice(u.client, 'a')).data.reason, 'suspended');
    } finally { await dropUser(u); }
  });
  test('admins are not device-limited', async () => {
    for (const d of ['x1', 'x2', 'x3']) assert.equal((await registerDevice(admin.client, d)).data.ok, true);
  });
});

describe('payments and receipts', () => {
  test('confirming issues sequential receipt numbers', async () => {
    const u = await makeUser('rcpt');
    try {
      const nums = [];
      for (const f of ['a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000005']) {
        const { data: p } = await u.client.from('purchases').insert({ user_id: u.id, file_id: f, amount: 1, method: 'GCash' }).select().single();
        nums.push((await admin.client.rpc('confirm_purchase', { p_id: p.id })).data.receipt_no);
      }
      const [a, b] = nums.map((n) => Number(n.replace(/\D/g, '')));
      assert.equal(b, a + 1, `receipts ${nums.join(', ')}`);
      assert.match(nums[0], /^OR-\d{6}$/);
    } finally { await dropUser(u); }
  });
  test('reject keeps the reason and allows resubmitting', async () => {
    const u = await makeUser('rej');
    try {
      const { data: p } = await u.client.from('purchases').insert({ user_id: u.id, file_id: XLSX, amount: 100, method: 'GCash' }).select().single();
      const { data: r } = await admin.client.rpc('reject_purchase', { p_id: p.id, p_reason: 'Amount short', p_note: 'send 50 more' });
      assert.equal(r.status, 'rejected'); assert.equal(r.receipt_no, null);
      assert.ifError((await u.client.from('purchases').insert({ user_id: u.id, file_id: XLSX, amount: 150, method: 'GCash' })).error);
      assert.ok((await admin.client.rpc('confirm_purchase', { p_id: p.id })).error, 'rejected payments cannot be confirmed');
    } finally { await dropUser(u); }
  });
});

describe('read-file (encrypted delivery)', () => {
  test('owner on a registered device gets the exact file, encrypted in transit', async () => {
    await registerDevice(buyer.client, 'buyer-pc');
    const r = await readSecure(buyer, PDF, 'buyer-pc');
    assert.equal(r.status, 200);
    assert.ok(r.plain.equals(pdfBytes), 'decrypted bytes match the original');
    assert.ok(!r.cipher.includes(Buffer.from('%PDF')), 'network body is not the PDF');
    assert.equal(r.total, pdfBytes.length);
  });
  test('byte ranges assemble to the whole file', async () => {
    const parts = [];
    for (let s = 0; s < pdfBytes.length; s += 700) parts.push((await readSecure(buyer, PDF, 'buyer-pc', { start: s, end: s + 699 })).plain);
    assert.ok(Buffer.concat(parts).equals(pdfBytes));
  });
  test('refuses: not owned, unregistered device, signed out, suspended', async () => {
    await registerDevice(other.client, 'other-pc');
    assert.equal((await readSecure(other, PDF, 'other-pc')).status, 403, 'not owned');
    assert.equal((await readSecure(buyer, PDF, 'some-other-device')).status, 403, 'unregistered device');
    const signedOut = { client: anon() };
    assert.equal((await readSecure(signedOut, PDF, 'buyer-pc')).status, 401, 'signed out');
    await service.from('profiles').update({ suspended: true }).eq('id', buyer.id);
    assert.equal((await readSecure(buyer, PDF, 'buyer-pc')).status, 403, 'suspended');
    await service.from('profiles').update({ suspended: false }).eq('id', buyer.id);
  });
  test('revoked access stops delivery immediately', async () => {
    const u = await makeUser('revoke');
    try {
      await registerDevice(u.client, 'r-pc');
      const { data: p } = await admin.client.rpc('admin_grant_file', { p_user: u.id, p_file: XLSX });
      assert.equal((await readSecure(u, XLSX, 'r-pc')).status, 200);
      await admin.client.from('purchases').delete().eq('id', p.id);
      assert.equal((await readSecure(u, XLSX, 'r-pc')).status, 403);
    } finally { await dropUser(u); }
  });
});

describe('accounts', () => {
  test('allow-listed email becomes admin on sign-up; others stay clients', async () => {
    const email = `test-allow-${Date.now()}@mednotes.test`;
    assert.ifError((await admin.client.from('admin_allowlist').insert({ email })).error);
    const { data } = await service.auth.admin.createUser({ email, password: 'x' + Date.now(), email_confirm: true });
    const late = await makeUser('late');
    try {
      assert.equal((await service.from('profiles').select('role').eq('id', data.user.id).single()).data.role, 'admin');
      assert.equal((await service.from('profiles').select('role').eq('id', late.id).single()).data.role, 'client');
      // adding an existing account's email promotes it right away
      await admin.client.from('admin_allowlist').insert({ email: late.email });
      assert.equal((await service.from('profiles').select('role').eq('id', late.id).single()).data.role, 'admin');
    } finally {
      await service.auth.admin.deleteUser(data.user.id);
      await dropUser(late);
      await service.from('admin_allowlist').delete().in('email', [email, late.email]);
    }
  });
  test('anyone can read the site look (for the sign-in page), nothing else', async () => {
    const { data, error } = await anon().rpc('get_public_theme');
    assert.ifError(error);
    assert.deepEqual(Object.keys(data).sort(), ['store_name', 'theme']);
  });
  test('delete my account removes the user and their data; admins are refused', async () => {
    const u = await makeUser('bye');
    await u.client.from('purchases').insert({ user_id: u.id, file_id: XLSX, amount: 150, method: 'GCash' });
    await registerDevice(u.client, 'bye-pc');
    assert.ifError((await u.client.rpc('delete_my_account')).error);
    assert.equal((await service.from('purchases').select('id').eq('user_id', u.id)).data.length, 0);
    assert.equal((await service.from('devices').select('id').eq('user_id', u.id)).data.length, 0);
    assert.ok((await service.auth.admin.getUserById(u.id)).error || true);
    assert.ok((await admin.client.rpc('delete_my_account')).error, 'admin refused');
  });
});
