-- Security hardening + user preferences + receipt design + site theme.

-- ------------------------------------------------------------ profile guard: allowlist
-- Buyers may only change their name, avatar and preferences. Everything else (role,
-- suspension, slots, ids, timestamps, and any column added later) is admin-only.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null for trusted server-side SQL (migrations, seed, service role)
  if auth.uid() is not null and not public.is_admin() then
    if (to_jsonb(new) - array['full_name', 'avatar_url', 'prefs']) is distinct from
       (to_jsonb(old) - array['full_name', 'avatar_url', 'prefs']) then
      raise exception 'only admins can change these fields';
    end if;
  end if;
  return new;
end $$;

-- per-user settings (reader theme, text size, motion, start page)
alter table public.profiles add column if not exists prefs jsonb not null default '{}';

-- only used inside other security-definer functions; don't let clients probe other users' limits
revoke execute on function public.effective_limits(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------ buyers can't fake decisions
drop policy if exists purchases_insert on public.purchases;
create policy purchases_insert on public.purchases for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and receipt_no is null
              and decided_by is null and confirmed_at is null and reject_reason = '' and note_to_buyer = '');

-- ------------------------------------------------------------ admin emails: admin-only table
-- They used to live on settings, which every signed-in buyer can read.
create table if not exists public.admin_allowlist (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
alter table public.admin_allowlist enable row level security;
drop policy if exists admin_allowlist_admin on public.admin_allowlist;
create policy admin_allowlist_admin on public.admin_allowlist for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

insert into public.admin_allowlist (email)
  select distinct lower(e) from public.settings, unnest(admin_emails) e where coalesce(e, '') <> ''
  on conflict do nothing;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, provider, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_app_meta_data ->> 'provider', 'email'),
    case when exists (select 1 from public.admin_allowlist a where a.email = lower(coalesce(new.email, '')))
         then 'admin'::public.app_role else 'client'::public.app_role end
  );
  return new;
end $$;

-- adding an email promotes an existing account with that email right away
create or replace function public.apply_admin_allowlist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set role = 'admin' where role <> 'admin' and lower(email) = new.email;
  return new;
end $$;
drop trigger if exists apply_admin_allowlist on public.admin_allowlist;
create trigger apply_admin_allowlist after insert on public.admin_allowlist
  for each row execute function public.apply_admin_allowlist();

drop trigger if exists apply_admin_emails on public.settings;
drop function if exists public.apply_admin_emails();
alter table public.settings drop column if exists admin_emails;

-- ------------------------------------------------------------ upload limits
update storage.buckets set file_size_limit = 10485760,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
  where id = 'proofs';
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
  where id in ('covers', 'payment-qr');

-- ------------------------------------------------------------ receipt design + site theme
alter table public.settings
  add column if not exists receipt_design jsonb not null default '{}',
  add column if not exists theme jsonb not null default '{}';

-- logos and background images chosen in Admin → Appearance
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists branding_read on storage.objects;
create policy branding_read on storage.objects for select using (bucket_id = 'branding');
drop policy if exists branding_admin on storage.objects;
create policy branding_admin on storage.objects for all to authenticated
  using (bucket_id = 'branding' and public.is_admin()) with check (bucket_id = 'branding' and public.is_admin());

-- The sign-in page is styled before anyone signs in, so the look is readable without a session.
create or replace function public.get_public_theme()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('store_name', store_name, 'theme', theme) from public.settings where id = 1;
$$;
revoke execute on function public.get_public_theme() from public;
grant execute on function public.get_public_theme() to anon, authenticated;
