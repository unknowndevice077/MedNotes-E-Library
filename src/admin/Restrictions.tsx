import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, paymentQrUrl } from '../lib/supabase';
import { decodeQrImage, qrDataUrl } from '../lib/qrimage';
import { describe as describeQr, inspect, isQrPh } from '../lib/qrph';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { initials } from '../lib/format';
import type { PaymentMethod, Profile, Settings } from '../lib/types';
import { AdminLayout } from '../components/Layouts';
import { Modal, Toggle, useToast } from '../components/ui';
import ProfileEditor from '../components/ProfileEditor';
import ReceiptCard, { sampleReceipt } from '../components/ReceiptCard';
import { PasswordCard } from '../pages/Account';
import { useAdminDark } from '../components/Layouts';
import { downloadReceiptImage } from '../lib/receiptImage';
import { markTile, publisherOf, watermarkLine } from '../lib/watermark';
import { Laptop, Shield } from '../components/Icons';
import { Bar, FormSkeleton } from '../components/Skeletons';

export function useSettingsForm() {
  const { refresh } = useAuth();
  const toast = useToast();
  const { data, loading } = useLoad(async () => must(await supabase.from('settings').select('*').eq('id', 1).single()) as Settings);
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => { if (data) setS(data); }, [data]);
  const save = async (patch?: Partial<Settings>) => {
    const { id: _ignored, ...rest } = { ...(s as Settings & { id?: number }), ...patch };
    void _ignored;
    const { error } = await supabase.from('settings').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) toast(error.message); else { toast('Saved.'); refresh(); }
  };
  const set = (patch: Partial<Settings>) => setS((cur) => (cur ? { ...cur, ...patch } : cur));
  return { s, setS, set, loading, save };
}

const Num = ({ value, onChange, width = 80, suffix }: { value: number; onChange: (n: number) => void; width?: number; suffix?: string }) => (
  <span className="row" style={{ gap: 6 }}><input className="input" style={{ width, height: 36 }} inputMode="numeric" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} />{suffix && <span className="small muted">{suffix}</span>}</span>
);

export function AdminRestrictions() {
  const { s, setS, loading, save } = useSettingsForm();
  const { data: overrides } = useLoad(async () => must(await supabase.from('profiles').select('*')
    .or('computer_slots.not.is.null,phone_slots.not.is.null,can_add_devices.eq.false,suspended.eq.true')) as Profile[]);
  if (loading || !s) return <AdminLayout title="Restrictions"><FormSkeleton /></AdminLayout>;
  const set = (p: Partial<Settings>) => setS({ ...s, ...p });
  return (
    <AdminLayout title="Restrictions" subtitle="Defaults for every account. Override them per user on the user's page." actions={<button className="btn btn-primary" onClick={() => save()}>Save restrictions</button>}>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div className="col grow" style={{ gap: 16, minWidth: 320 }}>
          <div className="card col" style={{ gap: 14 }}>
            <div className="row"><Laptop width={22} color="var(--blue)" /><h3>Device limit (like Netflix plans)</h3></div>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Computers per account</b><span className="small muted">Desktop or laptop, in the web browser</span></div><Num value={s.computer_slots} onChange={(n) => set({ computer_slots: n })} /></div>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Phones per account</b><span className="small muted">Android app (APK) or mobile browser</span></div><Num value={s.phone_slots} onChange={(n) => set({ phone_slots: n })} /></div>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Device swaps per 30 days</b><span className="small muted">Stops people from sharing one account</span></div><Num value={s.swaps_per_30d} onChange={(n) => set({ swaps_per_30d: n })} /></div>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Sell extra device slots</b><span className="small muted">Buyers pay by GCash on their Devices page; confirming adds the slot</span></div><Toggle on={s.slot_sales} onChange={(v) => set({ slot_sales: v })} label="Sell extra device slots" /></div>
            {s.slot_sales && (
              <div className="row wrap" style={{ gap: 16, paddingLeft: 2 }}>
                <div className="setting" style={{ flex: '1 1 220px' }}><span>Price per extra computer</span><Num value={s.slot_price_computer} onChange={(n) => set({ slot_price_computer: n })} suffix="₱" /></div>
                <div className="setting" style={{ flex: '1 1 220px' }}><span>Price per extra phone</span><Num value={s.slot_price_phone} onChange={(n) => set({ slot_price_phone: n })} suffix="₱" /></div>
              </div>
            )}
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Users can add new devices</b><span className="small muted">Off: only admins can reset devices</span></div><Toggle on={s.users_can_add_devices} onChange={(v) => set({ users_can_add_devices: v })} /></div>
          </div>
          <div className="card col" style={{ gap: 14 }}>
            <div className="row"><Shield width={22} color="var(--blue)" /><h3>Content protection</h3></div>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Publisher watermark</b><span className="small muted">Stamped on every page, image, slide and video buyers open</span></div><Toggle on={s.watermark} onChange={(v) => set({ watermark: v })} label="Publisher watermark" /></div>
            {s.watermark && (
              <div className="wm-editor">
                <div className="row wrap" style={{ gap: 12 }}>
                  <div className="field grow" style={{ minWidth: 200 }}><label htmlFor="wm-name">Publisher name</label>
                    <input id="wm-name" className="input" value={s.publisher_name} placeholder={s.receipt_business} maxLength={60} onChange={(e) => set({ publisher_name: e.target.value })} /></div>
                  <div className="field grow" style={{ minWidth: 240 }}><label htmlFor="wm-note">Second line</label>
                    <input id="wm-note" className="input" value={s.watermark_note} placeholder={watermarkLine({ ...s, watermark_note: '' })} maxLength={90} onChange={(e) => set({ watermark_note: e.target.value })} /></div>
                </div>
                <div className="wm-preview" style={{ backgroundImage: markTile(s) }} aria-label="Watermark preview">
                  <span className="small muted">Preview · also shown as “Published by {publisherOf(s).name}”</span>
                </div>
              </div>
            )}
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Block screenshots in the app</b><span className="small muted">Android secure screen</span></div><Toggle on={s.block_screenshots} onChange={(v) => set({ block_screenshots: v })} /></div>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Offline saving (mobile app only)</b><span className="small muted">Encrypted copies inside the app</span></div><Toggle on={s.offline_saving} onChange={(v) => set({ offline_saving: v })} /></div>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Saved copies lock after</b><span className="small muted">Days the phone can stay offline before it must check in</span></div><Num value={s.offline_days} onChange={(n) => set({ offline_days: Math.max(1, n) })} suffix="days" /></div>
          </div>
        </div>
        <div className="card col" style={{ width: 420, maxWidth: '100%' }}>
          <h3>Active user overrides</h3>
          {(overrides ?? []).length === 0 && <span className="muted">Nobody has custom limits.</span>}
          {(overrides ?? []).map((u) => (
            <Link key={u.id} to={`/admin/users/${u.id}`} className="spread" style={{ color: 'inherit' }}>
              <span className="row"><span className="avatar">{initials(u.full_name, u.email)}</span>{u.full_name || u.email}</span>
              <span className={`badge ${u.suspended || u.can_add_devices === false ? 'b-red' : 'b-pending'}`}>
                {u.suspended ? 'Suspended' : u.can_add_devices === false ? 'Devices locked' : 'Custom slots'}</span>
            </Link>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}

/** Emails that become admins on sign-up. Kept in their own admin-only table (buyers can read settings). Saves right away. */
function AdminEmails() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const { data, reload } = useLoad(async () => must(await supabase.from('admin_allowlist').select('email').order('added_at')) as { email: string }[]);
  async function add() {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast('Enter a valid email.');
    const { error } = await supabase.from('admin_allowlist').insert({ email: e });
    if (error && !/duplicate/i.test(error.message)) return toast(error.message);
    setEmail(''); toast(`${e} will be an admin.`); reload();
  }
  async function remove(e: string) {
    const { error } = await supabase.from('admin_allowlist').delete().eq('email', e);
    if (error) return toast(error.message);
    toast('Removed. Existing admins keep their role until you change it in Users.'); reload();
  }
  return (
    <div className="card col">
      <h3>Admin emails</h3>
      <span className="small muted">These emails become admins as soon as they sign up (or right away if they already have an account). Only admins can see this list.</span>
      {(data ?? []).map(({ email: e }) => (
        <div key={e} className="spread"><span>{e}</span><button className="btn btn-sm btn-danger" onClick={() => remove(e)}>Remove</button></div>
      ))}
      <form className="row" onSubmit={(ev) => { ev.preventDefault(); add(); }}><input className="input grow" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Admin email" />
        <button className="btn btn-sm">Add</button></form>
    </div>
  );
}

/** Lets the publisher check their own GCash QR end to end before buyers use it. */
function TestQrModal({ m, onClose }: { m: PaymentMethod; onClose: () => void }) {
  const [amount, setAmount] = useState('1.00');
  const [src, setSrc] = useState<string | null>(null);
  const value = Math.max(0.01, Number(amount) || 0);
  const info = (() => { try { return inspect(m.qr_payload!, value); } catch { return null; } })();
  useEffect(() => { if (info) qrDataUrl(info.generated, 420).then(setSrc); }, [info?.generated]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal onClose={onClose} width={640}>
      <div className="spread"><h2>Test your {m.name} QR</h2><button className="btn btn-sm" onClick={onClose} aria-label="Close">×</button></div>
      {!info ? <div className="note note-red">This QR could not be read as a QR Ph payment code. Upload a clear screenshot of your {m.name} QR.</div> : (
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
          <div className="col" style={{ width: 220, gap: 8 }}>
            {src ? <img src={src} alt={`${m.name} test QR for ₱${value.toFixed(2)}`} style={{ width: 220, height: 220, borderRadius: 12, border: '1px solid var(--line)' }} /> : <Bar w={220} h={220} r={12} />}
            <div className="field"><label htmlFor="test-amt">Test amount (₱)</label><input id="test-amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          </div>
          <div className="col grow" style={{ minWidth: 240, gap: 10 }}>
            <div className="facts" style={{ gridTemplateColumns: '1fr' }}>
              <div><span className="small muted">Pays to</span><b>{info.name || '—'}</b></div>
              <div><span className="small muted">Account</span><b>{info.accounts.map((a) => a.account || a.guid).filter(Boolean).join(' · ') || 'Inside the QR'}</b></div>
              <div><span className="small muted">City · currency</span><b>{info.city || '—'} · {info.currency}</b></div>
            </div>
            {info.generatedOk ? <span className="badge b-ok" style={{ alignSelf: 'flex-start' }}>Amount ₱{value.toFixed(2)} built into the QR · checksum OK</span>
              : <span className="badge b-red" style={{ alignSelf: 'flex-start' }}>The amount could not be added to this QR</span>}
            {!info.staticCode && <div className="note note-amber">This looks like a one-time (dynamic) QR. Upload your permanent {m.name} "Receive money" QR instead.</div>}
            <ol className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>Open {m.name} on <b>another</b> phone or account (you can't pay your own number) and scan this code.</li>
              <li>Check that it shows <b>{info.name || 'your name'}</b> and <b>₱{value.toFixed(2)}</b> already filled in.</li>
              <li>Pay it. The money goes straight to your {m.name}; MedNotes never touches it.</li>
              <li>For the full flow, sign in as a buyer, buy a file and confirm it in Payments.</li>
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Admin dark mode, saved on the admin's own profile. */
function AdminLook() {
  const [dark, setDark] = useAdminDark();
  return (
    <div className="card col">
      <h3>Admin appearance</h3>
      <div className="setting"><div className="col" style={{ gap: 0 }}><b>Dark mode</b><span className="small muted">Only for the admin pages, only for you. Buyers keep the site look.</span></div><Toggle on={dark} onChange={setDark} label="Dark mode" /></div>
    </div>
  );
}

/** The receipt buyers get, as they'll see it, with what's on it editable on the Receipts page. */
function ReceiptSampleCard({ s }: { s: Settings }) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();
  return (
    <div className="card col receipt-sample-card">
      <div className="spread wrap" style={{ gap: 8 }}><h3>Receipt buyers get</h3><Link to="/admin/receipts?tab=design" className="btn btn-sm">Edit what it says</Link></div>
      <span className="small muted">Sent when you confirm a payment. Buyers can save it as a picture or PDF, the only thing they can download.</span>
      <div ref={ref} className="receipt-shot"><ReceiptCard settings={s} r={sampleReceipt(s)} sample /></div>
      <button type="button" className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => ref.current && downloadReceiptImage(ref.current, 'sample-receipt').catch((e) => toast(String(e)))}>Download sample image</button>
    </div>
  );
}

export function AdminSettings() {
  const { s, setS, loading, save } = useSettingsForm();
  const { profile, session } = useAuth();
  const adminHasPassword = [...(session?.user.app_metadata.providers ?? []), profile?.provider].includes('email');
  const toast = useToast();
  const [testing, setTesting] = useState<PaymentMethod | null>(null);
  if (loading || !s) return <AdminLayout title="Settings"><FormSkeleton cards={3} /></AdminLayout>;
  // Upload a payment QR right away and save it, so buyers see it immediately.
  async function uploadQr(i: number, file?: File | null) {
    if (!file || !s) return;
    const path = `${s.payment_methods[i]!.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}.${file.name.split('.').pop() || 'png'}`;
    // Read the code in the image: a QR Ph code lets checkout fill in each file's price automatically.
    const decoded = await decodeQrImage(file).catch(() => null);
    const payload = decoded && isQrPh(decoded) ? decoded : null;
    const up = await supabase.storage.from('payment-qr').upload(path, file, { contentType: file.type });
    if (up.error) return toast(up.error.message);
    const methods = s.payment_methods.map((m, j) => (j === i ? { ...m, qr_path: path, qr_payload: payload } : m));
    setS({ ...s, payment_methods: methods });
    await save({ payment_methods: methods });
    toast(payload ? `QR Ph code read (${describeQr(payload).name || 'account'}): checkout will fill in the amount automatically.`
      : decoded ? "Saved, but this isn't a QR Ph payment code, so buyers will type the amount themselves."
      : "Saved, but no QR code was found in the image. Use a clear screenshot of your GCash QR.");
  }
  const set = (p: Partial<Settings>) => setS({ ...s, ...p });
  const setMethod = (i: number, p: Partial<PaymentMethod>) => set({ payment_methods: s.payment_methods.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  return (
    <AdminLayout title="Settings" actions={<button className="btn btn-primary" onClick={() => save()}>Save settings</button>}>
      <section className="col" style={{ gap: 12 }}>
        <span className="eyebrow">Your admin account</span>
        <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
          <div className="col grow" style={{ gap: 16, minWidth: 300, flexBasis: 360 }}><ProfileEditor hint="Shown in the admin and on the activity log." /><AdminLook /></div>
          <div className="col grow" style={{ gap: 16, minWidth: 300, flexBasis: 360 }}><PasswordCard hasPassword={adminHasPassword} email={profile?.email ?? ''} /></div>
        </div>
      </section>
      <span className="eyebrow">Payments & receipts</span>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div className="col grow" style={{ gap: 16, minWidth: 320 }}>
          <div className="card col">
            <h3>Payment methods shown to buyers</h3>
            {s.payment_methods.map((m, i) => (
              <div key={i} className="card row wrap" style={{ padding: 12 }}>
                <input className="input" style={{ width: 170 }} value={m.name} onChange={(e) => setMethod(i, { name: e.target.value })} aria-label="Method name" />
                <input className="input grow" style={{ minWidth: 140 }} value={m.account} onChange={(e) => setMethod(i, { account: e.target.value })} aria-label="Account number" />
                <input className="input grow" style={{ minWidth: 140 }} value={m.holder} onChange={(e) => setMethod(i, { holder: e.target.value })} aria-label="Account name" />
                <Toggle on={m.enabled} onChange={(v) => setMethod(i, { enabled: v })} label="Shown to buyers" />
                <button className="btn btn-sm btn-danger" onClick={() => set({ payment_methods: s.payment_methods.filter((_, j) => j !== i) })}>Remove</button>
                <div className="row wrap" style={{ width: '100%', gap: 12 }}>
                  {m.qr_path ? <a href={paymentQrUrl(m.qr_path)!} target="_blank" rel="noreferrer"><img src={paymentQrUrl(m.qr_path)!} alt={`${m.name} QR`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} /></a>
                    : <span className="small muted">No QR yet</span>}
                  <label className="btn btn-sm">{m.qr_path ? 'Replace QR' : 'Upload QR'}<input type="file" accept="image/*" hidden onChange={(e) => uploadQr(i, e.target.files?.[0])} /></label>
                  {m.qr_path && <button className="btn btn-sm" onClick={() => setMethod(i, { qr_path: null, qr_payload: null })}>Remove QR</button>}
                  {m.qr_payload && <button className="btn btn-sm btn-primary" onClick={() => setTesting(m)}>Test this QR</button>}
                  {m.qr_path?.includes('demo') ? <span className="badge b-pending" title={`Replace it with your real ${m.name} QR`}>Demo QR · replace it</span>
                    : m.qr_payload ? <span className="badge b-ok">QR Ph · amount filled in automatically</span>
                    : m.qr_path ? <span className="badge b-lock">Image only · buyers type the amount</span> : null}
                </div>
              </div>
            ))}
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ payment_methods: [...s.payment_methods, { name: 'New method', account: '', holder: s.receipt_business, enabled: true }] })}>+ Add payment method</button>
          </div>
          <ReceiptSampleCard s={s} />
        </div>
        <div className="col" style={{ width: 420, maxWidth: '100%', gap: 16 }}>
          <div className="card col">
            <h3>Store</h3>
            <div className="field"><label htmlFor="sn">Store name</label><input id="sn" className="input" value={s.store_name} onChange={(e) => set({ store_name: e.target.value })} /></div>
            <div className="field"><label htmlFor="se">Support email</label><input id="se" className="input" type="email" value={s.support_email} onChange={(e) => set({ support_email: e.target.value })} /></div>
          </div>
          <div className="card col">
            <h3>Sign-in providers</h3>
            <span className="small muted">Google and Facebook sign-in are switched on in Supabase (Authentication → Providers) with your app's client IDs. See README → "Social sign-in".</span>
            <Link to="/admin/users" className="link">Manage admins in Users →</Link>
          </div>
          <AdminEmails />
        </div>
      </div>
    {testing && <TestQrModal m={testing} onClose={() => setTesting(null)} />}
    </AdminLayout>
  );
}
