-- Buyers get live status updates on My files when the publisher confirms or rejects a payment.
alter publication supabase_realtime add table public.purchases;
