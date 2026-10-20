import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { App as CapApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Network } from '@capacitor/network';
import { Preferences } from '@capacitor/preferences';
import { supabase, NATIVE_REDIRECT } from './supabase';
import { registerDevice, type DeviceCheck } from './device';
import { appUrl, isNative } from './platform';
import { markVerified, pruneSaved } from './offline';
import type { Profile, Settings } from './types';
import { clearLoadCache } from './useLoad';

interface AuthState {
  loading: boolean;
  online: boolean;
  session: Session | null;
  profile: Profile | null;
  settings: Settings | null;
  device: DeviceCheck | null;
  refresh: () => Promise<void>;
  recheckDevice: () => Promise<void>;
  signOut: () => Promise<void>;
  signInWithProvider: (p: 'google' | 'facebook') => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const SETTINGS_CACHE = 'mn.settings';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [device, setDevice] = useState<DeviceCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);

  // The user whose profile is loaded. supabase-js re-emits SIGNED_IN / TOKEN_REFRESHED when the tab
  // wakes up or the token renews; for the same user that must not blank the app and refetch everything.
  const userRef = useRef<string | null>(null);
  const load = useCallback(async (s: Session | null, { quiet = false } = {}) => {
    if (!s) { userRef.current = null; clearLoadCache(); setSession(null); setProfile(null); setDevice(null); setLoading(false); return; }
    if (userRef.current !== s.user.id) clearLoadCache();
    userRef.current = s.user.id;
    // hold routing until the profile (role) is known, so admins land on the dashboard
    if (!quiet) setLoading(true);
    setSession(s);
    const [p, st] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', s.user.id).single(),
      supabase.from('settings').select('*').eq('id', 1).single(),
    ]);
    if (p.error && isNative) {
      // offline in the app: keep the cached session and settings so saved files still open
      const cached = (await Preferences.get({ key: SETTINGS_CACHE })).value;
      if (cached) setSettings(JSON.parse(cached));
      setLoading(false);
      return;
    }
    setProfile(p.data as Profile | null);
    if (st.data) {
      setSettings(st.data as Settings);
      if (isNative) await Preferences.set({ key: SETTINGS_CACHE, value: JSON.stringify(st.data) });
    }
    setDevice(await registerDevice());
    if (isNative) {
      // online license check for saved files
      const { data } = await supabase.from('purchases').select('file_id').eq('user_id', s.user.id).eq('status', 'confirmed');
      if (data) { await pruneSaved(new Set(data.map((r) => r.file_id))); await markVerified(); }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // INITIAL_SESSION covers the first load, so there is no separate getSession() call.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // run outside the auth callback (supabase-js deadlocks if we await its client inside it)
      setTimeout(() => {
        if (event === 'SIGNED_OUT' || !s) return load(null);
        if (event === 'INITIAL_SESSION' || s.user.id !== userRef.current) return load(s);
        if (event === 'USER_UPDATED') return load(s, { quiet: true });
        setSession(s); // TOKEN_REFRESHED, or SIGNED_IN again for the same user on tab focus
      }, 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  // Android: OAuth comes back through the com.mednotes.elibrary:// deep link
  useEffect(() => {
    if (!isNative) return;
    const h = CapApp.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith(NATIVE_REDIRECT)) return;
      const code = new URL(url.replace('com.mednotes.elibrary://', 'https://x/')).searchParams.get('code');
      if (code) await supabase.auth.exchangeCodeForSession(code);
      await Browser.close().catch(() => undefined);
    });
    Network.getStatus().then((s) => setOnline(s.connected));
    const n = Network.addListener('networkStatusChange', (s) => setOnline(s.connected));
    return () => { h.then((x) => x.remove()); n.then((x) => x.remove()); };
  }, []);

  useEffect(() => {
    if (isNative) return;
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on); window.addEventListener('offline', on);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on); };
  }, []);

  const value = useMemo<AuthState>(() => ({
    loading, online, session, profile, settings, device,
    refresh: async () => { const { data } = await supabase.auth.getSession(); await load(data.session, { quiet: true }); },
    recheckDevice: async () => setDevice(await registerDevice()),
    signOut: async () => { await supabase.auth.signOut(); },
    signInWithProvider: async (provider) => {
      if (isNative) {
        const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true } });
        if (error) throw error;
        if (data.url) await Browser.open({ url: data.url });
      } else {
        const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: appUrl() } });
        if (error) throw error;
      }
    },
  }), [loading, online, session, profile, settings, device, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
