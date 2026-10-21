import type { CSSProperties, ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useIsMobile } from './ui';

// Grey placeholder shapes shown while data loads, laid out like the page they stand in for,
// so nothing jumps around and there's no spinner.
export const Bar = ({ w = '100%', h = 14, r, style }: { w?: number | string; h?: number; r?: number; style?: CSSProperties }) =>
  <span className="skeleton sk-bar" style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden />;

const Card = ({ children, style }: { children: ReactNode; style?: CSSProperties }) =>
  <div className="card col sk-card" style={{ gap: 12, ...style }} aria-hidden>{children}</div>;

const Busy = ({ children, label = 'Loading' }: { children: ReactNode; label?: string }) =>
  <div className="sk-wrap" role="status" aria-busy="true" aria-label={label}>{children}</div>;

export function CoverGridSkeleton({ n = 10 }: { n?: number }) {
  return <div className="grid">{Array.from({ length: n }, (_, i) => <div key={i} className="col" style={{ gap: 10 }}><Bar h={0} style={{ aspectRatio: '3 / 4', height: 'auto' }} r={10} /><Bar w="60%" h={12} /><Bar h={16} /></div>)}</div>;
}

export function RowsSkeleton({ rows = 6, thumb = true }: { rows?: number; thumb?: boolean }) {
  return (
    <Busy>
      <div className="card col" style={{ padding: 0, gap: 0 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="row sk-row">
            {thumb && <Bar w={36} h={48} r={6} />}
            <div className="col grow" style={{ gap: 8 }}><Bar w={`${55 - (i % 3) * 8}%`} h={14} /><Bar w="35%" h={11} /></div>
            <Bar w={70} h={24} r={12} />
          </div>
        ))}
      </div>
    </Busy>
  );
}

export function StatsSkeleton({ n = 4 }: { n?: number }) {
  return <div className="row wrap" style={{ gap: 16 }}>{Array.from({ length: n }, (_, i) => <Card key={i} style={{ flex: '1 1 200px' }}><Bar w="50%" h={12} /><Bar w="40%" h={28} /><Bar w="65%" h={11} /></Card>)}</div>;
}

export function DashboardSkeleton() {
  return (
    <Busy>
      <div className="col" style={{ gap: 20 }}>
        <StatsSkeleton />
        <div className="row wrap" style={{ gap: 16, alignItems: 'stretch' }}>
          <Card style={{ flex: '2 1 340px' }}><Bar w={120} h={16} /><Bar h={180} r={12} /></Card>
          <Card style={{ flex: '1 1 300px' }}><Bar w={120} h={16} />{Array.from({ length: 5 }, (_, i) => <div key={i} className="row"><Bar w={36} h={36} r={18} /><div className="col grow" style={{ gap: 6 }}><Bar w="60%" h={12} /><Bar w="35%" h={10} /></div></div>)}</Card>
        </div>
      </div>
    </Busy>
  );
}

export function FormSkeleton({ cards = 2, fields = 4 }: { cards?: number; fields?: number }) {
  return (
    <Busy>
      <div className="col" style={{ gap: 16 }}>
        {Array.from({ length: cards }, (_, c) => (
          <Card key={c}><Bar w={180} h={18} />{Array.from({ length: fields }, (_, i) => <div key={i} className="spread"><div className="col" style={{ gap: 6, flex: 1 }}><Bar w="40%" h={13} /><Bar w="60%" h={10} /></div><Bar w={80} h={34} r={10} /></div>)}</Card>
        ))}
      </div>
    </Busy>
  );
}

export function DetailSkeleton() {
  return (
    <Busy>
      <div className="detail-grid">
        <div className="detail-cover"><Bar h={0} style={{ aspectRatio: '3 / 4', height: 'auto' }} r={16} /></div>
        <div className="col detail-main" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 8 }}><Bar w={60} h={22} r={11} /><Bar w={80} h={22} r={11} /></div>
          <Bar w="80%" h={34} /><Bar w="45%" h={14} /><Bar h={14} /><Bar w="90%" h={14} />
          <div className="facts">{Array.from({ length: 4 }, (_, i) => <Bar key={i} h={58} r={12} />)}</div>
        </div>
        <Card style={{ alignSelf: 'start' }}><Bar w="40%" h={14} /><Bar w="55%" h={30} /><Bar h={46} r={12} />{Array.from({ length: 3 }, (_, i) => <Bar key={i} w={`${80 - i * 10}%`} h={12} />)}</Card>
      </div>
    </Busy>
  );
}

export function CheckoutSkeleton() {
  return (
    <Busy>
      <div className="row wrap" style={{ gap: 24, alignItems: 'flex-start' }}>
        <div className="col grow" style={{ gap: 16, minWidth: 'min(300px, 100%)' }}>
          <Card><Bar w={160} h={16} /><Bar h={56} r={12} /><Bar w={220} h={220} r={12} /><Bar w="70%" h={12} /><Bar w="60%" h={12} /></Card>
          <Card><Bar w={180} h={16} /><Bar h={110} r={12} /></Card>
        </div>
        <Card style={{ width: 340, maxWidth: '100%' }}><Bar w={120} h={16} /><div className="row"><Bar w={44} h={58} r={6} /><div className="col grow" style={{ gap: 6 }}><Bar w="70%" h={13} /><Bar w="40%" h={10} /></div></div><Bar h={24} /></Card>
      </div>
    </Busy>
  );
}

export function ReceiptSkeleton() {
  return (
    <Busy>
      <Card style={{ width: '100%', maxWidth: 540, padding: 36, margin: '0 auto' }}>
        <div className="spread"><Bar w={150} h={30} /><Bar w={60} h={22} r={11} /></div>
        <Bar w="45%" h={22} /><Bar w="35%" h={12} />
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="spread"><Bar w="25%" h={12} /><Bar w="40%" h={12} /></div>)}
        <div className="spread"><Bar w="30%" h={16} /><Bar w="30%" h={26} /></div>
      </Card>
    </Busy>
  );
}

export function DevicesSkeleton() {
  return <Busy><div className="col" style={{ gap: 12 }}>{[0, 1].map((i) => <Card key={i}><div className="row"><Bar w={44} h={44} r={12} /><div className="col grow" style={{ gap: 6 }}><Bar w="45%" h={14} /><Bar w="30%" h={11} /></div><Bar w={70} h={28} r={10} /></div></Card>)}</div></Busy>;
}

/** The reader while a file is fetched and decrypted: a blank page with a real progress bar. */
export function ReaderSkeleton({ progress, label }: { progress: number; label: string }) {
  return (
    <div className="reader-sk" role="status" aria-label={label}>
      <div className="reader-progress"><span style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} /></div>
      <div className="reader-page sk-page col" style={{ gap: 14 }}>
        <Bar w="60%" h={26} /><Bar w="35%" h={12} />
        {Array.from({ length: 12 }, (_, i) => <Bar key={i} w={`${92 - (i * 7) % 30}%`} h={12} />)}
      </div>
      <span className="small muted reader-sk-label">{label}</span>
    </div>
  );
}

/** First paint before we know who is signed in: the app's frame with placeholder content. */
export function AppShellSkeleton() {
  const mobile = useIsMobile();
  const admin = useLocation().pathname.startsWith('/admin');
  if (admin && !mobile) {
    return (
      <div className="shell" role="status" aria-busy="true" aria-label="Loading MedNotes">
        <aside className="side" style={{ gap: 14 }}><Bar w={140} h={30} style={{ opacity: .25 }} />{Array.from({ length: 6 }, (_, i) => <Bar key={i} h={36} r={10} style={{ opacity: .15 }} />)}</aside>
        <main className="main"><div className="mainhead"><Bar w={180} h={24} /></div><div className="content"><DashboardSkeleton /></div></main>
      </div>
    );
  }
  return (
    <div className={mobile ? 'with-tabbar' : 'd-shell'} role="status" aria-busy="true" aria-label="Loading MedNotes">
      {mobile ? <header className="mobile-top"><Bar w={110} h={22} /><Bar w={34} h={34} r={17} /></header>
        : <header className="topbar"><Bar w={190} h={30} /><Bar w={220} h={14} /><Bar w={320} h={40} r={12} /><span className="grow" /><Bar w={110} h={38} r={19} /></header>}
      <div className="page"><Bar h={mobile ? 220 : 180} r={24} /><CoverGridSkeleton n={mobile ? 4 : 10} /></div>
      {mobile && <nav className="tabbar">{Array.from({ length: 4 }, (_, i) => <Bar key={i} w={44} h={30} r={15} style={{ margin: 'auto' }} />)}</nav>}
    </div>
  );
}
