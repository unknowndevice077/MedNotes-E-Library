-- Reader notes + drawings (per buyer, per file) and where the publisher watermark shows.

-- Watermark on the website too, or only in the Android app (the default: on the web it's too distracting).
alter table public.settings
  add column if not exists watermark_web boolean not null default false;

-- What a buyer writes and draws while reading. Only ever visible to that buyer.
create table if not exists public.reader_notes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  body text not null default '' check (length(body) <= 20000),
  -- strokes keyed by page ('p3', 's2', 'img', 'sketch'); points are 0..1 of the page size
  ink jsonb not null default '{}' check (jsonb_typeof(ink) = 'object' and pg_column_size(ink) <= 1500000),
  updated_at timestamptz not null default now(),
  primary key (user_id, file_id)
);

alter table public.reader_notes enable row level security;

drop policy if exists reader_notes_own on public.reader_notes;
create policy reader_notes_own on public.reader_notes for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.reader_notes from anon;
grant select, insert, update, delete on public.reader_notes to authenticated;

-- Buyers no longer type the amount or a reference number (the screenshot is the proof).
-- The amount is always the real price, whatever the browser sends.
create or replace function public.set_payment_amount()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if; -- server jobs and admins set their own
  if tg_table_name = 'purchases' then
    new.amount := (select price from public.files where id = new.file_id);
  else
    new.amount := new.qty * (select case when new.kind = 'computer' then slot_price_computer else slot_price_phone end from public.settings where id = 1);
  end if;
  return new;
end $$;
revoke execute on function public.set_payment_amount() from public, anon, authenticated;

drop trigger if exists set_payment_amount on public.purchases;
create trigger set_payment_amount before insert on public.purchases for each row execute function public.set_payment_amount();
drop trigger if exists set_payment_amount on public.device_orders;
create trigger set_payment_amount before insert on public.device_orders for each row execute function public.set_payment_amount();

-- Rejected payments are resubmitted in place: the same payment goes back to pending with the new
-- screenshot, so a buyer never ends up with two transactions for one purchase. Earlier attempts
-- (screenshot, method, why it was rejected) are kept in `history` for the admin.
alter table public.purchases
  add column if not exists attempts int not null default 1,
  add column if not exists history jsonb not null default '[]';
alter table public.device_orders
  add column if not exists attempts int not null default 1,
  add column if not exists history jsonb not null default '[]';

create or replace function public.resubmit_payment(p_kind text, p_id uuid, p_proof text, p_method text, p_qty int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare done uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  -- the screenshot must be one the buyer uploaded to their own folder
  if p_proof is null or split_part(p_proof, '/', 1) <> auth.uid()::text then raise exception 'upload your screenshot first'; end if;
  if p_kind = 'file' then
    update public.purchases p set
      history = p.history || jsonb_build_array(jsonb_build_object('proof_path', p.proof_path, 'method', p.method, 'amount', p.amount,
                'reject_reason', p.reject_reason, 'note_to_buyer', p.note_to_buyer, 'submitted_at', p.created_at, 'replaced_at', now())),
      proof_path = p_proof, method = coalesce(nullif(p_method, ''), p.method), reference_no = '',
      amount = (select price from public.files f where f.id = p.file_id),
      status = 'pending', reject_reason = '', note_to_buyer = '', decided_by = null, confirmed_at = null,
      attempts = p.attempts + 1, created_at = now()
    where p.id = p_id and p.user_id = auth.uid() and p.status = 'rejected'
    returning p.id into done;
  elsif p_kind = 'slot' then
    if not (select slot_sales from public.settings where id = 1) then raise exception 'extra devices are not for sale'; end if;
    update public.device_orders o set
      history = o.history || jsonb_build_array(jsonb_build_object('proof_path', o.proof_path, 'method', o.method, 'amount', o.amount, 'qty', o.qty,
                'reject_reason', o.reject_reason, 'note_to_buyer', o.note_to_buyer, 'submitted_at', o.created_at, 'replaced_at', now())),
      proof_path = p_proof, method = coalesce(nullif(p_method, ''), o.method), reference_no = '',
      qty = least(5, greatest(1, coalesce(p_qty, o.qty))),
      amount = least(5, greatest(1, coalesce(p_qty, o.qty))) * (select case when o.kind = 'computer' then slot_price_computer else slot_price_phone end from public.settings where id = 1),
      status = 'pending', reject_reason = '', note_to_buyer = '', decided_by = null, confirmed_at = null,
      attempts = o.attempts + 1, created_at = now()
    where o.id = p_id and o.user_id = auth.uid() and o.status = 'rejected'
    returning o.id into done;
  else
    raise exception 'unknown payment kind';
  end if;
  if done is null then raise exception 'this payment can no longer be resubmitted'; end if;
  return done;
end $$;
revoke execute on function public.resubmit_payment(text, uuid, text, text, int) from public, anon;
grant execute on function public.resubmit_payment(text, uuid, text, text, int) to authenticated;

-- Every dashboard reset is kept on the Statistics page: when, who, and what the dashboard had
-- counted since the reset before it.
create table if not exists public.stats_resets (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by uuid references public.profiles (id) on delete set null,
  since timestamptz,
  revenue numeric not null default 0,
  files_sold int not null default 0,
  slot_revenue numeric not null default 0,
  slots_sold int not null default 0,
  new_users int not null default 0
);
alter table public.stats_resets enable row level security;
drop policy if exists stats_resets_admin on public.stats_resets;
create policy stats_resets_admin on public.stats_resets for select to authenticated using (public.is_admin());
revoke all on public.stats_resets from anon;

create or replace function public.admin_reset_stats()
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  t timestamptz := now();
  since timestamptz := (select stats_reset_at from public.settings where id = 1);
  s timestamptz := coalesce(since, '-infinity'::timestamptz);
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  perform public.snapshot_monthly_stats();
  insert into public.stats_resets (at, by, since, revenue, files_sold, slot_revenue, slots_sold, new_users)
  select t, auth.uid(), since,
    (select coalesce(sum(amount), 0) from public.purchases where status = 'confirmed' and confirmed_at >= s),
    (select count(*) from public.purchases where status = 'confirmed' and confirmed_at >= s),
    (select coalesce(sum(amount), 0) from public.device_orders where status = 'confirmed' and confirmed_at >= s),
    (select coalesce(sum(qty), 0) from public.device_orders where status = 'confirmed' and confirmed_at >= s),
    (select count(*) from public.profiles where role = 'client' and created_at >= s);
  update public.settings set stats_reset_at = t where id = 1;
  return t;
end $$;
