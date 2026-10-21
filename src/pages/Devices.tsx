import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { deviceId, deviceReasonText } from '../lib/device';
import { must, useLoad } from '../lib/useLoad';
import { ago, dateOnly, peso } from '../lib/format';
import type { Device, DeviceOrder } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import { useConfirm, useIsMobile, useToast } from '../components/ui';
import { Laptop, Phone, Receipt, Shield } from '../components/Icons';
import { RejectNote, StatusBadge } from '../components/ui';
import { DevicesSkeleton } from '../components/Skeletons';
import { Tx } from '../lib/theme';

export default function Devices() {
  const { session, profile, settings } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const mobile = useIsMobile();
  const [mine, setMine] = useState('');
  useEffect(() => { deviceId().then(setMine); }, []);
  const { data, loading, reload } = useLoad(async () => {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [d, e, o, p] = await Promise.all([
      supabase.from('devices').select('*').eq('user_id', session!.user.id).order('kind'),
      supabase.from('device_events').select('id', { count: 'exact', head: true }).eq('user_id', session!.user.id).in('action', ['swapped', 'removed']).gte('at', since),
      supabase.from('device_orders').select('*').eq('user_id', session!.user.id).order('created_at', { ascending: false }),
      // read the limits fresh: a confirmed slot order raises them while the app is open
      supabase.from('profiles').select('computer_slots, phone_slots').eq('id', session!.user.id).single(),
    ]);
    return { devices: must(d) as Device[], swaps: e.count ?? 0, orders: (o.data ?? []) as DeviceOrder[], limits: p.data };
  }, [session?.user.id]);

  // live: the slot appears as soon as the publisher confirms the order
  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel('my-device-orders')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'device_orders', filter: `user_id=eq.${session.user.id}` }, (p) => {
        if ((p.new as DeviceOrder).status === 'confirmed') toast('Payment confirmed: your extra device slot is ready.');
        reload();
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, reload, toast]);

  const computers = data?.limits?.computer_slots ?? profile?.computer_slots ?? settings?.computer_slots ?? 1;
  const phones = data?.limits?.phone_slots ?? profile?.phone_slots ?? settings?.phone_slots ?? 1;
  const pendingOrder = (data?.orders ?? []).find((o) => o.status === 'pending');
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
    <ClientLayout title={<Tx k="nav.devices" />}>
      <div className="page" style={{ maxWidth: 940, margin: mobile ? undefined : '0' }}>
        <div className="col" style={{ gap: 4 }}>
          {!mobile && <h1><Tx k="devices.title" /></h1>}
          <span className="muted">Your plan allows {computers} computer{computers === 1 ? '' : 's'} and {phones} phone{phones === 1 ? '' : 's'}. On a computer, MedNotes runs in your web browser, so there's nothing to install. Offline reading is only in the mobile app. Removing a device signs it out.</span>
        </div>
        {loading ? <DevicesSkeleton /> : <>{slot('computer', computers)}{slot('phone', phones)}</>}
        {settings?.slot_sales ? (
          <div className="card col buy-slot">
            <h3><Tx k="devices.buyTitle" /></h3>
            <span className="small muted"><Tx k="devices.buyText" /></span>
            {pendingOrder ? (
              <div className="note note-amber"><span>Your order for {pendingOrder.qty} extra {pendingOrder.kind} slot{pendingOrder.qty > 1 ? 's' : ''} is waiting for confirmation.</span></div>
            ) : (
              <div className="row wrap" style={{ gap: 12 }}>
                <Link to="/checkout/slot/computer" className="slot-offer"><span className="slot-ico"><Laptop /></span><span className="col" style={{ gap: 0 }}><b>Extra computer</b><span className="small muted">{peso(settings.slot_price_computer)} · one-time</span></span></Link>
                <Link to="/checkout/slot/phone" className="slot-offer"><span className="slot-ico g"><Phone /></span><span className="col" style={{ gap: 0 }}><b>Extra phone</b><span className="small muted">{peso(settings.slot_price_phone)} · one-time</span></span></Link>
              </div>
            )}
          </div>
        ) : (
          <div className="note note-blue"><Shield /><span><Tx k="devices.askText" /></span></div>
        )}
        {(data?.orders ?? []).length > 0 && (
          <div className="card col" style={{ gap: 10 }}>
            <h3>Device slot orders</h3>
            {data!.orders.map((o) => (
              <div key={o.id} className="spread wrap" style={{ gap: 8 }}>
                <span className="col" style={{ gap: 0 }}><b>{o.qty} extra {o.kind} slot{o.qty > 1 ? 's' : ''} · {peso(o.amount)}</b><span className="small muted">{dateOnly(o.created_at)}</span>{o.status === 'rejected' && <RejectNote compact reason={o.reject_reason} note={o.note_to_buyer} />}</span>
                <span className="row" style={{ gap: 8 }}><StatusBadge status={o.status} />
                  {o.receipt_no && <Link to={`/receipt/slot/${o.id}`} className="link row" style={{ gap: 4 }}><Receipt width={16} /> {o.receipt_no}</Link>}
                  {o.status === 'rejected' && settings?.slot_sales && !pendingOrder && <Link to={`/checkout/slot/${o.kind}`} className="btn btn-sm">Resubmit</Link>}</span>
              </div>
            ))}
          </div>
        )}
        <div className="card col" style={{ gap: 10 }}>
          <h3><Tx k="devices.swaps" /></h3>
          <div style={{ height: 8, background: 'var(--line)', borderRadius: 4 }}><div style={{ width: `${Math.min(100, ((data?.swaps ?? 0) / Math.max(1, swapLimit)) * 100)}%`, height: 8, background: 'var(--blue)', borderRadius: 4 }} /></div>
          <span className="small muted">{data?.swaps ?? 0} of {swapLimit} swaps used in the last 30 days</span>
        </div>
      </div>
    </ClientLayout>
  );
}
