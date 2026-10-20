import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { deviceId, deviceReasonText } from '../lib/device';
import { must, useLoad } from '../lib/useLoad';
import { ago } from '../lib/format';
import type { Device } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import { useConfirm, useIsMobile, useToast } from '../components/ui';
import { Laptop, Phone, Shield } from '../components/Icons';
import { DevicesSkeleton } from '../components/Skeletons';

export default function Devices() {
  const { session, profile, settings } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const mobile = useIsMobile();
  const [mine, setMine] = useState('');
  useEffect(() => { deviceId().then(setMine); }, []);
  const { data, loading, reload } = useLoad(async () => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [d, e] = await Promise.all([
      supabase.from('devices').select('*').eq('user_id', session!.user.id).order('kind'),
      supabase.from('device_events').select('id', { count: 'exact', head: true }).eq('user_id', session!.user.id).in('action', ['swapped', 'removed']).gte('at', since),
    ]);
    return { devices: must(d) as Device[], swaps: e.count ?? 0 };
  }, [session?.user.id]);

  const computers = profile?.computer_slots ?? settings?.computer_slots ?? 1;
  const phones = profile?.phone_slots ?? settings?.phone_slots ?? 1;
  const swapLimit = profile?.swaps_per_30d ?? settings?.swaps_per_30d ?? 2;

  async function remove(d: Device) {
    if (!(await confirm({ title: `Remove ${d.label}?`, body: 'It is signed out and removed from your account. This uses one of your device swaps.', confirmLabel: 'Remove device', danger: true }))) return;
    const { data: r, error } = await supabase.rpc('remove_device', { p_id: d.id });
    if (error) return toast(error.message);
    if (!r.ok) return toast(deviceReasonText[r.reason] ?? 'Could not remove that device.');
    toast('Device removed.'); reload();
  }

  const slot = (kind: 'computer' | 'phone', limit: number) => {
    const list = (data?.devices ?? []).filter((d) => d.kind === kind);
    return (
      <>
        {list.map((d) => (
          <div key={d.id} className="device">
            <div className={`devicon${kind === 'phone' ? ' g' : ''}`}>{kind === 'phone' ? <Phone color="var(--green)" /> : <Laptop color="var(--blue)" />}</div>
            <div className="col grow" style={{ gap: 2 }}>
              <div className="row" style={{ gap: 8 }}><b>{d.label}</b>{d.device_id === mine && <span className="badge b-blue">This device</span>}</div>
              <span className="small muted">{kind === 'phone' ? 'Phone slot' : 'Computer slot'} · {d.device_id === mine ? 'active now' : `last active ${ago(d.last_seen)}`}</span>
            </div>
            {!mobile && <span className={`badge ${kind === 'phone' ? 'b-ok' : 'b-blue'}`}>{list.length}/{limit} {kind === 'phone' ? 'Phone' : 'Computer'}</span>}
            {d.device_id !== mine && <button className="btn btn-sm btn-danger" onClick={() => remove(d)}>Remove</button>}
          </div>
        ))}
        {list.length < limit && (
          <div className="device" style={{ borderStyle: 'dashed', background: 'var(--bg)' }}>
            <div className={`devicon${kind === 'phone' ? ' g' : ''}`}>{kind === 'phone' ? <Phone color="var(--green)" /> : <Laptop color="var(--blue)" />}</div>
            <span className="muted">{kind === 'phone' ? 'Phone slot free: sign in on the MedNotes app' : 'Computer slot free: sign in from your computer\'s browser'}</span>
          </div>
        )}
      </>
    );
  };

  return (
    <ClientLayout title="Devices">
      <div className="page" style={{ maxWidth: 940, margin: mobile ? undefined : '0' }}>
        <div className="col" style={{ gap: 4 }}>
          {!mobile && <h1>Your devices</h1>}
          <span className="muted">Your plan allows {computers} computer{computers === 1 ? '' : 's'} and {phones} phone{phones === 1 ? '' : 's'}. On a computer, MedNotes runs in your web browser, so there's nothing to install. Offline reading is only in the mobile app. Removing a device signs it out.</span>
        </div>
        {loading ? <DevicesSkeleton /> : <>{slot('computer', computers)}{slot('phone', phones)}</>}
        <div className="note note-blue"><Shield /><span>Need another device? Ask the publisher. Admins can grant extra slots or reset your devices.</span></div>
        <div className="card col" style={{ gap: 10 }}>
          <h3>Device swaps used</h3>
          <div style={{ height: 8, background: 'var(--line)', borderRadius: 4 }}><div style={{ width: `${Math.min(100, ((data?.swaps ?? 0) / Math.max(1, swapLimit)) * 100)}%`, height: 8, background: 'var(--blue)', borderRadius: 4 }} /></div>
          <span className="small muted">{data?.swaps ?? 0} of {swapLimit} swaps used in the last 30 days</span>
        </div>
      </div>
    </ClientLayout>
  );
}
