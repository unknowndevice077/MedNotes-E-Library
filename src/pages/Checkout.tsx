import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase, paymentQrUrl } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { errMsg, peso } from '../lib/format';
import { KIND_LABEL, type LibFile, type PaymentMethod } from '../lib/types';
import { isQrPh, withAmount } from '../lib/qrph';
import { qrDataUrl } from '../lib/qrimage';
import { isNative } from '../lib/platform';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { AppLauncher } from '@capacitor/app-launcher';
import { ClientLayout } from '../components/Layouts';
import { Empty, Loading, Thumb, useIsMobile, useToast } from '../components/ui';
import { Clock, Download, Upload } from '../components/Icons';

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
            {methods[method] && (methods[method]!.qr_payload || methods[method]!.qr_path) && <PayQr m={methods[method]!} price={Number(file.price)} fileName={file.name} />}
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

const GCASH_ANDROID = 'com.globe.gcash.android';

/** The payment QR: rebuilt per purchase with the price filled in when the publisher's QR is a QR Ph code. */
function PayQr({ m, price, fileName }: { m: PaymentMethod; price: number; fileName: string }) {
  const toast = useToast();
  const mobile = useIsMobile();
  const dynamic = !!m.qr_payload && isQrPh(m.qr_payload);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (dynamic) qrDataUrl(withAmount(m.qr_payload!, price)).then(setSrc);
    else setSrc(paymentQrUrl(m.qr_path));
  }, [dynamic, m.qr_payload, m.qr_path, price]);
  const isGcash = /gcash/i.test(m.name);
  const fname = `MedNotes-${m.name}-${price.toFixed(0)}.png`.replace(/\s+/g, '-');

  async function saveQr() {
    if (!src) return;
    try {
      const blob = await (await fetch(src)).blob();
      if (isNative) {
        const data = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]!); fr.readAsDataURL(blob); });
        const { uri } = await Filesystem.writeFile({ path: fname, data, directory: Directory.Cache });
        await Share.share({ title: `${m.name} payment QR`, text: `Pay ${peso(price)} for ${fileName}`, files: [uri], dialogTitle: 'Save the QR to your gallery' });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = fname; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
    } catch (e) { if (!String(e).includes('cancel')) toast('Could not save the QR: ' + errMsg(e)); }
  }
  async function openGcash() {
    try { await AppLauncher.openUrl({ url: GCASH_ANDROID }); }
    catch { toast("Couldn't open GCash. Is it installed?"); }
  }

  return (
    <div className="row wrap" style={{ alignItems: 'center', gap: 20, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
      <div className="col" style={{ gap: 8, alignItems: 'center', flexShrink: 0 }}>
        {src ? <img src={src} alt={`${m.name} QR code for ${peso(price)}`} style={{ width: 220, borderRadius: 12, border: '1px solid var(--line)', background: '#fff' }} /> : <div className="spinner" />}
        {dynamic && <span className="badge b-ok">{peso(price)} already filled in</span>}
      </div>
      <div className="col" style={{ gap: 10, flex: 1, minWidth: 230 }}>
        {mobile ? (
          <ol className="col" style={{ gap: 6, paddingLeft: 18, margin: 0 }}>
            <li><b>Save the QR</b> to your gallery (or take a screenshot).</li>
            <li>Open <b>{m.name}</b> → <b>Pay QR</b> → <b>Upload QR</b>, and pick the saved image.</li>
            <li>{dynamic ? <>Check the amount is <b style={{ color: 'var(--green)' }}>{peso(price)}</b> and pay.</> : <>Enter <b style={{ color: 'var(--green)' }}>{peso(price)}</b> and pay.</>}</li>
            <li>Screenshot the receipt and upload it below.</li>
          </ol>
        ) : (
          <ol className="col" style={{ gap: 6, paddingLeft: 18, margin: 0 }}>
            <li>Open <b>{m.name}</b> on your phone and tap <b>Pay QR</b>.</li>
            <li>Scan this QR{dynamic ? <>. The amount <b style={{ color: 'var(--green)' }}>{peso(price)}</b> is already filled in.</> : <> and enter <b style={{ color: 'var(--green)' }}>{peso(price)}</b>.</>}</li>
            <li>Pay to {m.holder}, then screenshot the receipt and upload it below.</li>
          </ol>
        )}
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={saveQr} disabled={!src}><Download /> Save QR</button>
          {isNative && isGcash && <button type="button" className="btn btn-sm btn-primary" onClick={openGcash}>Open GCash</button>}
        </div>
      </div>
    </div>
  );
}
