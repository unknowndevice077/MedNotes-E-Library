import { useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { errMsg } from '../lib/format';
import { reloadSubjects, useSubjects, type Subject } from '../lib/subjects';
import { Modal, useConfirm, useToast } from '../components/ui';

/** Admin → Files → Subjects & categories: the one list buyers filter the library by. */
export default function SubjectsManager({ labels, onClose, onChanged }: { labels: string[]; onClose: () => void; onChanged: () => void }) {
  const subjects = useSubjects();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const count = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of labels) if (l.trim()) m.set(l.trim().toLowerCase(), (m.get(l.trim().toLowerCase()) ?? 0) + 1);
    return (s: string) => m.get(s.toLowerCase()) ?? 0;
  }, [labels]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    if (subjects.some((s) => s.name.toLowerCase() === v.toLowerCase())) return toast(`"${v}" is already on the list.`);
    setBusy(true);
    const { error } = await supabase.from('subjects').insert({ name: v });
    setBusy(false);
    if (error) return toast(errMsg(error));
    setName(''); await reloadSubjects(); toast(`Added "${v}".`);
  }
  async function rename(s: Subject) {
    const v = editing?.name.trim() ?? '';
    if (!v || v === s.name) return setEditing(null);
    const n = count(s.name);
    if (n && !(await confirm({ title: `Rename "${s.name}"?`, body: `The ${n} file${n === 1 ? '' : 's'} in this subject move to "${v}" too.`, confirmLabel: 'Rename' }))) return;
    const { error } = await supabase.rpc('admin_rename_subject', { p_id: s.id, p_name: v });
    if (error) return toast(errMsg(error));
    setEditing(null); await reloadSubjects(); onChanged(); toast('Subject renamed.');
  }
  async function remove(s: Subject) {
    const n = count(s.name);
    if (!(await confirm({ title: `Delete "${s.name}"?`, body: n ? `${n} file${n === 1 ? '' : 's'} use this subject. They stay in the library, just without a subject, until you pick a new one.` : 'No files use it.', confirmLabel: 'Delete subject', danger: true }))) return;
    const { error } = await supabase.rpc('admin_delete_subject', { p_id: s.id });
    if (error) return toast(errMsg(error));
    await reloadSubjects(); onChanged(); toast('Subject deleted.');
  }

  return (
    <Modal onClose={onClose} width={560}>
      <div className="col" style={{ gap: 14 }}>
        <div className="spread"><h2 style={{ margin: 0 }}>Subjects &amp; categories</h2><button className="muted" style={{ fontSize: 22 }} onClick={onClose} aria-label="Close">×</button></div>
        <span className="small muted">Add any subject or category your files need, like Anatomy, Board Exam Review or Nursing. Buyers filter the library by these, and they show first when you pick one for a file.</span>
        <form className="row" style={{ gap: 8 }} onSubmit={add}>
          <input id="new-subject" className="input grow" placeholder="New subject or category, e.g. Board Exam Review" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} aria-label="New subject" />
          <button className="btn btn-primary" disabled={busy || !name.trim()}>Add</button>
        </form>
        <div className="col subject-list">
          {subjects.length === 0 && <span className="muted">Nothing yet. Add the first one above.</span>}
          {subjects.map((s) => (
            <div key={s.id} className="spread subject-row">
              {editing?.id === s.id ? (
                <form className="row grow" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void rename(s); }}>
                  <input className="input grow" autoFocus maxLength={60} value={editing.name} onChange={(e) => setEditing({ id: s.id, name: e.target.value })} aria-label={`Rename ${s.name}`}
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }} />
                  <button className="btn btn-sm btn-primary">Save</button>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <span className="col" style={{ gap: 0 }}><b>{s.name}</b><span className="small muted">{count(s.name) === 1 ? '1 file' : `${count(s.name)} files`}</span></span>
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm" onClick={() => setEditing({ id: s.id, name: s.name })}>Rename</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(s)}>Delete</button>
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
