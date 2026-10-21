import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ago, peso } from '../lib/format';
import type { DeviceOrder, Purchase } from '../lib/types';
import { Bell, Check, Clock, Close, Notes } from './Icons';

// The buyer's bell: payment confirmed / rejected / waiting, and replies to their help tickets.
// Built from their own rows (RLS keeps it to them); "seen" is remembered per device.

interface Note { id: string; at: string; tone: 'ok' | 'bad' | 'wait' | 'info'; title: string; body: string; to: string }

const seenKey = (uid: string) => `mn.notif.seen.${uid}`;

async function load(uid: string): Promise<Note[]> {
  const [p, o, t] = await Promise.all([
    supabase.from('purchases').select('id, file_id, status, amount, receipt_no, reject_reason, created_at, confirmed_at, method, files(name)').eq('user_id', uid).order('created_at', { ascending: false }).limit(30),
    supabase.from('device_orders').select('id, kind, qty, status, amount, receipt_no, reject_reason, created_at, confirmed_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(20),
    supabase.from('tickets').select('id, subject, status, unread_user, updated_at').eq('user_id', uid).order('updated_at', { ascending: false }).limit(20),
  ]);
  const out: Note[] = [];
  for (const r of (p.data ?? []) as unknown as (Purchase & { files: { name: string } | null })[]) {
    if (r.method === 'Granted by admin') continue;
    const name = r.files?.name ?? 'a file';
    if (r.status === 'confirmed') out.push({ id: `p-${r.id}-ok`, at: r.confirmed_at ?? r.created_at, tone: 'ok', title: 'Payment confirmed', body: `${name} is ready to read. Receipt ${r.receipt_no ?? ''}`.trim(), to: `/receipt/${r.id}` });
    else if (r.status === 'rejected') out.push({ id: `p-${r.id}-no-${r.created_at}`, at: r.created_at, tone: 'bad', title: 'Payment rejected', body: `${name}: ${r.reject_reason || 'see the reason'}. Tap to resubmit.`, to: `/checkout/${r.file_id}` });
    else out.push({ id: `p-${r.id}-wait-${r.created_at}`, at: r.created_at, tone: 'wait', title: 'Waiting for confirmation', body: `${name} · ${peso(r.amount)}`, to: '/payments' });
  }
  for (const r of (o.data ?? []) as DeviceOrder[]) {
    const name = `Extra ${r.kind} slot${r.qty > 1 ? ` ×${r.qty}` : ''}`;
    if (r.status === 'confirmed') out.push({ id: `o-${r.id}-ok`, at: r.confirmed_at ?? r.created_at, tone: 'ok', title: 'Device slot added', body: `${name} is ready. Receipt ${r.receipt_no ?? ''}`.trim(), to: `/receipt/slot/${r.id}` });
    else if (r.status === 'rejected') out.push({ id: `o-${r.id}-no-${r.created_at}`, at: r.created_at, tone: 'bad', title: 'Payment rejected', body: `${name}: ${r.reject_reason || 'see the reason'}. Tap to resubmit.`, to: `/checkout/slot/${r.kind}` });
    else out.push({ id: `o-${r.id}-wait-${r.created_at}`, at: r.created_at, tone: 'wait', title: 'Waiting for confirmation', body: `${name} · ${peso(r.amount)}`, to: '/devices' });
  }
  for (const r of (t.data ?? []) as { id: string; subject: string; status: string; unread_user: boolean; updated_at: string }[]) {
    if (r.unread_user) out.push({ id: `t-${r.id}-${r.updated_at}`, at: r.updated_at, tone: 'info', title: 'New reply from the publisher', body: r.subject, to: `/help?t=${r.id}` });
    else if (r.status === 'resolved') out.push({ id: `t-${r.id}-resolved`, at: r.updated_at, tone: 'ok', title: 'Your ticket was resolved', body: r.subject, to: `/help?t=${r.id}` });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25);
}

export default function NotificationBell({ size = 21 }: { size?: number }) {
  const { session } = useAuth();
  const nav = useNavigate();
  const uid = session?.user.id;
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<string>(() => { try { return (uid && localStorage.getItem(seenKey(uid))) || ''; } catch { return ''; } });
  const wrap = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => { if (uid) void load(uid).then(setNotes); }, [uid]);
  useEffect(() => {
    if (!uid) return;
    refresh();
    // live: a confirmation, rejection or reply shows up without refreshing
    const ch = supabase.channel(`bell-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases', filter: `user_id=eq.${uid}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'device_orders', filter: `user_id=eq.${uid}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `user_id=eq.${uid}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [uid, refresh]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const unread = notes.filter((n) => n.at > seen).length;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && notes[0] && uid) {
      // opening the list counts as seeing it; the dots stay until it closes
      try { localStorage.setItem(seenKey(uid), notes[0].at); } catch { /* private mode */ }
      setTimeout(() => setSeen(notes[0]!.at), 1500);
    }
  };
  const go = (n: Note) => { setOpen(false); nav(n.to); };

  return (
    <div className="bell-wrap" ref={wrap}>
      <button type="button" className="icon-btn bell" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-label={unread ? `${unread} new notifications` : 'Notifications'}>
        <Bell width={size} />{unread > 0 && <i className="dot">{unread > 9 ? '9+' : unread}</i>}
      </button>
      {open && (
        <div className="bell-menu" role="menu" aria-label="Notifications">
          <div className="spread bell-head"><b>Notifications</b><button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close"><Close width={18} /></button></div>
          {notes.length === 0 ? <div className="bell-empty small muted">Nothing yet. Payments, receipts and replies to your questions show up here.</div> : (
            <div className="bell-list">
              {notes.map((n) => (
                <button key={n.id} role="menuitem" className={`bell-item${n.at > seen ? ' new' : ''}`} onClick={() => go(n)}>
                  <span className={`bell-ico ${n.tone}`}>{n.tone === 'ok' ? <Check /> : n.tone === 'bad' ? <Close /> : n.tone === 'wait' ? <Clock /> : <Notes />}</span>
                  <span className="col grow" style={{ gap: 1, minWidth: 0, textAlign: 'left' }}>
                    <b>{n.title}</b><span className="small muted bell-body">{n.body}</span><span className="small muted">{ago(n.at)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
