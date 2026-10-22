import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { bytes } from '../lib/format';
import { listSaved, offlineExpired, removeOffline, type SavedFile } from '../lib/offline';
import { ClientLayout } from '../components/Layouts';
import { Empty, Thumb, useToast } from '../components/ui';
import { Wifi } from '../components/Icons';

export default function SavedOffline() {
  const { online, settings } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [list, setList] = useState<SavedFile[] | null>(null);
  const [expired, setExpired] = useState(false);
  const days = settings?.offline_days ?? 30;
  useEffect(() => { listSaved().then(setList); offlineExpired(days).then(setExpired); }, [days]);

  async function remove(f: SavedFile) {
    await removeOffline(f.id);
    setList(await listSaved());
    toast(`${f.name} removed from this phone.`);
  }
  const total = (list ?? []).reduce((a, f) => a + f.size, 0);

  return (
    <ClientLayout back title="Saved offline">
      <div className="page">
        {!online && <div className="note note-slate"><Wifi /><span>You're offline. Your saved files still open.</span></div>}
        {expired && <div className="note note-red"><span>Saved files are locked because this phone hasn't been online for {days} days. Connect to the internet once to unlock them.</span></div>}
        {list && list.length === 0 && <Empty title="Nothing saved yet">Open a file you own and tap <b>Save offline</b>.</Empty>}
        {(list ?? []).map((f) => (
          <div key={f.id} className="card row" style={{ padding: 12 }}>
            <Thumb file={f} />
            <div className="col grow" style={{ gap: 4 }}><b>{f.name}</b><span className="badge b-ok" style={{ alignSelf: 'flex-start' }}>Saved · {bytes(f.size)}</span></div>
            <button className="btn btn-sm btn-primary" disabled={expired} onClick={() => nav(`/read/${f.id}?offline=1`)}>Open</button>
            <button className="btn btn-sm btn-danger" onClick={() => remove(f)} aria-label={`Remove ${f.name}`}>✕</button>
          </div>
        ))}
        {list && list.length > 0 && (
          <span className="small muted">{list.length} files · {bytes(total)} on this phone. Saved files stay encrypted inside the app and can't be copied out. They lock if the phone stays offline for more than {days} days.</span>
        )}
      </div>
    </ClientLayout>
  );
}
