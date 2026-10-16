import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { dateOnly, errMsg, peso } from '../lib/format';
import { isNative } from '../lib/platform';
import { isSaved, saveOffline } from '../lib/offline';
import { KIND_LABEL, KIND_TAG, type LibFile, type Purchase } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import { Cover, Empty, Loading, useIsMobile, useToast } from '../components/ui';
import { Check, Clock, Download, Lock, Receipt } from '../components/Icons';

export function canDownload(file: LibFile, profileAllow: boolean | null | undefined) {
  return profileAllow ?? file.allow_download;
}

export default function FileDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const mobile = useIsMobile();
  const { session, profile, settings } = useAuth();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data, loading, error } = useLoad(async () => {
    const [f, p] = await Promise.all([
      supabase.from('files').select('*').eq('id', id!).single(),
      supabase.from('purchases').select('*').eq('file_id', id!).eq('user_id', session!.user.id).order('created_at', { ascending: false }),
    ]);
    return { file: must(f) as LibFile, purchases: must(p) as Purchase[] };
  }, [id]);
  useEffect(() => { if (isNative && id) isSaved(id).then(setSaved); }, [id]);

  if (loading) return <ClientLayout back title="File details"><Loading /></ClientLayout>;
  if (error || !data) return <ClientLayout back title="File details"><div className="page"><Empty title="File not found">{error}</Empty></div></ClientLayout>;

  const { file, purchases } = data;
  const owned = purchases.find((p) => p.status === 'confirmed');
  const pending = purchases.find((p) => p.status === 'pending');
  const rejected = !owned && !pending ? purchases.find((p) => p.status === 'rejected') : undefined;
  const allowDl = canDownload(file, profile?.allow_download);

  async function saveForOffline() {
    if (!file.storage_path) return;
    setSaving(true);
    try {
      const { data: s, error: e } = await supabase.storage.from('files').createSignedUrl(file.storage_path, 120);
      if (e) throw e;
      const blob = await (await fetch(s.signedUrl)).blob();
      await saveOffline(file, blob);
      setSaved(true);
      toast('Saved. It opens on this phone without internet.');
    } catch (e) { toast('Could not save: ' + errMsg(e)); }
    finally { setSaving(false); }
  }
  async function download() {
    const { data: s, error: e } = await supabase.storage.from('files').createSignedUrl(file.storage_path!, 60, { download: file.name });
    if (e) return toast(e.message);
    window.open(s.signedUrl, '_blank');
  }

  const status = owned ? (
    <span className="badge b-ok"><Check /> Unlocked</span>
  ) : pending ? <span className="badge b-pending"><Clock /> Pending confirmation</span> : <span className="badge b-lock"><Lock /> Locked</span>;

  const actionCard = owned ? (
    <div className="card col" style={{ gap: 14 }}>
      <div className="spread wrap"><span className="muted">Purchased {dateOnly(owned.confirmed_at)}{owned.receipt_no && <> · Receipt <Link className="link" to={`/receipt/${owned.id}`}>{owned.receipt_no}</Link></>}</span>
        <span style={{ fontSize: 26, fontWeight: 700, color: 'var(--green)' }}>✓ Owned</span></div>
      {!mobile && <button className="btn btn-primary btn-lg btn-block" onClick={() => nav(`/read/${file.id}`)}>Read now</button>}
      {!mobile && allowDl && <button className="btn btn-block" onClick={download}><Download /> Download</button>}
      <span className="small muted">{owned.note_to_buyer || 'Payment confirmed by the publisher.'} {isNative ? '' : 'Read it here in your browser, or open the mobile app to save it for offline reading.'}</span>
    </div>
  ) : pending ? (
    <div className="note note-amber"><Clock /><span>Your payment ({peso(pending.amount)} via {pending.method}, ref {pending.reference_no}) is waiting for the publisher's confirmation. You'll get your receipt and the file unlocks as soon as it's confirmed.</span></div>
  ) : (
    <div className="card col" style={{ gap: 14 }}>
      {rejected && <div className="note note-red"><span>Your last payment was rejected: <b>{rejected.reject_reason}</b>{rejected.note_to_buyer ? `. ${rejected.note_to_buyer}` : ''}</span></div>}
      <div className="spread"><span className="muted">Price</span><span style={{ fontSize: 30, fontWeight: 700, color: 'var(--green)' }}>{peso(file.price)}</span></div>
      {!mobile && <button className="btn btn-primary btn-lg btn-block" onClick={() => nav(`/checkout/${file.id}`)}><Lock /> {rejected ? 'Submit payment again' : 'Buy & unlock full file'}</button>}
      <span className="small muted">Only the front page is visible until you pay. After you pay, the publisher confirms the payment and sends your receipt. The file then unlocks on your devices.</span>
    </div>
  );

  return (
    <ClientLayout back title="File details" hideTabs={mobile}>
      <div className="page" style={{ flexDirection: mobile ? 'column' : 'row', alignItems: 'flex-start', gap: mobile ? 16 : 48 }}>
        <div className="col" style={{ width: mobile ? '100%' : 460, flexShrink: 0, gap: 12 }}>
          {!mobile && <span className="small muted"><Link to="/library" className="muted">Library</Link> / {file.label} / {file.name}</span>}
          <div style={{ position: 'relative' }}>
            <Cover file={file} showTag={false} />
            <span className="cover-tag badge" style={{ position: 'absolute', left: 14, top: 14, background: '#fff', color: 'var(--ink)' }}>{KIND_TAG[file.kind]} · {owned ? 'OWNED' : 'FRONT PAGE PREVIEW'}</span>
          </div>
        </div>
        <div className="col grow" style={{ gap: 18, maxWidth: 640 }}>
          <div className="row wrap"><span className="badge b-blue">{KIND_TAG[file.kind]}</span>{status}{file.meta && <span className="badge b-lock">{file.meta}</span>}</div>
          <h1>{file.name}</h1>
          <p className="muted" style={{ fontSize: 16 }}>{file.description}</p>
          <div className="row wrap" style={{ gap: 28 }}>
            <div className="col" style={{ gap: 0 }}><span className="small muted">Format</span><b>{KIND_LABEL[file.kind]}</b></div>
            <div className="col" style={{ gap: 0 }}><span className="small muted">Label</span><b>{file.label || '—'}</b></div>
            <div className="col" style={{ gap: 0 }}><span className="small muted">Download</span><b>{allowDl ? 'Allowed' : 'Read in the app only'}</b></div>
          </div>
          {actionCard}
          {owned && isNative && settings?.offline_saving && (
            <div className="note note-blue"><Download /><span>{saved ? 'Saved on this phone. It opens without internet from My files → Saved offline.' : 'Save it once and read it on this phone without internet.'}</span></div>
          )}
          {owned?.receipt_no && <Link to={`/receipt/${owned.id}`} className="row link"><Receipt width={18} /> View receipt {owned.receipt_no}</Link>}
        </div>
      </div>
      {mobile && (
        <div className="bottom-bar">
          {owned ? (
            <>
              {isNative && settings?.offline_saving && (
                <button className="btn btn-outline-blue" disabled={saving || saved} onClick={saveForOffline}><Download />{saved ? 'Saved' : saving ? 'Saving…' : 'Save offline'}</button>
              )}
              {!isNative && allowDl && <button className="btn" onClick={download}><Download /></button>}
              <button className="btn btn-primary grow" style={{ height: 50 }} onClick={() => nav(`/read/${file.id}`)}>Read now</button>
            </>
          ) : pending ? (
            <button className="btn grow" disabled style={{ height: 50 }}><Clock /> Waiting for confirmation</button>
          ) : (
            <>
              <div className="col" style={{ gap: 0 }}><span className="small muted">Price</span><span className="price" style={{ fontSize: 22 }}>{peso(file.price)}</span></div>
              <button className="btn btn-primary grow" style={{ height: 50 }} onClick={() => nav(`/checkout/${file.id}`)}><Lock /> Buy & unlock</button>
            </>
          )}
        </div>
      )}
    </ClientLayout>
  );
}
