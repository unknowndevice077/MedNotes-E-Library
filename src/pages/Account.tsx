import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { usePrefs } from '../lib/prefs';
import { bytes, errMsg, initials } from '../lib/format';
import { isNative } from '../lib/platform';
import { listSaved, removeOffline } from '../lib/offline';
import type { UserPrefs } from '../lib/types';
import { ClientLayout } from '../components/Layouts';
import ProfileEditor from '../components/ProfileEditor';
import { Toggle, useConfirm, useIsMobile, useToast } from '../components/ui';
import { Facebook, Google, Logout, Mail } from '../components/Icons';
import { Tx } from '../lib/theme';

/** 0–4 rough strength score for the password meter. */
function strength(pw: string) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
const STRENGTH = ['Too short', 'Weak', 'Okay', 'Good', 'Strong'];

export function PasswordCard({ hasPassword, email }: { hasPassword: boolean; email: string }) {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const score = strength(pw);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return toast('Use at least 8 characters.');
    if (pw !== again) return toast("The new passwords don't match.");
    setBusy(true);
    try {
      if (hasPassword) {
        // check the current password first, so someone at an unlocked screen can't change it
        const { error } = await supabase.auth.signInWithPassword({ email, password: cur });
        if (error) throw new Error('Your current password is not right.');
      }
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setCur(''); setPw(''); setAgain('');
      toast(hasPassword ? 'Password changed.' : 'Password set. You can now also sign in with your email.');
    } catch (err) { toast(errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <form className="card col" onSubmit={submit}>
      <h3>{hasPassword ? 'Password' : 'Add a password'}</h3>
      <span className="small muted">
        {hasPassword
          ? 'Your password is the one you chose when you signed up with your email. It is stored scrambled, so nobody (not even the publisher) can see it.'
          : 'You sign in with Google or Facebook. Add a password if you also want to sign in with your email.'}
        {' '}Forgot it? <Link to="/forgot-password" className="link">Reset it by email</Link>.
      </span>
      {hasPassword && <div className="field"><label htmlFor="cur-pw">Current password</label><input id="cur-pw" className="input" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></div>}
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field grow" style={{ minWidth: 200 }}><label htmlFor="pw">New password</label><input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
        <div className="field grow" style={{ minWidth: 200 }}><label htmlFor="pw2">Type it again</label><input id="pw2" className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></div>
      </div>
      {pw && (
        <div className="pw-meter" data-score={score}><span style={{ width: `${(score / 4) * 100}%` }} /><b className="small">{STRENGTH[score]}</b></div>
      )}
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={busy}>{busy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}</button>
    </form>
  );
}

function EmailCard({ email }: { email: string }) {
  const toast = useToast();
  const [next, setNext] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = next.trim().toLowerCase();
    if (!v || v === email) return;
    const { error } = await supabase.auth.updateUser({ email: v });
    if (error) return toast(error.message);
    setNext('');
    toast(`Check ${v} (and ${email}) for a link to confirm the change.`);
  }
  return (
    <form className="card col" onSubmit={submit}>
      <h3>Email</h3>
      <span className="small muted">Signed in as <b>{email}</b>. Receipts and sign-in links go here.</span>
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <div className="field grow" style={{ minWidth: 220 }}><label htmlFor="new-email">New email</label><input id="new-email" className="input" type="email" autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <button className="btn">Change email</button>
      </div>
    </form>
  );
}

function PrefsCard() {
  const { prefs, save } = usePrefs();
  const toast = useToast();
  const set = async (patch: Partial<UserPrefs>) => { const err = await save(patch); if (err) toast(err); };
  return (
    <div className="card col" style={{ gap: 16 }}>
      <h3><Tx k="account.prefs" /></h3>
      <div className="setting stack-sm"><div className="col" style={{ gap: 0 }}><b>Reader page colour</b><span className="small muted">For books, notes, slides and sheets</span></div>
        <div className="seg" role="radiogroup" aria-label="Reader page colour">
          {(['light', 'sepia', 'dark'] as const).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={prefs.readerTheme === t} className={prefs.readerTheme === t ? 'on' : ''} onClick={() => set({ readerTheme: t })}>
              <i className={`swatch sw-${t}`} />{t[0]!.toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
      </div>
      <div className="setting stack-sm"><div className="col" style={{ gap: 0 }}><b>App look</b><span className="small muted">Light, dark, or match your device</span></div>
        <div className="seg" role="radiogroup" aria-label="App look">
          {([['light', 'Light'], ['dark', 'Dark'], ['system', 'Device']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={prefs.appTheme === k} className={prefs.appTheme === k ? 'on' : ''}
              onClick={() => { try { localStorage.setItem('mn.app-theme', k); } catch { /* private mode */ } set({ appTheme: k }); }}>{l}</button>
          ))}
        </div>
      </div>
      <div className="setting"><div className="col" style={{ gap: 0 }}><b>Text size</b><span className="small muted">E-books, Word notes and slides</span></div>
        <div className="row" style={{ gap: 10 }}>
          <input type="range" min={14} max={24} step={1} value={prefs.textSize} aria-label="Text size" onChange={(e) => set({ textSize: Number(e.target.value) })} />
          <b className="small" style={{ width: 36, textAlign: 'right' }}>{prefs.textSize}px</b>
        </div>
      </div>
      <div className="reader-sample" data-theme={prefs.readerTheme} style={{ fontSize: prefs.textSize }}>Beta blockers lower heart rate and contractility.</div>
      <div className="setting"><div className="col" style={{ gap: 0 }}><b>Reduce motion</b><span className="small muted">Turn off animations and zoom effects</span></div><Toggle on={prefs.reduceMotion} onChange={(v) => set({ reduceMotion: v })} label="Reduce motion" /></div>
      <div className="setting"><div className="col" style={{ gap: 0 }}><b>Open the app on</b><span className="small muted">The first page after you sign in</span></div>
        <select className="input" style={{ width: 160 }} value={prefs.startPage} aria-label="Start page" onChange={(e) => set({ startPage: e.target.value as UserPrefs['startPage'] })}>
          <option value="library">Library</option><option value="my-files">My files</option>
        </select>
      </div>
    </div>
  );
}

export default function Account() {
  const { profile, session, signOut } = useAuth();
  const toast = useToast();
  const mobile = useIsMobile();
  const [storage, setStorage] = useState<{ n: number; size: number } | null>(null);
  useEffect(() => { if (isNative) listSaved().then((l) => setStorage({ n: l.length, size: l.reduce((a, f) => a + f.size, 0) })); }, []);
  const nav = useNavigate();
  const confirm = useConfirm();
  async function deleteAccount() {
    if (!(await confirm({ title: 'Delete your account?', body: 'This permanently deletes your account, your purchases and your access to every file you bought. It cannot be undone.', confirmLabel: 'Delete my account', danger: true, typeToConfirm: 'DELETE' }))) return;
    try {
      const uid = profile!.id;
      const { data: proofs } = await supabase.storage.from('proofs').list(uid, { limit: 1000 });
      if (proofs?.length) await supabase.storage.from('proofs').remove(proofs.map((f) => `${uid}/${f.name}`));
      const { error } = await supabase.rpc('delete_my_account');
      if (error) throw error;
      if (isNative) for (const f of await listSaved()) await removeOffline(f.id);
      await supabase.auth.signOut({ scope: 'local' });
      nav('/sign-in', { replace: true });
    } catch (e) { toast(errMsg(e)); }
  }
  // accounts made by email sign-up (or seeded) may not list 'email' in the session's providers
  const providers: string[] = [...new Set([...(session?.user.app_metadata.providers ?? []), profile?.provider ?? 'email'])];
  const email = profile?.email ?? session?.user.email ?? '';



  return (
    <ClientLayout title={<Tx k="nav.account" />}>
      <div className="page account" style={{ maxWidth: 820, margin: mobile ? undefined : '0' }}>
        {!mobile && <h1><Tx k="account.title" /></h1>}
        <div className="card row">
          <span className="avatar" style={{ width: 56, height: 56, borderRadius: 28, fontSize: 18 }}>
            {profile?.avatar_url ? <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials(profile?.full_name ?? '', profile?.email)}
          </span>
          <div className="col grow" style={{ gap: 2 }}><b>{profile?.full_name || 'No name yet'}</b><span className="small muted">{email}</span></div>
          {profile?.role === 'admin' && <Link to="/admin" className="btn btn-sm">Admin</Link>}
        </div>
        <Link to="/payments" className="card spread" style={{ color: 'inherit' }}><span className="col" style={{ gap: 0 }}><b>Payments & receipts</b><span className="small muted">Everything you paid for, with receipts</span></span><span className="link">Open →</span></Link>
        <Link to="/help" className="card spread" style={{ color: 'inherit' }}><span className="col" style={{ gap: 0 }}><b>Help & feedback</b><span className="small muted">Report a bug, send feedback or ask the publisher</span></span><span className="link">Open →</span></Link>
        <ProfileEditor />
        <PrefsCard />
        <div className="card col">
          <h3><Tx k="account.methods" /></h3>
          <div className="spread"><span className="row"><Google width={20} /> Google</span><span className={`badge ${providers.includes('google') ? 'b-ok' : 'b-lock'}`}>{providers.includes('google') ? 'Connected' : 'Not connected'}</span></div>
          <div className="spread"><span className="row"><Facebook width={20} /> Facebook</span><span className={`badge ${providers.includes('facebook') ? 'b-ok' : 'b-lock'}`}>{providers.includes('facebook') ? 'Connected' : 'Not connected'}</span></div>
          <div className="spread"><span className="row"><Mail width={20} color="var(--slate-600)" /> Email & password</span><span className={`badge ${providers.includes('email') ? 'b-ok' : 'b-lock'}`}>{providers.includes('email') ? 'Connected' : 'Not set up'}</span></div>
        </div>
        <EmailCard email={email} />
        <PasswordCard hasPassword={providers.includes('email')} email={email} />
        {isNative && storage && (
          <div className="card spread"><div className="col" style={{ gap: 0 }}><b>Saved offline</b><span className="small muted">{storage.n} files · {bytes(storage.size)} on this phone</span></div><Link to="/saved" className="btn btn-sm">Manage</Link></div>
        )}
        <button className="btn btn-danger btn-block" onClick={signOut}><Logout /> <Tx k="account.signOut" />{isNative ? ' of this phone' : ''}</button>
        <div className="card col" style={{ gap: 8, borderColor: '#fecdd3' }}>
          <b>Delete my account</b>
          <span className="small muted"><Tx k="account.deleteText" /> See <Link to="/data-deletion" className="link">what gets deleted</Link>.</span>
          <button className="btn btn-sm btn-danger-solid" style={{ alignSelf: 'flex-start' }} onClick={deleteAccount}>Delete my account</button>
        </div>
        <span className="small muted" style={{ textAlign: 'center' }}><Link to="/privacy" className="muted">Privacy policy</Link></span>
      </div>
    </ClientLayout>
  );
}
