-- GCash QR payments + admin allow-list.

-- Public bucket for payment QR images (buyers scan them at checkout); only admins upload.
insert into storage.buckets (id, name, public) values ('payment-qr', 'payment-qr', true) on conflict (id) do nothing;
create policy payment_qr_read on storage.objects for select using (bucket_id = 'payment-qr');
create policy payment_qr_admin on storage.objects for all to authenticated
  using (bucket_id = 'payment-qr' and public.is_admin()) with check (bucket_id = 'payment-qr' and public.is_admin());

-- GCash is the payment method; Maya and bank transfer stay available but switched off.
-- qr_path points into the payment-qr bucket (a demo QR until the publisher uploads the real one).
alter table public.settings alter column payment_methods set default '[
  {"name": "GCash", "account": "0917 123 4567", "holder": "MedNotes Publishing", "enabled": true, "qr_path": "gcash-demo.png"},
  {"name": "Maya", "account": "0918 765 4321", "holder": "MedNotes Publishing", "enabled": false},
  {"name": "BDO bank transfer", "account": "0012 3456 7890", "holder": "MedNotes Publishing", "enabled": false}
]'::jsonb;
update public.settings set payment_methods = (
  select jsonb_agg(case
    when m ->> 'name' = 'GCash' then m || jsonb_build_object('enabled', true, 'qr_path', coalesce(m ->> 'qr_path', 'gcash-demo.png'))
    else m || jsonb_build_object('enabled', false) end)
  from jsonb_array_elements(payment_methods) m)
where id = 1;

-- Emails listed here become admins automatically when they sign up (or immediately, if they already have).
alter table public.settings add column if not exists admin_emails text[] not null default '{}';

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
    case when lower(coalesce(new.email, '')) = any (select lower(e) from public.settings, unnest(admin_emails) e) then 'admin'::public.app_role else 'client'::public.app_role end
  );
  return new;
end $$;

-- Adding an email to the list also promotes an existing account with that email.
create or replace function public.apply_admin_emails() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set role = 'admin'
   where role <> 'admin' and lower(email) = any (select lower(e) from unnest(new.admin_emails) e);
  return new;
end $$;
drop trigger if exists apply_admin_emails on public.settings;
create trigger apply_admin_emails after insert or update of admin_emails on public.settings
  for each row execute function public.apply_admin_emails();
