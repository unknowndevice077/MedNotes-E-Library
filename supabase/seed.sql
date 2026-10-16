-- Local development seed. Test accounts only exist in your local Supabase:
--   admin:  admin@mednotes.test  / MedNotesAdmin#2026
--   client: juan@mednotes.test   / MedNotesReader#2026
-- File contents and covers are uploaded by `npm run seed:storage`.

create extension if not exists pgcrypto;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'admin@mednotes.test', crypt('MedNotesAdmin#2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Maria P."}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'juan@mednotes.test', crypt('MedNotesReader#2026', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Juan Dela Cruz"}', now(), now(), '', '', '', '');

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, jsonb_build_object('sub', id::text, 'email', email), 'email', now(), now(), now()
from auth.users where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';

insert into public.files (id, name, label, description, price, kind, mime, storage_path, cover_path, meta, allow_download) values
  ('a0000000-0000-0000-0000-000000000001', 'Pharmacology Made Easy', 'Pharmacology',
   'Drug classes, mechanisms, side effects and nursing considerations, summarized into tables and mnemonics. Built for board exam review.',
   450, 'epub', 'application/epub+zip', 'pharmacology-made-easy.epub', 'pharmacology.png', '320 pages', false),
  ('a0000000-0000-0000-0000-000000000002', 'Anatomy Atlas: Upper Limb', 'Anatomy',
   'Labeled plates of the bones, muscles and nerves of the upper limb.',
   350, 'pdf', 'application/pdf', 'anatomy-atlas-upper-limb.pdf', 'anatomy.png', '96 pages', true),
  ('a0000000-0000-0000-0000-000000000003', 'ECG Interpretation Lecture', 'Cardiology',
   'Recorded lecture: rhythm, axis, intervals and the common arrhythmias, with practice strips.',
   600, 'video', 'video/mp4', 'ecg-interpretation-lecture.mp4', 'ecg.png', '2h 14m', false),
  ('a0000000-0000-0000-0000-000000000004', 'Pathology Notes Vol. 1', 'Pathology',
   'Cell injury and inflammation handout with figures and mediator tables.',
   250, 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'pathology-notes-vol-1.docx', 'pathology.png', '48 pages', true),
  ('a0000000-0000-0000-0000-000000000005', 'Microbiology Slides', 'Microbiology',
   'Lecture deck on Gram-positive cocci with speaker notes.',
   200, 'pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'microbiology-slides.pptx', 'microbiology.png', '62 slides', false),
  ('a0000000-0000-0000-0000-000000000006', 'Lab Values Cheat Sheet', 'Clinical',
   'Normal ranges in SI and conventional units, printable.',
   150, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'lab-values-cheat-sheet.xlsx', 'lab-values.png', '4 sheets', true);

insert into public.purchases (user_id, file_id, amount, method, reference_no, status, receipt_no, confirmed_at, decided_by, reject_reason, created_at) values
  ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000004', 250, 'GCash', 'GC-7710 2290 1145', 'confirmed', 'OR-000001', now() - interval '2 days', '11111111-1111-1111-1111-111111111111', '', now() - interval '2 days'),
  ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000002', 350, 'BDO bank transfer', 'BDO-55102', 'confirmed', 'OR-000002', now() - interval '5 days', '11111111-1111-1111-1111-111111111111', '', now() - interval '5 days'),
  ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000001', 450, 'GCash', 'GC-8821 4407 3312', 'pending', null, null, null, '', now() - interval '6 hours'),
  ('22222222-2222-2222-2222-222222222222', 'a0000000-0000-0000-0000-000000000005', 200, 'Maya', 'MY-99031', 'rejected', null, null, '11111111-1111-1111-1111-111111111111', 'Amount doesn''t match the price', now() - interval '1 day');

update public.settings set receipt_next = 3 where id = 1;
