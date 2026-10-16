-- MedNotes E-Library: core schema, row-level security, storage rules and RPCs.

create type public.app_role as enum ('client', 'admin');
create type public.device_kind as enum ('computer', 'phone');
create type public.purchase_status as enum ('pending', 'confirmed', 'rejected');
create type public.file_kind as enum ('epub', 'pdf', 'video', 'image', 'docx', 'pptx', 'xlsx', 'other');

-- ---------------------------------------------------------------- settings
-- Single row (id = 1) of store-wide defaults that admins edit on the Settings
-- and Restrictions pages. Per-user overrides live on profiles.
create table public.settings (
  id int primary key default 1 check (id = 1),
  store_name text not null default 'MedNotes E-Library',
  support_email text not null default 'support@mednotes.example',
  receipt_business text not null default 'MedNotes Publishing',
  receipt_tin text not null default '',
  receipt_prefix text not null default 'OR-',
  receipt_next int not null default 1,
  receipt_footer text not null default 'Thank you for supporting MedNotes!',
  computer_slots int not null default 1 check (computer_slots >= 0),
  phone_slots int not null default 1 check (phone_slots >= 0),
  swaps_per_30d int not null default 2 check (swaps_per_30d >= 0),
  users_can_add_devices boolean not null default true,
  allow_download_default boolean not null default false,
  offline_saving boolean not null default true,
  offline_days int not null default 30 check (offline_days > 0),
  watermark boolean not null default true,
  block_screenshots boolean not null default true,
  payment_methods jsonb not null default '[
    {"name": "GCash", "account": "0917 123 4567", "holder": "MedNotes Publishing", "enabled": true},
    {"name": "Maya", "account": "0918 765 4321", "holder": "MedNotes Publishing", "enabled": true},
    {"name": "BDO bank transfer", "account": "0012 3456 7890", "holder": "MedNotes Publishing", "enabled": true}
  ]'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  avatar_url text,
  provider text not null default 'email',
  role public.app_role not null default 'client',
  suspended boolean not null default false,
  -- admin overrides (null = use settings default)
  computer_slots int check (computer_slots >= 0),
  phone_slots int check (phone_slots >= 0),
  swaps_per_30d int check (swaps_per_30d >= 0),
  allow_download boolean,
  can_add_devices boolean,
  admin_note text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and not suspended);
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, provider)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url',
    coalesce(new.raw_app_meta_data ->> 'provider', 'email')
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Non-admins may only edit their own name/avatar; everything else is admin-only.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() is null for trusted server-side SQL (migrations, seed, service role)
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role or new.suspended is distinct from old.suspended
      or new.computer_slots is distinct from old.computer_slots or new.phone_slots is distinct from old.phone_slots
      or new.swaps_per_30d is distinct from old.swaps_per_30d or new.allow_download is distinct from old.allow_download
      or new.can_add_devices is distinct from old.can_add_devices or new.admin_note is distinct from old.admin_note
      or new.email is distinct from old.email or new.provider is distinct from old.provider then
      raise exception 'only admins can change these fields';
    end if;
  end if;
  return new;
end $$;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------- files
create table public.files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  label text not null default '',
  description text not null default '',
  price numeric(10, 2) not null default 0 check (price >= 0),
  kind public.file_kind not null default 'other',
  mime text not null default 'application/octet-stream',
  storage_path text,            -- object name in the private "files" bucket
  cover_path text,              -- object name in the public "covers" bucket
  size_bytes bigint not null default 0,
  meta text not null default '', -- e.g. "320 pages", "2h 14m"
  allow_download boolean not null default false,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index files_published_idx on public.files (published, created_at desc);

-- ---------------------------------------------------------------- purchases
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  amount numeric(10, 2) not null check (amount >= 0),
  method text not null default '',
  reference_no text not null default '',
  proof_path text,              -- object name in the private "proofs" bucket
  status public.purchase_status not null default 'pending',
  reject_reason text not null default '',
  note_to_buyer text not null default '',
  receipt_no text unique,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null
);
-- one live (pending or confirmed) purchase per user per file
create unique index purchases_one_live_idx on public.purchases (user_id, file_id) where status <> 'rejected';
create index purchases_status_idx on public.purchases (status, created_at);

create or replace function public.owns_file(p_file uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.purchases where user_id = auth.uid() and file_id = p_file and status = 'confirmed');
$$;

-- ---------------------------------------------------------------- devices
create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  device_id text not null,       -- random id generated and stored on the device
  kind public.device_kind not null,
  label text not null default '',
  platform text not null default '',
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, device_id)
);
create table public.device_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.device_kind not null,
  action text not null check (action in ('added', 'swapped', 'removed', 'reset')),
  at timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS
alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.files enable row level security;
alter table public.purchases enable row level security;
alter table public.devices enable row level security;
alter table public.device_events enable row level security;

create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_admin on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin());

create policy files_read on public.files for select to authenticated using (published or public.is_admin());
create policy files_admin on public.files for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy purchases_read on public.purchases for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy purchases_insert on public.purchases for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and receipt_no is null);
create policy purchases_admin on public.purchases for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy devices_read on public.devices for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy device_events_read on public.device_events for select to authenticated using (user_id = auth.uid() or public.is_admin());
-- devices are only written through the RPCs below

-- ---------------------------------------------------------------- device RPCs
create or replace function public.effective_limits(p_user uuid)
returns table (computer_slots int, phone_slots int, swaps_per_30d int, can_add boolean, suspended boolean)
language sql stable security definer set search_path = public as $$
  select coalesce(p.computer_slots, s.computer_slots), coalesce(p.phone_slots, s.phone_slots),
         coalesce(p.swaps_per_30d, s.swaps_per_30d), coalesce(p.can_add_devices, s.users_can_add_devices), p.suspended
  from public.profiles p cross join public.settings s where p.id = p_user;
$$;

-- Called on every app start / sign-in. Registers the device if a slot is free;
-- otherwise returns reason 'limit' plus the devices currently in that slot.
create or replace function public.register_device(p_device_id text, p_kind public.device_kind, p_label text, p_platform text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lim record;
  used int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into lim from public.effective_limits(uid);
  if lim.suspended then return jsonb_build_object('ok', false, 'reason', 'suspended'); end if;

  update public.devices set last_seen = now(), label = p_label, platform = p_platform
    where user_id = uid and device_id = p_device_id;
  if found then return jsonb_build_object('ok', true); end if;

  select count(*) into used from public.devices where user_id = uid and kind = p_kind;
  if used < (case when p_kind = 'computer' then lim.computer_slots else lim.phone_slots end) then
    if not lim.can_add then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
    insert into public.devices (user_id, device_id, kind, label, platform) values (uid, p_device_id, p_kind, p_label, p_platform);
    insert into public.device_events (user_id, kind, action) values (uid, p_kind, 'added');
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'limit', 'devices',
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'last_seen', last_seen) order by last_seen desc), '[]')
       from public.devices where user_id = uid and kind = p_kind));
end $$;

-- "Sign out the other device and use this one" — counts against the 30-day swap limit.
create or replace function public.swap_device(p_old uuid, p_device_id text, p_kind public.device_kind, p_label text, p_platform text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lim record;
  swaps int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into lim from public.effective_limits(uid);
  if lim.suspended then return jsonb_build_object('ok', false, 'reason', 'suspended'); end if;
  if not lim.can_add then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  select count(*) into swaps from public.device_events
    where user_id = uid and action in ('swapped', 'removed') and at > now() - interval '30 days';
  if swaps >= lim.swaps_per_30d then return jsonb_build_object('ok', false, 'reason', 'swaps'); end if;
  delete from public.devices where id = p_old and user_id = uid and kind = p_kind;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into public.devices (user_id, device_id, kind, label, platform) values (uid, p_device_id, p_kind, p_label, p_platform);
  insert into public.device_events (user_id, kind, action) values (uid, p_kind, 'swapped');
  return jsonb_build_object('ok', true);
end $$;

-- Remove a device from the account (user: own devices, counts as a swap; admin: anyone's, free).
create or replace function public.remove_device(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d record;
  lim record;
  swaps int;
begin
  select * into d from public.devices where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if public.is_admin() then
    delete from public.devices where id = p_id;
    insert into public.device_events (user_id, kind, action) values (d.user_id, d.kind, 'reset');
    return jsonb_build_object('ok', true);
  end if;
  if d.user_id <> auth.uid() then raise exception 'not your device'; end if;
  select * into lim from public.effective_limits(auth.uid());
  select count(*) into swaps from public.device_events
    where user_id = auth.uid() and action in ('swapped', 'removed') and at > now() - interval '30 days';
  if swaps >= lim.swaps_per_30d then return jsonb_build_object('ok', false, 'reason', 'swaps'); end if;
  delete from public.devices where id = p_id;
  insert into public.device_events (user_id, kind, action) values (d.user_id, d.kind, 'removed');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_devices(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  delete from public.devices where user_id = p_user;
  delete from public.device_events where user_id = p_user and action in ('swapped', 'removed');
end $$;

-- True when the calling session's device is registered — the reader checks this
-- before handing out a file URL.
create or replace function public.device_ok(p_device_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (select 1 from public.devices where user_id = auth.uid() and device_id = p_device_id);
$$;

-- ---------------------------------------------------------------- purchase RPCs
create or replace function public.confirm_purchase(p_id uuid, p_note text default '')
returns public.purchases language plpgsql security definer set search_path = public as $$
declare
  s record;
  r public.purchases;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into s from public.settings where id = 1 for update;
  update public.purchases
     set status = 'confirmed', confirmed_at = now(), decided_by = auth.uid(), note_to_buyer = coalesce(p_note, ''),
         receipt_no = s.receipt_prefix || lpad(s.receipt_next::text, 6, '0'), reject_reason = ''
   where id = p_id and status = 'pending'
   returning * into r;
  if r.id is null then raise exception 'payment is not pending'; end if;
  update public.settings set receipt_next = receipt_next + 1 where id = 1;
  return r;
end $$;

create or replace function public.reject_purchase(p_id uuid, p_reason text, p_note text default '')
returns public.purchases language plpgsql security definer set search_path = public as $$
declare r public.purchases;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.purchases set status = 'rejected', reject_reason = p_reason, note_to_buyer = coalesce(p_note, ''),
         decided_by = auth.uid(), confirmed_at = null
   where id = p_id and status = 'pending' returning * into r;
  if r.id is null then raise exception 'payment is not pending'; end if;
  return r;
end $$;

create or replace function public.admin_grant_file(p_user uuid, p_file uuid)
returns public.purchases language plpgsql security definer set search_path = public as $$
declare r public.purchases;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  delete from public.purchases where user_id = p_user and file_id = p_file and status = 'pending';
  insert into public.purchases (user_id, file_id, amount, method, status, confirmed_at, decided_by, note_to_buyer)
  values (p_user, p_file, 0, 'Granted by admin', 'confirmed', now(), auth.uid(), 'Access granted by the publisher.')
  on conflict do nothing returning * into r;
  return r;
end $$;

create or replace function public.admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_user = auth.uid() then raise exception 'you cannot delete your own account'; end if;
  delete from auth.users where id = p_user;
end $$;

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'revenue_month', (select coalesce(sum(amount), 0) from public.purchases where status = 'confirmed' and confirmed_at >= date_trunc('month', now())),
    'revenue_last_month', (select coalesce(sum(amount), 0) from public.purchases where status = 'confirmed'
        and confirmed_at >= date_trunc('month', now()) - interval '1 month' and confirmed_at < date_trunc('month', now())),
    'pending', (select count(*) from public.purchases where status = 'pending'),
    'oldest_pending', (select min(created_at) from public.purchases where status = 'pending'),
    'users', (select count(*) from public.profiles where role = 'client'),
    'users_week', (select count(*) from public.profiles where role = 'client' and created_at > now() - interval '7 days'),
    'files', (select count(*) from public.files),
    'files_by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from public.files group by kind) k),
    'top', (select coalesce(jsonb_agg(t), '[]') from (
        select f.id, f.name, f.cover_path, count(p.*) sold from public.files f
        join public.purchases p on p.file_id = f.id and p.status = 'confirmed'
        group by f.id order by sold desc limit 5) t)
  );
end $$;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public) values
  ('covers', 'covers', true),
  ('files', 'files', false),
  ('proofs', 'proofs', false)
on conflict (id) do nothing;

create policy covers_read on storage.objects for select using (bucket_id = 'covers');
create policy covers_admin on storage.objects for all to authenticated
  using (bucket_id = 'covers' and public.is_admin()) with check (bucket_id = 'covers' and public.is_admin());

-- Paid files: admins, or buyers whose payment the publisher confirmed.
create policy files_read on storage.objects for select to authenticated using (
  bucket_id = 'files' and (
    public.is_admin()
    or exists (select 1 from public.files f join public.purchases p on p.file_id = f.id
               where f.storage_path = storage.objects.name and p.user_id = auth.uid() and p.status = 'confirmed')
  ));
create policy files_admin on storage.objects for all to authenticated
  using (bucket_id = 'files' and public.is_admin()) with check (bucket_id = 'files' and public.is_admin());

-- Proof of payment: buyers upload into their own folder ("<uid>/..."); admins read all.
create policy proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy proofs_admin on storage.objects for delete to authenticated using (bucket_id = 'proofs' and public.is_admin());
