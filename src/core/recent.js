// Recently used files. File System Access handles are kept in IndexedDB so a file can be
// reopened later (Chrome/Edge); browsers without handles get no recent list.
const DB_NAME = 'pdfwerk';
const STORE = 'recent';
const MAX = 20;

export const recentSupported = typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'indexedDB' in window;

let dbPromise = null;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tr = d.transaction(STORE, mode);
    const result = fn(tr.objectStore(STORE));
    tr.oncomplete = () => resolve(result?.result ?? result);
    tr.onerror = () => reject(tr.error);
  });
}

/** Entries { id, name, handle, time }, newest first. */
export async function listRecent() {
  if (!recentSupported) return [];
  try {
    const all = await tx('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.time - a.time);
  } catch {
    return [];
  }
}

export async function addRecent(name, handle) {
  if (!recentSupported || !handle) return;
  try {
    const all = await listRecent();
    const stale = [];
    for (const e of all) if (e.name === name && (await e.handle.isSameEntry(handle).catch(() => false))) stale.push(e.id);
    const keep = all.filter((e) => !stale.includes(e.id));
    const drop = [...stale, ...keep.slice(MAX - 1).map((e) => e.id)];
    await tx('readwrite', (s) => {
      for (const id of drop) s.delete(id);
      s.put({ id: crypto.randomUUID(), name, handle, time: Date.now() });
    });
  } catch (e) {
    console.warn('Recent list not updated', e);
  }
}

export async function removeRecent(id) {
  if (!recentSupported) return;
  await tx('readwrite', (s) => s.delete(id)).catch(() => {});
}

/** Ask for permission again (needs a user gesture) and return the File, or null. */
export async function openRecent(entry) {
  const handle = entry.handle;
  let perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
  if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' }).catch(() => 'denied');
  if (perm !== 'granted') return null;
  return handle.getFile();
}
