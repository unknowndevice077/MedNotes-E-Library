import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface Subject { id: number; name: string }

let cache: Subject[] | null = null;
const listeners = new Set<(s: Subject[]) => void>();

/** Re-read the admin's subject list (after adding, renaming or deleting one). */
export async function reloadSubjects() {
  const { data } = await supabase.from('subjects').select('id, name').order('name');
  cache = (data ?? []) as Subject[];
  for (const l of listeners) l(cache);
  return cache;
}

/** The subjects set up in Admin → Files → Subjects, shared by every picker on the page. */
export function useSubjects() {
  const [list, setList] = useState<Subject[]>(cache ?? []);
  useEffect(() => {
    listeners.add(setList);
    if (!cache) void reloadSubjects();
    return () => { listeners.delete(setList); };
  }, []);
  return list;
}
