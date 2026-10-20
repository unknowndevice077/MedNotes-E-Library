// Shared helpers for tests against the LOCAL Supabase (npm run db:start).
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

export const root = join(import.meta.dirname, '..');

export function localEnv() {
  const out = execSync(join(root, 'node_modules', '.bin', 'supabase') + ' status -o env', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const env = Object.fromEntries(out.split(/\r?\n/).map((l) => l.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  if (!/127\.0\.0\.1|localhost/.test(env.API_URL ?? '')) throw new Error('Tests only run against the local Supabase (npm run db:start)');
  return env;
}

const env = localEnv();
export const API = env.API_URL;
export const ANON = env.ANON_KEY;
export const service = createClient(API, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
export const anon = () => createClient(API, ANON, { auth: { persistSession: false } });

/** Creates a confirmed throwaway user and returns a signed-in client for it. */
export async function makeUser(tag, { admin = false } = {}) {
  const email = `test-${tag}-${randomBytes(4).toString('hex')}@mednotes.test`;
  const password = randomBytes(12).toString('base64url');
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Test ${tag}` } });
  if (error) throw error;
  if (admin) await service.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
  const client = createClient(API, ANON, { auth: { persistSession: false } });
  const { error: se } = await client.auth.signInWithPassword({ email, password });
  if (se) throw se;
  return { id: data.user.id, email, password, client };
}

export async function dropUser(u) {
  if (u) await service.auth.admin.deleteUser(u.id);
}

export const registerDevice = (c, id, kind = 'computer') =>
  c.rpc('register_device', { p_device_id: id, p_kind: kind, p_label: `Test ${kind}`, p_platform: 'test' });

/** Calls read-file the way the app does and decrypts the result with a fresh session key. */
export async function readSecure(user, fileId, deviceId, { start, end, raw = false } = {}) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, false, ['encrypt', 'decrypt']);
  const pub = Buffer.from(await crypto.subtle.exportKey('spki', publicKey)).toString('base64');
  const { data: s } = await user.client.auth.getSession();
  const res = await fetch(`${API}/functions/v1/read-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, ...(s.session ? { Authorization: `Bearer ${s.session.access_token}` } : {}) },
    body: JSON.stringify({ file_id: fileId, device_id: deviceId, public_key: pub, start, end }),
  });
  if (!res.ok) return { status: res.status, error: (await res.json().catch(() => ({}))).error };
  const buf = await res.arrayBuffer();
  if (raw) return { status: res.status, buf, headers: res.headers };
  const wl = new DataView(buf).getUint32(0);
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, buf.slice(4, 4 + wl)), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(buf.slice(4 + wl, 16 + wl)) }, key, buf.slice(16 + wl));
  return { status: res.status, plain: Buffer.from(plain), cipher: Buffer.from(buf), total: Number(res.headers.get('X-Total-Size')) };
}
