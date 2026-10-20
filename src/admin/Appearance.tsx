import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { must, useLoad } from '../lib/useLoad';
import { brandingUrl, FONTS, PRESETS, safeImage, THEME_DEFAULTS, themeVars, useTheme } from '../lib/theme';
import type { Theme } from '../lib/types';
import { AdminLayout } from '../components/Layouts';
import { Logo, useConfirm, useToast } from '../components/ui';
import { FormSkeleton } from '../components/Skeletons';
import { Lock, Search } from '../components/Icons';

type Bg = NonNullable<Theme['background']>;

function ImagePick({ label, value, onChange, hint }: { label: string; value?: string; onChange: (url: string | undefined) => void; hint?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function upload(file?: File | null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('Use an image under 5 MB.');
    setBusy(true);
    const path = `${label.toLowerCase().replace(/[^a-z]+/g, '-')}-${Date.now().toString(36)}.${(file.name.split('.').pop() || 'png').toLowerCase()}`;
    const { error } = await supabase.storage.from('branding').upload(path, file, { contentType: file.type });
    setBusy(false);
    if (error) return toast(error.message);
    onChange(brandingUrl(path));
  }
  const src = safeImage(value);
  return (
    <div className="img-pick">
      <div className="img-pick-thumb" style={src ? { backgroundImage: `url("${src}")` } : undefined}>{!src && <span className="small muted">Default</span>}</div>
      <div className="col" style={{ gap: 6, flex: 1 }}>
        <b>{label}</b>{hint && <span className="small muted">{hint}</span>}
        <div className="row" style={{ gap: 8 }}>
          <label className="btn btn-sm">{busy ? 'Uploading…' : src ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => upload(e.target.files?.[0])} /></label>
          {src && <button type="button" className="btn btn-sm" onClick={() => onChange(undefined)}>Use default</button>}
        </div>
      </div>
    </div>
  );
}

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <div className="row" style={{ gap: 8 }}><input id={id} type="color" className="color-input" value={value} onChange={(e) => onChange(e.target.value)} />
        <input className="input" style={{ width: 110 }} value={value} aria-label={`${label} hex`} onChange={(e) => /^#[0-9a-f]{0,6}$/i.test(e.target.value) && onChange(e.target.value)} /></div>
    </div>
  );
}

/** A small mock of the buyer's library, drawn with the draft theme. */
function Preview({ t }: { t: Theme }) {
  const vars = themeVars(t) as React.CSSProperties;
  return (
    <div className="ap-preview" style={{ ...vars, background: (vars as Record<string, string>)['--app-bg'] ?? 'var(--bg)', fontFamily: 'var(--font)' }} aria-label="Preview of the library">
      <div className="ap-top"><Logo size={26} /><span className="ap-search"><Search width={14} /> Search notes…</span></div>
      <div className="hero-card ap-hero"><span className="eyebrow light">Good morning, Maria</span><b>{t.heroTitle?.trim() || THEME_DEFAULTS.heroTitle}</b><span>{t.heroText?.trim() || THEME_DEFAULTS.heroText}</span></div>
      <div className="row" style={{ gap: 10 }}>
        {['Pharmacology Made Easy', 'Anatomy Atlas'].map((n, i) => (
          <div key={n} className="card ap-book"><div className="ap-cover" style={{ background: i ? 'var(--green-100)' : 'var(--blue-100)' }}><Lock width={14} /></div><span className="eyebrow">{i ? 'Anatomy' : 'Pharmacology'}</span><b className="small">{n}</b><span className="price-pill">₱{i ? 350 : 450}</span></div>
        ))}
      </div>
      <div className="row" style={{ gap: 8 }}><span className="btn btn-primary btn-sm">Buy & unlock</span><span className="btn btn-sm">Details</span><span className="chip on">All types</span></div>
    </div>
  );
}

export default function AdminAppearance() {
  const toast = useToast();
  const confirm = useConfirm();
  const { preview, reload } = useTheme();
  const { data, loading } = useLoad(async () => must(await supabase.from('settings').select('theme').eq('id', 1).single()) as { theme: Theme }, [], { cache: false });
  const [t, setT] = useState<Theme | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setT(data.theme ?? {}); }, [data]);
  // the whole admin screen previews the draft; leaving without saving restores the live look
  useEffect(() => { if (t) preview(t); }, [t, preview]);
  useEffect(() => () => preview(null), [preview]);

  if (loading || !t) return <AdminLayout title="Appearance"><FormSkeleton cards={3} /></AdminLayout>;
  const set = (patch: Partial<Theme>) => setT({ ...t, ...patch });
  const bg: Bg = t.background ?? { type: 'plain', color: '#f8fafc' };
  const setBg = (patch: Partial<Bg>) => set({ background: { ...bg, ...patch } });
  const dirty = JSON.stringify(t) !== JSON.stringify(data?.theme ?? {});

  async function save() {
    setSaving(true);
    const { error } = await supabase.from('settings').update({ theme: t, updated_at: new Date().toISOString() }).eq('id', 1);
    setSaving(false);
    if (error) return toast(error.message);
    await reload(); toast('Saved. Buyers see the new look on their next page load.');
  }
  async function reset() {
    if (await confirm({ title: 'Reset to the default look?', body: 'Colours, backgrounds, logo, font and welcome text go back to the MedNotes defaults. Save to apply.', confirmLabel: 'Reset' })) setT({});
  }

  return (
    <AdminLayout title="Appearance" subtitle="How the website and the app look. Features stay the same."
      actions={<><button className="btn" onClick={reset}>Reset</button><button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save appearance' : 'Saved'}</button></>}>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 24 }}>
        <div className="col grow" style={{ gap: 16, minWidth: 320, flexBasis: 460 }}>
          <div className="card col">
            <h3>Start from a preset</h3>
            <div className="ap-presets">
              {PRESETS.map((p) => {
                const v = themeVars(p.theme);
                return (
                  <button key={p.name} type="button" className="ap-preset" onClick={() => setT({ ...t, ...p.theme, background: p.theme.background, radius: p.theme.radius })}>
                    <span className="ap-swatches"><i style={{ background: v['--blue'] }} /><i style={{ background: v['--green'] }} /><i style={{ background: v['--app-bg'] ?? '#f8fafc' }} /></span>{p.name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="card col">
            <h3>Brand</h3>
            <div className="field"><label htmlFor="ap-name">Store name</label><input id="ap-name" className="input" maxLength={40} placeholder="MedNotes E-Library" value={t.storeName ?? ''} onChange={(e) => set({ storeName: e.target.value })} /></div>
            <ImagePick label="Logo" hint="Square PNG or SVG, at least 128 × 128" value={t.logo} onChange={(logo) => set({ logo })} />
            <div className="row wrap" style={{ gap: 16 }}>
              <ColorField id="ap-primary" label="Main colour" value={t.primary ?? THEME_DEFAULTS.primary} onChange={(primary) => set({ primary })} />
              <ColorField id="ap-accent" label="Accent colour" value={t.accent ?? THEME_DEFAULTS.accent} onChange={(accent) => set({ accent })} />
              <ColorField id="ap-ink" label="Text colour" value={t.ink ?? THEME_DEFAULTS.ink} onChange={(ink) => set({ ink })} />
            </div>
          </div>
          <div className="card col">
            <h3>Background</h3>
            <span className="small muted">Behind every page of the website and the app (not the reader, where pages stay clean).</span>
            <div className="seg" role="radiogroup" aria-label="Background type">
              {(['plain', 'gradient', 'image'] as const).map((k) => <button key={k} type="button" role="radio" aria-checked={bg.type === k} className={bg.type === k ? 'on' : ''} onClick={() => setBg({ type: k })}>{k === 'plain' ? 'Plain' : k === 'gradient' ? 'Gradient' : 'Photo'}</button>)}
            </div>
            {bg.type !== 'image' && (
              <div className="row wrap" style={{ gap: 16 }}>
                <ColorField id="ap-bg1" label={bg.type === 'gradient' ? 'From' : 'Colour'} value={bg.color ?? '#f8fafc'} onChange={(color) => setBg({ color })} />
                {bg.type === 'gradient' && <ColorField id="ap-bg2" label="To" value={bg.color2 ?? '#eef6ff'} onChange={(color2) => setBg({ color2 })} />}
              </div>
            )}
            {bg.type === 'image' && (
              <>
                <ImagePick label="Background photo" hint="Wide photo, about 1920 × 1080" value={bg.image} onChange={(image) => setBg({ image })} />
                <div className="setting"><div className="col" style={{ gap: 0 }}><b>Fade</b><span className="small muted">Keeps text readable over the photo</span></div>
                  <input type="range" min={0.5} max={0.95} step={0.05} value={bg.overlay ?? 0.85} aria-label="Photo fade" onChange={(e) => setBg({ overlay: Number(e.target.value) })} /></div>
              </>
            )}
          </div>
          <div className="card col">
            <h3>Sign-in page & welcome</h3>
            <ImagePick label="Sign-in background" hint="Shown behind the sign-in and sign-up forms" value={t.authImage} onChange={(authImage) => set({ authImage })} />
            <div className="field"><label htmlFor="ap-hero">Library welcome title</label><input id="ap-hero" className="input" maxLength={70} placeholder={THEME_DEFAULTS.heroTitle} value={t.heroTitle ?? ''} onChange={(e) => set({ heroTitle: e.target.value })} /></div>
            <div className="field"><label htmlFor="ap-hero-text">Welcome text</label><textarea id="ap-hero-text" className="input" maxLength={180} rows={2} placeholder={THEME_DEFAULTS.heroText} value={t.heroText ?? ''} onChange={(e) => set({ heroText: e.target.value })} /></div>
          </div>
          <div className="card col">
            <h3>Shape & type</h3>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Corner roundness</b><span className="small muted">Cards and panels</span></div>
              <div className="row" style={{ gap: 10 }}><input type="range" min={4} max={24} step={1} value={t.radius ?? THEME_DEFAULTS.radius} aria-label="Corner roundness" onChange={(e) => set({ radius: Number(e.target.value) })} /><b className="small" style={{ width: 36 }}>{t.radius ?? THEME_DEFAULTS.radius}px</b></div></div>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Font</b></div>
              <select className="input" style={{ width: 180 }} value={t.font ?? 'Inter'} aria-label="Font" onChange={(e) => set({ font: e.target.value as Theme['font'] })}>
                {Object.keys(FONTS).map((f) => <option key={f} value={f}>{f}</option>)}
              </select></div>
          </div>
        </div>
        <div className="col ap-side" style={{ gap: 10, flexBasis: 380, flexGrow: 1 }}>
          <span className="eyebrow">Live preview</span>
          <Preview t={t} />
          <span className="small muted">{dirty ? 'Not saved yet. This admin screen already shows the new look.' : 'This is what buyers see now.'}</span>
        </div>
      </div>
    </AdminLayout>
  );
}
