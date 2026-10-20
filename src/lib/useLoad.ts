import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from './format';

// Results of the last load per call site + deps, so going back to a page shows it instantly
// (stale-while-revalidate) instead of a spinner. Cleared when the signed-in user changes.
const cache = new Map<string, unknown>();
export const clearLoadCache = () => cache.clear();

/**
 * Tiny async loader: runs `fn` on mount and when `deps` change; `reload()` re-runs it.
 * `loading` is only true while there is nothing to show yet; refreshes happen in the background.
 * Pass `{ cache: false }` for data that must never be shown stale (e.g. file bytes).
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], opts: { cache?: boolean } = {}) {
  const useCache = opts.cache !== false;
  const key = useCache ? fn.toString() + '|' + JSON.stringify(deps) : '';
  const cached = useCache && cache.has(key) ? (cache.get(key) as T) : null;
  const [data, setDataState] = useState<T | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cached === null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keyRef = useRef(key);
  keyRef.current = key;
  const seq = useRef(0);

  const run = useCallback(async () => {
    const n = ++seq.current;
    const k = keyRef.current;
    if (!(useCache && cache.has(k))) setLoading(true);
    try {
      const v = await fnRef.current();
      if (n !== seq.current) return; // a newer load (other deps) won
      if (useCache) cache.set(k, v);
      setDataState(v); setError(null);
    } catch (e) {
      if (n === seq.current) setError(errMsg(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [useCache]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // show what we already have for the new deps right away, then refresh
    if (useCache && cache.has(key)) { setDataState(cache.get(key) as T); setLoading(false); }
    run();
  }, deps);

  const setData = useCallback((v: T | null | ((prev: T | null) => T | null)) => {
    setDataState((prev) => {
      const next = typeof v === 'function' ? (v as (p: T | null) => T | null)(prev) : v;
      if (useCache && next !== null) cache.set(keyRef.current, next);
      return next;
    });
  }, [useCache]);

  return { data, error, loading, reload: run, setData };
}

/** Throws Supabase errors so useLoad can show them. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}
