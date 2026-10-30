// Opening and saving files: File System Access API where available, otherwise
// a hidden <input type=file> and downloads.
const PDF_TYPES = [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }];
const IMAGE_TYPES = [{ description: 'Bilder', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg'] } }];

export const hasFsAccess = typeof window.showOpenFilePicker === 'function';

/** Returns [{ file, handle }] (handle only with FS Access). */
export async function pickFiles({ kind = 'pdf', multiple = false } = {}) {
  if (hasFsAccess) {
    try {
      const handles = await window.showOpenFilePicker({ types: kind === 'pdf' ? PDF_TYPES : IMAGE_TYPES, multiple, excludeAcceptAllOption: false });
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
    } catch (e) {
      if (e.name === 'AbortError') return [];
      console.warn('File picker failed, falling back', e);
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'pdf' ? 'application/pdf,.pdf' : 'image/*';
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve([...input.files].map((file) => ({ file, handle: null })));
      input.remove();
    });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

/**
 * Save bytes. With a handle (and not saveAs) the file is overwritten in place.
 * Returns { handle, name } or null if the user cancelled.
 */
export async function saveBytes(bytes, { name, handle = null, saveAs = false, type = 'application/pdf', ext = '.pdf' } = {}) {
  if (hasFsAccess && window.showSaveFilePicker) {
    try {
      let h = handle;
      if (!h || saveAs) {
        h = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: ext.slice(1).toUpperCase(), accept: { [type]: [ext] } }],
        });
      }
      if ((await h.queryPermission?.({ mode: 'readwrite' })) === 'prompt') await h.requestPermission({ mode: 'readwrite' });
      const w = await h.createWritable();
      await w.write(bytes);
      await w.close();
      return { handle: h, name: h.name };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      console.warn('Save via File System Access failed, downloading instead', e);
    }
  }
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { handle: null, name };
}
