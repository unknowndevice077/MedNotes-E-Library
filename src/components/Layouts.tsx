import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { initials } from '../lib/format';
import { Logo, Modal, useIsMobile } from './ui';
import { Back, Bell, Book, Chevron, Cog, Files, Grid, Home, Logout, Pay, Phone, Search, Shield, User, Users } from './Icons';

function Avatar({ size }: { size?: number }) {
  const { profile } = useAuth();
  return (
    <span className="avatar" style={size ? { width: size, height: size, borderRadius: size / 2 } : undefined}>
      {profile?.avatar_url ? <img src={profile.avatar_url} alt="" referrerPolicy="no-referrer" /> : initials(profile?.full_name ?? '', profile?.email)}
    </span>
  );
}

/** Pending payments for the signed-in buyer (the bell badge). */
// Last known badge counts, kept across page changes so the bell doesn't flicker or refetch on every page.
const counts = new Map<string, number>();
function useCount(key: string | null, query: () => PromiseLike<{ count: number | null }>) {
  const [n, setN] = useState(() => (key && counts.get(key)) || 0);
  useEffect(() => {
    if (!key) return;
    const last = counts.get(`${key}:at`) ?? 0;
    if (Date.now() - last < 30_000) { setN(counts.get(key) ?? 0); return; } // fresh enough
    query().then(({ count }) => { counts.set(key, count ?? 0); counts.set(`${key}:at`, Date.now()); setN(count ?? 0); });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return n;
}
export const invalidateCounts = () => counts.clear();

function usePendingCount() {
  const { session } = useAuth();
  const uid = session?.user.id ?? null;
  return useCount(uid && `mine:${uid}`, () => supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('user_id', uid!).eq('status', 'pending'));
}

function UserMenu() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="user-chip" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Avatar size={34} /><span className="hide-sm">{profile?.full_name?.split(' ')[0] || 'Account'}</span><Chevron width={16} />
      </button>
      {open && (
        <div className="menu" role="menu" onClick={() => setOpen(false)}>
          <div className="menu-head"><Avatar size={40} /><div className="col" style={{ gap: 0, minWidth: 0 }}><b>{profile?.full_name || 'Your account'}</b><span className="small muted ellipsis">{profile?.email}</span></div></div>
          <Link to="/account" role="menuitem"><User />Account</Link>
          <Link to="/my-files" role="menuitem"><Book />My files</Link>
          <Link to="/devices" role="menuitem"><Phone />Devices</Link>
          {profile?.role === 'admin' && <Link to="/admin" role="menuitem"><Grid />Admin dashboard</Link>}
          <button role="menuitem" className="danger" onClick={signOut}><Logout />Sign out</button>
        </div>
      )}
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="col" style={{ gap: 8, maxWidth: 360 }}>
          <Logo />
          <span className="small muted">Medical notes, e-books, lectures and slides from trusted publishers. Files are view-only and protected for each buyer.</span>
        </div>
        <div className="footer-links">
          <div className="col"><b className="small">Library</b><Link to="/library">Browse</Link><Link to="/my-files">My files</Link><Link to="/devices">Devices</Link></div>
          <div className="col"><b className="small">Help</b><Link to="/privacy">Privacy policy</Link><Link to="/data-deletion">Delete your data</Link><Link to="/account">Account</Link></div>
        </div>
      </div>
      <div className="site-footer-bottom small muted">© {new Date().getFullYear()} MedNotes E-Library · Files are licensed to your account and can only be viewed in MedNotes.</div>
    </footer>
  );
}

/** Client pages: top bar + footer on desktop, compact header + bottom tabs on phones and in the app. */
export function ClientLayout({ children, title, back, hideTabs, actions }: { children: ReactNode; title?: string; back?: string | true; hideTabs?: boolean; actions?: ReactNode }) {
  const mobile = useIsMobile();
  const nav = useNavigate();
  const loc = useLocation();
  const pending = usePendingCount();
  const [q, setQ] = useState(() => new URLSearchParams(loc.search).get('q') ?? '');
  const search = (e: FormEvent) => { e.preventDefault(); nav(`/library${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`); };
  if (mobile) {
    return (
      <div className={hideTabs ? 'm-shell' : 'm-shell with-tabbar'}>
        <header className="mobile-top">
          {back ? <button className="icon-btn" onClick={() => (back === true ? nav(-1) : nav(back))} aria-label="Back"><Back width={22} /></button>
            : title ? <b style={{ fontSize: 19 }}>{title}</b> : <Logo short size={30} />}
          {back && <b className="ellipsis" style={{ maxWidth: '62vw' }}>{title}</b>}
          <span className="row" style={{ gap: 6 }}>
            {actions}
            {!back && <Link to="/my-files" className="icon-btn bell" aria-label="Payments"><Bell width={21} />{pending > 0 && <i className="dot">{pending}</i>}</Link>}
            {!back && !title && <Link to="/account"><Avatar size={32} /></Link>}
            {back && !actions && <span style={{ width: 36 }} />}
          </span>
        </header>
        <div className="m-body">{children}</div>
        {!hideTabs && (
          <nav className="tabbar" aria-label="Main">
            <NavLink to="/library" className="tab"><span className="tab-ico"><Home /></span>Library</NavLink>
            <NavLink to="/my-files" className="tab"><span className="tab-ico"><Book />{pending > 0 && <i className="dot sm" />}</span>My files</NavLink>
            <NavLink to="/devices" className="tab"><span className="tab-ico"><Phone /></span>Devices</NavLink>
            <NavLink to="/account" className="tab"><span className="tab-ico"><User /></span>Account</NavLink>
          </nav>
        )}
      </div>
    );
  }
  return (
    <div className="d-shell">
      <header className="topbar">
        <Link to="/library" aria-label="MedNotes home"><Logo /></Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/my-files">My files</NavLink>
          <NavLink to="/devices">Devices</NavLink>
        </nav>
        <form className="search top-search" onSubmit={search} role="search">
          <Search width={18} color="var(--slate-400)" />
          <input placeholder="Search notes, books, lectures…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" />
        </form>
        <span className="grow" />
        <Link to="/my-files" className="icon-btn bell" aria-label={pending ? `${pending} payments waiting` : 'Payments'}><Bell width={21} />{pending > 0 && <i className="dot">{pending}</i>}</Link>
        <UserMenu />
      </header>
      <main className="d-main">{children}</main>
      <SiteFooter />
    </div>
  );
}

export function AdminLayout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const { signOut } = useAuth();
  const pending = useCount('admin-pending', () => supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('status', 'pending'));
  const mobile = useIsMobile();
  const loc = useLocation();
  const [more, setMore] = useState(false);
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
        <header className="mobile-top admin-mtop" style={{ background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' }}>
          <b style={{ fontSize: 18 }}>{title}</b><span className="row head-actions" style={{ gap: 8 }}>{actions}</span>
        </header>
        <div className="content">{children}</div>
        <nav className="tabbar">
          {links.filter((l) => ['Dashboard', 'Files', 'Payments', 'Users'].includes(l.label)).map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className="tab">{l.icon}{l.label === 'Dashboard' ? 'Home' : l.label}</NavLink>
          ))}
          <button type="button" className={`tab${['/admin/settings', '/admin/restrictions'].includes(loc.pathname) ? ' active' : ''}`} onClick={() => setMore(true)}><Cog />More</button>
        </nav>
        {more && (
          <Modal onClose={() => setMore(false)} width={420}>
            <h2>More</h2>
            <div className="col more-menu" style={{ gap: 4 }}>
              <Link to="/admin/restrictions" onClick={() => setMore(false)}><Shield />Restrictions</Link>
              <Link to="/admin/settings" onClick={() => setMore(false)}><Cog />Settings</Link>
              <Link to="/library" onClick={() => setMore(false)}><Book />Open library</Link>
              <button type="button" onClick={() => signOut()}><Logout />Sign out</button>
            </div>
          </Modal>
        )}
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
          <div className="row head-actions">{actions}</div>
        </div>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
