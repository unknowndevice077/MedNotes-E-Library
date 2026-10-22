import { supabase } from './supabase';
import { isDesktopApp, isNative } from './platform';
import { SITE_EDIT } from './siteText';

// Google's own sign-in button (Google Identity Services). Google's popup then names this website
// instead of the Supabase address, and Supabase signs the person in with the ID token Google gives us.
// The phone apps and the desktop app keep the normal redirect sign-in: Google's button doesn't work
// inside an app's web view or an app window.
const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
export const googleButtonAvailable = !!CLIENT_ID && !isNative && !isDesktopApp && !SITE_EDIT;

interface Gis {
  accounts: { id: {
    initialize(o: Record<string, unknown>): void;
    renderButton(el: HTMLElement, o: Record<string, unknown>): void;
    cancel(): void;
  } };
}
declare global { interface Window { google?: Gis } }

let script: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  script ??= new Promise<Gis>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('Google sign-in did not load')));
    s.onerror = () => { script = null; reject(new Error('Google sign-in could not load')); };
    document.head.appendChild(s);
  });
  return script;
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Draws Google's button into `el`. A fresh nonce each time, so a token can't be replayed. */
export async function renderGoogleButton(el: HTMLElement, opts: { dark: boolean; onError: (msg: string) => void; onStart: () => void }) {
  const gis = await loadGis();
  const raw = crypto.randomUUID() + crypto.randomUUID();
  gis.accounts.id.initialize({
    client_id: CLIENT_ID,
    nonce: await sha256(raw), // Google gets the hash, Supabase checks it against the raw one
    auto_select: false,
    itp_support: true,
    callback: async ({ credential }: { credential: string }) => {
      opts.onStart();
      const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: credential, nonce: raw });
      if (error) opts.onError(error.message);
    },
  });
  el.replaceChildren();
  gis.accounts.id.renderButton(el, {
    type: 'standard', theme: opts.dark ? 'filled_black' : 'outline', size: 'large', shape: 'pill',
    text: 'continue_with', logo_alignment: 'center', width: Math.min(400, Math.max(200, Math.round(el.clientWidth))),
  });
}
