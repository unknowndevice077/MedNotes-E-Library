-- Statistics for any date range (today, last 7 days, this month, custom ...), plus a CSV-ready list of sales.
-- Money counts the way an accountant would: confirmed paid sales (not access granted by an admin),
-- minus payments that were revoked afterwards (those come from the audit log, since revoking deletes the row).

-- a payment row deleted on purpose (Revoke), not swept away because its account or file was deleted
create or replace function public.is_revoke(a public.audit_log) returns boolean language sql stable set search_path = public as $$
  select a.action in ('purchases.delete', 'device_orders.delete')
     and a.before ->> 'status' = 'confirmed' and coalesce(a.before ->> 'method', '') <> 'Granted by admin'
     and a.reverted_at is null
     and not exists (select 1 from public.audit_log b where b.at = a.at and (
           (b.action = 'profiles.delete' and b.entity_id = a.before ->> 'user_id')
        or (b.action = 'files.delete' and b.entity_id = a.before ->> 'file_id')))
$$;

create or replace function public.admin_range_stats(p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  with sales as (
    select p.user_id, p.amount, p.created_at, p.confirmed_at, 'file'::text kind, p.file_id
      from public.purchases p
     where p.status = 'confirmed' and p.method <> 'Granted by admin' and p.confirmed_at >= p_from and p.confirmed_at < p_to
    union all
    select d.user_id, d.amount, d.created_at, d.confirmed_at, 'slot', null
      from public.device_orders d
     where d.status = 'confirmed' and d.confirmed_at >= p_from and d.confirmed_at < p_to
  ),
  lifetime as ( -- paid orders per buyer up to the end of the range, to spot returning buyers
    select user_id, count(*) n from (
      select user_id from public.purchases where status = 'confirmed' and method <> 'Granted by admin' and confirmed_at < p_to
      union all select user_id from public.device_orders where status = 'confirmed' and confirmed_at < p_to) x
    group by user_id
  ),
  submitted as (
    select status, created_at, confirmed_at from public.purchases where method <> 'Granted by admin' and created_at >= p_from and created_at < p_to
    union all select status, created_at, confirmed_at from public.device_orders where created_at >= p_from and created_at < p_to
  ),
  revoked as (
    select (a.before ->> 'amount')::numeric amount from public.audit_log a
     where a.at >= p_from and a.at < p_to and public.is_revoke(a)
  )
  select jsonb_build_object(
    'revenue', (select coalesce(sum(amount), 0) from sales),
    'file_revenue', (select coalesce(sum(amount), 0) from sales where kind = 'file'),
    'slot_revenue', (select coalesce(sum(amount), 0) from sales where kind = 'slot'),
    'orders', (select count(*) from sales),
    'files_sold', (select count(*) from sales where kind = 'file'),
    'slots_sold', (select count(*) from sales where kind = 'slot'),
    'buyers', (select count(distinct user_id) from sales),
    'returning_buyers', (select count(*) from (select distinct user_id from sales) b join lifetime l using (user_id) where l.n >= 2),
    'new_users', (select count(*) from public.profiles where role = 'client' and created_at >= p_from and created_at < p_to),
    'revoked_count', (select count(*) from revoked),
    'revoked_amount', (select coalesce(sum(amount), 0) from revoked),
    'submitted', (select count(*) from submitted),
    'confirmed', (select count(*) from submitted where status = 'confirmed'),
    'rejected', (select count(*) from submitted where status = 'rejected'),
    'pending', (select count(*) from submitted where status = 'pending'),
    'avg_confirm_hours', (select round((extract(epoch from avg(confirmed_at - created_at)) / 3600)::numeric, 3) from sales),
    'by_category', (select coalesce(jsonb_agg(c order by c.revenue desc), '[]') from (
        select coalesce(nullif(f.label, ''), 'Uncategorised') label, sum(s.amount) revenue, count(*) sold
          from sales s join public.files f on f.id = s.file_id group by 1) c),
    'by_file', (select coalesce(jsonb_agg(t order by t.revenue desc, t.sold desc), '[]') from (
        select f.id, f.name, f.label, sum(s.amount) revenue, count(*) sold
          from sales s join public.files f on f.id = s.file_id group by f.id) t),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'revenue', coalesce(x.rev, 0)) order by d.day), '[]') from (
        select generate_series((p_from at time zone 'Asia/Manila')::date, ((p_to - interval '1 second') at time zone 'Asia/Manila')::date, interval '1 day')::date as day) d
        left join (select (confirmed_at at time zone 'Asia/Manila')::date as day, sum(amount) rev from sales group by 1) x on x.day = d.day)
  ) into r;
  return r;
end $$;
revoke execute on function public.admin_range_stats(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_range_stats(timestamptz, timestamptz) to authenticated;

-- One line per sale for the accountant (CSV export); revoked payments come back as negative lines.
create or replace function public.admin_sales_export(p_from timestamptz, p_to timestamptz)
returns table (at timestamptz, receipt_no text, buyer text, email text, item text, category text, method text, amount numeric, note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  return query
  select * from (
    select p.confirmed_at, p.receipt_no, pr.full_name, pr.email, f.name, f.label, p.method, p.amount, ''::text
      from public.purchases p join public.profiles pr on pr.id = p.user_id join public.files f on f.id = p.file_id
     where p.status = 'confirmed' and p.method <> 'Granted by admin' and p.confirmed_at >= p_from and p.confirmed_at < p_to
    union all
    select d.confirmed_at, d.receipt_no, pr.full_name, pr.email, d.qty || ' extra ' || d.kind || ' slot' || case when d.qty > 1 then 's' else '' end,
           'Device slots', d.method, d.amount, ''
      from public.device_orders d join public.profiles pr on pr.id = d.user_id
     where d.status = 'confirmed' and d.confirmed_at >= p_from and d.confirmed_at < p_to
    union all
    select a.at, a.before ->> 'receipt_no', coalesce(pr.full_name, ''), coalesce(pr.email, ''),
           coalesce(f.name, case when a.entity = 'device_orders' then 'Extra device slots' else 'Deleted file' end),
           coalesce(f.label, ''), a.before ->> 'method', -(a.before ->> 'amount')::numeric, 'Revoked'
      from public.audit_log a
      left join public.profiles pr on pr.id = a.subject_user
      left join public.files f on f.id = (a.before ->> 'file_id')::uuid
     where a.at >= p_from and a.at < p_to and public.is_revoke(a)
  ) x order by 1;
end $$;
revoke execute on function public.admin_sales_export(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_sales_export(timestamptz, timestamptz) to authenticated;
