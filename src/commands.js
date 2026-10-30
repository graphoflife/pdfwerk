// Command registry: every action reachable from ribbon, menus and keyboard shortcuts.
import { t } from './i18n.js';
import { toast, withBusy, confirmDialog, downloadBlob } from './ui/dom.js';
import { cloneAnnotation, newId, translateAnnotation } from './core/model.js';
import { markupFromSelection } from './tools/markup.js';
import { loadPdfjs, AnnotationMode } from './core/pdfjs.js';
import { makeZip } from './core/zip.js';
import { AnnotationWriter } from './core/pdf-write.js';

/** Normalised key combo for a keyboard event, e.g. "Ctrl+Shift+S". */
export function comboOf(e) {
  let key = e.key;
  // Layout-independent digits and backquote for combos such as Ctrl+Shift+8 or Ctrl+`.
  if ((e.ctrlKey || e.metaKey || e.altKey) && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if ((e.ctrlKey || e.metaKey) && e.code === 'Backquote') key = '`';
  if (key === ' ') key = 'Space';
  else if (key === '+' || key === '=' || (e.shiftKey && key === '*' && (e.ctrlKey || e.metaKey))) key = 'Plus';
  else if (key === '-' || key === '_') key = 'Minus';
  else if (key.length === 1) key = key.toUpperCase();
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && (key.length > 1 || e.ctrlKey || e.metaKey || e.altKey)) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const displayKey = (k) => (k ? (isMac ? k.replace(/Ctrl/g, '⌘').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧') : k).replace('Plus', '+').replace('Minus', '−') : '');

export class Commands {
  constructor(app) {
    this.app = app;
    this.map = new Map();
    this.keymap = new Map();
    this.#registerAll();
  }

  add(id, spec) {
    this.map.set(id, { id, ...spec });
    for (const k of spec.keys || []) this.keymap.set(k, id);
  }

  get(id) {
    return this.map.get(id);
  }

  enabled(id) {
    const c = this.map.get(id);
    return !!c && (!c.enabled || c.enabled());
  }

  async run(id, ...args) {
    const c = this.map.get(id);
    if (!c || !this.enabled(id)) return;
    try {
      await c.run(...args);
    } catch (e) {
      console.error(e);
      toast(`${t('Fehler')}: ${e.message || e}`, { type: 'error', timeout: 6000 });
    }
    this.app.refreshUI();
  }

  shortcut(id) {
    return displayKey(this.map.get(id)?.keys?.[0]);
  }

  #registerAll() {
    const app = this.app;
    const hasDoc = () => !!app.doc;
    const editable = () => !!app.doc && !app.doc.readOnly;
    const hasSel = () => !!app.view?.selection.size;
    const sel = () => app.view?.selectedAnnots || [];

    // ------------------------------------------------------------ file
    this.add('open', { label: 'Öffnen …', icon: 'FolderOpen', keys: ['Ctrl+O'], run: () => app.openDialog() });
    this.add('new', { label: 'Neues leeres PDF', icon: 'FilePlus', keys: ['Alt+N'], run: () => app.dialogs.newBlank() });
    this.add('fromImages', { label: 'PDF aus Bildern …', icon: 'Images', run: () => app.fromImages() });
    this.add('save', { label: 'Speichern', icon: 'Save', keys: ['Ctrl+S'], enabled: hasDoc, run: () => app.save() });
    this.add('saveAs', { label: 'Speichern unter …', icon: 'SaveAll', keys: ['Ctrl+Shift+S'], enabled: hasDoc, run: () => app.save({ saveAs: true }) });
    this.add('saveFlat', { label: 'Abgeflachte Kopie speichern …', icon: 'Layers', enabled: hasDoc, run: () => app.save({ saveAs: true, flatten: true, flattenForms: true, suffix: '_flach' }) });
    this.add('print', { label: 'Drucken …', icon: 'Printer', keys: ['Ctrl+P'], enabled: hasDoc, run: () => this.print() });
    this.add('exportImages', { label: 'Seiten als Bilder exportieren …', icon: 'FileImage', enabled: hasDoc, run: () => app.dialogs.exportImages() });
    this.add('properties', { label: 'Dokumenteigenschaften …', icon: 'Info', keys: ['Ctrl+D'], enabled: hasDoc, run: () => app.dialogs.docProperties() });
    this.add('close', { label: 'Dokument schließen', icon: 'X', keys: ['Alt+W'], enabled: hasDoc, run: () => app.closeTab(app.active) });
    this.add('closeAll', { label: 'Alle schließen', icon: 'X', enabled: hasDoc, run: () => app.closeAll() });
    this.add('fileMenu', { label: 'Datei-Menü', icon: 'FolderOpen', keys: ['Alt+F'], run: () => app.backstage.open() });
    this.add('settings', { label: 'Einstellungen …', icon: 'Settings', keys: ['Ctrl+K'], run: () => app.dialogs.settings() });
    this.add('quickLaunch', { label: 'Schnellstart', icon: 'Search', keys: ['Ctrl+.'], run: () => app.quickLaunch.focus() });
    this.add('shortcuts', { label: 'Tastenkürzel', icon: 'Keyboard', keys: ['F1', '?'], run: () => app.dialogs.shortcuts() });
    this.add('about', { label: 'Über PDFwerk', icon: 'CircleHelp', run: () => app.dialogs.about() });

    // ------------------------------------------------------------ edit
    this.add('undo', { label: 'Rückgängig', icon: 'Undo2', keys: ['Ctrl+Z'], enabled: () => !!app.doc?.canUndo, run: () => this.#history('undo') });
    this.add('redo', { label: 'Wiederholen', icon: 'Redo2', keys: ['Ctrl+Y', 'Ctrl+Shift+Z'], enabled: () => !!app.doc?.canRedo, run: () => this.#history('redo') });
    this.add('copy', { label: 'Kopieren', icon: 'Copy', shortcutText: 'Ctrl+C', enabled: hasSel, run: () => this.copy() });
    this.add('cut', { label: 'Ausschneiden', icon: 'Scissors', shortcutText: 'Ctrl+X', enabled: hasSel, run: () => { this.copy(); this.deleteSel(); } });
    this.add('paste', { label: 'Einfügen', icon: 'ClipboardPaste', shortcutText: 'Ctrl+V', enabled: () => editable() && !!app.clipboard, run: () => this.pasteInternal() });
    this.add('duplicate', { label: 'Duplizieren', icon: 'Copy', shortcutText: 'Ctrl+Ziehen', enabled: hasSel, run: () => this.duplicate() });
    this.add('delete', { label: 'Löschen', icon: 'Trash2', keys: ['Delete', 'Backspace'], enabled: hasSel, run: () => this.deleteSel() });
    this.add('selectAll', { label: 'Alle Anmerkungen der Seite auswählen', icon: 'MousePointer2', keys: ['Ctrl+A'], enabled: hasDoc, run: () => this.selectAll() });
    this.add('bringFront', { label: 'In den Vordergrund', icon: 'BringToFront', keys: ['Ctrl+Shift+]'], enabled: hasSel, run: () => app.doc.zOrder([...app.view.selection], 'front') });
    this.add('sendBack', { label: 'In den Hintergrund', icon: 'SendToBack', keys: ['Ctrl+Shift+['], enabled: hasSel, run: () => app.doc.zOrder([...app.view.selection], 'back') });
    this.add('forward', { label: 'Eine Ebene nach vorne', icon: 'ArrowUp', keys: ['Ctrl+]'], enabled: hasSel, run: () => app.doc.zOrder([...app.view.selection], 'forward') });
    this.add('backward', { label: 'Eine Ebene nach hinten', icon: 'ArrowDown', keys: ['Ctrl+['], enabled: hasSel, run: () => app.doc.zOrder([...app.view.selection], 'backward') });
    this.add('lock', { label: 'Sperren / Entsperren', icon: 'Lock', enabled: hasSel, checked: () => sel().length && sel().every((a) => a.locked), run: () => { const lock = !sel().every((a) => a.locked); app.doc.update([...app.view.selection], { locked: lock }, { label: lock ? 'Sperren' : 'Entsperren' }); } });
    this.add('editAnnot', { label: 'Kommentar bearbeiten', icon: 'Pencil', keys: ['Enter', 'F2'], enabled: () => app.view?.selection.size === 1, run: () => { const id = [...app.view.selection][0]; const f = app.doc.find(id); app.editAnnotation(app.view, app.view.pageViews[f.page], id); } });
    this.add('flattenAnnots', { label: 'Anmerkungen abflachen', icon: 'Layers', enabled: editable, run: () => this.flattenAll() });
    this.add('deleteAllAnnots', { label: 'Alle Anmerkungen löschen', icon: 'Trash2', enabled: editable, run: () => this.deleteAll() });
    const setAnnotsHidden = (hide) => {
      const v = app.view;
      v.hiddenTypes = hide ? new Set(['*']) : null;
      v.pageViews.forEach((p) => (p.visible ? p.renderAnnotations() : (p.layersStale = true)));
    };
    this.add('toggleAnnots', { label: 'Anmerkungen ausblenden', icon: 'EyeOff', keys: ['Ctrl+Shift+8'], enabled: hasDoc, checked: () => !!app.view?.hiddenTypes, run: () => setAnnotsHidden(!app.view.hiddenTypes) });
    this.add('showAnnots', { label: 'Alle Anmerkungen anzeigen', icon: 'Eye', keys: ['Ctrl+8'], enabled: hasDoc, run: () => setAnnotsHidden(false) });
    this.add('stickyTools', { label: 'Werkzeug beibehalten', icon: 'Pin', checked: () => app.tools.sticky, run: () => app.tools.setSticky(!app.tools.sticky) });
    this.add('copyFormat', { label: 'Stil als Werkzeug-Standard', icon: 'Paintbrush', enabled: () => app.view?.selection.size === 1, run: () => this.styleAsDefault() });
    this.add('markHighlight', { label: 'Auswahl hervorheben', icon: 'Highlighter', enabled: editable, run: () => markupFromSelection(app, app.view, 'highlight') });
    this.add('markUnderline', { label: 'Auswahl unterstreichen', icon: 'Underline', enabled: editable, run: () => markupFromSelection(app, app.view, 'underline') });
    this.add('markStrike', { label: 'Auswahl durchstreichen', icon: 'Strikethrough', enabled: editable, run: () => markupFromSelection(app, app.view, 'strikeout') });
    this.add('copyText', { label: 'Text kopieren', icon: 'Copy', run: () => navigator.clipboard?.writeText(String(window.getSelection() || '')) });

    // ------------------------------------------------------------ view
    const zoomTo = (z) => app.view?.setZoom(z);
    this.add('zoomIn', { label: 'Vergrößern', icon: 'ZoomIn', keys: ['Ctrl+Plus'], enabled: hasDoc, run: () => app.view.zoomBy(1.25) });
    this.add('zoomOut', { label: 'Verkleinern', icon: 'ZoomOut', keys: ['Ctrl+Minus'], enabled: hasDoc, run: () => app.view.zoomBy(0.8) });
    this.add('actualSize', { label: 'Originalgröße (100 %)', icon: 'Scaling', keys: ['Ctrl+1'], enabled: hasDoc, run: () => zoomTo(1) });
    this.add('fitPage', { label: 'Ganze Seite', icon: 'Expand', keys: ['Ctrl+0'], enabled: hasDoc, checked: () => app.view?.fit === 'page', run: () => app.view.setFit('page') });
    this.add('fitWidth', { label: 'Seitenbreite', icon: 'StretchHorizontal', keys: ['Ctrl+2'], enabled: hasDoc, checked: () => app.view?.fit === 'width', run: () => app.view.setFit('width') });
    this.add('rotateViewCw', { label: 'Ansicht im Uhrzeigersinn drehen', icon: 'RotateCw', keys: ['Ctrl+Shift+Plus'], enabled: hasDoc, run: () => app.view.rotateView(90) });
    this.add('rotateViewCcw', { label: 'Ansicht gegen den Uhrzeigersinn drehen', icon: 'RotateCcw', keys: ['Ctrl+Shift+Minus'], enabled: hasDoc, run: () => app.view.rotateView(-90) });
    this.add('layoutSingle', { label: 'Einzelseite', icon: 'RectangleVertical', keys: ['Ctrl+4'], enabled: hasDoc, checked: () => app.view?.layout === 'single', run: () => app.view.setLayout('single') });
    this.add('layoutContinuous', { label: 'Fortlaufend', icon: 'ScrollText', keys: ['Ctrl+5'], enabled: hasDoc, checked: () => app.view?.layout === 'continuous', run: () => app.view.setLayout('continuous') });
    this.add('layoutTwo', { label: 'Doppelseite', icon: 'Columns2', keys: ['Ctrl+6'], enabled: hasDoc, checked: () => app.view?.layout === 'two', run: () => app.view.setLayout('two') });
    this.add('firstPage', { label: 'Erste Seite', icon: 'ChevronsLeft', keys: ['Home'], enabled: hasDoc, run: () => app.view.goToPage(0) });
    this.add('lastPage', { label: 'Letzte Seite', icon: 'ChevronsRight', keys: ['End'], enabled: hasDoc, run: () => app.view.goToPage(app.doc.numPages - 1) });
    this.add('prevPage', { label: 'Vorherige Seite', icon: 'ChevronLeft', keys: ['Ctrl+ArrowLeft', 'Alt+ArrowLeft'], enabled: hasDoc, run: () => app.view.prev() });
    this.add('nextPage', { label: 'Nächste Seite', icon: 'ChevronRight', keys: ['Ctrl+ArrowRight', 'Alt+ArrowRight'], enabled: hasDoc, run: () => app.view.next() });
    this.add('goToPage', { label: 'Gehe zu Seite …', icon: 'Hash', keys: ['Ctrl+G', 'Ctrl+Shift+N'], enabled: hasDoc, run: () => app.statusbar.focusPageInput() });
    this.add('zoomTo', { label: 'Zoomen auf …', icon: 'ZoomIn', keys: ['Ctrl+Shift+M'], enabled: hasDoc, run: () => app.statusbar.focusZoom() });
    this.add('find', { label: 'Suchen …', icon: 'Search', keys: ['Ctrl+F'], enabled: hasDoc, run: () => app.findbar.open() });
    this.add('findNext', { label: 'Weitersuchen', icon: 'ChevronDown', keys: ['F3'], enabled: hasDoc, run: () => app.findbar.next(1) });
    this.add('findPrev', { label: 'Rückwärts suchen', icon: 'ChevronUp', keys: ['Shift+F3'], enabled: hasDoc, run: () => app.findbar.next(-1) });
    this.add('toggleLeft', { label: 'Seitenleiste links', icon: 'PanelLeft', keys: ['F4'], checked: () => !!app.left?.isOpen, run: () => app.left.toggle() });
    this.add('toggleRight', { label: 'Eigenschaften-Leiste', icon: 'PanelRight', keys: ['Ctrl+E', 'Ctrl+`'], checked: () => !!app.props?.isOpen, run: () => app.props.toggle() });
    const panel = (id) => ({
      checked: () => !!app.left?.isOpen && app.left.panel === id,
      run: () => (app.left.isOpen && app.left.panel === id ? app.left.toggle() : app.left.show(id, true)),
    });
    this.add('panelThumbs', { label: 'Seitenminiaturen', icon: 'LayoutGrid', keys: ['Ctrl+T'], ...panel('thumbs') });
    this.add('panelBookmarks', { label: 'Lesezeichen', icon: 'Bookmark', keys: ['Ctrl+B'], ...panel('bookmarks') });
    this.add('panelComments', { label: 'Kommentare', icon: 'MessagesSquare', keys: ['Ctrl+M'], ...panel('comments') });
    this.add('fullscreen', { label: 'Vollbild', icon: 'Fullscreen', keys: ['F11'], run: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()) });
    this.add('theme', { label: 'Dunkles Design', icon: 'Moon', checked: () => document.documentElement.dataset.theme === 'dark', run: () => app.toggleTheme() });

    // ------------------------------------------------------------ pages
    const pages = () => app.targetPages();
    const busy = (label, fn) => withBusy(t(label), fn);
    this.add('rotatePagesCw', { label: 'Seiten rechts drehen', icon: 'RotateCw', keys: ['Ctrl+Shift+R'], enabled: editable, run: () => busy('Seiten drehen', () => app.doc.rotatePages(pages(), 90)) });
    this.add('rotatePagesCcw', { label: 'Seiten links drehen', icon: 'RotateCcw', keys: ['Ctrl+Shift+L'], enabled: editable, run: () => busy('Seiten drehen', () => app.doc.rotatePages(pages(), -90)) });
    this.add('rotatePages', { label: 'Seiten drehen …', icon: 'RotateCw', enabled: editable, run: () => app.dialogs.rotatePages() });
    this.add('deletePages', { label: 'Seiten löschen …', icon: 'FileMinus', keys: ['Ctrl+Shift+D'], enabled: editable, run: () => app.dialogs.deletePages() });
    this.add('insertBlank', { label: 'Leere Seiten einfügen …', icon: 'FilePlus2', enabled: editable, run: () => app.dialogs.insertBlank() });
    this.add('insertFile', { label: 'Seiten aus Datei einfügen …', icon: 'FileInput', keys: ['Ctrl+Shift+I'], enabled: editable, run: () => app.dialogs.insertFromFile() });
    this.add('extractPages', { label: 'Seiten extrahieren …', icon: 'FileOutput', keys: ['Ctrl+Shift+E'], enabled: hasDoc, run: () => app.dialogs.extractPages() });
    this.add('splitDoc', { label: 'Dokument teilen …', icon: 'Scissors', enabled: hasDoc, run: () => app.dialogs.splitDocument() });
    this.add('duplicatePages', { label: 'Seiten duplizieren', icon: 'Files', enabled: editable, run: () => busy('Seiten duplizieren', () => app.doc.duplicatePages(pages())) });
    this.add('movePages', { label: 'Seiten verschieben …', icon: 'ArrowUpDown', enabled: editable, run: () => app.dialogs.movePages() });
    this.add('reversePages', { label: 'Reihenfolge umkehren', icon: 'ArrowUpDown', enabled: editable, run: () => busy('Seiten umkehren', () => app.doc.reversePages(pages().length > 1 ? pages() : [...Array(app.doc.numPages).keys()])) });
    this.add('cropPages', { label: 'Seiten zuschneiden …', icon: 'Crop', keys: ['Ctrl+Shift+T'], enabled: editable, run: () => app.dialogs.cropPages() });
    this.add('watermark', { label: 'Wasserzeichen …', icon: 'Droplet', enabled: editable, run: () => app.dialogs.watermark() });
    this.add('headerFooter', { label: 'Kopf-/Fußzeile & Seitenzahlen …', icon: 'Heading', enabled: editable, run: () => app.dialogs.headerFooter() });
    this.add('mergeFiles', { label: 'Dateien anhängen …', icon: 'Combine', enabled: editable, run: () => app.dialogs.insertFromFile({ atEnd: true, multiple: true }) });

    // ------------------------------------------------------------ protect / forms
    this.add('applyRedactions', { label: 'Schwärzungen anwenden', icon: 'ShieldCheck', enabled: editable, run: () => this.applyRedactions() });
    this.add('sanitize', { label: 'Metadaten entfernen', icon: 'Ban', enabled: editable, run: () => this.sanitize() });
    this.add('resetForm', { label: 'Formular zurücksetzen', icon: 'RotateCcw', enabled: hasDoc, run: () => this.resetForm() });
    this.add('highlightFields', { label: 'Formularfelder hervorheben', icon: 'TextCursorInput', checked: () => !document.body.classList.contains('no-field-highlight'), run: () => { document.body.classList.toggle('no-field-highlight'); app.prefs.set('fieldHighlight', !document.body.classList.contains('no-field-highlight')); } });
    this.add('scaleSettings', { label: 'Maßstab …', icon: 'Ruler', keys: ['Ctrl+Shift+C'], run: () => app.dialogs.measureScale() });
    this.add('addBookmark', { label: 'Lesezeichen hinzufügen', icon: 'BookmarkPlus', keys: ['Ctrl+Shift+B'], enabled: editable, run: () => app.left.bookmarks.addForCurrent() });
  }

  async #history(dir) {
    const app = this.app;
    app.textEditor.commit();
    app.notePopup.close();
    app.tools.active.cancel?.();
    await withBusy(t('Bitte warten …'), () => app.doc[dir]());
  }

  // ------------------------------------------------------------ clipboard
  copy() {
    const app = this.app;
    const list = app.view.selectedAnnots;
    if (!list.length) return;
    const page = app.doc.find(list[0].id).page;
    const images = new Map();
    for (const a of list) if (a.stamp?.imageId) images.set(a.stamp.imageId, app.doc.images.get(a.stamp.imageId));
    app.clipboard = { annots: list.map(cloneAnnotation), page, docId: app.doc.id, images, pastes: 0, time: Date.now() };
    try { navigator.clipboard?.writeText(list.map((a) => a.contents || a.text || '').filter(Boolean).join('\n') || ' '); } catch { /* ignore */ }
    toast(t('{n} Anmerkung(en) kopiert', { n: list.length }), { timeout: 1500 });
  }

  pasteInternal(targetPage = null, at = null) {
    const app = this.app;
    const cb = app.clipboard;
    if (!cb || !app.doc || app.doc.readOnly) return;
    const view = app.view;
    const page = targetPage ?? view.current;
    cb.pastes++;
    const same = cb.docId === app.doc.id && page === cb.page;
    let dx = same ? 12 * cb.pastes : 0, dy = same ? -12 * cb.pastes : 0;
    if (at) {
      const box = cb.annots.map((a) => (a.rect ? a.rect : null)).find(Boolean);
      if (box) { dx = at[0] - box[0]; dy = at[1] - box[3]; }
    }
    for (const [id, img] of cb.images) if (img && !app.doc.images.has(id)) app.doc.images.set(id, img);
    const list = cb.annots.map((a) => ({ ...translateAnnotation(a, dx, dy), id: newId(), orig: undefined, replies: [], dirty: true }));
    app.doc.add(page, list, { label: 'Einfügen' });
    view.select(list.map((a) => a.id));
  }

  duplicate() {
    const app = this.app;
    const list = app.view.selectedAnnots;
    if (!list.length) return;
    const page = app.doc.find(list[0].id).page;
    const clones = list.map((a) => ({ ...translateAnnotation(a, 12, -12), id: newId(), orig: undefined, replies: [], dirty: true }));
    app.doc.add(page, clones, { label: 'Duplizieren' });
    app.view.select(clones.map((a) => a.id));
  }

  deleteSel() {
    const app = this.app;
    const ids = [...app.view.selection].filter((id) => !app.doc.find(id)?.a.locked);
    if (!ids.length) return;
    app.notePopup.close();
    app.doc.remove(ids);
    app.view.clearSelection();
  }

  selectAll() {
    const app = this.app;
    const v = app.view;
    if (app.tools.activeId === 'text') {
      const pv = v.pageViews[v.current];
      const r = document.createRange();
      r.selectNodeContents(pv.textDiv);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    v.select(app.doc.annots[v.current].map((a) => a.id));
  }

  styleAsDefault() {
    const app = this.app;
    const a = app.view.selectedAnnots[0];
    const toolId = app.props.toolIdFor(a);
    if (!toolId) return;
    const keys = ['color', 'fill', 'opacity', 'width', 'dash', 'startCap', 'endCap', 'font', 'textColor', 'align'];
    const patch = {};
    for (const k of keys) if (k in a) patch[k] = structuredClone(a[k]);
    app.tools.setStyle(toolId, patch);
    toast(t('Stil als Standard für „{tool}“ übernommen', { tool: t(app.tools.defs.get(toolId).label) }));
  }

  async flattenAll() {
    const app = this.app;
    const n = app.doc.allAnnotations().filter(({ a }) => a.type !== 'redact' && a.type !== 'note').length;
    if (!n) return toast(t('Keine Anmerkungen vorhanden.'));
    if (!(await confirmDialog(t('{n} Anmerkungen werden dauerhaft in den Seiteninhalt eingebrannt und sind danach nicht mehr bearbeitbar. Fortfahren?', { n }), { ok: t('Abflachen') }))) return;
    await withBusy(t('Anmerkungen abflachen'), async () => {
      const doc = app.doc;
      await doc.structural('Anmerkungen abflachen', async (lib) => {
        const writer = new AnnotationWriter(lib, doc.images);
        for (let i = 0; i < lib.getPageCount(); i++) {
          const list = doc.annots[i].filter((a) => a.type !== 'redact' && a.type !== 'note');
          await writer.writePage(i, list, { flatten: true });
          doc.annots[i] = doc.annots[i].filter((a) => a.type === 'redact' || a.type === 'note');
        }
        return [...Array(lib.getPageCount()).keys()];
      });
    });
  }

  async deleteAll() {
    const app = this.app;
    const ids = app.doc.allAnnotations().map(({ a }) => a.id);
    if (!ids.length) return toast(t('Keine Anmerkungen vorhanden.'));
    if (!(await confirmDialog(t('Alle {n} Anmerkungen löschen?', { n: ids.length }), { ok: t('Löschen'), danger: true }))) return;
    app.doc.remove(ids, { label: 'Alle Anmerkungen löschen' });
  }

  async applyRedactions() {
    const app = this.app;
    const marks = app.doc.allAnnotations().filter(({ a }) => a.type === 'redact');
    if (!marks.length) {
      toast(t('Keine Schwärzungen markiert. Verwende zuerst „Schwärzung markieren“.'), { timeout: 5000 });
      return;
    }
    const pagesN = new Set(marks.map((m) => m.page)).size;
    const ok = await confirmDialog(t('{n} Schwärzung(en) auf {p} Seite(n) anwenden? Die betroffenen Seiten werden in Bilder umgewandelt, sodass der verdeckte Inhalt (Text, Grafiken) unwiederbringlich entfernt wird.', { n: marks.length, p: pagesN }), { ok: t('Anwenden'), danger: true });
    if (!ok) return;
    await withBusy(t('Schwärzungen anwenden'), () => app.doc.applyRedactions());
    toast(t('Schwärzungen angewendet.'), { type: 'success' });
  }

  async sanitize() {
    const app = this.app;
    if (!(await confirmDialog(t('Titel, Autor, Betreff, Stichwörter und Ersteller werden entfernt.'), { ok: t('Entfernen') }))) return;
    app.doc.setMeta({ title: '', author: '', subject: '', keywords: '', creator: '' });
    toast(t('Metadaten entfernt.'), { type: 'success' });
  }

  async resetForm() {
    const app = this.app;
    const doc = app.doc;
    if (!(await confirmDialog(t('Alle Formularfelder auf die gespeicherten Werte zurücksetzen?')))) return;
    await withBusy(t('Bitte warten …'), () => doc.resetForms());
  }

  // ------------------------------------------------------------ printing
  async print() {
    const app = this.app;
    const doc = app.doc;
    app.textEditor.commit();
    const root = document.getElementById('print-root');
    await withBusy(t('Druck wird vorbereitet …'), async () => {
      const bytes = await doc.save();
      const { pdf } = await loadPdfjs(bytes, { password: doc.password });
      root.replaceChildren();
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 150 / 72 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print', annotationMode: AnnotationMode.ENABLE_STORAGE }).promise;
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        img.className = viewport.width > viewport.height ? 'landscape' : 'portrait';
        await img.decode().catch(() => {});
        const wrap = document.createElement('div');
        wrap.className = 'print-page';
        wrap.append(img);
        root.append(wrap);
        canvas.width = canvas.height = 0;
      }
      pdf.destroy();
    });
    const cleanup = () => {
      root.querySelectorAll('img').forEach((i) => URL.revokeObjectURL(i.src));
      root.replaceChildren();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  /** Render pages to images and download (single file or ZIP). */
  async exportImages(indices, { dpi = 150, format = 'png' } = {}) {
    const app = this.app;
    const doc = app.doc;
    const base = doc.name.replace(/\.pdf$/i, '');
    await withBusy(t('Bilder werden erzeugt …'), async () => {
      const bytes = await doc.save();
      const { pdf } = await loadPdfjs(bytes, { password: doc.password });
      const files = [];
      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
      for (const i of indices) {
        const page = await pdf.getPage(i + 1);
        const viewport = page.getViewport({ scale: dpi / 72 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport, intent: 'print', annotationMode: AnnotationMode.ENABLE_STORAGE }).promise;
        const blob = await new Promise((r) => canvas.toBlob(r, mime, 0.92));
        files.push({ name: `${base}_S${String(i + 1).padStart(3, '0')}.${format}`, data: new Uint8Array(await blob.arrayBuffer()) });
        canvas.width = canvas.height = 0;
      }
      pdf.destroy();
      if (files.length === 1) downloadBlob(files[0].data, files[0].name, mime);
      else downloadBlob(makeZip(files), `${base}_Bilder.zip`, 'application/zip');
    });
  }
}
