-- Free samples, paid extra device slots, activity/audit log with revert + edit, and resettable statistics.

-- ============================================================ free samples
alter table public.files add column if not exists is_free boolean not null default false;

-- nobody "buys" a free sample
drop policy if exists purchases_insert on public.purchases;
create policy purchases_insert on public.purchases for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and receipt_no is null
              and decided_by is null and confirmed_at is null and reject_reason = '' and note_to_buyer = ''
              and not exists (select 1 from public.files f where f.id = file_id and f.is_free));

-- ============================================================ paid extra device slots
alter table public.settings
  add column if not exists slot_sales boolean not null default true,
  add column if not exists slot_price_computer numeric(10, 2) not null default 199 check (slot_price_computer >= 0),
  add column if not exists slot_price_phone numeric(10, 2) not null default 149 check (slot_price_phone >= 0),
  add column if not exists stats_reset_at timestamptz;

create table if not exists public.device_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.device_kind not null,
  qty int not null default 1 check (qty between 1 and 5),
  amount numeric(10, 2) not null check (amount >= 0),
  method text not null default '',
  reference_no text not null default '',
  proof_path text,
  status public.purchase_status not null default 'pending',
  reject_reason text not null default '',
  note_to_buyer text not null default '',
  receipt_no text unique,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null
);
create index if not exists device_orders_user on public.device_orders (user_id, created_at desc);
alter table public.device_orders enable row level security;
create policy device_orders_read on public.device_orders for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy device_orders_insert on public.device_orders for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and receipt_no is null and decided_by is null
              and confirmed_at is null and reject_reason = '' and note_to_buyer = ''
              and (select slot_sales from public.settings where id = 1));
create policy device_orders_admin on public.device_orders for all to authenticated using (public.is_admin()) with check (public.is_admin());
alter publication supabase_realtime add table public.device_orders;

-- Confirming adds the slots on top of the buyer's current limit and issues the next receipt number
-- (same numbering as file receipts, so numbers never repeat).
create or replace function public.confirm_device_order(p_id uuid, p_note text default '')
returns public.device_orders language plpgsql security definer set search_path = public as $$
declare s record; r public.device_orders;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into s from public.settings where id = 1 for update;
  update public.device_orders
     set status = 'confirmed', confirmed_at = now(), decided_by = auth.uid(), note_to_buyer = coalesce(p_note, ''),
         receipt_no = s.receipt_prefix || lpad(s.receipt_next::text, 6, '0'), reject_reason = ''
   where id = p_id and status = 'pending' returning * into r;
  if r.id is null then raise exception 'order is not pending'; end if;
  update public.settings set receipt_next = receipt_next + 1 where id = 1;
  if r.kind = 'computer' then
    update public.profiles set computer_slots = coalesce(computer_slots, s.computer_slots) + r.qty where id = r.user_id;
  else
    update public.profiles set phone_slots = coalesce(phone_slots, s.phone_slots) + r.qty where id = r.user_id;
  end if;
  return r;
end $$;

create or replace function public.reject_device_order(p_id uuid, p_reason text, p_note text default '')
returns public.device_orders language plpgsql security definer set search_path = public as $$
declare r public.device_orders;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.device_orders set status = 'rejected', reject_reason = coalesce(p_reason, ''), note_to_buyer = coalesce(p_note, ''),
         decided_by = auth.uid(), confirmed_at = null
   where id = p_id and status = 'pending' returning * into r;
  if r.id is null then raise exception 'order is not pending'; end if;
  return r;
end $$;

-- ============================================================ audit log
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,                                   -- null = system (server, migrations)
  actor_email text not null default '',
  actor_role text not null default 'system',    -- admin | client | system
  action text not null,                         -- e.g. purchases.update, sign_in, open_file
  entity text not null default '',              -- table name for data changes
  entity_id text not null default '',
  subject_user uuid,                            -- whose account it concerns
  summary text not null default '',
  before jsonb,
  after jsonb,
  revert_of bigint references public.audit_log (id) on delete set null,
  reverted_at timestamptz,
  reverted_by uuid
);
create index if not exists audit_log_at on public.audit_log (at desc);
create index if not exists audit_log_subject on public.audit_log (subject_user, at desc);
create index if not exists audit_log_actor on public.audit_log (actor, at desc);
alter table public.audit_log enable row level security;
create policy audit_log_admin_read on public.audit_log for select to authenticated using (public.is_admin());
-- no insert/update/delete policies: rows are written only by the functions below

create or replace function public.audit_actor(out uid uuid, out email text, out role text)
language plpgsql stable security definer set search_path = public as $$
begin
  uid := auth.uid();
  if uid is null then email := ''; role := 'system'; return; end if;
  select p.email, case when p.role = 'admin' then 'admin' else 'client' end into email, role from public.profiles p where p.id = uid;
  email := coalesce(email, ''); role := coalesce(role, 'client');
end $$;

-- columns whose change alone isn't worth a log line
create or replace function public.audit_noise(t text) returns text[] language sql immutable as $$
  select case t
    when 'devices' then array['last_seen', 'label', 'platform']
    when 'settings' then array['updated_at', 'receipt_next']
    else array['updated_at'] end;
$$;

create or replace function public.audit_summary(t text, op text, o jsonb, n jsonb) returns text language sql immutable as $$
  select case
    when t = 'purchases' and op = 'INSERT' then 'Submitted a payment of ₱' || (n ->> 'amount')
    when t = 'purchases' and op = 'UPDATE' and (n ->> 'status') is distinct from (o ->> 'status') then
      case n ->> 'status' when 'confirmed' then 'Confirmed payment ' || coalesce(n ->> 'receipt_no', '')
                          when 'rejected' then 'Rejected payment: ' || coalesce(n ->> 'reject_reason', '')
                          else 'Payment set to ' || (n ->> 'status') end
    when t = 'device_orders' and op = 'INSERT' then 'Requested ' || (n ->> 'qty') || ' extra ' || (n ->> 'kind') || ' slot(s)'
    when t = 'device_orders' and op = 'UPDATE' and (n ->> 'status') is distinct from (o ->> 'status') then
      initcap(n ->> 'status') || ' device slot order' || coalesce(' ' || (n ->> 'receipt_no'), '')
    when t = 'files' and op = 'INSERT' then 'Uploaded "' || (n ->> 'name') || '"'
    when t = 'files' and op = 'DELETE' then 'Deleted "' || (o ->> 'name') || '"'
    when t = 'files' then 'Edited "' || (n ->> 'name') || '"'
    when t = 'profiles' and op = 'DELETE' then 'Deleted account ' || (o ->> 'email')
    when t = 'profiles' and (n ->> 'role') is distinct from (o ->> 'role') then 'Role changed to ' || (n ->> 'role')
    when t = 'profiles' and (n ->> 'suspended') is distinct from (o ->> 'suspended') then
      case when (n ->> 'suspended')::boolean then 'Suspended ' else 'Reactivated ' end || (n ->> 'email')
    when t = 'profiles' then 'Updated profile ' || (n ->> 'email')
    when t = 'settings' and (n ->> 'stats_reset_at') is distinct from (o ->> 'stats_reset_at') then 'Reset dashboard statistics'
    when t = 'settings' then 'Changed settings'
    when t = 'devices' and op = 'INSERT' then 'Added ' || (n ->> 'kind') || ': ' || (n ->> 'label')
    when t = 'devices' and op = 'DELETE' then 'Removed ' || (o ->> 'kind') || ': ' || (o ->> 'label')
    when t = 'admin_allowlist' and op = 'INSERT' then 'Added admin email ' || (n ->> 'email')
    when t = 'admin_allowlist' and op = 'DELETE' then 'Removed admin email ' || (o ->> 'email')
    else initcap(lower(op)) || ' ' || t end;
$$;

create or replace function public.audit_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  pk text := case when tg_table_name = 'admin_allowlist' then 'email' else 'id' end;
  a record;
  subj uuid;
begin
  if tg_op = 'UPDATE' and (o - public.audit_noise(tg_table_name)) = (n - public.audit_noise(tg_table_name)) then
    return new;
  end if;
  select * into a from public.audit_actor();
  subj := case tg_table_name when 'profiles' then coalesce(n, o) ->> 'id'
                             when 'purchases' then coalesce(n, o) ->> 'user_id'
                             when 'devices' then coalesce(n, o) ->> 'user_id'
                             when 'device_orders' then coalesce(n, o) ->> 'user_id' end;
  insert into public.audit_log (actor, actor_email, actor_role, action, entity, entity_id, subject_user, summary, before, after, revert_of)
  values (a.uid, a.email, a.role, tg_table_name || '.' || lower(tg_op), tg_table_name, coalesce(n, o) ->> pk, subj,
          public.audit_summary(tg_table_name, tg_op, o, n), o, n, nullif(current_setting('app.revert_of', true), '')::bigint);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'files', 'purchases', 'devices', 'settings', 'admin_allowlist', 'device_orders'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.audit_change()', t);
  end loop;
end $$;

-- Events that aren't data changes (sign-ins). Clients may only log these, at most once a minute each.
create or replace function public.log_event(p_action text, p_detail text default '')
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if auth.uid() is null or p_action not in ('sign_in', 'sign_out') then return; end if;
  if exists (select 1 from public.audit_log where actor = auth.uid() and action = p_action and at > now() - interval '1 minute') then return; end if;
  select * into a from public.audit_actor();
  insert into public.audit_log (actor, actor_email, actor_role, action, subject_user, summary)
  values (a.uid, a.email, a.role, p_action, a.uid, case p_action when 'sign_in' then 'Signed in' else 'Signed out' end || coalesce(nullif(' · ' || left(p_detail, 80), ' · '), ''));
end $$;
revoke execute on function public.log_event(text, text) from public, anon;
grant execute on function public.log_event(text, text) to authenticated;

-- Undo a logged change: an update gets its old values back, an insert is removed, a delete is restored.
create or replace function public.admin_revert(p_log bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.audit_log;
  pk text;
  cols text;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into l from public.audit_log where id = p_log for update;
  if l.id is null then raise exception 'log entry not found'; end if;
  if l.reverted_at is not null then raise exception 'already reverted'; end if;
  if l.entity not in ('files', 'purchases', 'settings', 'profiles', 'devices', 'admin_allowlist', 'device_orders') then
    raise exception 'this entry can''t be reverted';
  end if;
  if l.entity = 'profiles' and l.action = 'profiles.delete' then raise exception 'deleted accounts can''t be restored'; end if;
  pk := case when l.entity = 'admin_allowlist' then 'email' else 'id' end;
  perform set_config('app.revert_of', p_log::text, true);
  if l.action like '%.update' then
    select string_agg(format('%I = r.%I', k, k), ', ') into cols
      from jsonb_object_keys(l.before) k
     where k not in ('id', 'created_at') and (l.before -> k) is distinct from (l.after -> k);
    if cols is null then raise exception 'nothing to revert'; end if;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.%I::text = $2', l.entity, cols, l.entity, pk)
      using l.before, l.entity_id;
  elsif l.action like '%.insert' then
    execute format('delete from public.%I where %I::text = $1', l.entity, pk) using l.entity_id;
  elsif l.action like '%.delete' then
    execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', l.entity, l.entity) using l.before;
  end if;
  update public.audit_log set reverted_at = now(), reverted_by = auth.uid() where id = p_log;
  perform set_config('app.revert_of', '', true);
end $$;

-- Edit any field of a record directly (logged like every other change).
create or replace function public.admin_edit(p_entity text, p_id text, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cols text; pk text := case when p_entity = 'admin_allowlist' then 'email' else 'id' end;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_entity not in ('files', 'purchases', 'settings', 'profiles', 'device_orders') then raise exception 'not editable'; end if;
  select string_agg(format('%I = r.%I', k, k), ', ') into cols from jsonb_object_keys(p_patch) k where k not in ('id', 'created_at');
  if cols is null then return; end if;
  execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.%I::text = $2', p_entity, cols, p_entity, pk)
    using p_patch, p_id;
end $$;

-- ============================================================ statistics
create table if not exists public.monthly_stats (
  month date primary key,
  revenue numeric(12, 2) not null default 0,
  sales int not null default 0,
  slot_revenue numeric(12, 2) not null default 0,
  slot_sales int not null default 0,
  new_users int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.monthly_stats enable row level security;
create policy monthly_stats_admin on public.monthly_stats for select to authenticated using (public.is_admin());

-- Records every month's totals; numbers only ever grow, so a reset (or deleted data) never shrinks history.
create or replace function public.snapshot_monthly_stats()
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.monthly_stats as m (month, revenue, sales, slot_revenue, slot_sales, new_users)
  select mo, coalesce(f.rev, 0), coalesce(f.n, 0), coalesce(d.rev, 0), coalesce(d.n, 0), coalesce(u.n, 0)
  from (select distinct date_trunc('month', x)::date mo from (
          select confirmed_at x from public.purchases where status = 'confirmed' and confirmed_at is not null
          union all select confirmed_at from public.device_orders where status = 'confirmed' and confirmed_at is not null
          union all select created_at from public.profiles where role = 'client'
          union all select now()) s) months
  left join (select date_trunc('month', confirmed_at)::date mo, sum(amount) rev, count(*) n from public.purchases
             where status = 'confirmed' and method <> 'Granted by admin' group by 1) f using (mo)
  left join (select date_trunc('month', confirmed_at)::date mo, sum(amount) rev, count(*) n from public.device_orders where status = 'confirmed' group by 1) d using (mo)
  left join (select date_trunc('month', created_at)::date mo, count(*) n from public.profiles where role = 'client' group by 1) u using (mo)
  on conflict (month) do update set
    revenue = greatest(m.revenue, excluded.revenue), sales = greatest(m.sales, excluded.sales),
    slot_revenue = greatest(m.slot_revenue, excluded.slot_revenue), slot_sales = greatest(m.slot_sales, excluded.slot_sales),
    new_users = greatest(m.new_users, excluded.new_users), updated_at = now();
end $$;
revoke execute on function public.snapshot_monthly_stats() from public, anon, authenticated;

create or replace function public.admin_monthly_stats(p_months int default 24)
returns setof public.monthly_stats language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  perform public.snapshot_monthly_stats();
  return query select * from public.monthly_stats order by month desc limit greatest(1, least(p_months, 120));
end $$;

-- Dashboard counters start from the reset point; the monthly history is snapshotted first.
create or replace function public.admin_reset_stats()
returns timestamptz language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  perform public.snapshot_monthly_stats();
  update public.settings set stats_reset_at = t where id = 1;
  return t;
end $$;

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := coalesce((select stats_reset_at from public.settings where id = 1), '-infinity'::timestamptz);
  m0 timestamptz := greatest(date_trunc('month', now()), since);
  m1 timestamptz := greatest(date_trunc('month', now()) - interval '1 month', since);
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'since', nullif(since, '-infinity'::timestamptz),
    'revenue_month', (select coalesce(sum(amount), 0) from public.purchases where status = 'confirmed' and confirmed_at >= m0)
                   + (select coalesce(sum(amount), 0) from public.device_orders where status = 'confirmed' and confirmed_at >= m0),
    'revenue_last_month', (select coalesce(sum(amount), 0) from public.purchases where status = 'confirmed'
        and confirmed_at >= m1 and confirmed_at < date_trunc('month', now()))
      + (select coalesce(sum(amount), 0) from public.device_orders where status = 'confirmed'
        and confirmed_at >= m1 and confirmed_at < date_trunc('month', now())),
    'pending', (select count(*) from public.purchases where status = 'pending') + (select count(*) from public.device_orders where status = 'pending'),
    'oldest_pending', (select min(x) from (select min(created_at) x from public.purchases where status = 'pending'
                                           union all select min(created_at) from public.device_orders where status = 'pending') o),
    'users', (select count(*) from public.profiles where role = 'client'),
    'users_week', (select count(*) from public.profiles where role = 'client' and created_at > greatest(now() - interval '7 days', since)),
    'files', (select count(*) from public.files),
    'files_by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}') from (select kind, count(*) n from public.files group by kind) k),
    'top', (select coalesce(jsonb_agg(t), '[]') from (
        select f.id, f.name, f.cover_path, count(p.*) sold from public.files f
        join public.purchases p on p.file_id = f.id and p.status = 'confirmed' and p.confirmed_at >= since
        group by f.id order by sold desc limit 5) t)
  );
end $$;
