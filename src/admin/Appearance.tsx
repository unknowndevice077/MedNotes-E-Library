import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { must, useLoad } from '../lib/useLoad';
import { brandingUrl, FONTS, PRESETS, safeImage, THEME_DEFAULTS, themeVars, useTheme } from '../lib/theme';
import { fieldLabel, isLong, LEGACY, SITE_PAGES, TEXT, type SitePage, type TextKey } from '../lib/siteText';
import type { Theme } from '../lib/types';
import { AdminLayout } from '../components/Layouts';
import { useConfirm, useToast } from '../components/ui';
import type { EditMsg } from '../components/SiteEditBridge';
import { FormSkeleton } from '../components/Skeletons';
import { Laptop, Phone, Undo } from '../components/Icons';

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

/** Older saves kept a few texts as their own fields; the editor keeps all wording in theme.copy. */
function withCopy(th: Theme): Theme {
  const { authTitle, authText, heroTitle, heroText, footerText, announcement, ...rest } = th;
  const old = { authTitle, authText, heroTitle, heroText, footerText, announcement };
  const copy = { ...(th.copy ?? {}) };
  for (const [k, f] of Object.entries(LEGACY)) { const v = old[f!]?.trim(); if (v && !copy[k]) copy[k] = v; }
  return { ...rest, copy };
}

const SIZES = { computer: { w: 1280, h: 800 }, phone: { w: 390, h: 780 } };

/** The real website in a frame, scaled down to fit. */
function Frame({ device, src, frameRef }: { device: 'computer' | 'phone'; src: string; frameRef: React.RefObject<HTMLIFrameElement> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width));
    ro.observe(wrap.current!);
    return () => ro.disconnect();
  }, []);
  const size = SIZES[device];
  const scale = Math.min(1, (w - (device === 'phone' ? 16 : 0)) / size.w);
  return (
    <div ref={wrap} className="site-frame-wrap">
      <div className={`site-frame-box ${device}`} style={{ width: size.w * scale, height: size.h * scale }}>
        <iframe ref={frameRef} src={src} title="Website preview" className="site-frame" style={{ width: size.w, height: size.h, transform: `scale(${scale})` }} />
      </div>
    </div>
  );
}

function TextField({ k, value, onChange, onFocus, active }: { k: TextKey; value: string; onChange: (v: string) => void; onFocus: () => void; active: boolean }) {
  const id = `tx-${k.replace('.', '-')}`;
  const long = isLong(k);
  const props = { id, className: 'input', value, placeholder: TEXT[k] || 'Leave empty to hide', maxLength: long ? 280 : 90, onFocus, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  return (
    <div className={`field tx-field${active ? ' on' : ''}`}>
      <div className="spread"><label htmlFor={id}>{fieldLabel(k)}</label>{value && <button type="button" className="link small" onClick={() => onChange('')}>Use default</button>}</div>
      {long ? <textarea rows={2} {...props} /> : <input {...props} />}
    </div>
  );
}

export default function AdminAppearance() {
  const toast = useToast();
  const confirm = useConfirm();
  const { preview, reload } = useTheme();
  const { data, loading } = useLoad(async () => {
    const [s, f] = await Promise.all([
      supabase.from('settings').select('theme').eq('id', 1).single(),
      // a real file for the file details and checkout pages
      supabase.from('files').select('id').eq('published', true).eq('is_free', false).order('created_at', { ascending: false }).limit(1),
    ]);
    return { theme: withCopy((must(s) as { theme: Theme }).theme ?? {}), fileId: (f.data?.[0]?.id as string | undefined) ?? null };
  }, [], { cache: false });
  const [t, setTRaw] = useState<Theme | null>(null);
  // undo / redo: every change is a step; typing in the same text within a second is one step
  const past = useRef<Theme[]>([]);
  const future = useRef<Theme[]>([]);
  const lastStep = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const [, bump] = useState(0);
  const setT = useCallback((next: Theme, key = '') => {
    setTRaw((cur) => {
      if (cur && next !== cur) {
        const now = Date.now();
        const same = key && key === lastStep.current.key && now - lastStep.current.at < 1000;
        if (!same) past.current = [...past.current.slice(-99), cur];
        future.current = [];
        lastStep.current = { key, at: now };
      }
      return next;
    });
    bump((n) => n + 1);
  }, []);
  const undo = () => { const prev = past.current.pop(); if (!prev || !t) return; future.current.push(t); lastStep.current = { key: '', at: 0 }; setTRaw(prev); bump((n) => n + 1); };
  const redo = () => { const next = future.current.pop(); if (!next || !t) return; past.current.push(t); lastStep.current = { key: '', at: 0 }; setTRaw(next); bump((n) => n + 1); };
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'pages' | 'style'>('pages');
  const [pageId, setPageId] = useState('sign-in');
  const [device, setDevice] = useState<'computer' | 'phone'>('computer');
  const [focus, setFocus] = useState<TextKey | null>(null);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const editText = useRef<(k: TextKey, v: string) => void>(() => undefined);
  useEffect(() => { if (data) { setTRaw(data.theme); past.current = []; future.current = []; } }, [data]);
  // the whole admin screen previews the draft; leaving without saving restores the live look
  useEffect(() => { if (t) preview(t); }, [t, preview]);
  useEffect(() => () => preview(null), [preview]);

  const page = SITE_PAGES.find((p) => p.id === pageId)!;
  const pathOf = useCallback((p: SitePage) => p.path.replace(':file', data?.fileId ?? ''), [data?.fileId]);
  // set once: later page changes go through the bridge so the frame doesn't reload
  const src = useMemo(() => `${import.meta.env.BASE_URL}${pathOf(page).slice(1)}?site-edit=1`, [!!data]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = useCallback((m: EditMsg) => frame.current?.contentWindow?.postMessage(m, window.location.origin), []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data as { type: string; key?: TextKey; path?: string };
      if (m.type === 'mn-ready') setReady(true);
      else if (m.type === 'mn-page' && m.path) { const p = SITE_PAGES.find((x) => x.match.test(m.path!)); if (p) setPageId(p.id); }
      else if (m.type === 'mn-edit' && m.key && m.key in TEXT) {
        const key = m.key as TextKey, text = (m as { text?: string }).text ?? '';
        setFocus(key);
        setTRaw((cur) => cur);
        editText.current(key, text);
      }
      else if (m.type === 'mn-pick' && m.key && m.key in TEXT) {
        const key = m.key;
        setTab('pages'); setFocus(key);
        setTimeout(() => { const el = document.getElementById(`tx-${key.replace('.', '-')}`); el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 30);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  useEffect(() => { if (ready && t) send({ type: 'mn-theme', theme: t }); }, [ready, t, send]);
  useEffect(() => { if (ready && data) send({ type: 'mn-nav', path: pathOf(page) }); }, [ready, page, pathOf, send, data]);
  useEffect(() => { if (ready) send({ type: 'mn-focus', key: focus }); }, [ready, focus, pageId, send]);

  // keyboard: Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) when not typing in a box
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (loading || !t || !data) return <AdminLayout title="Appearance"><FormSkeleton cards={3} /></AdminLayout>;
  const set = (patch: Partial<Theme>, key = '') => setT({ ...t, ...patch }, key);
  const setText = (k: TextKey, v: string) => { const copy = { ...(t.copy ?? {}) }; if (v.trim() && v.trim() !== TEXT[k]) copy[k] = v; else delete copy[k]; set({ copy }, k); };
  editText.current = setText;
  const bg: Bg = t.background ?? { type: 'plain', color: '#f8fafc' };
  const setBg = (patch: Partial<Bg>) => set({ background: { ...bg, ...patch } });
  const dirty = JSON.stringify(t) !== JSON.stringify(data.theme);
  const edited = page.groups.flatMap((g) => g.keys).filter((k) => t.copy?.[k]).length;

  async function save() {
    setSaving(true);
    const { error } = await supabase.from('settings').update({ theme: t, updated_at: new Date().toISOString() }).eq('id', 1);
    setSaving(false);
    if (error) return toast(error.message);
    await reload(); toast('Saved. Open copies of the website and app update right away.');
  }
  async function reset() {
    if (await confirm({ title: 'Reset the whole website?', body: 'All page text, colours, backgrounds, logo and font go back to the MedNotes defaults. You can still undo this, and nothing changes for buyers until you save.', confirmLabel: 'Reset everything' })) setT({ copy: {} });
  }
  const revert = () => setT(data.theme);
  function resetPage() {
    const copy = { ...(t!.copy ?? {}) };
    for (const g of page.groups) for (const k of g.keys) delete copy[k];
    set({ copy });
  }

  const pageFields = (
    <div className="col" style={{ gap: 16 }}>
      <div className="note note-blue"><span><b>Edit mode:</b> click any text on the page on the right and type over it, like a design canvas. Press Enter when done. Undo with Ctrl+Z; nothing goes live until you press Save website.</span></div>
      {page.needsFile && !data.fileId && <div className="note note-amber"><span>Add a paid file in Files to preview this page.</span></div>}
      {page.id === 'sign-in' && <div className="card col"><h3>Sign-in background</h3><ImagePick label="Sign-in background" hint="Shown behind the welcome side of the sign-in page" value={t.authImage} onChange={(authImage) => set({ authImage })} /></div>}
      {page.groups.map((g) => (
        <div key={g.title} className="card col">
          <h3>{g.title}</h3>
          {g.keys.map((k) => <TextField key={k} k={k} value={t.copy?.[k] ?? ''} active={focus === k} onFocus={() => setFocus(k)} onChange={(v) => setText(k, v)} />)}
        </div>
      ))}
      {edited > 0 && <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={resetPage}>Reset this page's text ({edited})</button>}
    </div>
  );

  const styleFields = (
    <div className="col" style={{ gap: 16 }}>
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
        <h3>Android app download</h3>
        <span className="small muted">Shown on the sign-in page. The QR code is made from this link automatically, unless you upload your own.</span>
        <div className="field"><label htmlFor="ap-play">Google Play link</label>
          <input id="ap-play" className="input" type="url" placeholder="https://play.google.com/store/apps/details?id=…" value={t.playStoreUrl ?? ''}
            onChange={(e) => set({ playStoreUrl: e.target.value.trim() || undefined })} /></div>
        {t.playStoreUrl && !/^https:\/\//.test(t.playStoreUrl) && <span className="small" style={{ color: 'var(--red)' }}>The link should start with https://</span>}
        <ImagePick label="Download QR code" hint="Optional. Leave on Default to use a QR made from the link above." value={t.appQr} onChange={(appQr) => set({ appQr })} />
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
        <h3>Shape & type</h3>
        <div className="setting"><div className="col" style={{ gap: 0 }}><b>Corner roundness</b><span className="small muted">Cards and panels</span></div>
          <div className="row" style={{ gap: 10, minWidth: 0, flex: '1 1 140px', maxWidth: 220 }}><input type="range" min={4} max={24} step={1} value={t.radius ?? THEME_DEFAULTS.radius} aria-label="Corner roundness" onChange={(e) => set({ radius: Number(e.target.value) })} /><b className="small" style={{ width: 36 }}>{t.radius ?? THEME_DEFAULTS.radius}px</b></div></div>
        <div className="setting"><div className="col" style={{ gap: 0 }}><b>Font</b></div>
          <select className="input" style={{ width: 180 }} value={t.font ?? 'Inter'} aria-label="Font" onChange={(e) => set({ font: e.target.value as Theme['font'] })}>
            {Object.keys(FONTS).map((f) => <option key={f} value={f}>{f}</option>)}
          </select></div>
      </div>
    </div>
  );

  return (
    <AdminLayout title="Appearance" subtitle="Edit the whole website and app, from the sign-in page to the library. Changes go live everywhere when you save."
      actions={<>
        <span className="row edit-history" style={{ gap: 4 }}>
          <button className="btn btn-sm" onClick={undo} disabled={!past.current.length} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo width={16} /></button>
          <button className="btn btn-sm" onClick={redo} disabled={!future.current.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Undo width={16} style={{ transform: 'scaleX(-1)' }} /></button>
        </span>
        {dirty && <button className="btn" onClick={revert}>Back to last saved</button>}
        <button className="btn" onClick={reset}>Reset all</button><button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : dirty ? 'Save website' : 'Saved'}</button></>}>
      <div className="site-editor">
        <div className="site-panel col" style={{ gap: 14 }}>
          <div className="seg" role="tablist" aria-label="Edit">
            <button role="tab" aria-selected={tab === 'pages'} className={tab === 'pages' ? 'on' : ''} onClick={() => setTab('pages')}>Edit website</button>
            <button role="tab" aria-selected={tab === 'style'} className={tab === 'style' ? 'on' : ''} onClick={() => setTab('style')}>Colours & style</button>
          </div>
          {tab === 'pages' ? pageFields : styleFields}
        </div>
        <div className="site-preview col" style={{ gap: 10 }}>
          <div className="spread wrap" style={{ gap: 10 }}>
            <select className="input site-page-pick" aria-label="Page to edit" value={pageId} onChange={(e) => { setPageId(e.target.value); setFocus(null); setTab('pages'); }}>
              {SITE_PAGES.map((p) => <option key={p.id} value={p.id} disabled={p.needsFile && !data.fileId}>{p.label}</option>)}
            </select>
            <div className="seg" role="radiogroup" aria-label="Preview size">
              <button type="button" role="radio" aria-checked={device === 'computer'} className={device === 'computer' ? 'on' : ''} onClick={() => setDevice('computer')}><Laptop width={16} /> Computer</button>
              <button type="button" role="radio" aria-checked={device === 'phone'} className={device === 'phone' ? 'on' : ''} onClick={() => setDevice('phone')}><Phone width={16} /> Phone</button>
            </div>
          </div>
          <Frame device={device} src={src} frameRef={frame} />
          <span className="small muted">{dirty ? 'Not saved yet. Buyers still see the old version until you save.' : 'This is what buyers see now.'}</span>
        </div>
      </div>
    </AdminLayout>
  );
}
