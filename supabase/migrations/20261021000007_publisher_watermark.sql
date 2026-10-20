-- What the publisher puts on every file: their name (watermark + "Published by") and a second
-- watermark line. Empty = the app falls back to the receipt business name / a default line.
alter table public.settings
  add column if not exists publisher_name text not null default '',
  add column if not exists watermark_note text not null default '';

-- Start with the first admin's name, as asked for: the admin is the publisher.
update public.settings s
   set publisher_name = coalesce((select p.full_name from public.profiles p
                                   where p.role = 'admin' and coalesce(p.full_name, '') <> ''
                                   order by p.created_at limit 1), s.receipt_business)
 where s.id = 1 and s.publisher_name = '';
