import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
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
import { ClientLayout, invalidateCounts } from '../components/Layouts';
import { Empty, RejectNote, Thumb, useIsMobile, useToast } from '../components/ui';
import { Clock, Download, Files, Laptop, Lock, Phone, Upload } from '../components/Icons';
import { CheckoutSkeleton } from '../components/Skeletons';
import { Tx } from '../lib/theme';
import ZoomImage from '../components/ZoomImage';

const MAX = 10 * 1024 * 1024;

// The proof is uploaded as soon as it's picked and remembered per account + item, so a refresh
// (or coming back later) still shows it and the buyer only has to press submit.
type Draft = { path: string; name: string; type: string; method?: number };
const draftKey = (uid: string, item: string) => `mn.checkout.${uid}.${item}`;
function readDraft(key: string): Draft | null {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function writeDraft(key: string, d: Draft | null) {
  try { if (d) localStorage.setItem(key, JSON.stringify(d)); else localStorage.removeItem(key); } catch { /* private mode */ }
}

/**
 * Pay by GCash/Maya/bank and upload proof. Used for files (/checkout/:id) and for extra device
 * slots (/checkout/slot/:slotKind); the publisher confirms either one and a receipt is issued.
 */
export default function Checkout() {
  const { id, slotKind } = useParams();
  const slot = slotKind === 'computer' || slotKind === 'phone' ? slotKind : null;
  const nav = useNavigate();
  const toast = useToast();
  const mobile = useIsMobile();
  const { session, settings } = useAuth();
  const methods = (settings?.payment_methods ?? []).filter((m) => m.enabled);
  const key = session ? draftKey(session.user.id, slot ? `slot-${slot}` : id ?? '') : '';
  const [method, setMethodState] = useState(() => readDraft(key)?.method ?? 0);
  const [proof, setProof] = useState<Draft | null>(() => readDraft(key));
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // device slots: step 1 picks how many, then the count (and so the price) is locked while paying
  const qtyKey = `${key}.qty`;
  const [qty, setQty] = useState(() => { try { return Number(localStorage.getItem(qtyKey)) || 1; } catch { return 1; } });
  const [locked, setLocked] = useState(() => { try { return !!localStorage.getItem(qtyKey); } catch { return false; } });
  const lockQty = (on: boolean) => { setLocked(on); try { if (on) localStorage.setItem(qtyKey, String(qty)); else localStorage.removeItem(qtyKey); } catch { /* private mode */ } };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { data: file, loading } = useLoad(async () => {
    if (slot) return null;
    return must(await supabase.from('files').select('*').eq('id', id!).single()) as LibFile;
  }, [id, slot]);
  // a rejected payment for this item is resubmitted in place (no second transaction)
  const { data: rejected } = useLoad(async () => {
    if (!session) return null;
    const q = slot
      ? supabase.from('device_orders').select('id, status, reject_reason, note_to_buyer, qty').eq('user_id', session.user.id).eq('kind', slot)
      : supabase.from('purchases').select('id, status, reject_reason, note_to_buyer').eq('user_id', session.user.id).eq('file_id', id!);
    const rows = (await q.order('created_at', { ascending: false })).data ?? [];
    if (rows.some((r) => r.status === 'pending')) return null;
    return (rows.find((r) => r.status === 'rejected') ?? null) as { id: string; reject_reason: string; note_to_buyer: string; qty?: number } | null;
  }, [id, slot, session?.user.id]);
  const unitSlot = slot ? Number(slot === 'computer' ? settings?.slot_price_computer : settings?.slot_price_phone) || 0 : 0;
  const setMethod = (i: number) => { setMethodState(i); if (proof) writeDraft(key, { ...proof, method: i }); };

  // after a refresh: show the screenshot that's already uploaded (signed link, only the buyer and admins can open it)
  useEffect(() => {
    if (!proof || preview) return;
    if (!proof.type.startsWith('image/')) return;
    supabase.storage.from('proofs').createSignedUrl(proof.path, 3600).then(({ data, error }) => {
      if (error || !data) { setProof(null); writeDraft(key, null); } // gone (e.g. removed): start over
      else setPreview(data.signedUrl);
    });
  }, [proof, preview, key]);
  useEffect(() => () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);

  if (!slot && loading) return <ClientLayout back title="Pay"><div className="page"><CheckoutSkeleton /></div></ClientLayout>;
  if (!slot && !file) return <ClientLayout back title="Pay"><div className="page"><Empty title="File not found" /></div></ClientLayout>;
  if (file?.is_free) return <Navigate to={`/file/${file.id}`} replace />;
  if (slot && settings && !settings.slot_sales) return <ClientLayout back title="Pay"><div className="page"><Empty title="Extra devices aren't for sale">Ask the publisher to add a device for you.</Empty></div></ClientLayout>;
  const price = slot ? unitSlot * qty : Number(file!.price);
  const itemName = slot ? `Extra ${slot} slot${qty > 1 ? ` ×${qty}` : ''}` : file!.name;

  async function pick(f?: File | null) {
    if (!f || !session) return;
    if (f.size > MAX) return setErr('That file is over 10 MB.');
    if (!/^image\/|application\/pdf/.test(f.type)) return setErr('Upload a JPG, PNG or PDF.');
    setErr(''); setUploading(true);
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${session.user.id}/${slot ? `slot-${slot}` : file!.id}-${Date.now()}.${ext}`;
    const up = await supabase.storage.from('proofs').upload(path, f, { contentType: f.type });
    setUploading(false);
    if (up.error) return setErr(errMsg(up.error));
    if (proof) void supabase.storage.from('proofs').remove([proof.path]); // replaced: drop the old one
    const d = { path, name: f.name, type: f.type, method };
    writeDraft(key, d); setProof(d);
    setPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null);
  }
  async function clearProof() {
    if (!proof) return;
    void supabase.storage.from('proofs').remove([proof.path]);
    writeDraft(key, null); setProof(null); setPreview(null);
    if (input.current) input.current.value = '';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!proof) return setErr('Upload the screenshot of your payment.');
    setBusy(true); setErr('');
    try {
      // the amount is set by the server from the real price
      const common = { user_id: session!.user.id, amount: price, method: methods[method]?.name ?? 'Other', proof_path: proof.path };
      const ins = rejected
        ? await supabase.rpc('resubmit_payment', { p_kind: slot ? 'slot' : 'file', p_id: rejected.id, p_proof: proof.path, p_method: common.method, p_qty: slot ? qty : null })
        : slot
        ? await supabase.from('device_orders').insert({ ...common, kind: slot, qty })
        : await supabase.from('purchases').insert({ ...common, file_id: file!.id });
      if (ins.error) throw ins.error.code === '23505' ? new Error('You already have a payment for this file waiting or confirmed.') : ins.error;
      writeDraft(key, null); lockQty(false);
      toast(slot ? 'Payment submitted. Your extra device slot is added once the publisher confirms it.' : 'Payment submitted. The publisher will confirm it and send your receipt.');
      invalidateCounts(); nav(slot ? '/devices' : '/my-files', { replace: true });
    } catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  }

  return (
    <ClientLayout back title={`Pay ${peso(price)}`} hideTabs>
      <form className="page" onSubmit={submit} style={{ flexDirection: mobile ? 'column' : 'row', alignItems: 'flex-start', gap: 28, maxWidth: 1180 }}>
        <div className="col grow" style={{ gap: 18, width: '100%' }}>
          {!mobile && <h1>{slot ? `Add a ${slot} to your account` : <Tx k="checkout.title" />}</h1>}
          {rejected && (
            <div className="note note-red col" style={{ alignItems: 'stretch', gap: 6 }}><b>Your last payment was rejected.</b>
              <RejectNote reason={rejected.reject_reason} note={rejected.note_to_buyer} />
              <span>Upload a new screenshot and resubmit. This updates the same payment, so nothing is charged or counted twice.</span></div>
          )}
          <div className="row steps" style={{ gap: 8 }}><span className="badge b-ok">1 Pay</span><span className="muted hide-sm">—</span><span className="badge b-lock">2 Publisher confirms</span><span className="muted hide-sm">—</span><span className="badge b-lock">{slot ? '3 Receipt & extra slot' : '3 Receipt & read'}</span></div>
          {slot && !locked ? (
            <div className="card col slot-step">
              <h3>How many extra {slot}s?</h3>
              <span className="small muted">Each one lets you sign in on one more {slot}. {peso(unitSlot)} each, yours for good.</span>
              <div className="qty-pick">
                <button type="button" className="btn" aria-label="Fewer" disabled={qty <= 1} onClick={() => setQty(qty - 1)}>−</button>
                <b aria-live="polite">{qty}</b>
                <button type="button" className="btn" aria-label="More" disabled={qty >= 5} onClick={() => setQty(qty + 1)}>+</button>
              </div>
              <div className="spread"><span className="muted">{qty} × {peso(unitSlot)}</span><b style={{ color: 'var(--green)', fontSize: 22 }}>{peso(unitSlot * qty)}</b></div>
              <button type="button" className="btn btn-primary btn-lg" onClick={() => lockQty(true)}>Continue to payment</button>
            </div>
          ) : <>
          <div className="card col">
            <h3><Tx k="checkout.sendTo" /></h3>
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
            {methods[method] && (methods[method]!.qr_payload || methods[method]!.qr_path) && <PayQr m={methods[method]!} price={price} fileName={itemName} />}
          </div>
          </>}
          {mobile && <div className="note note-slate"><Clock /><span>The publisher confirms your payment and sends a receipt. {slot ? 'Your extra slot is then added.' : 'The file then opens for you.'}</span></div>}
        </div>
        <div className="col" style={{ width: mobile ? '100%' : 400, flexShrink: 0, gap: 18 }}>
          <div className="card col">
            <h3><Tx k="checkout.summary" /></h3>
            {slot ? (
              <>
                <div className="row"><span className="slot-ico">{slot === 'computer' ? <Laptop /> : <Phone />}</span><div className="col grow" style={{ gap: 0 }}><b>Extra {slot} slot</b><span className="small muted">{peso(unitSlot)} each · added to your account for good</span></div></div>
                <div className="setting"><b>How many</b>
                  {locked ? <span className="row" style={{ gap: 6 }}><Lock width={15} color="var(--muted)" /><b>{qty}</b></span> : <b>{qty}</b>}</div>
                {locked && (
                  <button type="button" className="link small" style={{ alignSelf: 'flex-start' }} onClick={async () => { await clearProof(); lockQty(false); }}>
                    Change how many{proof ? ' (removes your screenshot)' : ''}</button>
                )}
              </>
            ) : (
              <div className="row"><Thumb file={file!} /><div className="col grow" style={{ gap: 0 }}><b>{file!.name}</b><span className="small muted">{KIND_LABEL[file!.kind]}{file!.meta ? ` · ${file!.meta}` : ''}</span></div></div>
            )}
            <div className="spread" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}><b>Total</b><b style={{ color: 'var(--green)', fontSize: 20 }}>{peso(price)}</b></div>
            <span className="small muted"><Tx k="checkout.summaryNote" /></span>
          </div>
          {(!slot || locked) && <>
            <div className="card col">
              <h3><Tx k="checkout.proof" /></h3>
              {proof ? (
                <div className="proof-card">
                  {preview ? <ZoomImage src={preview} alt="Your payment screenshot" className="proof-img" />
                    : proof.type.startsWith('image/') ? <div className="proof-img skeleton" />
                    : <div className="proof-file"><Files /><span>PDF</span></div>}
                  <div className="col grow" style={{ gap: 4, minWidth: 0 }}>
                    <span className="badge b-ok" style={{ alignSelf: 'flex-start' }}>Uploaded</span>
                    <b className="ellipsis">{proof.name}</b>
                    <span className="small muted">Saved to your account. It stays here if you leave or refresh; just submit when you're ready.</span>
                    <div className="row wrap" style={{ gap: 8, marginTop: 4 }}>
                      <button type="button" className="btn btn-sm" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? 'Uploading…' : 'Change'}</button>
                      <button type="button" className="btn btn-sm" disabled={uploading} onClick={clearProof}>Remove</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="drop" onClick={() => !uploading && input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
                  <Upload />
                  <b>{uploading ? 'Uploading…' : <Tx k="checkout.drop" />}</b>
                  <span className="small">Screenshot of the {methods[method]?.name ?? 'payment'} receipt · JPG, PNG or PDF · max 10 MB</span>
                </div>
              )}
              <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={(e) => pick(e.target.files?.[0])} />
            </div>
            {err && <span className="error">{err}</span>}
            {!mobile && (!slot || locked) && <button className="btn btn-primary btn-lg" disabled={busy || uploading || !proof}>{busy ? 'Submitting…' : rejected ? 'Resubmit payment' : <Tx k="checkout.submit" />}</button>}
          </>}
        </div>
        {mobile && (!slot || locked) && <div className="bottom-bar" style={{ width: '100%', margin: '0 -16px -24px' }}><button className="btn btn-primary btn-block" style={{ height: 50 }} disabled={busy || uploading || !proof}>{busy ? 'Submitting…' : rejected ? 'Resubmit payment' : 'Submit for confirmation'}</button></div>}
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
        {src ? <ZoomImage src={src} alt={`${m.name} QR code for ${peso(price)}`} style={{ width: 220, borderRadius: 12, border: '1px solid var(--line)', background: '#fff' }} /> : <div className="spinner" />}
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
