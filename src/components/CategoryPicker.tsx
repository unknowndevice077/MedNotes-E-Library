import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CATEGORY_GROUPS, matches } from '../lib/categories';
import { Chevron, Search } from './Icons';

/**
 * Searchable dropdown of medical subjects. `counts` shows how many files each subject has and puts
 * those first (library filter); `allowCustom` lets the admin keep any label they type (upload form).
 */
export default function CategoryPicker({ id, value, onChange, counts, allowCustom, allLabel, placeholder = 'Search subjects…' }: {
  id?: string; value: string | null; onChange: (v: string | null) => void;
  counts?: Map<string, number>; allowCustom?: boolean; allLabel?: string; placeholder?: string;
}) {
  const auto = useId();
  const inputId = id ?? `cat-${auto}`;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // groups → flat options, filtered by the search; labels already used in the library come first
  const options = useMemo(() => {
    const extra = counts ? [...counts.keys()].filter((k) => !CATEGORY_GROUPS.some((g) => g.items.includes(k))) : [];
    const groups = [...(extra.length ? [{ group: 'In your library', items: extra }] : []), ...CATEGORY_GROUPS];
    const out: { label: string; group: string }[] = [];
    for (const g of groups) {
      const items = g.items.filter((i) => !q || matches(i, q));
      if (counts) items.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
      for (const i of items) out.push({ label: i, group: g.group });
    }
    return out;
  }, [q, counts]);
  const custom = allowCustom && q.trim() && !options.some((o) => o.label.toLowerCase() === q.trim().toLowerCase()) ? q.trim() : null;
  const rows = [...(allLabel && !q ? [{ label: '', group: '' }] : []), ...(custom ? [{ label: custom, group: 'custom' }] : []), ...options];

  useEffect(() => { setActive(0); }, [q, open]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  useEffect(() => { list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const pick = (label: string) => { onChange(label || null); setQ(''); setOpen(false); };

  return (
    <div className="catpick" ref={box}>
      <div className={`catpick-field input${open ? ' open' : ''}`} onClick={() => setOpen(true)}>
        <Search width={16} color="var(--slate-400)" />
        <input id={inputId} role="combobox" aria-expanded={open} aria-controls={`${inputId}-list`} aria-autocomplete="list" autoComplete="off"
          value={open ? q : value ?? ''} placeholder={value ?? allLabel ?? placeholder}
          onFocus={() => { setOpen(true); }}
          onChange={(e) => { setQ(e.target.value); setOpen(true); if (allowCustom) onChange(e.target.value.trim() || null); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(rows.length - 1, a + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter' && open && rows[active]) { e.preventDefault(); pick(rows[active]!.label); }
            else if (e.key === 'Escape') { setOpen(false); setQ(''); }
            else if (e.key === 'Tab') setOpen(false);
          }} />
        {value && !open ? <button type="button" className="catpick-clear" aria-label="Clear subject" onClick={(e) => { e.stopPropagation(); pick(''); }}>×</button> : <Chevron width={16} />}
      </div>
      {open && (
        <ul className="catpick-list" id={`${inputId}-list`} role="listbox" ref={list}>
          {rows.length === 0 && <li className="catpick-empty small muted">No subject matches “{q}”</li>}
          {rows.map((r, i) => {
            const head = r.group && r.group !== 'custom' && rows[i - 1]?.group !== r.group;
            const n = counts?.get(r.label) ?? 0;
            return [
              head ? <li key={`h-${r.group}`} className="catpick-group" role="presentation">{r.group}</li> : null,
              <li key={`${r.group}-${r.label}`} role="option" aria-selected={value === r.label || (!r.label && !value)} data-active={i === active}
                className={`catpick-opt${i === active ? ' active' : ''}${counts && r.label && !n ? ' empty' : ''}`}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(r.label); }}>
                <span>{r.group === 'custom' ? <>Use “<b>{r.label}</b>”</> : r.label || allLabel}</span>
                {counts && r.label && <span className="small muted">{n || ''}</span>}
              </li>,
            ];
          })}
        </ul>
      )}
    </div>
  );
}
