import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, setRememberMe, enabledProviders } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { errMsg } from '../lib/format';
import { appUrl, asset, isNative } from '../lib/platform';
import { Logo, Toggle } from '../components/ui';
import { Facebook, Google, Laptop } from '../components/Icons';
import { Tx } from '../lib/theme';
import { googleButtonAvailable, renderGoogleButton } from '../lib/googleSignIn';

const PLAY_URL = import.meta.env.VITE_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.mednotes.elibrary';

function AuthShell({ children, withHero = true }: { children: ReactNode; withHero?: boolean }) {
  return (
    <div className="auth">
      {withHero ? (
        <aside className="auth-side">
          <div className="col" style={{ gap: 28 }}>
            <Logo light />
            {!isNative && (
              <div className="qr">
                <img className="code" src={asset('qr-playstore.png')} alt="QR code to download the MedNotes Android app" />
                <div className="col shadowed" style={{ gap: 4 }}>
                  <b style={{ fontSize: 18 }}><Tx k="auth.appTitle" /></b>
                  <span style={{ opacity: 0.85 }}><Tx k="auth.appSub" /></span>
                  <b style={{ maxWidth: 320 }}><Tx k="auth.appPitch" /></b>
                  <a className="store-btn" href={PLAY_URL} target="_blank" rel="noreferrer">▶&nbsp; Get it on Google Play</a>
                </div>
              </div>
            )}
          </div>
          <div className="hero col shadowed" style={{ gap: 14 }}>
            <h1><Tx k="auth.title" /></h1>
            <p><Tx k="auth.text" /></p>
          </div>
        </aside>
      ) : null}
      <main className="auth-main">{children}</main>
    </div>
  );
}

/** Google / Facebook buttons. Always visible; if a provider isn't switched on in Supabase yet, a friendly note replaces the raw error. */
function Providers({ divider }: { divider: ReactNode }) {
  const { signInWithProvider } = useAuth();
  const [on, setOn] = useState<{ google: boolean; facebook: boolean } | null>(null);
  const [busy, setBusy] = useState<'google' | 'facebook' | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { enabledProviders().then(setOn); }, []);
  async function go(p: 'google' | 'facebook') {
    const name = p === 'google' ? 'Google' : 'Facebook';
    setNote('');
    if (on && !on[p]) return setNote(`${name} sign-in isn't switched on yet. Please use your email for now.`);
    setBusy(p);
    try { await signInWithProvider(p); }
    catch (e) { setNote(errMsg(e).includes('not enabled') ? `${name} sign-in isn't switched on yet. Please use your email for now.` : errMsg(e)); setBusy(null); }
  }
  return (
    <>
      {googleButtonAvailable && on?.google !== false
        ? <GoogleButton onBusy={() => { setNote(''); setBusy('google'); }} onError={(m) => { setNote(m); setBusy(null); }} fallback={() => go('google')} busy={busy === 'google'} />
        : (
          <button type="button" className="btn btn-block btn-social" disabled={!!busy} onClick={() => go('google')}>
            {busy === 'google' ? <span className="spinner sm" /> : <Google />} Continue with Google
          </button>
        )}
      <button type="button" className="btn btn-block btn-social" disabled={!!busy} onClick={() => go('facebook')}>
        {busy === 'facebook' ? <span className="spinner sm" /> : <Facebook />} Continue with Facebook
      </button>
      {note && <div className="note note-amber fade-in" role="status">{note}</div>}
      <div className="divider">{divider}</div>
    </>
  );
}

/** Google's own button on the website; if Google's script can't load, our usual button (redirect sign-in) is shown instead. */
function GoogleButton({ onBusy, onError, fallback, busy }: { onBusy: () => void; onError: (m: string) => void; fallback: () => void; busy: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!box.current) return;
    renderGoogleButton(box.current, { dark: document.documentElement.hasAttribute('data-dark'), onStart: onBusy, onError })
      .catch(() => setFailed(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (failed) {
    return (
      <button type="button" className="btn btn-block btn-social" onClick={fallback}>
        <Google /> Continue with Google
      </button>
    );
  }
  return (
    <div className="gsi-wrap" aria-busy={busy}>
      <div ref={box} className="gsi-box" />
      {busy && <div className="gsi-busy"><span className="spinner sm" /> Signing you in…</div>}
    </div>
  );
}

function LegalLinks() {
  return <div className="small muted" style={{ textAlign: 'center' }}><Link to="/privacy" className="muted">Privacy policy</Link> · <Link to="/data-deletion" className="muted">Delete your data</Link></div>;
}

export function SignIn() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    setRememberMe(keep);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
    else nav('/', { replace: true });
  }
  return (
    <AuthShell>
      <form className="auth-card" onSubmit={submit}>
        <div className="col" style={{ gap: 4 }}><h1><Tx k="signin.title" /></h1><span className="muted"><Tx k="signin.sub" /></span></div>
        <Providers divider={<Tx k="signin.divider" />} />
        <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div className="spread small">
          {isNative ? <span className="muted">You'll stay signed in on this phone.</span>
            : <label className="row" style={{ gap: 8 }}><Toggle on={keep} onChange={setKeep} label="Keep me signed in" />Keep me signed in</label>}
          <Link to="/forgot-password" className="link">Forgot password?</Link>
        </div>
        {err && <span className="error">{err}</span>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : <Tx k="signin.button" />}</button>
        <div className="muted" style={{ textAlign: 'center' }}><Tx k="signin.newPrompt" /> <Link to="/sign-up" className="link"><Tx k="signin.newLink" /></Link></div>
        <LegalLinks />
        <div className="note note-blue"><Laptop /><span><Tx k="signin.note" /></span></div>
      </form>
    </AuthShell>
  );
}

export function SignUp() {
  const nav = useNavigate();
  const [f, setF] = useState({ first: '', last: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password.length < 8) return setErr('Use at least 8 characters for your password.');
    setBusy(true); setErr('');
    setRememberMe(true);
    const { data, error } = await supabase.auth.signUp({
      email: f.email.trim(), password: f.password,
      options: { data: { full_name: `${f.first} ${f.last}`.trim() }, emailRedirectTo: isNative ? undefined : appUrl('library') },
    });
    setBusy(false);
    if (error) return setErr(error.message);
    if (data.session) nav('/library', { replace: true });
    else setSent(true);
  }
  return (
    <AuthShell withHero={false}>
      <form className="auth-card center" onSubmit={submit}>
        <Logo />
        <div className="col" style={{ gap: 4 }}><h2><Tx k="signup.title" /></h2><span className="muted"><Tx k="signup.sub" /></span></div>
        {sent ? (
          <div className="note note-blue">Check {f.email} for a confirmation link, then sign in.</div>
        ) : (
          <>
            <Providers divider={<Tx k="signup.divider" />} />
            <div className="row">
              <div className="field grow"><label htmlFor="fn">First name</label><input id="fn" className="input" required value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></div>
              <div className="field grow"><label htmlFor="ln">Last name</label><input id="ln" className="input" required value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} /></div>
            </div>
            <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" autoComplete="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div className="field"><label htmlFor="pw">Password</label><input id="pw" className="input" type="password" autoComplete="new-password" placeholder="At least 8 characters" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
            <span className="small muted"><Tx k="signup.terms" /></span>
            {err && <span className="error">{err}</span>}
            <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating…' : <Tx k="signup.button" />}</button>
          </>
        )}
        <div className="muted" style={{ textAlign: 'center' }}><Tx k="signup.havePrompt" /> <Link to="/sign-in" className="link"><Tx k="signup.haveLink" /></Link></div>
        <LegalLinks />
      </form>
    </AuthShell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl('reset-password') });
    if (error) setErr(error.message); else setSent(true);
  }
  return (
    <AuthShell withHero={false}>
      <form className="auth-card center" onSubmit={submit}>
        <Logo />
        <div className="col" style={{ gap: 4 }}><h2><Tx k="forgot.title" /></h2><span className="muted"><Tx k="forgot.sub" /></span></div>
        {sent ? <div className="note note-blue">If {email} has an account, a reset link is on its way.</div> : (
          <>
            <div className="field"><label htmlFor="em">Email</label><input id="em" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            {err && <span className="error">{err}</span>}
            <button className="btn btn-primary btn-block"><Tx k="forgot.button" /></button>
          </>
        )}
        <div className="muted" style={{ textAlign: 'center' }}>Remembered it? <Link to="/sign-in" className="link"><Tx k="forgot.back" /></Link></div>
      </form>
    </AuthShell>
  );
}

export function ResetPassword() {
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setErr('Use at least 8 characters.');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setErr(error.message); else nav('/library', { replace: true });
  }
  return (
    <AuthShell withHero={false}>
      <form className="auth-card center" onSubmit={submit}>
        <Logo />
        <h2>Choose a new password</h2>
        <div className="field"><label htmlFor="pw">New password</label><input id="pw" className="input" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></div>
        {err && <span className="error">{err}</span>}
        <button className="btn btn-primary btn-block">Save password</button>
      </form>
    </AuthShell>
  );
}
