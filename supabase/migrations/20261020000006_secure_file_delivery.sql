-- Buyers no longer read the files bucket directly (no signed URLs to copy from DevTools).
-- Paid content is served only by the read-file Edge Function, encrypted per session.
drop policy if exists files_read on storage.objects;
-- Admins keep full access (files_admin policy) for uploads and previews.

-- Downloads/export are no longer offered: files are view-only inside MedNotes.
update public.files set allow_download = false;
update public.profiles set allow_download = null;
update public.settings set allow_download_default = false where id = 1;
