-- Admin → Restrictions → Trace a leaked screenshot: the hidden mark in the reader carries the first
-- 6 hex digits of the buyer's id; this finds who that is. Admins only.
create or replace function public.admin_trace_mark(p_prefix text)
returns table (id uuid, full_name text, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_prefix !~ '^[0-9a-f]{6}$' then raise exception 'bad code'; end if;
  return query select p.id, p.full_name, p.email, p.created_at from public.profiles p where p.id::text like p_prefix || '%';
end $$;
revoke execute on function public.admin_trace_mark(text) from public, anon;
grant execute on function public.admin_trace_mark(text) to authenticated;
