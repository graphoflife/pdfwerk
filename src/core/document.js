// The editable document: base PDF bytes (without editable annotations), the pdf.js proxy
// used for rendering, our annotation model per page, metadata, outline and undo history.
import { PDFDocument, PDFName, PDFHexString, PDFString, PDFNumber, PDFNull } from 'pdf-lib';
import { loadPdfjs } from './pdfjs.js';
import { extractAnnotations } from './pdf-read.js';
import { AnnotationWriter } from './pdf-write.js';
import { cloneAnnotation, newId, translateAnnotation } from './model.js';
import { fitFreeText } from './appearance.js';
import * as ops from './page-ops.js';

const HISTORY_LIMIT = 80;
let docCounter = 0;

export class PdfDoc extends EventTarget {
  constructor() {
    super();
    this.id = `doc${++docCounter}`;
    this.name = 'Dokument.pdf';
    this.fileHandle = null;
    this.baseBytes = null;
    this.pdf = null;
    this.pages = [];
    this.annots = [];
    this.images = new Map();
    this.meta = {};
    this.outline = [];
    this.outlineDirty = false;
    this.readOnly = false;
    this.modified = false;
    this.undoStack = [];
    this.redoStack = [];
    this.password = null;
    this.busy = false;
  }

  static async open(bytes, { name, handle, askPassword } = {}) {
    const doc = new PdfDoc();
    doc.name = name || doc.name;
    doc.fileHandle = handle || null;
    await doc.#init(bytes, askPassword);
    return doc;
  }

  static async blank(size = ops.PAGE_SIZES.A4, name = 'Neu.pdf') {
    const lib = await PDFDocument.create();
    lib.addPage(size);
    return PdfDoc.open(await lib.save(), { name });
  }

  async #init(bytes, askPassword) {
    let lib = null;
    try {
      lib = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    } catch (e) {
      console.warn('pdf-lib could not parse the file, opening read-only', e);
    }
    if (!lib || lib.isEncrypted) {
      // Encrypted or unparsable: view (and fill forms) through pdf.js only.
      this.readOnly = true;
      this.baseBytes = bytes;
      const { pdf, password } = await loadPdfjs(bytes, { askPassword });
      this.password = password;
      await this.#adoptPdfjs(pdf);
      this.annots = this.pages.map(() => []);
      await this.#loadOutline();
      await this.#loadMetaFromPdfjs();
      return;
    }
    this.annots = await extractAnnotations(lib, this.images);
    this.meta = {
      title: lib.getTitle() || '', author: lib.getAuthor() || '', subject: lib.getSubject() || '',
      keywords: lib.getKeywords() || '', creator: lib.getCreator() || '', producer: lib.getProducer() || '',
    };
    this.baseBytes = await lib.save({ addDefaultPage: false, objectsPerTick: Infinity });
    await this.#reloadPdfjs();
    await this.#loadOutline();
  }

  async #loadMetaFromPdfjs() {
    try {
      const { info } = await this.pdf.getMetadata();
      this.meta = { title: info?.Title || '', author: info?.Author || '', subject: info?.Subject || '', keywords: info?.Keywords || '', creator: info?.Creator || '', producer: info?.Producer || '' };
    } catch {
      this.meta = {};
    }
  }

  async #reloadPdfjs() {
    const { pdf } = await loadPdfjs(this.baseBytes, { password: this.password });
    await this.#adoptPdfjs(pdf);
  }

  async #adoptPdfjs(pdf) {
    const old = this.pdf;
    this.pdf = pdf;
    pdf.annotationStorage.onSetModified = () => this.setModified(true);
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      pages.push({ view: p.view, rotate: p.rotate, userUnit: p.userUnit || 1, proxy: p });
    }
    this.pages = pages;
    this.fieldObjects = null;
    if (old) old.destroy();
  }

  get numPages() {
    return this.pages.length;
  }

  setModified(v) {
    if (this.modified === v) return;
    this.modified = v;
    this.emit('modified');
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // ---------------------------------------------------------------- outline
  async #loadOutline() {
    if (this.outlineDirty) return;
    try {
      const items = await this.pdf.getOutline();
      this.outline = items ? await this.#convertOutline(items) : [];
    } catch (e) {
      console.warn('Outline unreadable', e);
      this.outline = [];
    }
  }

  async #convertOutline(items) {
    const out = [];
    for (const it of items) {
      let pageIndex = null, top = null;
      try {
        let dest = it.dest;
        if (typeof dest === 'string') dest = await this.pdf.getDestination(dest);
        if (Array.isArray(dest)) {
          const ref = dest[0];
          pageIndex = typeof ref === 'object' && ref ? await this.pdf.getPageIndex(ref) : Number.isInteger(ref) ? ref : null;
          if (dest[1]?.name === 'XYZ' && typeof dest[3] === 'number') top = dest[3];
          else if (dest[1]?.name === 'FitH' || dest[1]?.name === 'FitBH') top = typeof dest[2] === 'number' ? dest[2] : null;
        }
      } catch { /* unresolvable destination */ }
      out.push({
        id: newId(), title: it.title || '', pageIndex, top, url: it.url || null,
        bold: !!it.bold, italic: !!it.italic, open: (it.count || 0) > 0,
        children: it.items?.length ? await this.#convertOutline(it.items) : [],
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- history
  #snapshot() {
    return {
      base: this.baseBytes,
      annots: structuredClone(this.annots),
      meta: { ...this.meta },
      outline: structuredClone(this.outline),
      outlineDirty: this.outlineDirty,
    };
  }

  checkpoint(label = '') {
    this.undoStack.push({ label, state: this.#snapshot() });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.setModified(true);
    this.emit('history');
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  async undo() {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push({ label: entry.label, state: this.#snapshot() });
    await this.#restore(entry.state);
  }

  async redo() {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push({ label: entry.label, state: this.#snapshot() });
    await this.#restore(entry.state);
  }

  async #restore(state) {
    const structural = state.base !== this.baseBytes;
    this.annots = structuredClone(state.annots);
    this.meta = { ...state.meta };
    this.outline = structuredClone(state.outline);
    this.outlineDirty = state.outlineDirty;
    if (structural) {
      this.baseBytes = state.base;
      await this.#reloadPdfjs();
      this.emit('structure');
    } else {
      this.emit('annotations', { pages: null });
    }
    this.emit('outline');
    this.setModified(true);
    this.emit('history');
  }

  // ---------------------------------------------------------------- annotations
  find(id) {
    for (let p = 0; p < this.annots.length; p++) {
      const i = this.annots[p].findIndex((a) => a.id === id);
      if (i >= 0) return { a: this.annots[p][i], page: p, index: i };
    }
    return null;
  }

  #touch(a) {
    a.modified = new Date().toISOString();
    a.dirty = true;
  }

  #changed(pages) {
    this.emit('annotations', { pages: pages ? [...new Set(pages)] : null });
  }

  add(page, list, { history = true, label = 'Anmerkung hinzufügen' } = {}) {
    if (history) this.checkpoint(label);
    for (const a of list) {
      this.#touch(a);
      this.annots[page].push(a);
    }
    this.#changed([page]);
  }

  /** Replace annotations by id with new versions (same page). */
  replace(list, { history = true, label = 'Anmerkung ändern' } = {}) {
    if (history) this.checkpoint(label);
    const pages = [];
    for (const n of list) {
      const f = this.find(n.id);
      if (!f) continue;
      const a = cloneAnnotation(n);
      if (a.type === 'freetext') a.rect = fitFreeText(a);
      this.#touch(a);
      this.annots[f.page][f.index] = a;
      pages.push(f.page);
    }
    this.#changed(pages);
  }

  /** Apply a patch object (or function) to each annotation in ids. */
  update(ids, patch, opts = {}) {
    const list = [];
    for (const id of ids) {
      const f = this.find(id);
      if (!f || f.a.locked && !('locked' in (typeof patch === 'object' ? patch : {}))) continue;
      const n = cloneAnnotation(f.a);
      if (typeof patch === 'function') patch(n);
      else Object.assign(n, structuredClone(patch));
      list.push(n);
    }
    if (list.length) this.replace(list, opts);
  }

  remove(ids, { history = true, label = 'Anmerkung löschen' } = {}) {
    const set = new Set(ids);
    if (!set.size) return;
    if (history) this.checkpoint(label);
    const pages = [];
    this.annots.forEach((list, p) => {
      const n = list.filter((a) => !set.has(a.id));
      if (n.length !== list.length) {
        this.annots[p] = n;
        pages.push(p);
      }
    });
    this.#changed(pages);
  }

  /** Undo an add that turned out to be empty (e.g. a text box left blank). */
  cancelAdd(id) {
    const f = this.find(id);
    if (!f) return;
    this.annots[f.page].splice(f.index, 1);
    const last = this.undoStack[this.undoStack.length - 1];
    if (last && !last.state.annots[f.page]?.some((a) => a.id === id)) this.undoStack.pop();
    this.emit('history');
    this.#changed([f.page]);
  }

  translate(ids, dx, dy, opts = {}) {
    const list = ids.map((id) => this.find(id)).filter((f) => f && !f.a.locked).map((f) => translateAnnotation(f.a, dx, dy));
    if (list.length) this.replace(list, { label: 'Verschieben', ...opts });
  }

  zOrder(ids, where) {
    const set = new Set(ids);
    this.checkpoint('Reihenfolge');
    const pages = [];
    this.annots.forEach((list, p) => {
      const sel = list.filter((a) => set.has(a.id));
      if (!sel.length) return;
      const rest = list.filter((a) => !set.has(a.id));
      if (where === 'front') this.annots[p] = [...rest, ...sel];
      else if (where === 'back') this.annots[p] = [...sel, ...rest];
      else {
        const arr = [...list];
        const step = where === 'forward' ? 1 : -1;
        const idxs = arr.map((a, i) => (set.has(a.id) ? i : -1)).filter((i) => i >= 0);
        if (step > 0) idxs.reverse();
        for (const i of idxs) {
          const j = i + step;
          if (j < 0 || j >= arr.length || set.has(arr[j].id)) continue;
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        this.annots[p] = arr;
      }
      sel.forEach((a) => this.#touch(a));
      pages.push(p);
    });
    this.#changed(pages);
  }

  addImage(img) {
    const id = `img${newId()}`;
    this.images.set(id, img);
    return id;
  }

  // ---------------------------------------------------------------- metadata / outline
  setMeta(meta) {
    this.checkpoint('Dokumenteigenschaften');
    this.meta = { ...this.meta, ...meta };
    this.emit('meta');
  }

  setOutline(outline, label = 'Lesezeichen') {
    this.checkpoint(label);
    this.outline = outline;
    this.outlineDirty = true;
    this.emit('outline');
  }

  // ---------------------------------------------------------------- forms
  get formsModified() {
    return (this.pdf?.annotationStorage?.size || 0) > 0;
  }

  /** Discard unsaved form input by reloading the document from its bytes. */
  async resetForms() {
    await this.#reloadPdfjs();
    this.emit('structure');
  }

  async #commitForms() {
    if (!this.formsModified || this.readOnly) return;
    try {
      this.baseBytes = await this.pdf.saveDocument();
    } catch (e) {
      console.warn('Form values could not be saved', e);
    }
  }

  // ---------------------------------------------------------------- structural changes
  /**
   * Run a structural operation. fn(lib) must return `order` (see page-ops.js).
   */
  async structural(label, fn) {
    if (this.readOnly) throw new Error('readonly');
    this.busy = true;
    try {
      await this.#commitForms();
      const before = this.#snapshot();
      const lib = await PDFDocument.load(this.baseBytes, { ignoreEncryption: true, updateMetadata: false });
      const order = await fn(lib);
      this.undoStack.push({ label, state: before });
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
      this.redoStack = [];
      if (order) {
        const oldAnnots = this.annots;
        const used = new Set();
        this.annots = order.map((o) => {
          if (typeof o === 'number') {
            if (used.has(o)) return oldAnnots[o].map((a) => ({ ...cloneAnnotation(a), id: newId(), dirty: true, orig: undefined }));
            used.add(o);
            return oldAnnots[o] || [];
          }
          return o.annots || [];
        });
        if (this.outlineDirty) this.#remapOutline(order);
      }
      this.baseBytes = await lib.save({ addDefaultPage: false, objectsPerTick: Infinity });
      await this.#reloadPdfjs();
      if (!this.outlineDirty) await this.#loadOutline();
      this.setModified(true);
      this.emit('structure');
      this.emit('outline');
      this.emit('history');
    } finally {
      this.busy = false;
    }
  }

  #remapOutline(order) {
    const map = new Map();
    order.forEach((o, i) => { if (typeof o === 'number' && !map.has(o)) map.set(o, i); });
    const walk = (items) => items.forEach((it) => {
      if (it.pageIndex != null) it.pageIndex = map.has(it.pageIndex) ? map.get(it.pageIndex) : null;
      walk(it.children);
    });
    walk(this.outline);
  }

  rotatePages(indices, delta) {
    return this.structural('Seiten drehen', (lib) => ops.rotatePages(lib, indices, delta));
  }

  deletePages(indices) {
    return this.structural('Seiten löschen', (lib) => ops.deletePages(lib, indices));
  }

  movePages(indices, target) {
    return this.structural('Seiten verschieben', (lib) => ops.movePages(lib, indices, target));
  }

  reversePages(indices) {
    return this.structural('Seiten umkehren', (lib) => ops.reversePages(lib, indices));
  }

  insertBlankPages(at, count, size) {
    return this.structural('Leere Seite einfügen', (lib) => ops.insertBlankPages(lib, at, count, size));
  }

  duplicatePages(indices) {
    return this.structural('Seiten duplizieren', (lib) => ops.duplicatePages(lib, indices, (i) => this.annots[i].map((a) => ({ ...cloneAnnotation(a), id: newId(), dirty: true, orig: undefined }))));
  }

  cropPages(indices, margins) {
    return this.structural('Seiten zuschneiden', (lib) => ops.cropPages(lib, indices, margins));
  }

  addWatermark(indices, opts) {
    return this.structural('Wasserzeichen', (lib) => ops.addWatermark(lib, indices, opts));
  }

  addHeaderFooter(indices, opts) {
    return this.structural('Kopf-/Fußzeile', (lib) => ops.addHeaderFooter(lib, indices, opts));
  }

  async insertPdf(bytes, at, srcIndices = null) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (src.isEncrypted) throw new Error('encrypted');
    const annots = await extractAnnotations(src, this.images, { keepRefs: false });
    const idx = srcIndices || src.getPageIndices();
    return this.structural('Seiten einfügen', (lib) => ops.insertPdfPages(lib, src, idx, at, annots));
  }

  /** Apply all redaction marks: rasterise affected pages with black boxes. */
  async applyRedactions({ dpi = 200 } = {}) {
    const rectsByPage = new Map();
    this.annots.forEach((list, p) => {
      const rects = list.filter((a) => a.type === 'redact').map((a) => a.rect);
      if (rects.length) rectsByPage.set(p, rects);
    });
    if (!rectsByPage.size) return 0;
    this.outlineDirty = true; // page objects are replaced, so rewrite bookmarks on save
    const pdf = this.pdf;
    await this.structural('Schwärzungen anwenden', async (lib) => {
      const order = await ops.rasterizeRedactions(lib, pdf, rectsByPage, { dpi });
      for (const [p, rects] of rectsByPage) {
        const inside = (a) => {
          const b = a.rect || null;
          return b && rects.some((r) => b[0] >= r[0] - 1 && b[1] >= r[1] - 1 && b[2] <= r[2] + 1 && b[3] <= r[3] + 1);
        };
        this.annots[p] = this.annots[p].filter((a) => a.type !== 'redact' && !inside(a));
        this.annots[p].forEach((a) => { a.dirty = true; delete a.orig; });
      }
      return order;
    });
    return rectsByPage.size;
  }

  // ---------------------------------------------------------------- output
  /** Produce the final PDF bytes. */
  async save({ flatten = false, flattenForms = false } = {}) {
    if (this.readOnly) {
      return this.formsModified ? this.pdf.saveDocument() : this.baseBytes;
    }
    let bytes = this.baseBytes;
    if (this.formsModified) {
      try { bytes = await this.pdf.saveDocument(); } catch (e) { console.warn(e); }
    }
    const lib = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const writer = new AnnotationWriter(lib, this.images);
    for (let i = 0; i < lib.getPageCount(); i++) {
      await writer.writePage(i, this.annots[i] || [], { flatten });
    }
    if (flattenForms) {
      try { lib.getForm().flatten(); } catch (e) { console.warn('Form flatten failed', e); }
    }
    const m = this.meta;
    lib.setTitle(m.title || '', { showInWindowTitleBar: !!m.title });
    lib.setAuthor(m.author || '');
    lib.setSubject(m.subject || '');
    lib.setKeywords((m.keywords || '').split(/[,;]\s*/).filter(Boolean));
    if (m.creator) lib.setCreator(m.creator);
    lib.setProducer('PDFwerk (pdf-lib)');
    lib.setModificationDate(new Date());
    if (this.outlineDirty) writeOutline(lib, this.outline);
    return lib.save({ addDefaultPage: false, objectsPerTick: Infinity });
  }

  async extract(indices) {
    const full = await PDFDocument.load(await this.save(), { updateMetadata: false });
    const out = await PDFDocument.create();
    const pages = await out.copyPages(full, indices);
    pages.forEach((p) => out.addPage(p));
    return out.save();
  }

  /** All annotation text for search/comments panel. */
  allAnnotations() {
    const out = [];
    this.annots.forEach((list, page) => list.forEach((a) => out.push({ a, page })));
    return out;
  }

  destroy() {
    this.pdf?.destroy();
    this.pdf = null;
  }
}

/** Rebuild the /Outlines tree from our bookmark model. */
function writeOutline(lib, items) {
  const ctx = lib.context;
  const pageRefs = lib.getPages().map((p) => p.ref);
  if (!items.length) {
    lib.catalog.delete(PDFName.of('Outlines'));
    return;
  }
  const rootRef = ctx.nextRef();
  const build = (list, parentRef) => {
    const refs = list.map(() => ctx.nextRef());
    let total = 0;
    list.forEach((it, i) => {
      const dict = ctx.obj({});
      dict.set(PDFName.of('Title'), PDFHexString.fromText(it.title || ''));
      dict.set(PDFName.of('Parent'), parentRef);
      if (i > 0) dict.set(PDFName.of('Prev'), refs[i - 1]);
      if (i < list.length - 1) dict.set(PDFName.of('Next'), refs[i + 1]);
      if (it.url) {
        dict.set(PDFName.of('A'), ctx.obj({ S: 'URI', URI: PDFString.of(it.url) }));
      } else if (it.pageIndex != null && pageRefs[it.pageIndex]) {
        const top = it.top != null ? PDFNumber.of(it.top) : PDFNull;
        dict.set(PDFName.of('Dest'), ctx.obj([pageRefs[it.pageIndex], PDFName.of('XYZ'), PDFNull, top, PDFNull]));
      }
      const flags = (it.italic ? 1 : 0) | (it.bold ? 2 : 0);
      if (flags) dict.set(PDFName.of('F'), PDFNumber.of(flags));
      let count = 0;
      if (it.children?.length) {
        const sub = build(it.children, refs[i]);
        dict.set(PDFName.of('First'), sub.first);
        dict.set(PDFName.of('Last'), sub.last);
        count = sub.count;
        dict.set(PDFName.of('Count'), PDFNumber.of(it.open ? count : -count));
      }
      ctx.assign(refs[i], dict);
      total += 1 + (it.open ? count : 0);
    });
    return { first: refs[0], last: refs[refs.length - 1], count: total };
  };
  const top = build(items, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: top.first, Last: top.last, Count: top.count }));
  lib.catalog.set(PDFName.of('Outlines'), rootRef);
}

