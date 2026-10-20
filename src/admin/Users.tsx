import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, coverUrl } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { ago, errMsg, initials } from '../lib/format';
import type { Device, LibFile, Profile, Purchase } from '../lib/types';
import { AdminLayout } from '../components/Layouts';
import { Loading, Modal, Toggle, useIsMobile, useToast } from '../components/ui';
import { Laptop, Phone, Search } from '../components/Icons';

export function AdminUsers() {
  const nav = useNavigate();
  const mobile = useIsMobile();
  const { settings } = useAuth();
  const [q, setQ] = useState('');
  const { data, loading } = useLoad(async () => {
    const [p, d, o] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('devices').select('user_id,kind'),
      supabase.from('purchases').select('user_id').eq('status', 'confirmed'),
    ]);
    return { users: must(p) as Profile[], devices: must(d) as Pick<Device, 'user_id' | 'kind'>[], owned: must(o) as { user_id: string }[] };
  });
  const shown = useMemo(() => (data?.users ?? []).filter((u) => !q || `${u.full_name} ${u.email}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  const count = (uid: string, kind: string) => data?.devices.filter((d) => d.user_id === uid && d.kind === kind).length ?? 0;

  return (
    <AdminLayout title="Users" actions={<label className="search" style={{ width: mobile ? 160 : 320 }}><Search width={18} color="var(--slate-400)" /><input placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} /></label>}>
      {loading ? <Loading /> : (
        <div className="table">
          <div className="tr th hide-sm"><span style={{ width: 300 }}>User</span><span style={{ width: 100 }}>Sign-in</span><span style={{ width: 90 }}>Files</span><span style={{ width: 210 }}>Devices</span><span style={{ width: 120 }}>Status</span><span className="grow" /></div>
          {shown.map((u) => {
            const pc = u.computer_slots ?? settings?.computer_slots ?? 1, ph = u.phone_slots ?? settings?.phone_slots ?? 1;
            const extra = (u.computer_slots ?? pc) > (settings?.computer_slots ?? 1) || (u.phone_slots ?? ph) > (settings?.phone_slots ?? 1);
            return (
              <div key={u.id} className="tr" style={{ cursor: 'pointer' }} onClick={() => nav(`/admin/users/${u.id}`)}>
                <div className="row" style={{ width: mobile ? '100%' : 300 }}><span className="avatar">{initials(u.full_name, u.email)}</span><div className="col" style={{ gap: 0, minWidth: 0 }}><b>{u.full_name || '—'}{u.role === 'admin' && <span className="badge b-blue" style={{ marginLeft: 8 }}>Admin</span>}</b><span className="small muted">{u.email}</span></div></div>
                <span style={{ width: 100, textTransform: 'capitalize' }}>{u.provider}</span>
                <span style={{ width: 90 }}>{data!.owned.filter((o) => o.user_id === u.id).length} owned</span>
                <span style={{ width: 210 }} className="row"><span className={`badge ${count(u.id, 'computer') ? 'b-blue' : 'b-lock'}`}>PC {count(u.id, 'computer')}/{pc}</span><span className={`badge ${count(u.id, 'phone') ? 'b-ok' : 'b-lock'}`}>Phone {count(u.id, 'phone')}/{ph}</span></span>
                <span style={{ width: 120 }}>{u.suspended ? <span className="badge b-red">Suspended</span> : extra ? <span className="badge b-pending">Extra slot</span> : <span className="badge b-ok">Active</span>}</span>
                <span className="grow" />
                <Link to={`/admin/users/${u.id}`} className="btn btn-sm" onClick={(e) => e.stopPropagation()}>Manage</Link>
              </div>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
}

function Stepper({ value, placeholder, onChange }: { value: number | null; placeholder: number; onChange: (v: number | null) => void }) {
  const v = value ?? placeholder;
  return (
    <div className="stepper">
      <button className="btn btn-sm" onClick={() => onChange(Math.max(0, v - 1))} aria-label="Fewer">−</button>
      <b style={{ width: 22, textAlign: 'center' }}>{v}</b>
      <button className="btn btn-sm" onClick={() => onChange(v + 1)} aria-label="More">+</button>
      {value !== null && <button className="small link" onClick={() => onChange(null)}>default</button>}
    </div>
  );
}

export function AdminUserDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { settings, profile: me } = useAuth();
  const [o, setO] = useState<Partial<Profile> | null>(null);
  const [granting, setGranting] = useState(false);
  const { data, loading, reload } = useLoad(async () => {
    const [p, d, pu] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', id!).single(),
      supabase.from('devices').select('*').eq('user_id', id!).order('kind'),
      supabase.from('purchases').select('*, files(*)').eq('user_id', id!).order('created_at', { ascending: false }),
    ]);
    const prof = must(p) as Profile;
    setO({ computer_slots: prof.computer_slots, phone_slots: prof.phone_slots, swaps_per_30d: prof.swaps_per_30d, can_add_devices: prof.can_add_devices, admin_note: prof.admin_note });
    return { prof, devices: must(d) as Device[], purchases: must(pu) as Purchase[] };
  }, [id]);
  if (loading || !data || !o) return <AdminLayout title="User"><Loading /></AdminLayout>;
  const { prof, devices, purchases } = data;

  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    const { error } = await fn();
    if (error) toast(errMsg(error)); else { toast(ok); reload(); }
  };
  const saveOverrides = () => act(() => supabase.from('profiles').update(o).eq('id', prof.id), 'Overrides saved.');
  const isMe = me?.id === prof.id;

  return (
    <AdminLayout title={prof.full_name || prof.email} subtitle={prof.email} actions={!isMe && <>
      <button className="btn btn-danger" onClick={() => act(() => supabase.from('profiles').update({ suspended: !prof.suspended }).eq('id', prof.id), prof.suspended ? 'User reactivated.' : 'User suspended.')}>{prof.suspended ? 'Reactivate' : 'Suspend'}</button>
      <button className="btn btn-danger" onClick={async () => { if (!confirm(`Permanently delete ${prof.email}, their devices and purchases?`)) return; const { error } = await supabase.rpc('admin_delete_user', { p_user: prof.id }); if (error) toast(error.message); else { toast('User deleted.'); nav('/admin/users'); } }}>Delete user</button>
      <button className="btn" onClick={() => act(() => supabase.from('profiles').update({ role: prof.role === 'admin' ? 'client' : 'admin' }).eq('id', prof.id), 'Role changed.')}>{prof.role === 'admin' ? 'Remove admin' : 'Make admin'}</button></>}>
      <div className="row wrap" style={{ alignItems: 'flex-start', gap: 20 }}>
        <div className="col grow" style={{ gap: 16, minWidth: 320 }}>
          <div className="card col">
            <div className="spread"><h3>Devices</h3><button className="btn btn-sm" onClick={() => act(() => supabase.rpc('admin_reset_devices', { p_user: prof.id }), 'Devices reset. The user can sign in fresh.')}>Reset all devices</button></div>
            {devices.length === 0 && <span className="muted">No devices registered.</span>}
            {devices.map((d) => (
              <div key={d.id} className="device" style={{ padding: 12 }}>
                <div className={`devicon${d.kind === 'phone' ? ' g' : ''}`}>{d.kind === 'phone' ? <Phone color="var(--green)" /> : <Laptop color="var(--blue)" />}</div>
                <div className="col grow" style={{ gap: 0 }}><b>{d.label}</b><span className="small muted">{d.kind === 'phone' ? 'Phone' : 'Computer'} · {ago(d.last_seen)}</span></div>
                <button className="btn btn-sm btn-danger" onClick={() => act(() => supabase.rpc('remove_device', { p_id: d.id }), 'Device signed out.')}>Sign out</button>
              </div>
            ))}
          </div>
          <div className="card col">
            <div className="spread"><h3>Files</h3><button className="btn btn-sm" onClick={() => setGranting(true)}>+ Grant file access</button></div>
            {purchases.length === 0 && <span className="muted">No purchases.</span>}
            {purchases.map((p) => (
              <div key={p.id} className="spread">
                <span className="row"><span className="thumb"><img src={coverUrl(p.files?.cover_path)} alt="" /></span>{p.files?.name}</span>
                <span className="row">
                  <span className={`badge ${p.status === 'confirmed' ? 'b-ok' : p.status === 'pending' ? 'b-pending' : 'b-red'}`}>{p.status === 'confirmed' ? 'Unlocked' : p.status}</span>
                  {p.status === 'confirmed' && <button className="btn btn-sm btn-danger" onClick={() => { if (confirm('Revoke access to this file?')) act(() => supabase.from('purchases').delete().eq('id', p.id), 'Access revoked.'); }}>Revoke</button>}
                  {p.status === 'pending' && <Link to={`/admin/payments?id=${p.id}`} className="btn btn-sm btn-green">Review</Link>}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="card col" style={{ width: 440, maxWidth: '100%', gap: 14 }}>
          <h3>Restrictions & overrides</h3>
          <div className="setting"><div className="col" style={{ gap: 0 }}><b>Computer slots</b><span className="small muted">Default: {settings?.computer_slots}</span></div><Stepper value={o.computer_slots ?? null} placeholder={settings?.computer_slots ?? 1} onChange={(v) => setO({ ...o, computer_slots: v })} /></div>
          <div className="setting"><div className="col" style={{ gap: 0 }}><b>Phone slots</b><span className="small muted">Default: {settings?.phone_slots}</span></div><Stepper value={o.phone_slots ?? null} placeholder={settings?.phone_slots ?? 1} onChange={(v) => setO({ ...o, phone_slots: v })} /></div>
          <div className="setting"><div className="col" style={{ gap: 0 }}><b>Device swaps per 30 days</b><span className="small muted">Default: {settings?.swaps_per_30d}</span></div><Stepper value={o.swaps_per_30d ?? null} placeholder={settings?.swaps_per_30d ?? 2} onChange={(v) => setO({ ...o, swaps_per_30d: v })} /></div>
          <div className="setting"><div className="col" style={{ gap: 0 }}><b>Can add new devices</b><span className="small muted">Off locks the current devices</span></div><Toggle on={o.can_add_devices ?? settings?.users_can_add_devices ?? true} onChange={(v) => setO({ ...o, can_add_devices: v })} label="Can add new devices" /></div>
          <div className="field"><label htmlFor="anote">Admin note</label><textarea id="anote" className="input" value={o.admin_note ?? ''} onChange={(e) => setO({ ...o, admin_note: e.target.value })} /></div>
          <button className="btn btn-primary" onClick={saveOverrides}>Save overrides</button>
        </div>
      </div>
      {granting && <GrantModal userId={prof.id} owned={new Set(purchases.filter((p) => p.status === 'confirmed').map((p) => p.file_id))} onClose={() => setGranting(false)} onDone={() => { setGranting(false); reload(); }} />}
    </AdminLayout>
  );
}

function GrantModal({ userId, owned, onClose, onDone }: { userId: string; owned: Set<string>; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data } = useLoad(async () => must(await supabase.from('files').select('*').order('name')) as LibFile[]);
  return (
    <Modal onClose={onClose}>
      <h2>Grant file access</h2>
      <span className="muted">The user gets the file without paying. It shows as "Granted by admin".</span>
      <div className="col" style={{ gap: 8, maxHeight: 380, overflow: 'auto' }}>
        {(data ?? []).filter((f) => !owned.has(f.id)).map((f) => (
          <button key={f.id} className="card row" style={{ padding: 10, textAlign: 'left' }} onClick={async () => {
            const { error } = await supabase.rpc('admin_grant_file', { p_user: userId, p_file: f.id });
            if (error) toast(error.message); else { toast(`Granted ${f.name}.`); onDone(); }
          }}><span className="thumb"><img src={coverUrl(f.cover_path)} alt="" /></span><b className="grow">{f.name}</b><span className="link">Grant</span></button>
        ))}
      </div>
      <button className="btn" onClick={onClose}>Close</button>
    </Modal>
  );
}
