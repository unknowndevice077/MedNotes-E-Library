-- Public contact details for the privacy / data-deletion pages (readable without signing in).
create or replace function public.public_contact()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('store_name', store_name, 'support_email', support_email, 'business', receipt_business)
  from public.settings where id = 1;
$$;
grant execute on function public.public_contact() to anon, authenticated;

-- Buyers may delete their own proof-of-payment images (used by "Delete my account").
create policy proofs_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);

-- Self-serve account deletion: removes the auth user; profile, purchases, devices cascade.
-- Admins must hand over the admin role first so the store is never left without one.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Admins can''t delete their account here. Ask another admin to remove your admin role first.';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account() from anon;
