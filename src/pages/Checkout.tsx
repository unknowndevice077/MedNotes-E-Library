import { useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { errMsg, peso } from '../lib/format';
import { KIND_LABEL, type LibFile } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import { Empty, Loading, Thumb, useIsMobile, useToast } from '../components/ui';
import { Clock, Upload } from '../components/Icons';

const MAX = 10 * 1024 * 1024;

export default function Checkout() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const mobile = useIsMobile();
  const { session, settings } = useAuth();
  const methods = (settings?.payment_methods ?? []).filter((m) => m.enabled);
  const [method, setMethod] = useState(0);
  const [proof, setProof] = useState<File | null>(null);
  const [ref, setRef] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { data: file, loading } = useLoad(async () => {
    const f = must(await supabase.from('files').select('*').eq('id', id!).single()) as LibFile;
    setAmount(String(f.price));
    return f;
  }, [id]);

  if (loading) return <ClientLayout back title="Pay"><Loading /></ClientLayout>;
  if (!file) return <ClientLayout back title="Pay"><div className="page"><Empty title="File not found" /></div></ClientLayout>;

  function pick(f?: File | null) {
    if (!f) return;
    if (f.size > MAX) return setErr('That file is over 10 MB.');
    if (!/^image\/|application\/pdf/.test(f.type)) return setErr('Upload a JPG, PNG or PDF.');
    setErr(''); setProof(f);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!proof) return setErr('Upload your proof of payment.');
    if (!ref.trim()) return setErr('Enter the reference number from your payment.');
    setBusy(true); setErr('');
    try {
      const uid = session!.user.id;
      const ext = proof.name.split('.').pop() || 'jpg';
      const path = `${uid}/${file!.id}-${Date.now()}.${ext}`;
      const up = await supabase.storage.from('proofs').upload(path, proof, { contentType: proof.type });
      if (up.error) throw up.error;
      const ins = await supabase.from('purchases').insert({
        user_id: uid, file_id: file!.id, amount: Number(amount) || file!.price, method: methods[method]?.name ?? 'Other',
        reference_no: ref.trim(), proof_path: path,
      });
      if (ins.error) throw ins.error.code === '23505' ? new Error('You already have a payment for this file waiting or confirmed.') : ins.error;
      toast('Payment submitted. The publisher will confirm it and send your receipt.');
      nav('/my-files', { replace: true });
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  }

  return (
    <ClientLayout back title={`Pay ${peso(file.price)}`} hideTabs>
      <form className="page" onSubmit={submit} style={{ flexDirection: mobile ? 'column' : 'row', alignItems: 'flex-start', gap: 28, maxWidth: 1180 }}>
        <div className="col grow" style={{ gap: 18, width: '100%' }}>
          {!mobile && <h1>Pay for your file</h1>}
          <div className="row wrap" style={{ gap: 8 }}><span className="badge b-ok">1 Pay</span><span className="muted">—</span><span className="badge b-lock">2 Publisher confirms</span><span className="muted">—</span><span className="badge b-lock">3 Receipt & unlock</span></div>
          <div className="card col">
            <h3>Send payment to</h3>
            {methods.length === 0 ? <span className="muted">The publisher hasn't added payment methods yet.</span> : (
              <div className="row wrap" style={{ alignItems: 'stretch' }}>
                {methods.map((m, i) => (
                  <button type="button" key={m.name} onClick={() => setMethod(i)} className="card col grow" style={{ gap: 2, padding: 14, minWidth: 180, textAlign: 'left',
                    border: i === method ? '2px solid var(--blue)' : undefined, background: i === method ? 'var(--blue-50)' : undefined }}>
                    <b>{m.name}</b><span className="small muted">{m.account} · {m.holder}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="card col">
            <h3>Upload proof of payment</h3>
            <div className="drop" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
              <Upload />
              <b>{proof ? proof.name : 'Drop your screenshot here, or tap to browse'}</b>
              <span className="small">JPG, PNG or PDF · max 10 MB</span>
            </div>
            <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <div className="row wrap">
              <div className="field grow"><label htmlFor="ref">Reference number</label><input id="ref" className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 8821 4407 3312" /></div>
              <div className="field" style={{ width: 180 }}><label htmlFor="amt">Amount sent (₱)</label><input id="amt" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            </div>
          </div>
          {err && <span className="error">{err}</span>}
          {!mobile && <button className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Submitting…' : 'Submit payment for confirmation'}</button>}
          {mobile && <div className="note note-slate"><Clock /><span>The publisher confirms your payment and sends a receipt. The file then unlocks.</span></div>}
        </div>
        <div className="card col" style={{ width: mobile ? '100%' : 360, flexShrink: 0 }}>
          <h3>Order summary</h3>
          <div className="row"><Thumb file={file} /><div className="col grow" style={{ gap: 0 }}><b>{file.name}</b><span className="small muted">{KIND_LABEL[file.kind]}{file.meta ? ` · ${file.meta}` : ''}</span></div></div>
          <div className="spread" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}><b>Total</b><b style={{ color: 'var(--green)', fontSize: 20 }}>{peso(file.price)}</b></div>
          <span className="small muted">The publisher checks every payment by hand. This usually takes less than 24 hours.</span>
        </div>
        {mobile && <div className="bottom-bar" style={{ width: '100%', margin: '0 -16px -24px' }}><button className="btn btn-primary btn-block" style={{ height: 50 }} disabled={busy}>{busy ? 'Submitting…' : 'Submit for confirmation'}</button></div>}
      </form>
    </ClientLayout>
  );
}
