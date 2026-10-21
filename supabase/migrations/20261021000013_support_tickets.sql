-- Help & support: buyers open tickets (bug, feedback, payment, account, other) with a star rating
-- and an optional screenshot, talk with the admin in a thread, and rate the help once it's resolved.

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null default 'other' check (kind in ('bug', 'feedback', 'payment', 'account', 'other')),
  subject text not null check (length(trim(subject)) between 3 and 120),
  body text not null check (length(trim(body)) between 3 and 5000),
  rating int check (rating between 1 and 5),             -- how the buyer rates the app (feedback)
  satisfaction int check (satisfaction between 1 and 5), -- how they rate the help, after it's resolved
  attachment_path text,                                  -- screenshot in the private "tickets" bucket
  page text not null default '',                         -- where they were when they opened it
  status text not null default 'open' check (status in ('open', 'answered', 'resolved', 'closed')),
  unread_admin boolean not null default true,
  unread_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tickets_user_idx on public.tickets (user_id, updated_at desc);
create index if not exists tickets_status_idx on public.tickets (status, updated_at desc);

create table if not exists public.ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.tickets (id) on delete cascade,
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  from_admin boolean not null default false,
  body text not null check (length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists ticket_messages_ticket_idx on public.ticket_messages (ticket_id, id);

alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;

drop policy if exists tickets_own_read on public.tickets;
create policy tickets_own_read on public.tickets for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists tickets_own_insert on public.tickets;
create policy tickets_own_insert on public.tickets for insert to authenticated
  with check (user_id = auth.uid() and status = 'open' and satisfaction is null
              and (attachment_path is null or split_part(attachment_path, '/', 1) = auth.uid()::text));
drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists tickets_admin_delete on public.tickets;
create policy tickets_admin_delete on public.tickets for delete to authenticated using (public.is_admin());

drop policy if exists ticket_messages_read on public.ticket_messages;
create policy ticket_messages_read on public.ticket_messages for select to authenticated
  using (public.is_admin() or exists (select 1 from public.tickets t where t.id = ticket_id and t.user_id = auth.uid()));
drop policy if exists ticket_messages_insert on public.ticket_messages;
create policy ticket_messages_insert on public.ticket_messages for insert to authenticated
  with check (author_id = auth.uid() and (
    (public.is_admin() and from_admin)
    or (not from_admin and exists (select 1 from public.tickets t where t.id = ticket_id and t.user_id = auth.uid() and t.status <> 'closed'))));

revoke all on public.tickets, public.ticket_messages from anon;

-- Buyers may only rate the help, close their ticket or reopen it; everything else is the admin's.
create or replace function public.guard_ticket_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    if (to_jsonb(new) - array['satisfaction', 'status', 'unread_user', 'unread_admin', 'updated_at'])
       is distinct from (to_jsonb(old) - array['satisfaction', 'status', 'unread_user', 'unread_admin', 'updated_at']) then
      raise exception 'only the publisher can change that';
    end if;
    if new.status is distinct from old.status and new.status not in ('closed', 'open') then
      raise exception 'only the publisher can change the status';
    end if;
    if new.satisfaction is distinct from old.satisfaction and old.status not in ('resolved', 'closed') and new.status not in ('resolved', 'closed') then
      raise exception 'rate the help once your ticket is resolved';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_ticket_update on public.tickets;
create trigger guard_ticket_update before update on public.tickets for each row execute function public.guard_ticket_update();

-- a new message bumps the ticket and marks it unread for the other side
create or replace function public.on_ticket_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.tickets set
    updated_at = now(),
    unread_admin = case when new.from_admin then unread_admin else true end,
    unread_user = case when new.from_admin then true else unread_user end,
    status = case when new.from_admin and status = 'open' then 'answered'
                  when not new.from_admin and status in ('answered', 'resolved') then 'open' else status end
  where id = new.ticket_id;
  return new;
end $$;
drop trigger if exists on_ticket_message on public.ticket_messages;
create trigger on_ticket_message after insert on public.ticket_messages for each row execute function public.on_ticket_message();

-- screenshots: private bucket, each buyer writes in their own folder; admins read all
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tickets', 'tickets', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists tickets_files_insert on storage.objects;
create policy tickets_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tickets' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists tickets_files_read on storage.objects;
create policy tickets_files_read on storage.objects for select to authenticated
  using (bucket_id = 'tickets' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists tickets_files_delete on storage.objects;
create policy tickets_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tickets' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- live: replies show up without refreshing; tickets are in the activity log like everything else
alter publication supabase_realtime add table public.tickets;
alter publication supabase_realtime add table public.ticket_messages;
drop trigger if exists audit_tickets on public.tickets;
create trigger audit_tickets after insert or update or delete on public.tickets for each row execute function public.audit_change();

-- read/unread flags flip on every message; they're not worth an activity-log row
create or replace function public.audit_noise(t text) returns text[] language sql immutable as $$
  select case t
    when 'devices' then array['last_seen', 'label', 'platform']
    when 'settings' then array['updated_at', 'receipt_next']
    when 'tickets' then array['updated_at', 'unread_admin', 'unread_user']
    else array['updated_at'] end;
$$;
