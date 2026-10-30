// Left sidebar: page thumbnails (organise pages), bookmarks and the comments list.
import { h, iconButton, showMenu, promptDialog, confirmDialog, toast, withBusy } from './dom.js';
import { icon } from './icons.js';
import { t, fmtDate } from '../i18n.js';
import { annotationsSvg } from '../viewer/svg.js';
import { TYPES } from '../core/model.js';
import { buildAppearance } from '../core/appearance.js';
import { newId } from '../core/model.js';

const PANELS = [
  { id: 'thumbs', label: 'Seitenminiaturen', icon: 'LayoutGrid' },
  { id: 'bookmarks', label: 'Lesezeichen', icon: 'Bookmark' },
  { id: 'comments', label: 'Kommentare', icon: 'MessagesSquare' },
];

export class LeftSidebar {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    this.isOpen = app.prefs.get('leftOpen', true);
    this.panel = app.prefs.get('leftPanel', 'thumbs');
    this.strip = h('div', { class: 'side-strip', role: 'tablist' });
    this.content = h('div', { class: 'side-content' });
    this.resizer = h('div', { class: 'side-resizer', title: t('Breite ändern') });
    host.append(this.strip, this.content, this.resizer);
    host.style.setProperty('--side-w', `${app.prefs.get('leftWidth', 230)}px`);
    this.thumbs = new ThumbsPanel(app);
    this.bookmarks = new BookmarksPanel(app);
    this.comments = new CommentsPanel(app);
    this.panels = { thumbs: this.thumbs, bookmarks: this.bookmarks, comments: this.comments };
    this.#initResize();
    this.render();
  }

  #initResize() {
    let start = null;
    this.resizer.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, w: this.content.getBoundingClientRect().width };
      this.resizer.setPointerCapture(e.pointerId);
    });
    this.resizer.addEventListener('pointermove', (e) => {
      if (!start) return;
      const w = Math.max(150, Math.min(520, start.w + e.clientX - start.x));
      this.host.style.setProperty('--side-w', `${w}px`);
    });
    this.resizer.addEventListener('pointerup', () => {
      if (!start) return;
      start = null;
      this.app.prefs.set('leftWidth', Math.round(this.content.getBoundingClientRect().width));
      this.thumbs.relayout();
    });
  }

  render() {
    this.strip.replaceChildren(...PANELS.map((p) => h('button', {
      class: `strip-btn ${this.isOpen && this.panel === p.id ? 'active' : ''}`, type: 'button', title: t(p.label), role: 'tab',
      onclick: () => (this.isOpen && this.panel === p.id ? this.toggle() : this.show(p.id, true)),
    }, icon(p.icon, 20))));
    this.host.classList.toggle('closed', !this.isOpen);
    const p = this.panels[this.panel];
    this.content.replaceChildren(p.el);
    if (this.isOpen) p.activate();
  }

  show(id, open = false) {
    this.panel = id;
    if (open) this.isOpen = true;
    this.app.prefs.set('leftPanel', id);
    this.app.prefs.set('leftOpen', this.isOpen);
    this.render();
    this.app.refreshUI();
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.app.prefs.set('leftOpen', this.isOpen);
    this.render();
    this.app.refreshUI();
  }

  /** Called when the active document changes. */
  setDoc() {
    for (const p of Object.values(this.panels)) p.setDoc(this.app.doc, this.app.view);
    if (this.isOpen) this.panels[this.panel].activate();
  }
}

// ======================================================================= thumbnails
class ThumbsPanel {
  constructor(app) {
    this.app = app;
    this.selected = new Set();
    this.anchor = null;
    this.size = app.prefs.get('thumbSize', 130);
    this.list = h('div', { class: 'thumbs', tabIndex: 0 });
    const zoomOut = iconButton('ZoomOut', t('Kleinere Miniaturen'), () => this.setSize(this.size - 30), { size: 16 });
    const zoomIn = iconButton('ZoomIn', t('Größere Miniaturen'), () => this.setSize(this.size + 30), { size: 16 });
    const menu = iconButton('Ellipsis', t('Seitenoptionen'), (e) => this.#menu(e.currentTarget), { size: 16 });
    this.el = h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('span', { class: 'panel-title', text: t('Seiten') }), zoomOut, zoomIn, menu),
      this.list);
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.#renderThumb(+e.target.dataset.index);
    }, { root: this.list, rootMargin: '200px' });
    this.list.addEventListener('keydown', (e) => this.#onKey(e));
    this.list.addEventListener('dragover', (e) => this.#onDragOver(e));
    this.list.addEventListener('dragleave', () => this.#clearDrop());
    this.list.addEventListener('drop', (e) => this.#onDrop(e));
    this.list.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.thumb');
      e.preventDefault();
      if (item && !this.selected.has(+item.dataset.index)) this.#select(+item.dataset.index, {});
      this.#menu(null, e.clientX, e.clientY);
    });
  }

  setSize(s) {
    this.size = Math.max(70, Math.min(320, s));
    this.app.prefs.set('thumbSize', this.size);
    this.rebuild();
  }

  setDoc(doc, view) {
    if (this.doc === doc) return;
    this.doc?.removeEventListener('structure', this.onStructure);
    this.doc?.removeEventListener('annotations', this.onAnnots);
    this.view?.removeEventListener('page', this.onPage);
    this.doc = doc;
    this.view = view;
    this.selected.clear();
    this.onStructure = () => { this.selected = new Set([...this.selected].filter((i) => i < doc.numPages)); this.rebuild(); };
    this.onAnnots = (e) => {
      clearTimeout(this.annTimer);
      this.annTimer = setTimeout(() => (e.detail.pages || [...Array(doc.numPages).keys()]).forEach((i) => this.#overlay(i)), 400);
    };
    this.onPage = () => this.#markCurrent();
    doc?.addEventListener('structure', this.onStructure);
    doc?.addEventListener('annotations', this.onAnnots);
    view?.addEventListener('page', this.onPage);
    this.rebuild();
  }

  activate() {
    if (this.dirty) this.rebuild();
    this.#markCurrent();
  }

  relayout() {
    this.rebuild();
  }

  rebuild() {
    this.observer.disconnect();
    this.items = [];
    if (!this.doc) { this.list.replaceChildren(h('div', { class: 'empty', text: t('Kein Dokument geöffnet') })); return; }
    if (!this.el.isConnected) { this.dirty = true; return; }
    this.dirty = false;
    const doc = this.doc;
    this.items = doc.pages.map((p, i) => {
      const [x1, y1, x2, y2] = p.view;
      let w = x2 - x1, hgt = y2 - y1;
      const rot = (p.rotate + (this.view?.rotation || 0)) % 180;
      if (rot) [w, hgt] = [hgt, w];
      const scale = this.size / Math.max(w, hgt);
      const box = h('div', { class: 'thumb-box', style: { width: `${Math.round(w * scale)}px`, height: `${Math.round(hgt * scale)}px` } });
      const item = h('div', {
        class: 'thumb', draggable: true, dataset: { index: i }, title: t('Seite {n}', { n: i + 1 }),
        onclick: (e) => this.#select(i, e),
        ondragstart: (e) => this.#onDragStart(e, i),
        ondragend: () => this.#clearDrop(),
      }, box, h('div', { class: 'thumb-label', text: String(i + 1) }));
      item.classList.toggle('selected', this.selected.has(i));
      this.observer.observe(item);
      return { item, box, scale, rendered: false };
    });
    this.list.replaceChildren(...this.items.map((x) => x.item));
    this.#markCurrent();
  }

  async #renderThumb(i) {
    const it = this.items?.[i];
    if (!it || it.rendered || !this.doc) return;
    it.rendered = true;
    const doc = this.doc;
    const proxy = doc.pages[i].proxy;
    const rotation = (doc.pages[i].rotate + (this.view?.rotation || 0)) % 360;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const viewport = proxy.getViewport({ scale: it.scale * dpr, rotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    try {
      await proxy.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, annotationMode: 2, annotationStorage: doc.pdf.annotationStorage }).promise;
    } catch {
      it.rendered = false;
      return;
    }
    if (this.doc !== doc || this.items[i] !== it) return;
    it.box.replaceChildren(canvas);
    it.viewport = proxy.getViewport({ scale: it.scale, rotation });
    this.#overlay(i);
  }

  #overlay(i) {
    const it = this.items?.[i];
    if (!it?.viewport) return;
    it.box.querySelector('.annot-svg')?.remove();
    const list = this.doc.annots[i];
    if (list?.length) it.box.append(annotationsSvg(list, this.doc.images, it.viewport));
  }

  #markCurrent() {
    const cur = this.view?.current ?? -1;
    this.items?.forEach((x, i) => x.item.classList.toggle('current', i === cur));
    const el = this.items?.[cur]?.item;
    if (el && this.el.isConnected) {
      const r = el.getBoundingClientRect(), lr = this.list.getBoundingClientRect();
      if (r.top < lr.top || r.bottom > lr.bottom) el.scrollIntoView({ block: 'nearest' });
    }
  }

  #select(i, e) {
    if (e.shiftKey && this.anchor != null) {
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      if (!e.ctrlKey && !e.metaKey) this.selected.clear();
      for (let k = a; k <= b; k++) this.selected.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      if (this.selected.has(i)) this.selected.delete(i); else this.selected.add(i);
      this.anchor = i;
    } else {
      this.selected = new Set([i]);
      this.anchor = i;
      this.view?.goToPage(i);
    }
    this.items.forEach((x, k) => x.item.classList.toggle('selected', this.selected.has(k)));
    this.list.focus({ preventScroll: true });
    this.app.refreshUI();
  }

  get selection() {
    return [...this.selected].filter((i) => i < (this.doc?.numPages || 0)).sort((a, b) => a - b);
  }

  #onKey(e) {
    if (!this.doc) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected.size) {
      e.preventDefault();
      e.stopPropagation();
      this.app.dialogs.deletePages(this.selection);
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      this.selected = new Set(this.doc.pages.map((_, i) => i));
      this.items.forEach((x) => x.item.classList.add('selected'));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const cur = Math.max(0, Math.min(this.doc.numPages - 1, (this.anchor ?? this.view.current) + d));
      this.#select(cur, { shiftKey: e.shiftKey, ctrlKey: false });
      this.items[cur]?.item.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---- drag & drop (reorder, or drop PDF files to insert)
  #onDragStart(e, i) {
    if (!this.selected.has(i)) this.#select(i, {});
    this.dragging = this.selection;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/x-pdfwerk-pages', JSON.stringify(this.dragging));
  }

  #dropIndex(e) {
    const item = e.target.closest('.thumb');
    if (!item) return this.doc.numPages;
    const r = item.getBoundingClientRect();
    const i = +item.dataset.index;
    const before = this.list.clientWidth > r.width * 1.9 ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
    return before ? i : i + 1;
  }

  #onDragOver(e) {
    if (!this.doc || this.doc.readOnly) return;
    const files = e.dataTransfer.types.includes('Files');
    if (!this.dragging && !files) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = files ? 'copy' : 'move';
    const idx = this.#dropIndex(e);
    this.#clearDrop();
    const target = this.items[idx]?.item || this.items[idx - 1]?.item;
    target?.classList.add(this.items[idx] ? 'drop-before' : 'drop-after');
  }

  #clearDrop() {
    this.list.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  }

  async #onDrop(e) {
    if (!this.doc || this.doc.readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    this.#clearDrop();
    const idx = this.#dropIndex(e);
    if (this.dragging) {
      const pages = this.dragging;
      this.dragging = null;
      if (pages.length === 1 && (idx === pages[0] || idx === pages[0] + 1)) return;
      await withBusy(t('Seiten verschieben'), () => this.doc.movePages(pages, idx));
      const start = idx - pages.filter((p) => p < idx).length;
      this.selected = new Set(pages.map((_, k) => start + k));
      this.rebuild();
      return;
    }
    const pdfs = [...e.dataTransfer.files].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    let at = idx;
    for (const f of pdfs) {
      const before = this.doc.numPages;
      await withBusy(t('Seiten einfügen'), async () => this.doc.insertPdf(new Uint8Array(await f.arrayBuffer()), at));
      at += this.doc.numPages - before;
    }
    if (pdfs.length) toast(t('Seiten eingefügt.'), { type: 'success' });
  }

  #menu(anchor, x = 0, y = 0) {
    const app = this.app;
    const c = app.commands;
    const item = (id) => ({ label: t(c.get(id).label), icon: c.get(id).icon, shortcut: c.shortcut(id), disabled: !c.enabled(id), run: () => c.run(id) });
    const n = this.selection.length;
    const items = [
      { label: n > 1 ? t('{n} Seiten ausgewählt', { n }) : t('Seite {n}', { n: (this.selection[0] ?? app.view?.current ?? 0) + 1 }), disabled: true },
      '-',
      item('rotatePagesCcw'), item('rotatePagesCw'), '-',
      item('insertBlank'), item('insertFile'), item('duplicatePages'), '-',
      item('extractPages'), item('movePages'), item('cropPages'), '-',
      { ...item('deletePages'), run: () => app.dialogs.deletePages(this.selection.length ? this.selection : undefined) },
    ];
    showMenu(items, x, y, { anchor });
  }
}

// ======================================================================= bookmarks
class BookmarksPanel {
  constructor(app) {
    this.app = app;
    this.tree = h('div', { class: 'bm-tree', role: 'tree' });
    this.selectedId = null;
    this.el = h('div', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('span', { class: 'panel-title', text: t('Lesezeichen') }),
        iconButton('BookmarkPlus', t('Lesezeichen für aktuelle Seite hinzufügen'), () => this.addForCurrent(), { size: 16 }),
        iconButton('Pencil', t('Umbenennen'), () => this.rename(this.selectedId), { size: 16 }),
        iconButton('Trash2', t('Löschen'), () => this.remove(this.selectedId), { size: 16 })),
      this.tree);
  }

  setDoc(doc) {
    this.doc?.removeEventListener('outline', this.onOutline);
    this.doc = doc;
    this.onOutline = () => this.render();
    doc?.addEventListener('outline', this.onOutline);
    this.render();
  }

  activate() {
    this.render();
  }

  render() {
    if (!this.doc) { this.tree.replaceChildren(h('div', { class: 'empty', text: t('Kein Dokument geöffnet') })); return; }
    if (!this.doc.outline.length) {
      this.tree.replaceChildren(h('div', { class: 'empty', text: t('Keine Lesezeichen. Mit Strg+Shift+B ein Lesezeichen für die aktuelle Seite anlegen.') }));
      return;
    }
    const build = (items, depth) => items.map((it) => {
      const hasKids = it.children?.length;
      const twisty = h('button', {
        class: `bm-twisty ${hasKids ? '' : 'leaf'}`, type: 'button', tabIndex: -1,
        onclick: (e) => { e.stopPropagation(); it.open = !it.open; this.render(); },
      }, hasKids ? icon(it.open ? 'ChevronDown' : 'ChevronRight', 14) : null);
      const row = h('div', {
        class: `bm-row ${this.selectedId === it.id ? 'selected' : ''}`, role: 'treeitem', tabIndex: 0, style: { paddingLeft: `${4 + depth * 14}px` },
        title: it.url || (it.pageIndex != null ? t('Seite {n}', { n: it.pageIndex + 1 }) : ''),
        onclick: () => this.#go(it),
        ondblclick: () => this.rename(it.id),
        oncontextmenu: (e) => { e.preventDefault(); this.selectedId = it.id; this.render(); this.#menu(it, e.clientX, e.clientY); },
        onkeydown: (e) => {
          if (e.key === 'Enter') this.#go(it);
          if (e.key === 'F2') this.rename(it.id);
          if (e.key === 'Delete') this.remove(it.id);
        },
      }, twisty, h('span', { class: 'bm-title', text: it.title, style: { fontWeight: it.bold ? '600' : null, fontStyle: it.italic ? 'italic' : null } }));
      return h('div', {}, row, hasKids && it.open ? h('div', { role: 'group' }, ...build(it.children, depth + 1)) : null);
    });
    this.tree.replaceChildren(...build(this.doc.outline, 0));
  }

  #go(it) {
    this.selectedId = it.id;
    this.render();
    if (it.url) window.open(it.url, '_blank', 'noopener');
    else if (it.pageIndex != null) this.app.view?.goToPage(it.pageIndex, { top: it.top });
  }

  #find(id, items = this.doc.outline, parent = null) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) return { item: items[i], list: items, index: i, parent };
      const r = this.#find(id, items[i].children, items[i]);
      if (r) return r;
    }
    return null;
  }

  async addForCurrent(asChildOf = null) {
    const app = this.app;
    if (!this.doc || this.doc.readOnly) return;
    const view = app.view;
    const pv = view.pageViews[view.current];
    const rect = view.el.getBoundingClientRect();
    const local = pv.clientToLocal(rect.left + 10, Math.max(rect.top + 4, pv.el.getBoundingClientRect().top));
    const top = Math.round(pv.toPdf(...local)[1]);
    const sel = window.getSelection()?.toString().trim().slice(0, 80);
    const title = await promptDialog(t('Titel des Lesezeichens'), sel || t('Seite {n}', { n: view.current + 1 }), { title: t('Lesezeichen hinzufügen') });
    if (!title) return;
    const outline = structuredClone(this.doc.outline);
    const node = { id: newId(), title, pageIndex: view.current, top, url: null, bold: false, italic: false, open: false, children: [] };
    if (asChildOf) {
      const f = this.#findIn(outline, asChildOf);
      f.item.children.push(node);
      f.item.open = true;
    } else {
      outline.push(node);
    }
    this.selectedId = node.id;
    this.doc.setOutline(outline, 'Lesezeichen hinzufügen');
    app.left.show('bookmarks', true);
  }

  #findIn(items, id) {
    const saved = this.doc.outline;
    this.doc.outline = items;
    const r = this.#find(id, items);
    this.doc.outline = saved;
    return r;
  }

  async rename(id) {
    if (!id || this.doc?.readOnly) return;
    const f = this.#find(id);
    if (!f) return;
    const title = await promptDialog(t('Neuer Titel'), f.item.title, { title: t('Lesezeichen umbenennen') });
    if (!title) return;
    const outline = structuredClone(this.doc.outline);
    this.#findIn(outline, id).item.title = title;
    this.doc.setOutline(outline, 'Lesezeichen umbenennen');
  }

  async remove(id) {
    if (!id || this.doc?.readOnly) return;
    const f = this.#find(id);
    if (!f) return;
    if (f.item.children?.length && !(await confirmDialog(t('Lesezeichen „{t}“ mit allen Unterpunkten löschen?', { t: f.item.title }), { danger: true, ok: t('Löschen') }))) return;
    const outline = structuredClone(this.doc.outline);
    const g = this.#findIn(outline, id);
    g.list.splice(g.index, 1);
    this.doc.setOutline(outline, 'Lesezeichen löschen');
  }

  #move(id, dir) {
    const outline = structuredClone(this.doc.outline);
    const g = this.#findIn(outline, id);
    if (!g) return;
    if (dir === 'up' || dir === 'down') {
      const j = g.index + (dir === 'up' ? -1 : 1);
      if (j < 0 || j >= g.list.length) return;
      [g.list[g.index], g.list[j]] = [g.list[j], g.list[g.index]];
    } else if (dir === 'in') {
      if (g.index === 0) return;
      const [node] = g.list.splice(g.index, 1);
      g.list[g.index - 1].children.push(node);
      g.list[g.index - 1].open = true;
    } else if (dir === 'out') {
      if (!g.parent) return;
      const [node] = g.list.splice(g.index, 1);
      const p = this.#findIn(outline, g.parent.id);
      p.list.splice(p.index + 1, 0, node);
    }
    this.doc.setOutline(outline, 'Lesezeichen verschieben');
  }

  async #setTarget(id) {
    const outline = structuredClone(this.doc.outline);
    const g = this.#findIn(outline, id);
    g.item.pageIndex = this.app.view.current;
    g.item.url = null;
    g.item.top = null;
    this.doc.setOutline(outline, 'Lesezeichen-Ziel');
    toast(t('Ziel auf Seite {n} gesetzt.', { n: this.app.view.current + 1 }));
  }

  #menu(it, x, y) {
    const ro = this.doc.readOnly;
    showMenu([
      { label: t('Gehe zu'), icon: 'ChevronRight', run: () => this.#go(it) },
      '-',
      { label: t('Unterpunkt hinzufügen'), icon: 'BookmarkPlus', disabled: ro, run: () => this.addForCurrent(it.id) },
      { label: t('Umbenennen'), icon: 'Pencil', shortcut: 'F2', disabled: ro, run: () => this.rename(it.id) },
      { label: t('Ziel = aktuelle Seite'), icon: 'Pin', disabled: ro, run: () => this.#setTarget(it.id) },
      { label: t('Fett'), checked: it.bold, disabled: ro, run: () => this.#style(it.id, 'bold') },
      { label: t('Kursiv'), checked: it.italic, disabled: ro, run: () => this.#style(it.id, 'italic') },
      '-',
      { label: t('Nach oben'), icon: 'ArrowUp', disabled: ro, run: () => this.#move(it.id, 'up') },
      { label: t('Nach unten'), icon: 'ArrowDown', disabled: ro, run: () => this.#move(it.id, 'down') },
      { label: t('Einrücken'), icon: 'ChevronRight', disabled: ro, run: () => this.#move(it.id, 'in') },
      { label: t('Ausrücken'), icon: 'ChevronLeft', disabled: ro, run: () => this.#move(it.id, 'out') },
      '-',
      { label: t('Löschen'), icon: 'Trash2', shortcut: 'Entf', disabled: ro, run: () => this.remove(it.id) },
    ], x, y);
  }

  #style(id, key) {
    const outline = structuredClone(this.doc.outline);
    const g = this.#findIn(outline, id);
    g.item[key] = !g.item[key];
    this.doc.setOutline(outline, 'Lesezeichen-Stil');
  }
}

// ======================================================================= comments
class CommentsPanel {
  constructor(app) {
    this.app = app;
    this.filter = '';
    this.input = h('input', { class: 'input', type: 'search', placeholder: t('Kommentare filtern …'), oninput: () => { this.filter = this.input.value.toLowerCase(); this.render(); } });
    this.listEl = h('div', { class: 'comments' });
    this.countEl = h('span', { class: 'panel-count' });
    this.el = h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('span', { class: 'panel-title', text: t('Kommentare') }), this.countEl),
      h('div', { class: 'panel-tools' }, this.input),
      this.listEl);
  }

  setDoc(doc, view) {
    this.doc?.removeEventListener('annotations', this.onChange);
    this.view?.removeEventListener('selection', this.onSel);
    this.doc = doc;
    this.view = view;
    this.onChange = () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.render(), 150); };
    this.onSel = () => this.#markSelected();
    doc?.addEventListener('annotations', this.onChange);
    view?.addEventListener('selection', this.onSel);
    this.render();
  }

  activate() {
    this.render();
  }

  render() {
    if (!this.el.isConnected) return;
    if (!this.doc) { this.listEl.replaceChildren(h('div', { class: 'empty', text: t('Kein Dokument geöffnet') })); this.countEl.textContent = ''; return; }
    const all = this.doc.allAnnotations();
    const f = this.filter;
    const list = all.filter(({ a }) => !f || [a.contents, a.text, a.author, t(TYPES[a.type]?.label || ''), a.stamp?.label, ...(a.replies || []).map((r) => r.contents)].some((s) => s && String(s).toLowerCase().includes(f)));
    this.countEl.textContent = String(all.length);
    if (!list.length) {
      this.listEl.replaceChildren(h('div', { class: 'empty', text: all.length ? t('Keine Treffer') : t('Dieses Dokument enthält keine Anmerkungen.') }));
      return;
    }
    const groups = new Map();
    for (const x of list) {
      if (!groups.has(x.page)) groups.set(x.page, []);
      groups.get(x.page).push(x);
    }
    const out = [];
    for (const [page, items] of groups) {
      out.push(h('div', { class: 'cm-page', text: t('Seite {n}', { n: page + 1 }) }));
      for (const { a } of items) {
        const text = a.type === 'freetext' ? a.text : a.type === 'stamp' ? (a.stamp?.label || t('Bild')) : a.contents;
        const swatch = h('span', { class: 'cm-swatch', style: { background: a.color ? `rgb(${a.color.map((v) => v * 255).join(',')})` : 'transparent' } });
        out.push(h('div', {
          class: 'cm-item', tabIndex: 0, dataset: { id: a.id },
          onclick: () => this.#reveal(a.id, page),
          ondblclick: () => { this.#reveal(a.id, page); this.app.editAnnotation(this.view, this.view.pageViews[page], a.id); },
          onkeydown: (e) => { if (e.key === 'Delete') { this.doc.remove([a.id]); } if (e.key === 'Enter') this.#reveal(a.id, page); },
          oncontextmenu: (e) => {
            e.preventDefault();
            this.#reveal(a.id, page);
            this.app.showAnnotationMenu(e.clientX, e.clientY);
          },
        },
        h('div', { class: 'cm-head' }, swatch, icon(TYPES[a.type]?.icon || 'Square', 14), h('span', { class: 'cm-type', text: t(TYPES[a.type]?.label || a.type) }), a.locked ? icon('Lock', 12) : null, h('span', { class: 'cm-date', text: fmtDate(a.modified) })),
        a.author ? h('div', { class: 'cm-author', text: a.author }) : null,
        text ? h('div', { class: 'cm-text', text }) : null,
        a.type !== 'freetext' && a.contents && text !== a.contents ? h('div', { class: 'cm-text', text: a.contents }) : null,
        ...(a.replies || []).map((r) => h('div', { class: 'cm-reply' }, icon('Reply', 12), h('b', { text: `${r.author || t('Unbekannt')}: ` }), r.contents))));
      }
    }
    this.listEl.replaceChildren(...out);
    this.#markSelected();
  }

  #reveal(id, page) {
    const f = this.doc.find(id);
    if (!f) return;
    this.view.revealRect(page, buildAppearance(f.a, this.doc.images).bbox);
    this.view.select([id]);
  }

  #markSelected() {
    const sel = this.view?.selection || new Set();
    this.listEl.querySelectorAll('.cm-item').forEach((el) => el.classList.toggle('selected', sel.has(el.dataset.id)));
  }
}
