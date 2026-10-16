import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { bytes, initials } from '../lib/format';
import { isNative } from '../lib/platform';
import { listSaved } from '../lib/offline';
import { ClientLayout } from '../components/Layouts';
import { useIsMobile, useToast } from '../components/ui';
import { Facebook, Google, Logout } from '../components/Icons';

export default function Account() {
  const { profile, session, signOut, refresh } = useAuth();
  const toast = useToast();
  const mobile = useIsMobile();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [pw, setPw] = useState('');
  const [storage, setStorage] = useState<{ n: number; size: number } | null>(null);
  useEffect(() => { if (isNative) listSaved().then((l) => setStorage({ n: l.length, size: l.reduce((a, f) => a + f.size, 0) })); }, []);
  const providers: string[] = session?.user.app_metadata.providers ?? [profile?.provider ?? 'email'];

  async function saveName() {
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile!.id);
    if (error) return toast(error.message);
    await supabase.auth.updateUser({ data: { full_name: name.trim() } });
    toast('Profile saved.'); refresh();
  }
  async function changePw() {
    if (pw.length < 8) return toast('Use at least 8 characters.');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) return toast(error.message);
    setPw(''); toast('Password changed.');
  }

  return (
    <ClientLayout title="Account">
      <div className="page" style={{ maxWidth: 820, margin: mobile ? undefined : '0' }}>
        {!mobile && <h1>Account</h1>}
        <div className="card row">
          <span className="avatar" style={{ width: 56, height: 56, borderRadius: 28, fontSize: 18 }}>
            {profile?.avatar_url ? <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials(profile?.full_name ?? '', profile?.email)}
          </span>
          <div className="col grow" style={{ gap: 2 }}><b>{profile?.full_name || 'No name yet'}</b><span className="small muted">{profile?.email}</span></div>
          {profile?.role === 'admin' && <Link to="/admin" className="btn btn-sm">Admin</Link>}
        </div>
        <div className="card col">
          <h3>Profile</h3>
          <div className="field"><label htmlFor="nm">Full name</label><input id="nm" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={saveName}>Save changes</button>
        </div>
        <div className="card col">
          <h3>Sign-in methods</h3>
          <div className="spread"><span className="row"><Google width={20} /> Google</span><span className={`badge ${providers.includes('google') ? 'b-ok' : 'b-lock'}`}>{providers.includes('google') ? 'Connected' : 'Not connected'}</span></div>
          <div className="spread"><span className="row"><Facebook width={20} /> Facebook</span><span className={`badge ${providers.includes('facebook') ? 'b-ok' : 'b-lock'}`}>{providers.includes('facebook') ? 'Connected' : 'Not connected'}</span></div>
          {providers.includes('email') && (
            <div className="row wrap" style={{ alignItems: 'flex-end' }}>
              <div className="field grow"><label htmlFor="pw">New password</label><input id="pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
              <button className="btn" onClick={changePw}>Change password</button>
            </div>
          )}
        </div>
        {isNative && storage && (
          <div className="card spread"><div className="col" style={{ gap: 0 }}><b>Saved offline</b><span className="small muted">{storage.n} files · {bytes(storage.size)} on this phone</span></div><Link to="/saved" className="btn btn-sm">Manage</Link></div>
        )}
        <button className="btn btn-danger btn-block" onClick={signOut}><Logout /> Sign out{isNative ? ' of this phone' : ''}</button>
      </div>
    </ClientLayout>
  );
}
