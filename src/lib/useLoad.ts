import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from './format';

/** Tiny async loader: runs `fn` on mount and when `deps` change; `reload()` re-runs it. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const run = useCallback(async () => {
    setLoading(true);
    try { setData(await fnRef.current()); setError(null); }
    catch (e) { setError(errMsg(e)); }
    finally { setLoading(false); }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, deps);
  return { data, error, loading, reload: run, setData };
}

/** Throws Supabase errors so useLoad can show them. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
