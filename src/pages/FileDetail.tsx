import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { must, useLoad } from '../lib/useLoad';
import { dateOnly, errMsg, peso, pesoShort } from '../lib/format';
import { isNative } from '../lib/platform';
import { isSaved, saveOffline } from '../lib/offline';
import { fetchSecureFile } from '../lib/secureFile';
import { KIND_LABEL, KIND_TAG, type LibFile, type Purchase } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import { publisherOf } from '../lib/watermark';
import { Cover, Empty, RejectNote, useIsMobile, useToast } from '../components/ui';
import { Check, Clock, Download, Eye, Laptop, Lock, Phone, Receipt, Shield } from '../components/Icons';
import { DetailSkeleton } from '../components/Skeletons';
import { Tx } from '../lib/theme';

/** Paid → publisher confirms → yours to read. */
function Timeline({ p }: { p?: Purchase }) {
  const step = !p || p.status === 'rejected' ? 0 : p.status === 'pending' ? 1 : 3;
  const items = [
    { t: <Tx k="detail.step1" />, key: 1, d: p && p.status !== 'rejected' ? `${peso(p.amount)} via ${p.method}` : 'Scan the GCash QR and upload your proof' },
    { t: <Tx k="detail.step2" />, key: 2, d: step === 1 ? 'Usually within 24 hours' : step === 3 ? `Confirmed ${dateOnly(p!.confirmed_at)}` : 'They check the payment by hand' },
    { t: <Tx k="detail.step3" />, key: 3, d: step === 3 ? `Receipt ${p!.receipt_no ?? ''}` : 'Your receipt appears and the file opens' },
  ];
  return (
    <ol className="timeline">
      {items.map((it, i) => {
        const state = i < step ? 'done' : i === step && step === 1 ? 'now' : 'todo';
        return (
          <li key={it.key} className={state}>
            <span className="tl-dot">{state === 'done' ? <Check /> : state === 'now' ? <Clock /> : i + 1}</span>
            <div className="col" style={{ gap: 0 }}><b>{it.t}</b><span className="small muted">{it.d}</span></div>
          </li>
        );
      })}
    </ol>
  );
}

export default function FileDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const mobile = useIsMobile();
  const { session, settings } = useAuth();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const { data, loading, error } = useLoad(async () => {
    const [f, p] = await Promise.all([
      supabase.from('files').select('*').eq('id', id!).single(),
      supabase.from('purchases').select('*').eq('file_id', id!).eq('user_id', session!.user.id).order('created_at', { ascending: false }),
    ]);
    const file = must(f) as LibFile;
    const { data: rel } = await supabase.from('files').select('*').eq('published', true).eq('label', file.label).neq('id', file.id).limit(6);
    return { file, purchases: must(p) as Purchase[], related: (rel ?? []) as LibFile[] };
  }, [id]);
  useEffect(() => { if (isNative && id) isSaved(id).then(setSaved); }, [id]);

  if (loading) return <ClientLayout back title="File details"><div className="page"><DetailSkeleton /></div></ClientLayout>;
  if (error || !data) return <ClientLayout back title="File details"><div className="page"><Empty title="File not found">{error}</Empty></div></ClientLayout>;

  const { file, purchases, related } = data;
  const owned = purchases.find((p) => p.status === 'confirmed');
  const pending = purchases.find((p) => p.status === 'pending');
  const rejected = !owned && !pending ? purchases.find((p) => p.status === 'rejected') : undefined;
  const current = owned ?? pending ?? rejected;
  const free = file.is_free && !owned; // free samples open for everyone, no payment

  async function saveForOffline() {
    setSaving(true);
    try {
      await saveOffline(file, await fetchSecureFile(file.id, file.mime));
      setSaved(true);
      toast('Saved. It opens on this phone without internet.');
    } catch (e) { toast('Could not save: ' + errMsg(e)); }
    finally { setSaving(false); }
  }

  const cta = owned || free ? (
    <button className="btn btn-primary btn-lg btn-block" onClick={() => nav(`/read/${file.id}`)}><Eye /> {free ? <Tx k="detail.readFree" /> : <Tx k="detail.read" />}</button>
  ) : pending ? (
    <button className="btn btn-lg btn-block" disabled><Clock /> <Tx k="detail.waiting" /></button>
  ) : (
    <button className="btn btn-primary btn-lg btn-block" onClick={() => nav(`/checkout/${file.id}`)}><Lock /> {rejected ? 'Submit payment again' : <Tx k="detail.buy" />}</button>
  );

  const panel = (
    <aside className="buy-panel card">
      {owned ? (
        <div className="spread"><span className="badge b-ok"><Check /> You own this</span><span className="small muted">since {dateOnly(owned.confirmed_at)}</span></div>
      ) : free ? (
        <div className="spread"><span className="badge b-ok"><Check /> Free to read</span><span className="small muted">No payment needed</span></div>
      ) : (
        <div className="spread"><span className="muted"><Tx k="detail.priceLabel" /></span><span className="big-price">{peso(file.price)}</span></div>
      )}
      {!mobile && cta}
      {(owned || free) && isNative && settings?.offline_saving && (
        <button className="btn btn-outline-blue btn-block" disabled={saving || saved} onClick={saveForOffline}><Download />{saved ? 'Saved for offline' : saving ? 'Saving…' : 'Save for offline'}</button>
      )}
      {rejected && <div className="col" style={{ gap: 6 }}><span className="badge b-red" style={{ alignSelf: 'flex-start' }}>Last payment rejected</span><RejectNote reason={rejected.reject_reason} note={rejected.note_to_buyer} /></div>}
      {!free && <Timeline p={current} />}
      {owned?.receipt_no && <Link to={`/receipt/${owned.id}`} className="row link"><Receipt width={18} /> View receipt {owned.receipt_no}</Link>}
      <ul className="perks">
        <li><Eye /> <Tx k="detail.perk1" /></li>
        <li><Laptop /> <Tx k="detail.perk2" /></li>
        <li><Phone /> <span><Tx k="detail.perk3" />{settings?.offline_saving ? ', even offline' : ''}</span></li>
        <li><Shield /> <Tx k="detail.perk4" /></li>
      </ul>
    </aside>
  );

  return (
    <ClientLayout back={mobile || undefined} title="File details" hideTabs={mobile}>
      <div className="page detail">
        {!mobile && <nav className="crumbs small"><Link to="/library">Library</Link><span>/</span>{file.label && <><Link to={`/library?q=${encodeURIComponent(file.label)}`}>{file.label}</Link><span>/</span></>}<span className="muted ellipsis">{file.name}</span></nav>}
        <div className="detail-grid">
          <div className="detail-cover">
            <Cover file={file} showTag={false} locked={!owned && !free} />
            <span className="badge cover-flag">{KIND_TAG[file.kind]} · {owned ? 'OWNED' : free ? 'FREE SAMPLE' : 'FREE PREVIEW: COVER'}</span>
          </div>
          <div className="col detail-main" style={{ gap: 18 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <span className="badge b-blue">{KIND_LABEL[file.kind]}</span>
              {file.label && <span className="badge b-lock">{file.label}</span>}
              {file.meta && <span className="badge b-lock">{file.meta}</span>}
            </div>
            <h1 className="detail-title">{file.name}</h1>
            <span className="byline">Published by <b>{publisherOf(settings).name}</b></span>
            <p className="lead">{file.description}</p>
            <div className="facts">
              <div><span>Format</span><b>{KIND_LABEL[file.kind]}</b></div>
              <div><span>Length</span><b>{file.meta || '—'}</b></div>
              <div><span>Subject</span><b>{file.label || '—'}</b></div>
              <div><span>Access</span><b>View only</b></div>
              <div className="wide"><span>Publisher</span><b>{publisherOf(settings).name}</b></div>
            </div>
            {mobile && panel}
            {owned || free ? (
              <button type="button" className="ready-card" onClick={() => nav(`/read/${file.id}`)}>
                <span className="ready-ico"><Eye /></span>
                <span className="col" style={{ gap: 2, alignItems: 'flex-start' }}><b>{free ? 'Free to read' : 'In your library'}: the full {KIND_LABEL[file.kind].toLowerCase()}</b>
                  <span className="small muted">Opens in the reader, with notes and drawing on your computer.</span></span>
                <span className="btn btn-primary btn-sm">Open</span>
              </button>
            ) : (
              <div className="locked-preview">
                <div className="lp-lines">{Array.from({ length: 6 }, (_, i) => <span key={i} style={{ width: `${92 - i * 9}%` }} />)}</div>
                <div className="lp-overlay"><Lock /> <b>Buy to read the full {KIND_LABEL[file.kind].toLowerCase()}</b><span className="small muted"><Tx k="detail.lockedSub" /></span></div>
              </div>
            )}
          </div>
          {!mobile && <div className="detail-side">{panel}</div>}
        </div>
        {related.length > 0 && (
          <section className="shelf">
            <h2>More in {file.label}</h2>
            <div className="shelf-row">
              {related.map((r) => (
                <Link key={r.id} to={`/file/${r.id}`} className="bookcard"><Cover file={r} /><h3 className="clamp-2">{r.name}</h3><span className="price-pill" style={{ alignSelf: 'flex-start' }}>{pesoShort(r.price)}</span></Link>
              ))}
            </div>
          </section>
        )}
      </div>
      {mobile && <div className="bottom-bar">{!owned && !pending && !free && <div className="col" style={{ gap: 0 }}><span className="small muted"><Tx k="detail.priceLabel" /></span><span className="price" style={{ fontSize: 20 }}>{peso(file.price)}</span></div>}<div className="grow">{cta}</div></div>}
    </ClientLayout>
  );
}
