// Publishes the sample medical e-books to the CLOUD Supabase project so the payment flow can be demoed.
// Signs in as an admin (RLS allows admins to upload and insert), so no service-role key is needed.
//   ADMIN_EMAIL=you@x.com ADMIN_PASSWORD=... npm run publish:samples
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = join(import.meta.dirname, '..');
const envFile = existsSync(join(root, '.env.production')) ? readFileSync(join(root, '.env.production'), 'utf8') : '';
const fromFile = Object.fromEntries(envFile.split(/\r?\n/).map((l) => l.match(/^(VITE_\w+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, '')]));
const url = process.env.VITE_SUPABASE_URL || fromFile.VITE_SUPABASE_URL;
const anon = process.env.VITE_SUPABASE_ANON_KEY || fromFile.VITE_SUPABASE_ANON_KEY;
const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!url || !anon) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (an admin account)');

const sb = createClient(url, anon, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) throw authErr;

const types = { '.png': 'image/png', '.epub': 'application/epub+zip', '.pdf': 'application/pdf', '.mp4': 'video/mp4',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const sizes = {};
for (const [bucket, dir] of [['covers', 'covers'], ['files', 'files']]) {
  const folder = join(root, 'supabase', 'sample', dir);
  for (const name of readdirSync(folder)) {
    const body = readFileSync(join(folder, name));
    const { error } = await sb.storage.from(bucket).upload(name, body, { upsert: true, contentType: types[extname(name)] });
    console.log(error ? `✗ ${bucket}/${name}: ${error.message}` : `✓ ${bucket}/${name}`);
    if (bucket === 'files') sizes[name] = body.length;
  }
}

// Same catalogue as supabase/seed.sql (prices in PHP). Re-running updates in place.
const rows = [
  ['Pharmacology Made Easy', 'Pharmacology', 'Drug classes, mechanisms, side effects and nursing considerations, summarized into tables and mnemonics. Built for board exam review.', 450, 'epub', 'pharmacology-made-easy.epub', 'pharmacology.png', '320 pages', false],
  ['Anatomy Atlas: Upper Limb', 'Anatomy', 'Labeled plates of the bones, muscles and nerves of the upper limb.', 350, 'pdf', 'anatomy-atlas-upper-limb.pdf', 'anatomy.png', '96 pages', true],
  ['ECG Interpretation Lecture', 'Cardiology', 'Recorded lecture: rhythm, axis, intervals and the common arrhythmias, with practice strips.', 600, 'video', 'ecg-interpretation-lecture.mp4', 'ecg.png', '2h 14m', false],
  ['Pathology Notes Vol. 1', 'Pathology', 'Cell injury and inflammation handout with figures and mediator tables.', 250, 'docx', 'pathology-notes-vol-1.docx', 'pathology.png', '48 pages', true],
  ['Microbiology Slides', 'Microbiology', 'Lecture deck on Gram-positive cocci with speaker notes.', 200, 'pptx', 'microbiology-slides.pptx', 'microbiology.png', '62 slides', false],
  ['Lab Values Cheat Sheet', 'Clinical', 'Normal ranges in SI and conventional units, printable.', 150, 'xlsx', 'lab-values-cheat-sheet.xlsx', 'lab-values.png', '4 sheets', true],
];
for (const [name, label, description, price, kind, path, cover, meta, allow] of rows) {
  const row = { name, label, description, price, kind, mime: types['.' + path.split('.').pop()], storage_path: path, cover_path: cover, size_bytes: sizes[path], meta, allow_download: allow, published: true };
  const { data: ex } = await sb.from('files').select('id').eq('storage_path', path).maybeSingle();
  const { error } = ex ? await sb.from('files').update(row).eq('id', ex.id) : await sb.from('files').insert(row);
  console.log(error ? `✗ ${name}: ${error.message}` : `✓ ${name} (₱${price})`);
}
