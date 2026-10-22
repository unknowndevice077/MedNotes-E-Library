-- Hiding a file (draft) takes it out of the library, but buyers who already paid for it keep it:
-- it stays in their My files and opens in the reader, and a payment still waiting shows which file
-- it's for. Everyone else can't see it.
drop policy if exists files_read on public.files;
create policy files_read on public.files for select to authenticated using (
  published or public.is_admin()
  or exists (select 1 from public.purchases p where p.file_id = files.id and p.user_id = auth.uid())
);
