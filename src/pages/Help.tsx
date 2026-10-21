import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { ago, errMsg } from '../lib/format';
import { ClientLayout } from '../components/Layouts';
import { Modal, useIsMobile, useToast } from '../components/ui';
import { RowsSkeleton } from '../components/Skeletons';
import { Back, Upload } from '../components/Icons';
import { KINDS, kindLabel, Stars, StatusPill, Thread, type Ticket, type TicketKind } from '../components/Tickets';

const FAQ: { q: string; a: string }[] = [
  { q: 'I paid. When does my file open?', a: 'The publisher checks every payment by hand, usually within 24 hours. Your receipt pops up and the file opens as soon as it\'s confirmed.' },
  { q: 'My payment was rejected. What now?', a: 'Open the file or Payments & receipts and press Resubmit. Upload a new screenshot; it updates the same payment, so nothing is charged twice.' },
  { q: 'It says my device limit is reached.', a: 'Each account works on 1 computer and 1 phone. Remove an old device in Devices, or buy an extra slot there.' },
  { q: 'Can I download the files?', a: 'No. Files are view-only inside MedNotes. In the Android app you can save them for offline reading.' },
];

/** Help & support: quick answers, new ticket (with stars and a screenshot), and the buyer's tickets. */
export default function Help() {
  const { session } = useAuth();
  const mobile = useIsMobile();
  const [sp, setSp] = useSearchParams();
  const [composing, setComposing] = useState(sp.get('new') === '1');
  const openId = sp.get('t');
  const { data, loading, reload } = useLoad(async () =>
    must(await supabase.from('tickets').select('*').eq('user_id', session!.user.id).order('updated_at', { ascending: false })) as Ticket[], [session?.user.id]);
  // live: a reply from the publisher shows up right away
  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel('my-tickets').on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `user_id=eq.${session.user.id}` }, () => reload()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [session, reload]);
  const open = data?.find((t) => t.id === openId) ?? null;

  if (open) return <TicketView t={open} onBack={() => setSp({})} onChanged={reload} />;

  return (
    <ClientLayout title="Help">
      <div className="page" style={{ maxWidth: 900, margin: mobile ? undefined : '0' }}>
        {!mobile && <div className="col" style={{ gap: 4 }}><h1>Help & feedback</h1><span className="muted">Report a problem, send feedback or ask the publisher anything. We usually reply within a day.</span></div>}
        <div className="help-start">
          {KINDS.map((k) => (
            <button key={k.k} type="button" className="help-kind" onClick={() => { setComposing(true); setSp({ new: '1', kind: k.k }); }}>
              <b>{k.label}</b><span className="small muted">{k.hint}</span>
            </button>
          ))}
        </div>
        <div className="card col" style={{ gap: 10 }}>
          <h3>My tickets</h3>
          {loading && !data ? <RowsSkeleton rows={3} /> : !data?.length ? <span className="small muted">You haven't opened any tickets yet.</span> : data.map((t) => (
            <button key={t.id} type="button" className="ticket-row" onClick={() => setSp({ t: t.id })}>
              {t.unread_user && <i className="unread-dot" aria-label="New reply" />}
              <span className="col grow" style={{ gap: 2, minWidth: 0, textAlign: 'left' }}>
                <b className="ellipsis">{t.subject}</b>
                <span className="small muted">{kindLabel(t.kind)} · updated {ago(t.updated_at)}</span>
              </span>
              <StatusPill s={t.status} />
            </button>
          ))}
        </div>
        <div className="card col" style={{ gap: 4 }}>
          <h3>Quick answers</h3>
          {FAQ.map((f) => <details key={f.q} className="faq"><summary>{f.q}</summary><p className="small muted">{f.a}</p></details>)}
          <span className="small muted" style={{ marginTop: 6 }}>Also see <Link to="/payments" className="link">Payments & receipts</Link> and <Link to="/devices" className="link">Devices</Link>.</span>
        </div>
      </div>
      {composing && <NewTicket kind={(sp.get('kind') as TicketKind) || 'bug'} onClose={() => { setComposing(false); setSp({}); }} onCreated={(id) => { setComposing(false); reload(); setSp({ t: id }); }} />}
    </ClientLayout>
  );
}

function NewTicket({ kind: initial, onClose, onCreated }: { kind: TicketKind; onClose: () => void; onCreated: (id: string) => void }) {
  const { session } = useAuth();
  const toast = useToast();
  const [kind, setKind] = useState<TicketKind>(KINDS.some((k) => k.k === initial) ? initial : 'bug');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [shot, setShot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function pick(f?: File | null) {
    if (!f) return;
    if (!/^image\//.test(f.type)) return setErr('Attach a picture (PNG or JPG).');
    if (f.size > 5 * 1024 * 1024) return setErr('Use a picture under 5 MB.');
    setErr(''); setShot(f); setPreview(URL.createObjectURL(f));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (subject.trim().length < 3) return setErr('Add a short subject.');
    if (body.trim().length < 3) return setErr('Tell us a bit more.');
    if (kind === 'feedback' && !rating) return setErr('Give the app a star rating.');
    setBusy(true); setErr('');
    try {
      let attachment_path: string | null = null;
      if (shot) {
        attachment_path = `${session!.user.id}/${Date.now()}.${(shot.name.split('.').pop() || 'png').toLowerCase()}`;
        const up = await supabase.storage.from('tickets').upload(attachment_path, shot, { contentType: shot.type });
        if (up.error) throw up.error;
      }
      const { data, error } = await supabase.from('tickets').insert({
        user_id: session!.user.id, kind, subject: subject.trim(), body: body.trim(), rating, attachment_path,
        page: document.referrer ? new URL(document.referrer).pathname.slice(0, 120) : '',
      }).select('id').single();
      if (error) throw error;
      toast('Sent. The publisher will reply here.');
      onCreated(data.id);
    } catch (e2) { setErr(errMsg(e2)); } finally { setBusy(false); }
  }

  return (
    <Modal onClose={onClose} width={600}>
      <form className="col" style={{ gap: 14 }} onSubmit={submit}>
        <h2>How can we help?</h2>
        <div className="chips">{KINDS.map((k) => <button key={k.k} type="button" className={`chip${kind === k.k ? ' on' : ''}`} onClick={() => setKind(k.k)}>{k.label}</button>)}</div>
        <div className="field"><label htmlFor="t-subject">Subject</label>
          <input id="t-subject" className="input" maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)}
            placeholder={kind === 'bug' ? 'e.g. The PDF won\'t open on my phone' : kind === 'feedback' ? 'e.g. Love the dark mode!' : 'A few words'} /></div>
        <div className="field"><label htmlFor="t-body">{kind === 'bug' ? 'What happened? What did you expect?' : 'Details'}</label>
          <textarea id="t-body" className="input" rows={5} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        <div className="field"><label>{kind === 'feedback' ? 'How would you rate MedNotes?' : 'How is MedNotes for you so far? (optional)'}</label>
          <Stars value={rating} onChange={setRating} label="Rate MedNotes" /></div>
        <div className="field"><label>Screenshot (optional)</label>
          {preview ? (
            <div className="row" style={{ gap: 12 }}>
              <img src={preview} alt="Screenshot to attach" className="ticket-preview" />
              <div className="col" style={{ gap: 6 }}><span className="small ellipsis">{shot?.name}</span>
                <span className="row" style={{ gap: 6 }}><button type="button" className="btn btn-sm" onClick={() => input.current?.click()}>Change</button>
                  <button type="button" className="btn btn-sm" onClick={() => { setShot(null); setPreview(null); }}>Remove</button></span></div>
            </div>
          ) : (
            <div className="drop" style={{ minHeight: 90 }} onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
              <Upload /><b>Add a screenshot</b><span className="small">PNG or JPG · max 5 MB</span>
            </div>
          )}
          <input ref={input} id="t-file" type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} /></div>
        {err && <span className="error">{err}</span>}
        <div className="row"><button type="button" className="btn grow" onClick={onClose}>Cancel</button><button className="btn btn-primary grow" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button></div>
      </form>
    </Modal>
  );
}

function TicketView({ t, onBack, onChanged }: { t: Ticket; onBack: () => void; onChanged: () => void }) {
  const toast = useToast();
  const mobile = useIsMobile();
  const update = async (patch: Partial<Ticket>, msg: string) => {
    const { error } = await supabase.from('tickets').update(patch).eq('id', t.id);
    if (error) return toast(errMsg(error));
    toast(msg); onChanged();
  };
  return (
    <ClientLayout back title="Ticket" hideTabs>
      <div className="page" style={{ maxWidth: 820, margin: mobile ? undefined : '0' }}>
        {!mobile && <button className="link row" style={{ gap: 4, alignSelf: 'flex-start' }} onClick={onBack}><Back width={16} /> All tickets</button>}
        <div className="spread wrap" style={{ gap: 10 }}>
          <div className="col" style={{ gap: 2 }}><h2 style={{ margin: 0 }}>{t.subject}</h2><span className="small muted">{kindLabel(t.kind)} · opened {ago(t.created_at)}</span></div>
          <StatusPill s={t.status} />
        </div>
        {(t.status === 'resolved' || t.status === 'closed') && (
          <div className="card col" style={{ gap: 8 }}>
            <b>{t.satisfaction ? 'Thanks for rating the help' : 'How was the help you got?'}</b>
            <Stars value={t.satisfaction} onChange={(n) => update({ satisfaction: n }, 'Thanks for the rating!')} label="Rate the help" />
          </div>
        )}
        <div className="card"><Thread ticket={t} onChanged={onChanged} /></div>
        <div className="row wrap" style={{ gap: 8 }}>
          {t.status !== 'closed' ? <button className="btn" onClick={() => update({ status: 'closed' }, 'Ticket closed.')}>Close ticket</button>
            : <button className="btn" onClick={() => update({ status: 'open' }, 'Ticket reopened.')}>Reopen</button>}
        </div>
      </div>
    </ClientLayout>
  );
}
