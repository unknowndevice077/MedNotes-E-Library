-- Demo catalog + buyers for local testing (loaded after seed.sql).
-- Demo buyers all use the password DemoBuyer#2026 (local only, never in production).

insert into public.files (id, name, label, description, price, kind, mime, storage_path, cover_path, meta, created_at) values
  ('a0000000-0000-0000-0000-000000000007', 'Clinical Microbiology Review', 'Microbiology', 'Bacteria, viruses, fungi and parasites with lab diagnosis and treatment tables.', 420, 'epub', 'application/epub+zip', 'pharmacology-made-easy.epub', 'micro-review.png', '280 pages', now() - interval '20 days'),
  ('a0000000-0000-0000-0000-000000000008', 'Renal Physiology Notes', 'Physiology', 'Filtration, tubular transport, acid-base and fluid balance in one handout.', 280, 'pdf', 'application/pdf', 'anatomy-atlas-upper-limb.pdf', 'renal-physio.png', '64 pages', now() - interval '18 days'),
  ('a0000000-0000-0000-0000-000000000009', 'Biochemistry Pathways Chart', 'Biochemistry', 'Glycolysis and the key regulatory enzymes on one printable chart.', 120, 'image', 'image/png', 'biochem-pathways.png', 'biochem-pathways.png', '1 chart', now() - interval '16 days'),
  ('a0000000-0000-0000-0000-000000000010', 'Pediatric Milestones Lecture', 'Pediatrics', 'Recorded lecture on gross motor, fine motor, language and social milestones.', 550, 'video', 'video/mp4', 'ecg-interpretation-lecture.mp4', 'peds-milestones.png', '1h 32m', now() - interval '14 days'),
  ('a0000000-0000-0000-0000-000000000011', 'Obstetrics Quick Review', 'OB-GYN', 'Antenatal care, labor stages and obstetric emergencies.', 300, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'pathology-notes-vol-1.docx', 'ob-review.png', '40 pages', now() - interval '12 days'),
  ('a0000000-0000-0000-0000-000000000012', 'Surgical Instruments Atlas', 'Surgery', 'Labeled photos of common instruments with their uses.', 390, 'pdf', 'application/pdf', 'anatomy-atlas-upper-limb.pdf', 'surgical-atlas.png', '120 pages', now() - interval '10 days'),
  ('a0000000-0000-0000-0000-000000000013', 'Antibiotics Cheat Sheet', 'Pharmacology', 'Spectrum, mechanism and key side effects of each class.', 180, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'lab-values-cheat-sheet.xlsx', 'antibiotics.png', '3 sheets', now() - interval '8 days'),
  ('a0000000-0000-0000-0000-000000000014', 'NCLEX Practice Set 1', 'Nursing', '150 practice questions with rationales.', 250, 'pdf', 'application/pdf', 'anatomy-atlas-upper-limb.pdf', 'nclex-set-1.png', '150 items', now() - interval '6 days'),
  ('a0000000-0000-0000-0000-000000000015', 'Neuroanatomy Slides', 'Anatomy', 'Cranial nerves, tracts and blood supply in 48 slides.', 320, 'pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'microbiology-slides.pptx', 'neuro-slides.png', '48 slides', now() - interval '4 days'),
  ('a0000000-0000-0000-0000-000000000016', 'ECG Practice Strips', 'Cardiology', 'Five annotated rhythm strips to practice reading.', 150, 'image', 'image/png', 'ecg-strips.png', 'ecg-strips.png', '5 strips', now() - interval '3 days'),
  ('a0000000-0000-0000-0000-000000000017', 'Heart Sounds Lecture', 'Cardiology', 'Normal and abnormal heart sounds, murmurs and where to listen.', 480, 'video', 'video/mp4', 'ecg-interpretation-lecture.mp4', 'heart-sounds.png', '58m', now() - interval '2 days'),
  ('a0000000-0000-0000-0000-000000000018', 'Public Health Case Studies', 'Community Health', 'Ten community health cases with discussion questions.', 200, 'epub', 'application/epub+zip', 'pharmacology-made-easy.epub', 'public-health.png', '96 pages', now() - interval '1 day');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
select '00000000-0000-0000-0000-000000000000', u.id::uuid, 'authenticated', 'authenticated', u.email, crypt('DemoBuyer#2026', gen_salt('bf')), now(),
  jsonb_build_object('provider', u.provider, 'providers', jsonb_build_array(u.provider)), jsonb_build_object('full_name', u.name),
  now() - make_interval(days => u.age), now(), '', '', '', ''
from (values
  ('33333333-0000-0000-0000-000000000001', 'maria.reyes@mednotes.test', 'Maria Reyes', 'google', 25),
  ('33333333-0000-0000-0000-000000000002', 'kevin.lim@mednotes.test', 'Kevin Lim', 'email', 21),
  ('33333333-0000-0000-0000-000000000003', 'ana.santos@mednotes.test', 'Ana Santos', 'facebook', 9),
  ('33333333-0000-0000-0000-000000000004', 'rico.tan@mednotes.test', 'Rico Tan', 'email', 5),
  ('33333333-0000-0000-0000-000000000005', 'liza.gomez@mednotes.test', 'Liza Gomez', 'email', 30),
  ('33333333-0000-0000-0000-000000000006', 'paolo.cruz@mednotes.test', 'Paolo Cruz', 'google', 2)
) as u(id, email, name, provider, age);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now()
from auth.users where id::text like '33333333-0000%';

update public.profiles p set provider = u.raw_app_meta_data ->> 'provider', created_at = u.created_at
from auth.users u where u.id = p.id and u.id::text like '33333333-0000%';
update public.profiles set suspended = true, admin_note = 'Shared account with classmates (demo).' where id = '33333333-0000-0000-0000-000000000005';
update public.profiles set computer_slots = 2, admin_note = 'Extra computer approved for lab use (demo).' where id = '33333333-0000-0000-0000-000000000006';

insert into public.purchases (user_id, file_id, amount, method, reference_no, proof_path, status, receipt_no, confirmed_at, decided_by, reject_reason, created_at) values
  ('33333333-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 450, 'GCash', '8821 4407 3312', '33333333-0000-0000-0000-000000000001/proof-1.png', 'pending', null, null, null, '', now() - interval '5 hours'),
  ('33333333-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 600, 'GCash', '7712 9921 0044', '33333333-0000-0000-0000-000000000002/proof-1.png', 'pending', null, null, null, '', now() - interval '3 hours'),
  ('33333333-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 350, 'GCash', '5510 2288 1930', '33333333-0000-0000-0000-000000000003/proof-1.png', 'pending', null, null, null, '', now() - interval '90 minutes'),
  ('33333333-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000008', 280, 'GCash', '9031 4471 2205', '33333333-0000-0000-0000-000000000004/proof-1.png', 'pending', null, null, null, '', now() - interval '20 minutes'),
  ('33333333-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 350, 'GCash', '1100 2200 3300', null, 'confirmed', 'OR-000003', now() - interval '24 days', '11111111-1111-1111-1111-111111111111', '', now() - interval '24 days'),
  ('33333333-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006', 150, 'GCash', '1100 2200 3301', null, 'confirmed', 'OR-000004', now() - interval '20 days', '11111111-1111-1111-1111-111111111111', '', now() - interval '20 days'),
  ('33333333-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000008', 280, 'GCash', '1100 2200 3302', null, 'confirmed', 'OR-000005', now() - interval '15 days', '11111111-1111-1111-1111-111111111111', '', now() - interval '15 days'),
  ('33333333-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000014', 250, 'GCash', '1100 2200 3303', null, 'confirmed', 'OR-000006', now() - interval '12 days', '11111111-1111-1111-1111-111111111111', '', now() - interval '12 days'),
  ('33333333-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000017', 480, 'GCash', '1100 2200 3304', null, 'confirmed', 'OR-000007', now() - interval '2 days', '11111111-1111-1111-1111-111111111111', '', now() - interval '2 days'),
  ('33333333-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000015', 320, 'GCash', '1100 2200 3305', null, 'confirmed', 'OR-000008', now() - interval '1 day', '11111111-1111-1111-1111-111111111111', '', now() - interval '1 day'),
  ('33333333-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000002', 350, 'GCash', '1100 2200 3306', null, 'confirmed', 'OR-000009', now() - interval '6 hours', '11111111-1111-1111-1111-111111111111', '', now() - interval '6 hours'),
  ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000016', 150, 'GCash', '1100 2200 3307', null, 'confirmed', 'OR-000010', now() - interval '3 days', '11111111-1111-1111-1111-111111111111', '', now() - interval '3 days'),
  ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000011', 300, 'GCash', '1100 2200 3308', null, 'confirmed', 'OR-000011', now() - interval '1 day', '11111111-1111-1111-1111-111111111111', '', now() - interval '1 day'),
  ('33333333-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000007', 400, 'GCash', '4400 1100 2299', null, 'rejected', null, null, '11111111-1111-1111-1111-111111111111', 'Amount does not match the price', now() - interval '2 days');

insert into public.devices (user_id, device_id, kind, label, platform, last_seen) values
  ('33333333-0000-0000-0000-000000000001', 'demo-maria-pc', 'computer', 'Windows PC · Chrome', 'web', now() - interval '5 hours'),
  ('33333333-0000-0000-0000-000000000001', 'demo-maria-phone', 'phone', 'Galaxy A54 · MedNotes app', 'android-app', now() - interval '1 day'),
  ('33333333-0000-0000-0000-000000000002', 'demo-kevin-pc', 'computer', 'Mac · Safari', 'web', now() - interval '3 hours'),
  ('33333333-0000-0000-0000-000000000006', 'demo-paolo-pc1', 'computer', 'Windows PC · Edge', 'web', now() - interval '6 hours'),
  ('33333333-0000-0000-0000-000000000006', 'demo-paolo-pc2', 'computer', 'Linux PC · Firefox', 'web', now() - interval '2 days');

update public.settings set receipt_next = 12 where id = 1;

-- Free samples: always unlocked for every signed-in buyer (one of each document type).
insert into public.files (id, name, label, description, price, kind, mime, storage_path, cover_path, meta, is_free, created_at) values
  ('a0000000-0000-0000-0000-000000000019', 'Free sample: Upper Limb Atlas', 'Anatomy', 'A free preview of the anatomy atlas. Open it to see how reading works.', 0, 'pdf', 'application/pdf', 'anatomy-atlas-upper-limb.pdf', 'anatomy.png', '4 pages', true, now() - interval '1 hour'),
  ('a0000000-0000-0000-0000-000000000020', 'Free sample: Gram-positive Cocci Slides', 'Microbiology', 'Three lecture slides, free to view.', 0, 'pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'microbiology-slides.pptx', 'microbiology.png', '3 slides', true, now() - interval '1 hour'),
  ('a0000000-0000-0000-0000-000000000021', 'Free sample: Pharmacology Chapter', 'Pharmacology', 'Three short chapters of the board review e-book, free to read.', 0, 'epub', 'application/epub+zip', 'pharmacology-made-easy.epub', 'pharmacology.png', '3 chapters', true, now() - interval '1 hour'),
  ('a0000000-0000-0000-0000-000000000022', 'Free sample: Pathology Notes', 'Pathology', 'Cell injury and inflammation handout, free to read.', 0, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'pathology-notes-vol-1.docx', 'pathology.png', '2 pages', true, now() - interval '1 hour'),
  ('a0000000-0000-0000-0000-000000000023', 'Free sample: Lab Values Sheet', 'Clinical', 'The chemistry lab values sheet, free to view.', 0, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'lab-values-cheat-sheet.xlsx', 'lab-values.png', '1 sheet', true, now() - interval '1 hour')
on conflict (id) do update set is_free = true, price = 0;
