import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { deviceReasonText, swapDevice } from '../lib/device';
import { deviceKind } from '../lib/platform';
import { ago } from '../lib/format';
import { Modal } from './ui';
import { Laptop, Phone } from './Icons';

/** Blocks the app when this device can't take a slot (Netflix-style limit). */
export default function DeviceGate() {
  const { device, recheckDevice, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!device || device.ok) return null;
  const phone = deviceKind() === 'phone';
  const Icon = phone ? Phone : Laptop;

  async function swap(id: string) {
    setBusy(true); setMsg('');
    const r = await swapDevice(id);
    setBusy(false);
    if (r.ok) await recheckDevice();
    else setMsg(r.reason === 'error' ? r.message ?? 'Something went wrong.' : deviceReasonText[r.reason] ?? 'Could not switch devices.');
  }

  return (
    <Modal>
      <div className={`devicon${phone ? ' g' : ''}`} style={{ width: 60, height: 60 }}><Icon color={phone ? 'var(--green)' : 'var(--blue)'} /></div>
      {device.reason === 'limit' ? (
        <>
          <h2>{phone ? 'Phone' : 'Computer'} limit reached</h2>
          <span className="muted">Your account is already signed in on another {phone ? 'phone' : 'computer'}. Sign that one out to use this one. Switching counts as one of your device swaps for the month.</span>
          {device.devices.map((d) => (
            <div key={d.id} className="device" style={{ padding: 14 }}>
              <div className={`devicon${phone ? ' g' : ''}`}><Icon color={phone ? 'var(--green)' : 'var(--blue)'} /></div>
              <div className="col grow" style={{ gap: 0 }}><b>{d.label}</b><span className="small muted">Last active {ago(d.last_seen)}</span></div>
              <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => swap(d.id)}>Sign it out</button>
            </div>
          ))}
        </>
      ) : (
        <>
          <h2>Can't use this device</h2>
          <span className="muted">{device.reason === 'error' ? device.message : deviceReasonText[device.reason]}</span>
        </>
      )}
      {msg && <span className="error">{msg}</span>}
      <button className="btn" onClick={signOut}>Cancel and sign out</button>
    </Modal>
  );
}
