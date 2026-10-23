-- Subjects the admin manages (Admin → Files → Subjects). They show first in the upload form and in
-- the library filter. A file's subject is still its own `label`, so renaming one here renames it on
-- every file that uses it.
create table if not exists public.subjects (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create unique index if not exists subjects_name_key on public.subjects (lower(name));

alter table public.subjects enable row level security;
drop policy if exists subjects_read on public.subjects;
create policy subjects_read on public.subjects for select to authenticated using (true);
drop policy if exists subjects_admin on public.subjects;
create policy subjects_admin on public.subjects for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.subjects from anon;

-- the subjects already on files become the starting list
insert into public.subjects (name)
select distinct on (lower(trim(label))) trim(label) from public.files where trim(coalesce(label, '')) <> ''
on conflict do nothing;

-- Rename a subject and every file that uses it, in one go.
create or replace function public.admin_rename_subject(p_id bigint, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare old text; nm text := trim(p_name);
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if nm = '' then raise exception 'Give the subject a name.'; end if;
  select name into old from public.subjects where id = p_id;
  if old is null then raise exception 'That subject no longer exists.'; end if;
  if exists (select 1 from public.subjects where lower(name) = lower(nm) and id <> p_id) then
    raise exception 'There is already a subject called %.', nm;
  end if;
  update public.subjects set name = nm where id = p_id;
  update public.files set label = nm where lower(trim(label)) = lower(old);
end $$;

-- Delete a subject; files that used it are left without a subject (they stay in the library).
create or replace function public.admin_delete_subject(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare old text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  delete from public.subjects where id = p_id returning name into old;
  if old is not null then update public.files set label = '' where lower(trim(label)) = lower(old); end if;
end $$;

revoke execute on function public.admin_rename_subject(bigint, text) from public, anon;
revoke execute on function public.admin_delete_subject(bigint) from public, anon;
grant execute on function public.admin_rename_subject(bigint, text) to authenticated;
grant execute on function public.admin_delete_subject(bigint) to authenticated;
