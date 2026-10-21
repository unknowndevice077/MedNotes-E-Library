import { useEffect, useRef, useState, type FormEvent, type ReactNode, useLayoutEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { initials } from '../lib/format';
import { Logo, Modal, useIsMobile } from './ui';
import { editAttr, Tx, useText, useTheme } from '../lib/theme';
import { usePrefs } from '../lib/prefs';
import { SITE_EDIT } from '../lib/siteText';
import { Back, Bell, Book, Chevron, Clock, Cog, Files, Grid, Home, Logout, Palette, Pay, Phone, Receipt, Search, Shield, Trend, User, Users } from './Icons';

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
          <Link to="/account" role="menuitem"><User /><Tx k="nav.account" /></Link>
          <Link to="/my-files" role="menuitem"><Book /><Tx k="nav.myFiles" /></Link>
          <Link to="/devices" role="menuitem"><Phone /><Tx k="nav.devices" /></Link>
          <Link to="/payments" role="menuitem"><Receipt />Payments & receipts</Link>
          <Link to="/help" role="menuitem"><Bell />Help & feedback</Link>
          {profile?.role === 'admin' && <Link to="/admin" role="menuitem"><Grid />Admin dashboard</Link>}
          <button role="menuitem" className="danger" onClick={signOut}><Logout />Sign out</button>
        </div>
      )}
    </div>
  );
}

function SiteFooter() {
  const { storeName } = useTheme();
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="col" style={{ gap: 8, maxWidth: 360 }}>
          <Logo />
          <span className="small muted"><Tx k="footer.text" /></span>
        </div>
        <div className="footer-links">
          <div className="col"><b className="small"><Tx k="footer.colLibrary" /></b><Link to="/library">Browse</Link><Link to="/my-files"><Tx k="nav.myFiles" /></Link><Link to="/payments">Payments & receipts</Link><Link to="/devices"><Tx k="nav.devices" /></Link></div>
          <div className="col"><b className="small"><Tx k="footer.colHelp" /></b><Link to="/help">Help & feedback</Link><Link to="/privacy">Privacy policy</Link><Link to="/data-deletion">Delete your data</Link><Link to="/account"><Tx k="nav.account" /></Link></div>
        </div>
      </div>
      <div className="site-footer-bottom small muted">© {new Date().getFullYear()} {storeName || 'MedNotes E-Library'} · <Tx k="footer.bottom" /></div>
    </footer>
  );
}

/** The buyer's light / dark / match-the-device choice (Account → Reading & app), with a local copy for the first paint. */
function useUserDark() {
  const { prefs } = usePrefs();
  const mode = prefs.appTheme ?? (() => { try { return (localStorage.getItem('mn.app-theme') as 'light' | 'dark' | 'system') || 'light'; } catch { return 'light'; } })();
  const [sysDark, setSysDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const q = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSysDark(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  const dark = !SITE_EDIT && (mode === 'dark' || (mode === 'system' && sysDark));
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-dark', dark);
    return () => document.documentElement.removeAttribute('data-dark');
  }, [dark]);
}

/** Client pages: top bar + footer on desktop, compact header + bottom tabs on phones and in the app. */
export function ClientLayout({ children, title, back, hideTabs, actions }: { children: ReactNode; title?: ReactNode; back?: string | true; hideTabs?: boolean; actions?: ReactNode }) {
  const mobile = useIsMobile();
  const t = useText();
  useUserDark();
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
            <NavLink to="/library" className="tab"><span className="tab-ico"><Home /></span><Tx k="nav.library" /></NavLink>
            <NavLink to="/my-files" className="tab"><span className="tab-ico"><Book />{pending > 0 && <i className="dot sm" />}</span><Tx k="nav.myFiles" /></NavLink>
            <NavLink to="/devices" className="tab"><span className="tab-ico"><Phone /></span><Tx k="nav.devices" /></NavLink>
            <NavLink to="/account" className="tab"><span className="tab-ico"><User /></span><Tx k="nav.account" /></NavLink>
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
          <NavLink to="/library"><Tx k="nav.library" /></NavLink>
          <NavLink to="/my-files"><Tx k="nav.myFiles" /></NavLink>
          <NavLink to="/devices"><Tx k="nav.devices" /></NavLink>
        </nav>
        <form className="search top-search" onSubmit={search} role="search">
          <Search width={18} color="var(--slate-400)" />
          <input placeholder={t('nav.search')} {...editAttr('nav.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the library" />
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

/** Admin dark mode (Admin → Settings): the admin's own preference, with a local copy so the first paint is right. */
export function useAdminDark(): [boolean, (v: boolean) => void] {
  const { profile } = useAuth();
  const { save } = usePrefs();
  const dark = profile?.prefs?.adminDark ?? (() => { try { return localStorage.getItem('mn.admin-dark') === '1'; } catch { return false; } })();
  const set = (v: boolean) => { try { localStorage.setItem('mn.admin-dark', v ? '1' : '0'); } catch { /* private mode */ } save({ adminDark: v }); };
  return [!!dark, set];
}

export function AdminLayout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  const { signOut } = useAuth();
  const [dark] = useAdminDark();
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-dark', !!dark);
    return () => document.documentElement.removeAttribute('data-dark');
  }, [dark]);
  const pending = useCount('admin-pending', async () => {
    const [a, b] = await Promise.all([
      supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('device_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    return { count: (a.count ?? 0) + (b.count ?? 0) };
  });
  const mobile = useIsMobile();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const links = [
    { to: '/admin', label: 'Dashboard', icon: <Grid />, end: true },
    { to: '/admin/files', label: 'Files', icon: <Files /> },
    { to: '/admin/payments', label: 'Payments', icon: <Pay />, count: pending },
    { to: '/admin/users', label: 'Users', icon: <Users /> },
    { to: '/admin/support', label: 'Support', icon: <Bell /> },
    { to: '/admin/receipts', label: 'Receipts', icon: <Receipt /> },
    { to: '/admin/statistics', label: 'Statistics', icon: <Trend /> },
    { to: '/admin/logs', label: 'Logs', icon: <Clock /> },
    { to: '/admin/restrictions', label: 'Restrictions', icon: <Shield /> },
    { to: '/admin/appearance', label: 'Appearance', icon: <Palette /> },
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
          <button type="button" className={`tab${['/admin/settings', '/admin/restrictions', '/admin/receipts', '/admin/appearance', '/admin/logs', '/admin/statistics', '/admin/support'].includes(loc.pathname) ? ' active' : ''}`} onClick={() => setMore(true)}><Cog />More</button>
        </nav>
        {more && (
          <Modal onClose={() => setMore(false)} width={420}>
            <h2>More</h2>
            <div className="col more-menu" style={{ gap: 4 }}>
              <Link to="/admin/support" onClick={() => setMore(false)}><Bell />Support</Link>
              <Link to="/admin/receipts" onClick={() => setMore(false)}><Receipt />Receipts</Link>
              <Link to="/admin/statistics" onClick={() => setMore(false)}><Trend />Statistics</Link>
              <Link to="/admin/logs" onClick={() => setMore(false)}><Clock />Logs</Link>
              <Link to="/admin/restrictions" onClick={() => setMore(false)}><Shield />Restrictions</Link>
              <Link to="/admin/appearance" onClick={() => setMore(false)}><Palette />Appearance</Link>
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
