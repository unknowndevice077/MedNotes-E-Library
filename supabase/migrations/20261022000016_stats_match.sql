-- Dashboard and Statistics count revenue the same way:
--  * months are Philippine months (a sale at 7am on Nov 1 in Manila is November, not October)
--  * access granted by an admin isn't revenue anywhere
--  * the current month is always the live total, so it matches the dashboard to the peso
--    (past months still never shrink)

create or replace function public.ph_month(t timestamptz) returns date
language sql immutable as $$ select date_trunc('month', t at time zone 'Asia/Manila')::date $$;

create or replace function public.snapshot_monthly_stats()
returns void language plpgsql security definer set search_path = public as $$
declare cur date := public.ph_month(now());
begin
  insert into public.monthly_stats as m (month, revenue, sales, slot_revenue, slot_sales, new_users)
  select mo, coalesce(f.rev, 0), coalesce(f.n, 0), coalesce(d.rev, 0), coalesce(d.n, 0), coalesce(u.n, 0)
  from (select distinct public.ph_month(x) mo from (
          select confirmed_at x from public.purchases where status = 'confirmed' and confirmed_at is not null
          union all select confirmed_at from public.device_orders where status = 'confirmed' and confirmed_at is not null
          union all select created_at from public.profiles where role = 'client'
          union all select now()) s) months
  left join (select public.ph_month(confirmed_at) mo, sum(amount) rev, count(*) n from public.purchases
             where status = 'confirmed' and method <> 'Granted by admin' group by 1) f using (mo)
  left join (select public.ph_month(confirmed_at) mo, sum(amount) rev, count(*) n from public.device_orders where status = 'confirmed' group by 1) d using (mo)
  left join (select public.ph_month(created_at) mo, count(*) n from public.profiles where role = 'client' group by 1) u using (mo)
  on conflict (month) do update set
    revenue = case when m.month = cur then excluded.revenue else greatest(m.revenue, excluded.revenue) end,
    sales = case when m.month = cur then excluded.sales else greatest(m.sales, excluded.sales) end,
    slot_revenue = case when m.month = cur then excluded.slot_revenue else greatest(m.slot_revenue, excluded.slot_revenue) end,
    slot_sales = case when m.month = cur then excluded.slot_sales else greatest(m.slot_sales, excluded.slot_sales) end,
    new_users = case when m.month = cur then excluded.new_users else greatest(m.new_users, excluded.new_users) end,
    updated_at = now();
end $$;
revoke execute on function public.snapshot_monthly_stats() from public, anon, authenticated;

-- the old rows were bucketed by UTC month; rebuild them by Philippine month
delete from public.monthly_stats;
select public.snapshot_monthly_stats();

create or replace function public.admin_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := coalesce((select stats_reset_at from public.settings where id = 1), '-infinity'::timestamptz);
  start0 timestamptz := (public.ph_month(now())::timestamp) at time zone 'Asia/Manila';
  start1 timestamptz := ((public.ph_month(now()) - interval '1 month')::timestamp) at time zone 'Asia/Manila';
  m0 timestamptz := greatest(start0, since);
  m1 timestamptz := greatest(start1, since);
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'since', nullif(since, '-infinity'::timestamptz),
    'revenue_month', (select coalesce(sum(amount), 0) from public.purchases where status = 'confirmed' and method <> 'Granted by admin' and confirmed_at >= m0)
                   + (select coalesce(sum(amount), 0) from public.device_orders where status = 'confirmed' and confirmed_at >= m0),
    'revenue_last_month', (select coalesce(sum(amount), 0) from public.purchases where status = 'confirmed' and method <> 'Granted by admin'
        and confirmed_at >= m1 and confirmed_at < start0)
      + (select coalesce(sum(amount), 0) from public.device_orders where status = 'confirmed'
        and confirmed_at >= m1 and confirmed_at < start0),
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
