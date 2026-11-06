// Songs live only on this device (IndexedDB), never on the server.
const DB = 'tuner-songs', STORE = 'songs';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}

export const listSongs = () => tx('readonly', (s) => s.getAll());
export const getSong = (id) => tx('readonly', (s) => s.get(id));
export const putSong = (rec) => tx('readwrite', (s) => s.put(rec));
export const deleteSong = (id) => tx('readwrite', (s) => s.delete(id));
