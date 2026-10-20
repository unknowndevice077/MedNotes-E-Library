// Uploads sample covers and files into the LOCAL Supabase storage buckets.
// Reads the local API URL and service-role key from `supabase status`, so it never needs secrets in the repo.
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const root = join(import.meta.dirname, '..');
const env = Object.fromEntries(
  execSync(join(root, 'node_modules', '.bin', 'supabase') + ' status -o env', { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/).map((l) => l.match(/^(\w+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]),
);
if (!env.API_URL || !env.SERVICE_ROLE_KEY) throw new Error('Local Supabase is not running (npm run db:start)');
if (!/127\.0\.0\.1|localhost/.test(env.API_URL)) throw new Error('Refusing to seed a non-local Supabase: ' + env.API_URL);

const sb = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.epub': 'application/epub+zip', '.pdf': 'application/pdf', '.mp4': 'video/mp4',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

for (const [bucket, dir] of [['covers', 'covers'], ['files', 'files'], ['payment-qr', 'payment-qr'], ['proofs', 'proofs']]) {
  const folder = join(root, 'supabase', 'sample', dir);
  // proofs live in <user id>/ folders; the rest are flat
  const names = readdirSync(folder, { recursive: true, withFileTypes: true }).filter((d) => d.isFile())
    .map((d) => relative(folder, join(d.parentPath ?? d.path, d.name)).split(sep).join('/'));
  for (const name of names) {
    const body = readFileSync(join(folder, name));
    const { error } = await sb.storage.from(bucket).upload(name, body, { upsert: true, contentType: types[extname(name)] });
    console.log(error ? `✗ ${bucket}/${name}: ${error.message}` : `✓ ${bucket}/${name}`);
    if (!error && bucket === 'files') await sb.from('files').update({ size_bytes: body.length }).eq('storage_path', name);
  }
}
