import { Preferences } from '@capacitor/preferences';
import { supabase } from './supabase';
import { deviceKind, deviceLabel, isNative, platformName } from './platform';

const KEY = 'mn.device_id';

/** A random id created once per browser / app install. */
export async function deviceId(): Promise<string> {
  const stored = isNative ? (await Preferences.get({ key: KEY })).value : localStorage.getItem(KEY);
  if (stored) return stored;
  const id = crypto.randomUUID();
  if (isNative) await Preferences.set({ key: KEY, value: id });
  else localStorage.setItem(KEY, id);
  return id;
}

export type DeviceCheck =
  | { ok: true }
  | { ok: false; reason: 'limit'; devices: { id: string; label: string; last_seen: string }[] }
  | { ok: false; reason: 'suspended' | 'locked' | 'swaps' | 'not_found' | 'error'; message?: string };

export async function registerDevice(): Promise<DeviceCheck> {
  const { data, error } = await supabase.rpc('register_device', {
    p_device_id: await deviceId(), p_kind: deviceKind(), p_label: deviceLabel(), p_platform: platformName,
  });
  if (error) return { ok: false, reason: 'error', message: error.message };
  return data as DeviceCheck;
}

export async function swapDevice(oldId: string): Promise<DeviceCheck> {
  const { data, error } = await supabase.rpc('swap_device', {
    p_old: oldId, p_device_id: await deviceId(), p_kind: deviceKind(), p_label: deviceLabel(), p_platform: platformName,
  });
  if (error) return { ok: false, reason: 'error', message: error.message };
  return data as DeviceCheck;
}

export const deviceReasonText: Record<string, string> = {
  suspended: 'Your account is suspended. Contact the publisher.',
  locked: 'New devices are locked on your account. Ask the publisher to add this device.',
  swaps: "You've used all your device swaps for this month. Ask the publisher to reset your devices.",
  not_found: 'That device was already removed. Try again.',
};
