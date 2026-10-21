// Unsaved form drafts kept in the browser's IndexedDB, so a refresh doesn't lose them.
// IndexedDB can hold File objects (a chosen video or PDF included), which localStorage can't.

const DB = 'mn-drafts', STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch { return undefined; } // private mode or storage full: drafts just aren't kept
}

export const getDraft = <T>(key: string) => run<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
export const saveDraft = (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key));
export const dropDraft = (key: string) => run('readwrite', (s) => s.delete(key));
