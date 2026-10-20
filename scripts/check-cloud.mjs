// Read-only health check of the cloud catalog: rows, public covers, private files (no downloads allowed).
// Run: SUPABASE_CLI=<path to supabase v2> node scripts/check-cloud.mjs   (needs `supabase login`)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = Object.fromEntries(readFileSync('.env.production', 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const ref = new URL(env.VITE_SUPABASE_URL).hostname.split('.')[0];
const keys = JSON.parse(execFileSync(process.env.SUPABASE_CLI ?? 'node_modules/.bin/supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: true }));
const c = createClient(env.VITE_SUPABASE_URL, keys.find((k) => k.name === 'service_role').api_key, { auth: { persistSession: false } });
const { data: st } = await c.from('settings').select('publisher_name, watermark_note, watermark').eq('id', 1).single();
console.log('publisher:', JSON.stringify(st));
const { data: files } = await c.from('files').select('kind, published, cover_path, storage_path, allow_download');
console.log('rows', files.length, 'published', files.filter((f) => f.published).length, 'downloadable', files.filter((f) => f.allow_download).length, 'by kind', Object.entries(files.reduce((a, f) => ({ ...a, [f.kind]: (a[f.kind] ?? 0) + 1 }), {})).map((e) => e.join(':')).join(' '));
let missing = 0;
for (const f of files) {
  const cover = await fetch(`${env.VITE_SUPABASE_URL}/storage/v1/object/public/covers/${f.cover_path}`);
  const pub = await fetch(`${env.VITE_SUPABASE_URL}/storage/v1/object/public/files/${f.storage_path}`);
  const exists = await c.storage.from('files').createSignedUrl(f.storage_path, 30);
  if (cover.status !== 200 || pub.status === 200 || exists.error) { missing++; console.log('PROBLEM', f.storage_path, cover.status, pub.status, exists.error?.message); }
}
console.log(missing ? `${missing} problems` : 'all covers load publicly; all files exist and none is public');
