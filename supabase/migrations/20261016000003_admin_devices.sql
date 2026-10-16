-- Admins (publisher staff) are not bound by the buyer device limit; their devices are still listed.
create or replace function public.register_device(p_device_id text, p_kind public.device_kind, p_label text, p_platform text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  lim record;
  used int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into lim from public.effective_limits(uid);
  if lim.suspended then return jsonb_build_object('ok', false, 'reason', 'suspended'); end if;

  update public.devices set last_seen = now(), label = p_label, platform = p_platform
    where user_id = uid and device_id = p_device_id;
  if found then return jsonb_build_object('ok', true); end if;

  if public.is_admin() then
    insert into public.devices (user_id, device_id, kind, label, platform) values (uid, p_device_id, p_kind, p_label, p_platform);
    return jsonb_build_object('ok', true);
  end if;

  select count(*) into used from public.devices where user_id = uid and kind = p_kind;
  if used < (case when p_kind = 'computer' then lim.computer_slots else lim.phone_slots end) then
    if not lim.can_add then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
    insert into public.devices (user_id, device_id, kind, label, platform) values (uid, p_device_id, p_kind, p_label, p_platform);
    insert into public.device_events (user_id, kind, action) values (uid, p_kind, 'added');
    return jsonb_build_object('ok', true);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'limit', 'devices',
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'last_seen', last_seen) order by last_seen desc), '[]')
       from public.devices where user_id = uid and kind = p_kind));
end $$;
