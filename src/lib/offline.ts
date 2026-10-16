// Offline saving for the Android app. Files are AES-GCM encrypted with a key that never
// leaves this install, written to the app's private data folder, and lock after
// `offline_days` without an online license check.
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import type { LibFile } from './types';

const INDEX = 'mn.offline_index';
const KEYPREF = 'mn.offline_key';
const VERIFIED = 'mn.offline_verified_at';

export interface SavedFile {
  id: string; name: string; kind: LibFile['kind']; mime: string; cover_path: string | null; label: string; size: number; saved_at: string;
}

const toB64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function key(): Promise<CryptoKey> {
  let raw = (await Preferences.get({ key: KEYPREF })).value;
  if (!raw) {
    raw = toB64(crypto.getRandomValues(new Uint8Array(32)).buffer);
    await Preferences.set({ key: KEYPREF, value: raw });
  }
  return crypto.subtle.importKey('raw', fromB64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function listSaved(): Promise<SavedFile[]> {
  return JSON.parse((await Preferences.get({ key: INDEX })).value || '[]');
}
async function writeIndex(list: SavedFile[]) {
  await Preferences.set({ key: INDEX, value: JSON.stringify(list) });
}

export async function isSaved(id: string) {
  return (await listSaved()).some((f) => f.id === id);
}

export async function saveOffline(file: LibFile, blob: Blob) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), await blob.arrayBuffer());
  const packed = new Uint8Array(iv.length + enc.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(enc), iv.length);
  await Filesystem.writeFile({ path: `offline/${file.id}.bin`, data: toB64(packed.buffer), directory: Directory.Data, recursive: true });
  const list = (await listSaved()).filter((f) => f.id !== file.id);
  list.unshift({ id: file.id, name: file.name, kind: file.kind, mime: file.mime, cover_path: file.cover_path, label: file.label, size: blob.size, saved_at: new Date().toISOString() });
  await writeIndex(list);
  await markVerified();
}

export async function readOffline(id: string): Promise<Blob> {
  const meta = (await listSaved()).find((f) => f.id === id);
  if (!meta) throw new Error('This file is not saved on this phone.');
  const { data } = await Filesystem.readFile({ path: `offline/${id}.bin`, directory: Directory.Data });
  const packed = fromB64(typeof data === 'string' ? data : await (data as Blob).text());
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.subarray(0, 12) }, await key(), packed.subarray(12));
  return new Blob([plain], { type: meta.mime });
}

export async function removeOffline(id: string) {
  await Filesystem.deleteFile({ path: `offline/${id}.bin`, directory: Directory.Data }).catch(() => undefined);
  await writeIndex((await listSaved()).filter((f) => f.id !== id));
}

/** Drop saved copies the user no longer owns (e.g. access revoked by the publisher). */
export async function pruneSaved(ownedIds: Set<string>) {
  for (const f of await listSaved()) if (!ownedIds.has(f.id)) await removeOffline(f.id);
}

export async function markVerified() {
  await Preferences.set({ key: VERIFIED, value: new Date().toISOString() });
}
export async function lastVerified(): Promise<Date | null> {
  const v = (await Preferences.get({ key: VERIFIED })).value;
  return v ? new Date(v) : null;
}
/** Saved copies lock if the phone hasn't checked in online for `days`. */
export async function offlineExpired(days: number) {
  const v = await lastVerified();
  return !v || Date.now() - v.getTime() > days * 86400000;
}
