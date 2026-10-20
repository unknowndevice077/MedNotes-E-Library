import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { dateTime, errMsg } from '../lib/format';
import type { AuditEntry } from '../lib/types';
import { AdminLayout } from '../components/Layouts';
import { Empty, Modal, useConfirm, useToast } from '../components/ui';
import { Search } from '../components/Icons';
import { RowsSkeleton } from '../components/Skeletons';

const PAGE = 100;
const REVERTABLE = ['files', 'purchases', 'settings', 'profiles', 'devices', 'admin_allowlist', 'device_orders'];
const EDITABLE = ['files', 'purchases', 'settings', 'profiles', 'device_orders'];
// fields that are long, technical or never meant to be hand-edited
const HIDDEN = ['payment_methods', 'theme', 'receipt_design', 'prefs', 'before', 'after'];
const LOCKED = ['id', 'created_at', 'user_id', 'file_id', 'storage_path', 'proof_path'];

const TYPES: Record<string, string> = {
  '': 'Everything', sign_in: 'Sign-ins', open_file: 'Files opened', purchases: 'Payments', device_orders: 'Device slot orders',
  files: 'Files (uploads, edits)', profiles: 'Accounts', devices: 'Devices', settings: 'Settings', admin_allowlist: 'Admin emails',
};

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Fields that changed between before and after (all fields for inserts/deletes). */
function changes(e: AuditEntry) {
  const keys = [...new Set([...Object.keys(e.before ?? {}), ...Object.keys(e.after ?? {})])].filter((k) => k !== 'updated_at');
  return keys.filter((k) => !e.before || !e.after || JSON.stringify(e.before[k]) !== JSON.stringify(e.after[k]))
    .map((k) => ({ k, from: e.before?.[k], to: e.after?.[k] }));
}

function EditModal({ e, onClose, onDone }: { e: AuditEntry; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { data: current, loading } = useLoad(async () => {
    const pk = e.entity === 'admin_allowlist' ? 'email' : 'id';
    const { data } = await supabase.from(e.entity).select('*').eq(pk, e.entity === 'settings' ? 1 : e.entity_id).maybeSingle();
    return data as Record<string, unknown> | null;
  }, [e.id], { cache: false });
  const [patch, setPatch] = useState<Record<string, string>>({});
  async function save() {
    const typed: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      const orig = current?.[k];
      typed[k] = typeof orig === 'number' ? Number(v) : typeof orig === 'boolean' ? v === 'true' : v === '' && orig === null ? null : v;
    }
    const { error } = await supabase.rpc('admin_edit', { p_entity: e.entity, p_id: e.entity === 'settings' ? '1' : e.entity_id, p_patch: typed });
    if (error) return toast(errMsg(error));
    toast('Saved. The change is in the log and can be reverted.'); onDone();
  }
  return (
    <Modal onClose={onClose} width={640}>
      <h2>Edit {e.entity.replace('_', ' ')} record</h2>
      {loading ? <RowsSkeleton rows={4} thumb={false} /> : !current ? <Empty title="This record no longer exists" /> : (
        <div className="col log-edit">
          {Object.entries(current).filter(([k]) => !HIDDEN.includes(k)).map(([k, v]) => (
            <div key={k} className="field">
              <label htmlFor={`ed-${k}`}>{k.replace(/_/g, ' ')}</label>
              {typeof v === 'boolean' ? (
                <select id={`ed-${k}`} className="input" value={patch[k] ?? String(v)} disabled={LOCKED.includes(k)} onChange={(ev) => setPatch({ ...patch, [k]: ev.target.value })}><option value="true">true</option><option value="false">false</option></select>
              ) : (
                <input id={`ed-${k}`} className="input" value={patch[k] ?? (v === null ? '' : String(v))} disabled={LOCKED.includes(k)} onChange={(ev) => setPatch({ ...patch, [k]: ev.target.value })} />
              )}
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!Object.keys(patch).length} onClick={save}>Save changes</button></div>
    </Modal>
  );
}

/** The activity feed. Used on its own page and, filtered to one person, on a user's admin page. */
export function LogList({ user, compact }: { user?: string; compact?: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [sp, setSp] = useSearchParams();
  const who = compact ? '' : sp.get('who') ?? '';
  const type = compact ? '' : sp.get('type') ?? '';
  const q = compact ? '' : sp.get('q') ?? '';
  const from = compact ? '' : sp.get('from') ?? '';
  const [limit, setLimit] = useState(compact ? 12 : PAGE);
  const [editing, setEditing] = useState<AuditEntry | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };

  const { data, loading, reload } = useLoad(async () => {
    let query = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(limit);
    if (user) query = query.or(`subject_user.eq.${user},actor.eq.${user}`);
    if (who) query = query.eq('actor_role', who);
    if (type === 'sign_in') query = query.in('action', ['sign_in', 'sign_out']);
    else if (type === 'open_file') query = query.eq('action', 'open_file');
    else if (type) query = query.eq('entity', type).neq('action', 'open_file');
    if (q) query = query.or(`actor_email.ilike.%${q.replace(/[%,()]/g, '')}%,summary.ilike.%${q.replace(/[%,()]/g, '')}%`);
    if (from) query = query.gte('at', new Date(from).toISOString());
    const { data: rows, error } = await query;
    if (error) throw error;
    return rows as AuditEntry[];
  }, [user, who, type, q, from, limit], { cache: false });

  const byId = useMemo(() => new Map((data ?? []).map((e) => [e.id, e])), [data]);

  async function revert(e: AuditEntry) {
    const what = e.action.endsWith('.insert') ? 'This removes what was added.' : e.action.endsWith('.delete') ? 'This restores what was deleted.' : 'The changed fields go back to their earlier values.';
    if (!(await confirm({ title: 'Revert this change?', body: <>{e.summary}<br />{what} The revert is logged too.</>, confirmLabel: 'Revert' }))) return;
    const { error } = await supabase.rpc('admin_revert', { p_log: e.id });
    if (error) return toast(errMsg(error));
    toast('Reverted.'); reload();
  }

  return (
    <div className="col" style={{ gap: 12 }}>
      {!compact && (
        <div className="filterbar log-filters">
          <label className="search" style={{ flex: '1 1 240px' }}><Search width={18} color="var(--slate-400)" />
            <input placeholder="Email or what happened" defaultValue={q} onKeyDown={(ev) => { if (ev.key === 'Enter') set('q', (ev.target as HTMLInputElement).value.trim()); }} onBlur={(ev) => set('q', ev.target.value.trim())} aria-label="Search the log" /></label>
          <select className="input" value={who} onChange={(ev) => set('who', ev.target.value)} aria-label="Who"><option value="">Everyone</option><option value="admin">Admins</option><option value="client">Buyers</option><option value="system">System</option></select>
          <select className="input" value={type} onChange={(ev) => set('type', ev.target.value)} aria-label="What">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input className="input" type="date" value={from} onChange={(ev) => set('from', ev.target.value)} aria-label="From date" style={{ width: 170 }} />
        </div>
      )}
      {loading && !data ? <RowsSkeleton rows={compact ? 4 : 8} thumb={false} /> : (data ?? []).length === 0 ? <Empty title="Nothing logged yet">{compact ? 'This person has no activity yet.' : 'Try another filter.'}</Empty> : (
        <div className="card col log-list" style={{ padding: 0, gap: 0 }}>
          {data!.map((e) => {
            const diff = changes(e);
            const canRevert = REVERTABLE.includes(e.entity) && !e.reverted_at && e.action !== 'open_file' && e.action !== 'profiles.delete' && !e.revert_of;
            const canEdit = EDITABLE.includes(e.entity) && !e.action.endsWith('.delete') && e.action !== 'open_file';
            const isOpen = open === e.id;
            return (
              <div key={e.id} className={`log-row${e.reverted_at ? ' reverted' : ''}`}>
                <button type="button" className="log-head" onClick={() => setOpen(isOpen ? null : e.id)} aria-expanded={isOpen}>
                  <span className={`log-dot r-${e.actor_role}`} title={e.actor_role} />
                  <span className="col grow" style={{ gap: 2, minWidth: 0 }}>
                    <b className="ellipsis">{e.summary || e.action}</b>
                    <span className="small muted ellipsis">{e.actor_email || 'System'} · {e.actor_role}{e.revert_of ? ` · reverts #${e.revert_of}` : ''}</span>
                  </span>
                  {e.reverted_at && <span className="badge b-lock">Reverted</span>}
                  <span className="small muted log-time">{dateTime(e.at)}</span>
                </button>
                {isOpen && (
                  <div className="log-body">
                    {diff.length > 0 && (
                      <div className="log-diff">
                        {diff.filter((d) => !HIDDEN.includes(d.k) || e.entity === 'settings').slice(0, 30).map((d) => (
                          <div key={d.k} className="log-diff-row"><span className="muted">{d.k.replace(/_/g, ' ')}</span><span className="from">{show(d.from)}</span><span className="to">{show(d.to)}</span></div>
                        ))}
                      </div>
                    )}
                    <div className="row wrap" style={{ gap: 8 }}>
                      {e.subject_user && !user && <Link className="btn btn-sm" to={`/admin/users/${e.subject_user}`}>Open account</Link>}
                      {canEdit && <button className="btn btn-sm" onClick={() => setEditing(e)}>Edit record</button>}
                      {canRevert && <button className="btn btn-sm btn-danger" onClick={() => revert(e)}>Revert</button>}
                      {e.revert_of && byId.get(e.revert_of) && <span className="small muted">Undoes: {byId.get(e.revert_of)!.summary}</span>}
                      <span className="small muted" style={{ marginLeft: 'auto' }}>#{e.id} · {e.action}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!compact && (data ?? []).length >= limit && <button className="btn" style={{ alignSelf: 'center' }} onClick={() => setLimit(limit + PAGE)}>Show more</button>}
      {editing && <EditModal e={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

export default function AdminLogs() {
  return (
    <AdminLayout title="Logs" subtitle="Everything buyers and admins did. Open a line to see what changed, edit the record or revert it.">
      <LogList />
    </AdminLayout>
  );
}
