import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { initials } from '../lib/format';
import type { PaymentMethod, Profile, Settings } from '../lib/types';
import { AdminLayout } from '../components/Layouts';
import { Loading, Toggle, useToast } from '../components/ui';
import { Laptop, Shield } from '../components/Icons';

function useSettingsForm() {
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
  return { s, setS, loading, save };
}

const Num = ({ value, onChange, width = 80, suffix }: { value: number; onChange: (n: number) => void; width?: number; suffix?: string }) => (
  <span className="row" style={{ gap: 6 }}><input className="input" style={{ width, height: 36 }} inputMode="numeric" value={value} onChange={(e) => onChange(Math.max(0, Number(e.target.value.replace(/\D/g, '')) || 0))} />{suffix && <span className="small muted">{suffix}</span>}</span>
);

export function AdminRestrictions() {
  const { s, setS, loading, save } = useSettingsForm();
  const { data: overrides } = useLoad(async () => must(await supabase.from('profiles').select('*')
    .or('computer_slots.not.is.null,phone_slots.not.is.null,allow_download.not.is.null,can_add_devices.eq.false,suspended.eq.true')) as Profile[]);
  if (loading || !s) return <AdminLayout title="Restrictions"><Loading /></AdminLayout>;
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
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Users can add new devices</b><span className="small muted">Off: only admins can reset devices</span></div><Toggle on={s.users_can_add_devices} onChange={(v) => set({ users_can_add_devices: v })} /></div>
          </div>
          <div className="card col" style={{ gap: 14 }}>
            <div className="row"><Shield width={22} color="var(--blue)" /><h3>Content protection</h3></div>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Allow file export by default</b><span className="small muted">New files start with this setting. Each file can change it.</span></div><Toggle on={s.allow_download_default} onChange={(v) => set({ allow_download_default: v })} /></div>
            <div className="setting"><div className="col" style={{ gap: 0 }}><b>Watermark with buyer email</b><span className="small muted">On the reader and videos</span></div><Toggle on={s.watermark} onChange={(v) => set({ watermark: v })} /></div>
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
              <span className={`badge ${u.suspended || u.can_add_devices === false ? 'b-red' : u.allow_download ? 'b-blue' : 'b-pending'}`}>
                {u.suspended ? 'Suspended' : u.can_add_devices === false ? 'Devices locked' : u.allow_download ? 'Downloads on' : 'Custom slots'}</span>
            </Link>
          ))}
        </div>
      </div>
    </AdminLayout>
  );
}

export function AdminSettings() {
  const { s, setS, loading, save } = useSettingsForm();
  if (loading || !s) return <AdminLayout title="Settings"><Loading /></AdminLayout>;
  const set = (p: Partial<Settings>) => setS({ ...s, ...p });
  const setMethod = (i: number, p: Partial<PaymentMethod>) => set({ payment_methods: s.payment_methods.map((m, j) => (j === i ? { ...m, ...p } : m)) });
  return (
    <AdminLayout title="Settings" actions={<button className="btn btn-primary" onClick={() => save()}>Save settings</button>}>
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
              </div>
            ))}
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ payment_methods: [...s.payment_methods, { name: 'New method', account: '', holder: s.receipt_business, enabled: true }] })}>+ Add payment method</button>
          </div>
          <div className="card col">
            <h3>Receipts</h3>
            <div className="row wrap">
              <div className="field grow"><label htmlFor="rb">Business name on receipt</label><input id="rb" className="input" value={s.receipt_business} onChange={(e) => set({ receipt_business: e.target.value })} /></div>
              <div className="field" style={{ width: 200 }}><label htmlFor="tin">TIN (optional)</label><input id="tin" className="input" value={s.receipt_tin} onChange={(e) => set({ receipt_tin: e.target.value })} /></div>
            </div>
            <div className="row wrap">
              <div className="field" style={{ width: 140 }}><label htmlFor="rp">Receipt prefix</label><input id="rp" className="input" value={s.receipt_prefix} onChange={(e) => set({ receipt_prefix: e.target.value })} /></div>
              <div className="field" style={{ width: 160 }}><label htmlFor="rn">Next number</label><input id="rn" className="input" inputMode="numeric" value={s.receipt_next} onChange={(e) => set({ receipt_next: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} /></div>
              <div className="field grow"><label htmlFor="rf">Footer note</label><input id="rf" className="input" value={s.receipt_footer} onChange={(e) => set({ receipt_footer: e.target.value })} /></div>
            </div>
            <span className="small muted">Next receipt: <b>{s.receipt_prefix}{String(s.receipt_next).padStart(6, '0')}</b></span>
          </div>
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
        </div>
      </div>
    </AdminLayout>
  );
}
