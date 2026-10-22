import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { dateTime, peso } from '../lib/format';
import { Modal } from './ui';
import ZoomImage from './ZoomImage';

interface Sent { amount: number; method: string; reference_no?: string | null; proof_path: string | null; created_at: string; reject_reason?: string | null; note_to_buyer?: string | null }

/** "See what you sent": the screenshot and details of a rejected payment, so the buyer can spot the mistake. */
export default function SentProof({ p }: { p: Sent }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  async function show() {
    setOpen(true);
    if (!p.proof_path || url) return;
    const { data, error } = await supabase.storage.from('proofs').createSignedUrl(p.proof_path, 600);
    if (error || !data) setErr("We couldn't load your screenshot. It may have been removed.");
    else setUrl(data.signedUrl);
  }
  return (
    <>
      <button type="button" className="link small" style={{ alignSelf: 'flex-start' }} onClick={show}>See what you sent</button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="col" style={{ gap: 12 }}>
            <h3>What you sent</h3>
            <div className="facts" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
              <div><span className="small muted">Amount</span><b>{peso(p.amount)}</b></div>
              <div><span className="small muted">Paid with</span><b>{p.method}</b></div>
              {p.reference_no && <div><span className="small muted">Reference no.</span><b>{p.reference_no}</b></div>}
              <div><span className="small muted">Sent on</span><b>{dateTime(p.created_at)}</b></div>
            </div>
            {p.reject_reason && <div className="reject-note"><span><b>Why it was rejected:</b> {p.reject_reason}</span>{p.note_to_buyer && <q className="reject-quote">{p.note_to_buyer}</q>}</div>}
            {!p.proof_path ? <span className="muted">No screenshot was attached.</span>
              : err ? <span className="muted">{err}</span>
              : !url ? <span className="muted">Loading your screenshot…</span>
              : p.proof_path.endsWith('.pdf') ? <a className="btn" href={url} target="_blank" rel="noreferrer">Open the PDF you sent</a>
              : <ZoomImage src={url} alt="Your payment screenshot" style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 12 }} />}
          </div>
        </Modal>
      )}
    </>
  );
}
