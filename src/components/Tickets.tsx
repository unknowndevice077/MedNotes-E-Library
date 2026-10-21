import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ago, dateTime, errMsg } from '../lib/format';
import { useToast } from './ui';

// Shared by Help (buyers) and Admin → Support.

export type TicketKind = 'bug' | 'feedback' | 'payment' | 'account' | 'other';
export type TicketStatus = 'open' | 'answered' | 'resolved' | 'closed';
export interface Ticket {
  id: string; user_id: string; kind: TicketKind; subject: string; body: string; rating: number | null; satisfaction: number | null;
  attachment_path: string | null; page: string; status: TicketStatus; unread_admin: boolean; unread_user: boolean;
  created_at: string; updated_at: string;
  profiles?: { full_name: string; email: string } | null;
}
export interface TicketMessage { id: number; ticket_id: string; author_id: string | null; from_admin: boolean; body: string; created_at: string }

export const KINDS: { k: TicketKind; label: string; hint: string }[] = [
  { k: 'bug', label: 'Report a bug', hint: 'Something broken or not loading' },
  { k: 'feedback', label: 'Feedback', hint: 'Ideas, praise or what to improve' },
  { k: 'payment', label: 'Payment', hint: 'A payment, receipt or refund' },
  { k: 'account', label: 'Account & devices', hint: 'Sign-in, devices or your profile' },
  { k: 'other', label: 'Something else', hint: 'Anything else' },
];
export const kindLabel = (k: TicketKind) => KINDS.find((x) => x.k === k)?.label ?? k;
export const STATUS_LABEL: Record<TicketStatus, string> = { open: 'Open', answered: 'Answered', resolved: 'Resolved', closed: 'Closed' };
const STATUS_CLASS: Record<TicketStatus, string> = { open: 'b-pending', answered: 'b-blue', resolved: 'b-ok', closed: 'b-lock' };
export const StatusPill = ({ s }: { s: TicketStatus }) => <span className={`badge ${STATUS_CLASS[s]}`}>{STATUS_LABEL[s]}</span>;

/** 1–5 stars; read-only when there's no onChange. */
export function Stars({ value, onChange, size = 26, label = 'Rating' }: { value: number | null; onChange?: (n: number) => void; size?: number; label?: string }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value || 0;
  const words = ['', 'Bad', 'Poor', 'Okay', 'Good', 'Great'];
  return (
    <span className="stars" role={onChange ? 'radiogroup' : 'img'} aria-label={onChange ? label : `${value ?? 0} out of 5 stars`} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => onChange ? (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={n <= shown ? 'on' : ''} style={{ fontSize: size }} onMouseEnter={() => setHover(n)} onClick={() => onChange(n)}>★</button>
      ) : <i key={n} className={n <= shown ? 'on' : ''} style={{ fontSize: size }}>★</i>)}
      {onChange && shown > 0 && <span className="small muted stars-word">{words[shown]}</span>}
    </span>
  );
}

/** Opens the private screenshot with a short-lived link. */
export function Attachment({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { supabase.storage.from('tickets').createSignedUrl(path, 600).then(({ data }) => setUrl(data?.signedUrl ?? null)); }, [path]);
  return url ? <a href={url} target="_blank" rel="noreferrer" className="ticket-shot"><img src={url} alt="Attached screenshot" /></a> : <div className="ticket-shot skeleton" />;
}

/** The conversation under a ticket, live, with a reply box. */
export function Thread({ ticket, asAdmin, onChanged }: { ticket: Ticket; asAdmin?: boolean; onChanged?: () => void }) {
  const { session } = useAuth();
  const toast = useToast();
  const [msgs, setMsgs] = useState<TicketMessage[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = () => supabase.from('ticket_messages').select('*').eq('ticket_id', ticket.id).order('id').then(({ data }) => { if (alive) setMsgs((data ?? []) as TicketMessage[]); });
    load();
    // reading it clears the unread dot for this side (only when it's set, so this can't loop with the list reloading)
    if (asAdmin ? ticket.unread_admin : ticket.unread_user)
      void supabase.from('tickets').update(asAdmin ? { unread_admin: false } : { unread_user: false }).eq('id', ticket.id).then(() => onChanged?.());
    const ch = supabase.channel(`ticket-${ticket.id}-${asAdmin ? 'a' : 'u'}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticket_messages', filter: `ticket_id=eq.${ticket.id}` }, () => load())
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [ticket.id, asAdmin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [msgs?.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || !session) return;
    setBusy(true);
    const { error } = await supabase.from('ticket_messages').insert({ ticket_id: ticket.id, author_id: session.user.id, from_admin: !!asAdmin, body: text.trim() });
    setBusy(false);
    if (error) return toast(errMsg(error));
    setText(''); onChanged?.();
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="msg mine-false first">
        <div className="msg-meta"><b>{asAdmin ? ticket.profiles?.full_name || ticket.profiles?.email || 'Buyer' : 'You'}</b> · {dateTime(ticket.created_at)}</div>
        <div className="msg-body">{ticket.body}</div>
        {ticket.rating && <div className="row" style={{ gap: 6, marginTop: 6 }}><Stars value={ticket.rating} size={16} /><span className="small muted">for the app</span></div>}
        {ticket.attachment_path && <Attachment path={ticket.attachment_path} />}
      </div>
      {msgs === null ? <div className="skeleton" style={{ height: 60, borderRadius: 12 }} /> : msgs.map((m) => (
        <div key={m.id} className={`msg${m.from_admin === !!asAdmin ? ' mine' : ''}${m.from_admin ? ' staff' : ''}`}>
          <div className="msg-meta"><b>{m.from_admin ? (asAdmin ? 'You (publisher)' : 'Publisher') : asAdmin ? 'Buyer' : 'You'}</b> · {ago(m.created_at)}</div>
          <div className="msg-body">{m.body}</div>
        </div>
      ))}
      <div ref={end} />
      {ticket.status === 'closed' && !asAdmin ? (
        <div className="note note-slate"><span>This ticket is closed. Open a new one if you need more help.</span></div>
      ) : (
        <form className="reply" onSubmit={send}>
          <textarea className="input" rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={asAdmin ? 'Reply to the buyer…' : 'Add a message…'} aria-label="Reply" />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button>
        </form>
      )}
    </div>
  );
}
