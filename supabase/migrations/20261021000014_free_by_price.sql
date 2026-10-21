-- A file is a free sample when its price is ₱0; there is no separate "Free samples" category.
create or replace function public.files_free_by_price()
returns trigger language plpgsql as $$
begin
  new.is_free := coalesce(new.price, 0) = 0;
  return new;
end $$;
drop trigger if exists files_free_by_price on public.files;
create trigger files_free_by_price before insert or update of price, is_free on public.files
  for each row execute function public.files_free_by_price();
update public.files set is_free = (price = 0) where is_free is distinct from (price = 0);

-- the five demo samples go back under their real subjects
update public.files set label = 'Anatomy' where id = 'a0000000-0000-0000-0000-000000000019' and label = 'Free samples';
update public.files set label = 'Microbiology' where id = 'a0000000-0000-0000-0000-000000000020' and label = 'Free samples';
update public.files set label = 'Pharmacology' where id = 'a0000000-0000-0000-0000-000000000021' and label = 'Free samples';
update public.files set label = 'Pathology' where id = 'a0000000-0000-0000-0000-000000000022' and label = 'Free samples';
update public.files set label = 'Clinical' where id = 'a0000000-0000-0000-0000-000000000023' and label = 'Free samples';
