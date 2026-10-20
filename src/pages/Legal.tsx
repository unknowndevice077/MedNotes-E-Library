import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Logo } from '../components/ui';

const UPDATED = 'October 16, 2026';

type Contact = { store_name: string; support_email: string; business: string };
let preset: Contact | null = null;
/** Used by the build-time prerender (scripts/prerender.mjs) so the static HTML includes the contact email. */
export const presetContact = (c: Contact) => { preset = c; };

function useContact() {
  const [c, setC] = useState<Contact | null>(preset);
  useEffect(() => { supabase.rpc('public_contact').then(({ data }) => data && setC(data)); }, []);
  return c ?? { store_name: 'MedNotes E-Library', support_email: '', business: 'MedNotes Publishing' };
}

function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header className="topbar" style={{ position: 'static' }}>
        <Link to="/"><Logo /></Link><span className="grow" />
        <Link to="/privacy" className="muted">Privacy</Link><Link to="/data-deletion" className="muted">Data deletion</Link>
      </header>
      <article className="page legal" style={{ maxWidth: 820 }}>
        <h1>{title}</h1>
        <span className="muted small">Last updated {UPDATED}</span>
        {children}
      </article>
      <style>{`.legal h2 { font-size: 18px; margin-top: 8px; } .legal p, .legal li { color: var(--slate-700); line-height: 1.65; } .legal ul { padding-left: 20px; display: flex; flex-direction: column; gap: 4px; }`}</style>
    </div>
  );
}

const Mail = ({ email }: { email: string }) => (email ? <a className="link" href={`mailto:${email}`}>{email}</a> : <>the support email shown in the app</>);

export function Privacy() {
  const c = useContact();
  return (
    <LegalShell title="Privacy policy">
      <p>{c.store_name} ("we") is run by {c.business}. It lets you preview and buy medical study files (e-books, notes, lectures and slides) and read them in our web app or Android app. This policy explains what we collect and why.</p>
      <h2>What we collect</h2>
      <ul>
        <li><b>Account details:</b> your name, email address and profile picture. If you sign in with Google or Facebook, we receive only these from them. We never get your Google or Facebook password.</li>
        <li><b>Purchases:</b> the files you buy, the amount, the payment method, the reference number you enter and the proof-of-payment image you upload.</li>
        <li><b>Devices:</b> a random device ID, a label such as "Windows PC · Chrome", and when each device was last used, so we can enforce the 1 computer + 1 phone limit.</li>
        <li><b>Files you save offline</b> stay encrypted on your phone. We don't receive a copy of what you read or when.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To sign you in, keep you signed in, and limit each account to its allowed devices.</li>
        <li>To check your payment, unlock the files you bought and issue your receipt.</li>
        <li>To answer your questions. We don't sell your data or use it for advertising.</li>
      </ul>
      <h2>Who processes it</h2>
      <p>Our data is stored with Supabase (database, sign-in and file storage). Payments are made by you directly in GCash; we only see the proof you upload. Google and Facebook handle their own sign-in screens.</p>
      <h2>How long we keep it</h2>
      <p>We keep your account and purchase records while your account exists. Receipts may be kept longer where tax or accounting rules require it. When you delete your account, everything else is removed (see <Link className="link" to="/data-deletion">Data deletion</Link>).</p>
      <h2>Your rights</h2>
      <p>Under the Philippine Data Privacy Act (RA 10173) you can ask to see, correct or delete your personal data, and complain to the National Privacy Commission. Contact us at <Mail email={c.support_email} />.</p>
      <h2>Changes</h2>
      <p>If we change this policy we'll update the date above and, for important changes, tell you in the app.</p>
    </LegalShell>
  );
}

export function DataDeletion() {
  const c = useContact();
  return (
    <LegalShell title="Delete your data">
      <p>You can delete your {c.store_name} account and its data at any time.</p>
      <h2>In the app (fastest)</h2>
      <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <li>Sign in on the web app or the Android app.</li>
        <li>Open <b>Account</b>.</li>
        <li>Tap <b>Delete my account</b> and confirm.</li>
      </ol>
      <h2>By email</h2>
      <p>Email <Mail email={c.support_email} /> from the address you signed up with and ask us to delete your account. We'll do it within 30 days and confirm by email.</p>
      <h2>What gets deleted</h2>
      <ul>
        <li>Your profile (name, email, picture) and sign-in links to Google or Facebook.</li>
        <li>Your registered devices and your uploaded proof-of-payment images.</li>
        <li>Your purchases and access to the files you bought. This can't be undone.</li>
      </ul>
      <p>Files you saved offline on your phone lock automatically and can be removed by uninstalling the app. If you signed in with Facebook, you can also remove MedNotes under Facebook → Settings → Apps and websites.</p>
    </LegalShell>
  );
}
