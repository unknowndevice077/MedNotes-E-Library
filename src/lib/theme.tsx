import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import type { Theme } from './types';

// Site look set in Admin → Appearance (settings.theme). Applied as CSS variables, so every
// page and the Android app pick it up without changing any feature. Read through the public
// get_public_theme() RPC, so the sign-in page is themed too, and cached for an instant (and offline) first paint.

export const THEME_DEFAULTS = {
  primary: '#0284c7', accent: '#059669', ink: '#0f172a', radius: 14, font: 'Inter' as NonNullable<Theme['font']>,
  heroTitle: 'What are you reviewing today?', heroText: 'Preview any cover for free. Unlock a file once, then read it on your computer and phone.',
};

export const PRESETS: { name: string; theme: Theme }[] = [
  { name: 'Medical (default)', theme: {} },
  { name: 'Ocean', theme: { primary: '#2563eb', accent: '#0891b2', background: { type: 'gradient', color: '#eff6ff', color2: '#ecfeff' } } },
  { name: 'Forest', theme: { primary: '#15803d', accent: '#65a30d', background: { type: 'plain', color: '#f7faf5' } } },
  { name: 'Berry', theme: { primary: '#be185d', accent: '#7c3aed', background: { type: 'gradient', color: '#fdf2f8', color2: '#f5f3ff' } } },
  { name: 'Clinic gray', theme: { primary: '#334155', accent: '#0d9488', background: { type: 'plain', color: '#f1f5f9' }, radius: 8 } },
];

export const FONTS: Record<NonNullable<Theme['font']>, { stack: string; google?: string }> = {
  Inter: { stack: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" },
  Poppins: { stack: "Poppins, system-ui, sans-serif", google: 'Poppins:wght@400;500;600;700;800' },
  Nunito: { stack: "Nunito, system-ui, sans-serif", google: 'Nunito:wght@400;600;700;800' },
  Merriweather: { stack: "Merriweather, Georgia, serif", google: 'Merriweather:wght@400;700;900' },
  System: { stack: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" },
};

const HEX = /^#[0-9a-f]{6}$/i;
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback);
// images may only come from our own storage (the branding bucket), never an arbitrary URL
const BRANDING = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/branding/`;
export const safeImage = (v: unknown) => (typeof v === 'string' && v.startsWith(BRANDING) && !/["'()\\\s]/.test(v) ? v : '');
export const brandingUrl = (path: string) => BRANDING + path;

function mix(hex: string, other: string, t: number) {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)), b = [1, 3, 5].map((i) => parseInt(other.slice(i, i + 2), 16));
  return '#' + a.map((x, i) => Math.round(x + (b[i]! - x) * t).toString(16).padStart(2, '0')).join('');
}

/** Turns a saved theme into the CSS variables the stylesheets use. */
export function themeVars(t: Theme): Record<string, string> {
  const primary = color(t.primary, THEME_DEFAULTS.primary), accent = color(t.accent, THEME_DEFAULTS.accent), ink = color(t.ink, THEME_DEFAULTS.ink);
  const radius = Math.min(24, Math.max(4, Number(t.radius) || THEME_DEFAULTS.radius));
  const v: Record<string, string> = {
    '--blue': primary, '--blue-deep': mix(primary, '#000000', 0.18), '--blue-50': mix(primary, '#ffffff', 0.95), '--blue-100': mix(primary, '#ffffff', 0.88), '--blue-200': mix(primary, '#ffffff', 0.72),
    '--green': accent, '--green-deep': mix(accent, '#000000', 0.18), '--green-50': mix(accent, '#ffffff', 0.94), '--green-100': mix(accent, '#ffffff', 0.84),
    '--ink': ink, '--grad': `linear-gradient(90deg, ${primary}, ${accent})`, '--radius': `${radius}px`,
    '--font': (FONTS[t.font ?? 'Inter'] ?? FONTS.Inter).stack,
  };
  const bg = t.background;
  if (bg?.type === 'plain') v['--app-bg'] = color(bg.color, '#f8fafc');
  else if (bg?.type === 'gradient') v['--app-bg'] = `linear-gradient(160deg, ${color(bg.color, '#f8fafc')}, ${color(bg.color2, '#eef6ff')})`;
  else if (bg?.type === 'image' && safeImage(bg.image)) {
    const o = Math.min(0.95, Math.max(0, bg.overlay ?? 0.85));
    v['--app-bg'] = `linear-gradient(rgba(248,250,252,${o}), rgba(248,250,252,${o})), url("${safeImage(bg.image)}") center / cover fixed`;
  }
  if (safeImage(t.authImage)) v['--auth-image'] = `url("${safeImage(t.authImage)}")`;
  return v;
}

const CACHE = 'mn.theme';
interface ThemeCtx { theme: Theme; storeName: string; reload: () => Promise<void>; preview: (t: Theme | null) => void }
const Ctx = createContext<ThemeCtx>({ theme: {}, storeName: '', reload: async () => undefined, preview: () => undefined });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<{ theme: Theme; store_name: string }>(() => {
    try { return JSON.parse(localStorage.getItem(CACHE) || 'null') ?? { theme: {}, store_name: '' }; } catch { return { theme: {}, store_name: '' }; }
  });
  const [draft, setDraft] = useState<Theme | null>(null); // Admin → Appearance live preview
  const reload = useCallback(async () => {
    const { data } = await supabase.rpc('get_public_theme');
    if (data) { setSaved({ theme: data.theme ?? {}, store_name: data.store_name ?? '' }); try { localStorage.setItem(CACHE, JSON.stringify(data)); } catch { /* private mode */ } }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const theme = draft ?? saved.theme;

  useEffect(() => {
    const root = document.documentElement;
    const vars = themeVars(theme);
    const all = ['--blue', '--blue-deep', '--blue-50', '--blue-100', '--blue-200', '--green', '--green-deep', '--green-50', '--green-100', '--ink', '--grad', '--radius', '--font', '--app-bg', '--auth-image'];
    for (const k of all) { if (vars[k]) root.style.setProperty(k, vars[k]); else root.style.removeProperty(k); }
    root.toggleAttribute('data-app-bg', !!vars['--app-bg']);
    root.toggleAttribute('data-auth-bg', !!vars['--auth-image']);
    const g = FONTS[theme.font ?? 'Inter']?.google;
    if (g && !document.querySelector(`link[data-font="${theme.font}"]`)) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.font = theme.font!;
      l.href = `https://fonts.googleapis.com/css2?family=${g}&display=swap`; document.head.appendChild(l);
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, storeName: theme.storeName?.trim() || '', reload, preview: setDraft }), [theme, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
