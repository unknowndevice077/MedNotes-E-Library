import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { initials } from '../lib/format';
import { Logo, useIsMobile } from './ui';
import { Back, Bell, Book, Cog, Files, Grid, Home, Logout, Pay, Phone, Shield, User, Users } from './Icons';

function Avatar() {
  const { profile } = useAuth();
  return (
    <span className="avatar">
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials(profile?.full_name ?? '', profile?.email)}
    </span>
  );
}

/** Client pages: top bar on desktop, compact header + bottom tabs on phones and in the app. */
export function ClientLayout({ children, title, back, hideTabs, actions }: { children: ReactNode; title?: string; back?: string | true; hideTabs?: boolean; actions?: ReactNode }) {
  const mobile = useIsMobile();
  const nav = useNavigate();
  const { profile } = useAuth();
  if (mobile) {
    return (
      <div className={hideTabs ? '' : 'with-tabbar'}>
        <header className="mobile-top">
          {back ? <button onClick={() => (back === true ? nav(-1) : nav(back))} aria-label="Back"><Back width={22} /></button>
            : title ? <b style={{ fontSize: 18 }}>{title}</b> : <Logo short size={30} />}
          {back && <b>{title}</b>}
          <span className="row" style={{ gap: 8 }}>{actions}{!back && !title && <Link to="/account"><Avatar /></Link>}{back && !actions && <span style={{ width: 22 }} />}</span>
        </header>
        {children}
        {!hideTabs && (
          <nav className="tabbar">
            <NavLink to="/library" className="tab"><Home />Library</NavLink>
            <NavLink to="/my-files" className="tab"><Book />My files</NavLink>
            <NavLink to="/devices" className="tab"><Phone />Devices</NavLink>
            <NavLink to="/account" className="tab"><User />Account</NavLink>
          </nav>
        )}
      </div>
    );
  }
  return (
    <div>
      <header className="topbar">
        <Link to="/library"><Logo /></Link>
        <nav className="nav">
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/my-files">My files</NavLink>
          <NavLink to="/devices">Devices</NavLink>
          {profile?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <span className="grow" />
        <Link to="/my-files" aria-label="Notifications" style={{ color: 'var(--slate-600)' }}><Bell width={22} /></Link>
        <Link to="/account"><Avatar /></Link>
      </header>
      {children}
    </div>
  );
}

export function AdminLayout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const [pending, setPending] = useState(0);
  const { signOut } = useAuth();
  const mobile = useIsMobile();
  useEffect(() => {
    supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('status', 'pending').then(({ count }) => setPending(count ?? 0));
  }, [title]);
  const links = [
    { to: '/admin', label: 'Dashboard', icon: <Grid />, end: true },
    { to: '/admin/files', label: 'Files', icon: <Files /> },
    { to: '/admin/payments', label: 'Payments', icon: <Pay />, count: pending },
    { to: '/admin/users', label: 'Users', icon: <Users /> },
    { to: '/admin/restrictions', label: 'Restrictions', icon: <Shield /> },
    { to: '/admin/settings', label: 'Settings', icon: <Cog /> },
  ];
  if (mobile) {
    return (
      <div className="with-tabbar">
        <header className="mobile-top" style={{ background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' }}>
          <b style={{ fontSize: 18 }}>{title}</b><span className="row" style={{ gap: 8 }}>{actions}</span>
        </header>
        <div className="content">{children}</div>
        <nav className="tabbar">
          {links.filter((l) => ['Dashboard', 'Files', 'Payments', 'Users'].includes(l.label)).map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="tab">{l.icon}{l.label === 'Dashboard' ? 'Home' : l.label}</NavLink>
          ))}
          <NavLink to="/admin/settings" className="tab"><Cog />More</NavLink>
        </nav>
      </div>
    );
  }
  return (
    <div className="shell">
      <aside className="side">
        <div style={{ padding: '0 8px 22px' }}><Logo light short size={32} /> <span className="small" style={{ color: '#94a3b8', marginLeft: 46 }}>Admin</span></div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}>{l.icon}{l.label}{!!l.count && <span className="count">{l.count}</span>}</NavLink>
        ))}
        <span className="grow" />
        <Link to="/library"><Book />Open library</Link>
        <a href="#" onClick={(e) => { e.preventDefault(); signOut(); }}><Logout />Sign out</a>
      </aside>
      <main className="main">
        <div className="mainhead">
          <div className="col" style={{ gap: 0 }}><h2>{title}</h2>{subtitle && <span className="small muted">{subtitle}</span>}</div>
          <div className="row">{actions}</div>
        </div>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
