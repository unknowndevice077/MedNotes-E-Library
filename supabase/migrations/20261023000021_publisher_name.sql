-- The publisher shown on every file ("by …") and receipt is the store, not a person.
update public.settings set publisher_name = 'MedNotes Publishing'
 where publisher_name is null or publisher_name = '' or publisher_name ilike '%dela cruz%' or publisher_name ilike '%fritz%';
update public.settings set receipt_business = 'MedNotes Publishing'
 where receipt_business ilike '%dela cruz%' or receipt_business ilike '%fritz%';
