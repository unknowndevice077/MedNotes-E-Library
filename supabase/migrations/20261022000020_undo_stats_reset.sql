-- Undo the latest dashboard reset: the counters go back to where they were counting from.
-- Nothing is deleted by a reset, so this loses nothing; the reset stays listed as undone.
alter table public.stats_resets add column if not exists undone_at timestamptz;
alter table public.stats_resets add column if not exists undone_by uuid references public.profiles (id) on delete set null;

create or replace function public.admin_undo_reset(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r public.stats_resets;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into r from public.stats_resets where id = p_id for update;
  if r.id is null then raise exception 'reset not found'; end if;
  if r.undone_at is not null then raise exception 'already undone'; end if;
  -- only the active reset can be undone, or the counters would jump to an odd point
  if (select stats_reset_at from public.settings where id = 1) is distinct from r.at then
    raise exception 'only the latest reset can be undone';
  end if;
  update public.settings set stats_reset_at = r.since where id = 1;
  update public.stats_resets set undone_at = now(), undone_by = auth.uid() where id = p_id;
end $$;
revoke execute on function public.admin_undo_reset(bigint) from public, anon;
grant execute on function public.admin_undo_reset(bigint) to authenticated;
