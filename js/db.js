// Minimal promise wrapper over IndexedDB (holds image blobs and folder handles).

let dbp;
function open() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('homepate', 1);
    r.onupgradeneeded = () => {
      for (const s of ['kv', 'liked', 'places']) r.result.createObjectStore(s);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}

export const get = (store, key) => tx(store, 'readonly', s => s.get(key));
export const set = (store, key, val) => tx(store, 'readwrite', s => s.put(val, key));
export const del = (store, key) => tx(store, 'readwrite', s => s.delete(key));
export const all = (store) => tx(store, 'readonly', s => s.getAll());
export const keys = (store) => tx(store, 'readonly', s => s.getAllKeys());
