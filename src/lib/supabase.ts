import { createClient } from '@supabase/supabase-js';
import { Preferences } from '@capacitor/preferences';
import { isNative } from './platform';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!url || !anonKey) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see .env.example)');

const REMEMBER = 'mn.remember';

/** "Keep me signed in": on web the session lives in localStorage (survives restarts) or sessionStorage (ends with the tab). */
export function setRememberMe(on: boolean) {
  localStorage.setItem(REMEMBER, on ? '1' : '0');
}
const remember = () => localStorage.getItem(REMEMBER) !== '0';

const webStorage = {
  getItem: (k: string) => localStorage.getItem(k) ?? sessionStorage.getItem(k),
  setItem: (k: string, v: string) => {
    if (remember()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
    else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
  },
  removeItem: (k: string) => { localStorage.removeItem(k); sessionStorage.removeItem(k); },
};

// The app always stays signed in (one-time sign-in), stored in native preferences.
const nativeStorage = {
  getItem: async (k: string) => (await Preferences.get({ key: k })).value,
  setItem: (k: string, v: string) => Preferences.set({ key: k, value: v }),
  removeItem: (k: string) => Preferences.remove({ key: k }),
};

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: isNative ? nativeStorage : webStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: !isNative,
    flowType: 'pkce',
  },
});

export const NATIVE_REDIRECT = 'com.mednotes.elibrary://auth-callback';
export const coverUrl = (path?: string | null) =>
  path ? supabase.storage.from('covers').getPublicUrl(path).data.publicUrl : '/logo.png';
export const paymentQrUrl = (path?: string | null) =>
  path ? supabase.storage.from('payment-qr').getPublicUrl(path).data.publicUrl : null;
