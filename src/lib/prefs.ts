import { useCallback, useEffect } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';
import type { UserPrefs } from './types';

export const DEFAULT_PREFS: Required<UserPrefs> = { readerTheme: 'light', textSize: 17, reduceMotion: false, startPage: 'library', adminDark: false, appTheme: 'light' };

/** The signed-in user's own settings (saved on their profile, so they follow them to every device). */
export function usePrefs() {
  const { profile, patchProfile } = useAuth();
  const prefs = { ...DEFAULT_PREFS, ...(profile?.prefs ?? {}) };
  const save = useCallback(async (patch: Partial<UserPrefs>) => {
    if (!profile) return 'Not signed in';
    const next = { ...(profile.prefs ?? {}), ...patch };
    patchProfile({ prefs: next }); // feels instant; rolled back below if saving fails
    const { error } = await supabase.from('profiles').update({ prefs: next }).eq('id', profile.id);
    if (error) { patchProfile({ prefs: profile.prefs }); return error.message; }
    return null;
  }, [profile, patchProfile]);
  return { prefs, save };
}

/** Applies app-wide preferences (reduced motion) to the page. */
export function useApplyPrefs() {
  const { prefs } = usePrefs();
  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', prefs.reduceMotion); }, [prefs.reduceMotion]);
}
