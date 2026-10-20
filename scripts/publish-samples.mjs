// Copies the demo catalog (file rows + covers + file bytes) from the LOCAL Supabase to the cloud
// project, so the live library has sample files to browse and test with. Buyers, purchases and
// devices are never copied. Safe to re-run: rows are upserted by id and uploads overwrite.
//
//   node scripts/publish-samples.mjs            # show what would be copied
//   node scripts/publish-samples.mjs --apply    # copy it
//
// Needs: local stack running with the demo seed, and `supabase login` (the cloud service key is
// read from the CLI into memory; it is never printed or written to disk).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { service as local } from '../tests/helpers.mjs';

const root = join(import.meta.dirname, '..');
const apply = process.argv.includes('--apply');
const CLI = process.env.SUPABASE_CLI ?? join(root, 'node_modules', '.bin', 'supabase');
const env = Object.fromEntries(readFileSync(join(root, '.env.production'), 'utf8').split(/\r?\n/).filter((l) => l.includes('=')).map((l) => l.split(/=(.*)/s).slice(0, 2)));
const url = env.VITE_SUPABASE_URL;
const ref = new URL(url).hostname.split('.')[0];
const keys = JSON.parse(execFileSync(CLI, ['projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' }));
const serviceKey = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')?.api_key;
if (!serviceKey) throw new Error('No service_role key from the Supabase CLI (run `supabase login`)');
const cloud = createClient(url, serviceKey, { auth: { persistSession: false } });

const SAMPLE_NOTE = 'Sample file for trying out MedNotes.';
const { data: files, error } = await local.from('files').select('*').order('created_at');
if (error) throw error;
const { data: existing } = await cloud.from('files').select('id');
const have = new Set((existing ?? []).map((f) => f.id));
console.log(`local demo catalog: ${files.length} files · cloud has ${have.size} files (${files.filter((f) => have.has(f.id)).length} of these already)`);

const copy = async (bucket, path, contentType) => {
  const { data, error: e } = await local.storage.from(bucket).download(path);
  if (e) throw new Error(`${bucket}/${path}: ${e.message}`);
  const { error: ue } = await cloud.storage.from(bucket).upload(path, data, { upsert: true, contentType: contentType || data.type || undefined });
  if (ue) throw new Error(`upload ${bucket}/${path}: ${ue.message}`);
};

const objects = new Set();
for (const f of files) {
  console.log(`${have.has(f.id) ? 'update' : 'add   '} ${f.kind.padEnd(5)} ₱${String(f.price).padStart(4)}  ${f.name}`);
  if (!apply) continue;
  if (f.cover_path && !objects.has(`covers/${f.cover_path}`)) { await copy('covers', f.cover_path, 'image/png'); objects.add(`covers/${f.cover_path}`); }
  if (f.storage_path && !objects.has(`files/${f.storage_path}`)) { await copy('files', f.storage_path, f.mime); objects.add(`files/${f.storage_path}`); }
  const row = { ...f, description: f.description?.includes(SAMPLE_NOTE) ? f.description : `${f.description} ${SAMPLE_NOTE}`.trim(), allow_download: false };
  delete row.created_by;
  const { error: ie } = await cloud.from('files').upsert(row, { onConflict: 'id' });
  if (ie) throw new Error(`${f.name}: ${ie.message}`);
}
console.log(apply ? `done: ${files.length} files, ${objects.size} storage objects copied` : 'dry run: add --apply to copy');
