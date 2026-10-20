// Fetches a paid file through the read-file function. The file arrives AES-GCM encrypted in
// chunks; each chunk's key is wrapped with this session's RSA public key. The matching private
// key is generated non-extractable and never leaves memory, so what DevTools' Network tab
// shows (or anyone replaying the request) is unreadable.
import { supabase } from './supabase';
import { deviceId } from './device';

const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const CHUNK = 4 * 1024 * 1024;

let pair: Promise<CryptoKeyPair> | null = null;
const sessionKeys = () =>
  (pair ??= crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    false, // private key can't be exported, even from the console
    ['encrypt', 'decrypt'],
  ));

const toB64 = (buf: ArrayBuffer) => {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

async function decryptChunk(buf: ArrayBuffer, priv: CryptoKey) {
  const view = new DataView(buf);
  const wl = view.getUint32(0);
  const wrapped = buf.slice(4, 4 + wl);
  const iv = new Uint8Array(buf.slice(4 + wl, 16 + wl));
  const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, priv, wrapped);
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, buf.slice(16 + wl));
}

export class FileAccessError extends Error {}

/** Returns the decrypted file as an in-memory Blob (never a URL to the stored file). */
export async function fetchSecureFile(fileId: string, mime: string, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const [{ publicKey, privateKey }, dev, { data: s }] = await Promise.all([sessionKeys(), deviceId(), supabase.auth.getSession()]);
  if (!s.session) throw new FileAccessError('Sign in to open this file.');
  const pub = toB64(await crypto.subtle.exportKey('spki', publicKey));
  const parts: ArrayBuffer[] = [];
  let start = 0;
  let total = Infinity;
  while (start < total) {
    const res = await fetch(`${URL_}/functions/v1/read-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${s.session.access_token}` },
      body: JSON.stringify({ file_id: fileId, device_id: dev, public_key: pub, start, end: start + CHUNK - 1 }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const msg = (await res.json().catch(() => null))?.error;
      throw new FileAccessError(msg || `Could not open the file (${res.status})`);
    }
    total = Number(res.headers.get('X-Total-Size'));
    const end = Number(res.headers.get('X-Chunk-End'));
    parts.push(await decryptChunk(await res.arrayBuffer(), privateKey));
    onProgress?.(Math.min(end + 1, total), total);
    if (!Number.isFinite(end) || end < start) break;
    start = end + 1;
  }
  return new Blob(parts, { type: mime });
}
