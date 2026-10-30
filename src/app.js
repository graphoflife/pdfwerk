// Application shell: tabs, layout, keyboard, clipboard, drag & drop, theme.
import { Prefs } from './core/prefs.js';
import { t, setLang, detectLang } from './i18n.js';
import { PdfDoc } from './core/document.js';
import { DocView } from './viewer/doc-view.js';
import { SearchController } from './viewer/search.js';
import { ToolManager } from './tools/index.js';
import { TextEditor, NotePopup } from './tools/editors.js';
import { Commands, comboOf } from './commands.js';
import { Ribbon } from './ui/ribbon.js';
import { LeftSidebar } from './ui/sidebar.js';
import { PropertiesPanel } from './ui/properties.js';
import { StatusBar, FindBar } from './ui/statusbar.js';
import { Dialogs } from './ui/dialogs.js';
import { Backstage, recentRow } from './ui/backstage.js';
import { QuickLaunch } from './ui/quicklaunch.js';
import { addRecent, listRecent, recentSupported } from './core/recent.js';
import { h, iconButton, toast, withBusy, showMenu, closeMenus, openDialog, field, select } from './ui/dom.js';
import { icon } from './ui/icons.js';
import { pickFiles, saveBytes, hasFsAccess } from './core/file-io.js';
import { imagesToPdf, normalizeImage, PAGE_SIZES } from './core/page-ops.js';
import { createAnnotation } from './core/model.js';
import { fitFreeText } from './core/appearance.js';

export class App {
  constructor(root) {
    this.root = root;
    this.prefs = new Prefs();
    setLang(this.prefs.get('lang', detectLang()));
    this.tabs = [];
    this.active = null;
    this.clipboard = null;
    this.spaceHand = false;
    this.tools = new ToolManager(this);
    this.textEditor = new TextEditor(this);
    this.notePopup = new NotePopup(this);
    this.commands = new Commands(this);
    this.dialogs = new Dialogs(this);
    this.#buildDom();
    this.applyTheme();
    if (this.prefs.get('fieldHighlight', true) === false) document.body.classList.add('no-field-highlight');
    this.#installGlobalHandlers();
    this.renderStart();
    this.refreshUI();
  }

  get doc() { return this.active?.doc || null; }
  get view() { return this.active?.view || null; }

  // ------------------------------------------------------------------ DOM
  #buildDom() {
    const c = (id) => iconButton(this.commands.get(id).icon, `${t(this.commands.get(id).label)} (${this.commands.shortcut(id)})`, () => this.commands.run(id), { cls: `qa-btn qa-${id}`, size: 16 });
    this.qa = h('div', { class: 'qa' }, c('open'), c('save'), c('print'), h('span', { class: 'qa-sep' }), c('undo'), c('redo'));
    this.quickLaunch = new QuickLaunch(this);
    this.titleEl = h('div', { class: 'app-title' });
    const right = h('div', { class: 'top-right' },
      this.quickLaunch.el,
      iconButton('Moon', t('Hell/Dunkel umschalten'), () => this.toggleTheme(), { cls: 'theme-btn', size: 16 }),
      iconButton('Settings', `${t('Einstellungen')} (${this.commands.shortcut('settings')})`, () => this.commands.run('settings'), { size: 16 }),
      iconButton('CircleHelp', t('Tastenkürzel (F1)'), () => this.commands.run('shortcuts'), { size: 16 }));
    const brand = h('div', { class: 'brand', title: 'PDFwerk' }, h('span', { class: 'logo' }, icon('FileText', 14)));
    const top = h('header', { class: 'titlebar' }, brand, this.qa, this.titleEl, right);
    this.tabsHost = h('nav', { class: 'ribbon-tabs', role: 'tablist' });
    this.ribbonBody = h('div', { class: 'ribbon-body', role: 'toolbar' });
    this.tabList = h('div', { class: 'doc-tab-list' });
    this.tabBar = h('div', { class: 'doc-tabs', role: 'tablist', hidden: true }, this.tabList,
      iconButton('Plus', `${t('Öffnen …')} (${this.commands.shortcut('open')})`, () => this.commands.run('open'), { size: 15, cls: 'tab-new' }),
      h('div', { class: 'doc-tabs-fill' }),
      iconButton('X', t('Dokument schließen'), () => this.commands.run('close'), { size: 15, cls: 'tab-close-active' }));
    this.leftEl = h('aside', { class: 'left-sidebar' });
    this.rightEl = h('aside', { class: 'right-sidebar' });
    this.viewsEl = h('div', { class: 'views' });
    this.startEl = h('div', { class: 'start' });
    this.viewerHost = h('section', { class: 'viewer-host' }, this.viewsEl, this.startEl);
    this.statusEl = h('footer', { class: 'statusbar' });
    this.dropOverlay = h('div', { class: 'drop-overlay' }, h('div', {}, icon('FileInput', 40), h('div', { text: t('Dateien hier ablegen') })));
    this.backstage = new Backstage(this);
    this.root.replaceChildren(
      top, this.tabsHost, this.ribbonBody, this.tabBar,
      h('main', { class: 'workspace' }, this.leftEl, this.viewerHost, this.rightEl),
      this.statusEl, this.dropOverlay, this.backstage.el);
    this.ribbon = new Ribbon(this, this.tabsHost, this.ribbonBody);
    this.left = new LeftSidebar(this, this.leftEl);
    this.props = new PropertiesPanel(this, this.rightEl);
    this.statusbar = new StatusBar(this, this.statusEl);
    this.findbar = new FindBar(this, this.viewerHost);
    this.tools.addEventListener('style', () => { this.props.refresh(true); this.ribbon.refresh(); });
  }

  rebuildUI() {
    for (const tab of this.tabs) tab.view.el.remove();
    this.#buildDom();
    for (const tab of this.tabs) {
      this.viewsEl.append(tab.view.el);
      this.tabList.append(tab.el);
    }
    this.#renderTabs();
    this.left.setDoc();
    this.renderStart();
    this.refreshUI();
  }

  renderStart() {
    const c = this.commands;
    const card = (id, title, text) => h('button', { class: 'start-card', type: 'button', onclick: () => c.run(id) }, icon(c.get(id).icon, 26), h('b', { text: t(title) }), h('span', { text: t(text) }));
    this.startEl.replaceChildren(h('div', { class: 'start-inner' },
      h('div', { class: 'start-hero' }, h('span', { class: 'logo big' }, icon('FileText', 34)), h('div', {}, h('h1', { text: 'PDFwerk' }), h('p', { text: t('PDFs ansehen, kommentieren, organisieren, unterschreiben und schwärzen – direkt im Browser. Deine Dateien verlassen nie deinen Rechner.') }))),
      h('div', { class: 'start-cards' },
        card('open', 'PDF öffnen', 'oder Datei hierher ziehen'),
        card('new', 'Neues PDF', 'leeres Dokument erstellen'),
        card('fromImages', 'Aus Bildern', 'Fotos/Scans zu PDF')),
      h('div', { class: 'start-tips' },
        h('div', {}, icon('Keyboard', 16), h('span', { text: t('F1: alle Tastenkürzel · Shift beim Zeichnen: 0°/45°/90° einrasten') })),
        h('div', {}, icon('Lock', 16), h('span', { text: t('Läuft komplett lokal – kein Upload, kein Konto.') }))),
      this.startRecent = h('div', { class: 'start-recent', hidden: true })));
    this.startEl.hidden = this.tabs.length > 0;
    this.refreshStartRecent();
  }

  async refreshStartRecent() {
    const box = this.startRecent;
    if (!box || !recentSupported) return;
    const entries = (await listRecent()).slice(0, 8);
    box.hidden = !entries.length;
    box.replaceChildren(h('h2', { text: t('Zuletzt verwendet') }), ...entries.map((e) => recentRow(this, e, null, () => this.refreshStartRecent())));
  }

  // ------------------------------------------------------------------ documents & tabs
  async openDialog() {
    const files = await pickFiles({ kind: 'pdf', multiple: true });
    for (const f of files) await this.openFile(f.file, f.handle);
  }

  async openFile(file, handle = null) {
    const existing = handle && this.tabs.find((x) => x.doc.fileHandle && x.doc.fileHandle.isSameEntry && x.doc.name === file.name);
    if (existing) { this.activate(existing); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.openBytes(bytes, file.name, handle);
  }

  async openBytes(bytes, name, handle = null) {
    let doc;
    try {
      doc = await withBusy(t('{name} wird geöffnet …', { name }), () => PdfDoc.open(bytes, { name, handle, askPassword: (retry) => this.dialogs.askPassword(retry) }));
    } catch (e) {
      console.error(e);
      const msg = e?.name === 'PasswordException' ? t('Kein Passwort eingegeben.') : t('Die Datei konnte nicht geöffnet werden: {msg}', { msg: e?.message || e });
      toast(msg, { type: 'error', timeout: 7000 });
      return null;
    }
    const tab = this.#addTab(doc);
    if (handle) addRecent(name, handle).then(() => this.refreshStartRecent());
    if (doc.readOnly) toast(t('Dieses PDF ist geschützt und wird schreibgeschützt geöffnet (Formulare können ausgefüllt werden).'), { timeout: 7000 });
    if (!this.prefs.get('authorHint') && !this.prefs.get('author')) {
      this.prefs.set('authorHint', true);
      setTimeout(() => this.dialogs.askAuthor(), 600);
    }
    return tab;
  }

  #addTab(doc) {
    const view = new DocView(this, doc);
    view.search = new SearchController(view);
    const tab = { doc, view };
    tab.el = h('div', { class: 'doc-tab', role: 'tab', title: doc.name, onclick: () => this.activate(tab), onauxclick: (e) => { if (e.button === 1) this.closeTab(tab); } },
      icon('FileText', 14), h('span', { class: 'tab-name' }), iconButton('X', t('Schließen'), (e) => { e.stopPropagation(); this.closeTab(tab); }, { size: 13, cls: 'tab-close' }));
    this.tabs.push(tab);
    this.tabList.append(tab.el);
    this.viewsEl.append(view.el);
    doc.addEventListener('modified', () => this.#renderTabs());
    doc.addEventListener('history', () => this.refreshUI());
    doc.addEventListener('structure', () => { view.search.invalidate(); this.refreshUI(); });
    doc.addEventListener('annotations', () => this.refreshUI());
    doc.addEventListener('meta', () => this.refreshUI());
    view.addEventListener('selection', () => this.refreshUI());
    view.addEventListener('page', () => this.refreshUI());
    view.addEventListener('zoom', () => this.refreshUI());
    this.activate(tab);
    view.rebuild();
    this.applyToolMode(view);
    return tab;
  }

  activate(tab) {
    if (!tab) return;
    this.textEditor.commit();
    this.notePopup.close();
    this.active = tab;
    for (const x of this.tabs) x.view.el.hidden = x !== tab;
    this.#renderTabs();
    this.startEl.hidden = true;
    this.left.setDoc();
    this.findbar.setDoc();
    this.applyToolMode(tab.view);
    tab.view.el.focus({ preventScroll: true });
    this.refreshUI();
  }

  #renderTabs() {
    for (const x of this.tabs) {
      x.el.classList.toggle('active', x === this.active);
      x.el.querySelector('.tab-name').textContent = `${x.doc.modified ? '● ' : ''}${x.doc.name}`;
      x.el.title = x.doc.name;
    }
    this.tabBar.hidden = this.tabs.length === 0;
    const title = this.active ? `${this.active.doc.modified ? '● ' : ''}${this.active.doc.name} – PDFwerk` : 'PDFwerk';
    this.titleEl.textContent = title;
    document.title = title;
  }

  async closeTab(tab) {
    if (!tab) return;
    if (tab === this.active) this.textEditor.commit();
    if (tab.doc.modified) {
      this.activate(tab);
      const r = await openDialog({
        title: t('Ungespeicherte Änderungen'),
        body: h('p', { text: t('„{name}“ wurde geändert. Änderungen speichern?', { name: tab.doc.name }) }),
        buttons: [{ label: t('Abbrechen'), value: null }, { label: t('Verwerfen'), value: 'discard', danger: true }, { label: t('Speichern'), value: 'save', primary: true }],
      });
      if (!r) return;
      if (r === 'save' && !(await this.save())) return;
    }
    const i = this.tabs.indexOf(tab);
    this.tabs.splice(i, 1);
    tab.el.remove();
    tab.view.destroy();
    tab.doc.destroy();
    if (this.active === tab) {
      this.active = null;
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      if (next) this.activate(next);
      else {
        this.left.setDoc();
        this.startEl.hidden = false;
      }
    }
    this.#renderTabs();
    this.refreshUI();
  }

  async closeAll() {
    for (const tab of [...this.tabs]) {
      await this.closeTab(tab);
      if (this.tabs.includes(tab)) return; // cancelled
    }
  }

  async save({ saveAs = false, flatten = false, flattenForms = false, suffix = '' } = {}) {
    const doc = this.doc;
    if (!doc) return false;
    this.textEditor.commit();
    this.notePopup.close();
    if (doc.readOnly && doc.allAnnotations().length) toast(t('Geschütztes PDF: Anmerkungen können nicht gespeichert werden, nur Formularwerte.'), { type: 'error' });
    let bytes;
    try {
      bytes = await withBusy(t('Speichern …'), () => doc.save({ flatten, flattenForms }));
    } catch (e) {
      console.error(e);
      toast(`${t('Speichern fehlgeschlagen')}: ${e.message}`, { type: 'error', timeout: 7000 });
      return false;
    }
    const base = doc.name.replace(/\.pdf$/i, '');
    const name = `${base}${suffix}.pdf`;
    const res = await saveBytes(bytes, { name, handle: suffix ? null : doc.fileHandle, saveAs: saveAs || !!suffix });
    if (!res) return false;
    if (!suffix) {
      doc.fileHandle = res.handle;
      doc.name = res.name;
      doc.setModified(false);
      this.#renderTabs();
      if (res.handle) addRecent(res.name, res.handle);
    }
    toast(res.handle ? t('Gespeichert: {name}', { name: res.name }) : t('Heruntergeladen: {name}', { name: res.name }), { type: 'success' });
    if (!hasFsAccess && !this.prefs.get('downloadHint')) {
      this.prefs.set('downloadHint', true);
      toast(t('Hinweis: Dein Browser erlaubt kein direktes Speichern – die Datei wird in den Download-Ordner geladen.'), { timeout: 7000 });
    }
    return true;
  }

  targetPages() {
    const sel = this.left.isOpen && this.left.panel === 'thumbs' ? this.left.thumbs.selection : [];
    return sel.length ? sel : [this.view?.current ?? 0];
  }

  async fromImages() {
    const files = await pickFiles({ kind: 'image', multiple: true });
    if (!files.length) return;
    const size = select([['image', t('Wie Bild')], ...Object.keys(PAGE_SIZES).map((k) => [k, `${k} (${t('Bild einpassen')})`])], 'A4');
    const ok = await openDialog({ title: t('PDF aus Bildern'), body: h('div', { class: 'form' }, h('p', { class: 'hint', text: t('{n} Bild(er) ausgewählt', { n: files.length }) }), field(t('Seitengröße'), size)), buttons: [{ label: t('Abbrechen'), value: null }, { label: t('Erstellen'), value: true, primary: true }] });
    if (!ok) return;
    const bytes = await withBusy(t('PDF wird erstellt …'), () => imagesToPdf(files.map((f) => f.file), { pageSize: size.value === 'image' ? null : PAGE_SIZES[size.value], margin: size.value === 'image' ? 0 : 20 }));
    await this.openBytes(bytes, `${files[0].file.name.replace(/\.[^.]+$/, '')}.pdf`);
  }

  async pickImage() {
    const files = await pickFiles({ kind: 'image' });
    if (!files.length) {
      if (this.tools.activeId === 'image' && !this.tools.active.payload) this.tools.setTool(this.tools.lastNav);
      return;
    }
    await this.armImage(files[0].file, 'image', 200);
  }

  /** Prepare an image (File/Blob or data URL) for placement with a placement tool. */
  async armImage(src, toolId = 'image', defaultWidth = 200) {
    if (!this.doc) return;
    let blob = src;
    if (typeof src === 'string') blob = await (await fetch(src)).blob();
    const img = await normalizeImage(blob);
    const id = this.doc.addImage(img);
    const w = Math.min(defaultWidth, img.width * 0.75);
    this.tools.setTool(toolId, { payload: { stamp: { kind: 'image', imageId: id }, size: [w, (w * img.height) / img.width], image: img } });
    toast(t('Klicken oder Rahmen aufziehen, um das Bild zu platzieren.'), { timeout: 2500 });
  }

  /** Put an image annotation in the middle of the visible part of the current page. */
  async placeImageNow(blob) {
    const view = this.view;
    const img = await normalizeImage(blob);
    const id = this.doc.addImage(img);
    const pv = view.pageViews[view.current];
    const [cx, cy] = this.#visibleCenter(pv);
    const [x1, y1, x2, y2] = pv.viewBox;
    let w = Math.min(img.width * 0.75, (x2 - x1) * 0.6);
    let hh = (w * img.height) / img.width;
    if (hh > (y2 - y1) * 0.6) { hh = (y2 - y1) * 0.6; w = (hh * img.width) / img.height; }
    const a = createAnnotation('stamp', { author: this.prefs.get('author', ''), rect: [cx - w / 2, cy - hh / 2, cx + w / 2, cy + hh / 2], stamp: { kind: 'image', imageId: id }, width: 0, color: null });
    this.doc.add(pv.index, [a], { label: 'Bild einfügen' });
    view.select([a.id]);
  }

  #visibleCenter(pv) {
    const vr = this.view.el.getBoundingClientRect();
    const pr = pv.el.getBoundingClientRect();
    const x = (Math.max(vr.left, pr.left) + Math.min(vr.right, pr.right)) / 2;
    const y = (Math.max(vr.top, pr.top) + Math.min(vr.bottom, pr.bottom)) / 2;
    return pv.toPdf(...pv.clientToLocal(x, y));
  }

  pasteText(text) {
    const view = this.view;
    const pv = view.pageViews[view.current];
    const [cx, cy] = this.#visibleCenter(pv);
    const st = this.tools.styleFor('typewriter');
    const a = createAnnotation('freetext', { author: this.prefs.get('author', ''), ...structuredClone(st), rect: [cx - 100, cy, cx + 100, cy + 20], text, autoWidth: !text.includes('\n') && text.length < 60 });
    if (!a.autoWidth) a.rect = [cx - 150, cy + 50, cx + 150, cy + 60];
    a.rect = fitFreeText(a);
    this.doc.add(pv.index, [a], { label: 'Text einfügen' });
    view.select([a.id]);
  }

  // ------------------------------------------------------------------ tool mode & UI refresh
  onToolChanged() {
    this.textEditor.commit();
    for (const tab of this.tabs) this.applyToolMode(tab.view);
    this.refreshUI();
    this.props.refresh(true);
  }

  applyToolMode(view) {
    const tool = this.spaceHand ? this.tools.get('hand') : this.tools.active;
    view.el.classList.remove('mode-hand', 'mode-select', 'mode-text', 'mode-markup', 'mode-draw');
    view.el.classList.add(`mode-${tool.mode}`);
    view.el.dataset.tool = tool.id;
    view.pagesEl.style.cursor = tool.cursor;
  }

  refreshUI() {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      this.ribbon.refresh();
      this.statusbar.refresh();
      this.props.refresh();
      for (const b of this.qa.querySelectorAll('.qa-btn')) {
        const id = [...b.classList].find((x) => x.startsWith('qa-') && x !== 'qa-btn').slice(3);
        b.disabled = !this.commands.enabled(id);
      }
      const theme = this.root.querySelector('.theme-btn');
      theme?.replaceChildren(icon(document.documentElement.dataset.theme === 'dark' ? 'Sun' : 'Moon', 17));
    });
  }

  editAnnotation(view, pv, id) {
    if (!id) return;
    const f = view.doc.find(id);
    if (!f) return;
    pv = view.pageViews[f.page];
    if (f.a.type === 'freetext' && !f.a.locked && !view.doc.readOnly) this.textEditor.open(view, pv, id);
    else this.notePopup.open(view, pv, id);
  }

  // ------------------------------------------------------------------ theme
  applyTheme() {
    const pref = this.prefs.get('theme', 'light');
    const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    this.refreshUI?.();
  }

  toggleTheme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    this.prefs.set('theme', dark ? 'light' : 'dark');
    this.applyTheme();
  }

  // ------------------------------------------------------------------ context menus
  showViewContextMenu(ev, e) {
    const c = this.commands;
    const item = (id, extra = {}) => ({ label: t(c.get(id).label), icon: c.get(id).icon, shortcut: c.shortcut(id) || c.get(id).shortcutText, disabled: !c.enabled(id), checked: c.get(id).checked?.(), run: () => c.run(id), ...extra });
    const view = ev.view;
    const textSel = window.getSelection();
    if (textSel && !textSel.isCollapsed && view.el.contains(textSel.anchorNode)) {
      showMenu([item('copyText'), '-', item('markHighlight'), item('markUnderline'), item('markStrike'), '-', item('addBookmark'), item('find')], e.clientX, e.clientY);
      return;
    }
    if (ev.hitId) {
      if (!view.selection.has(ev.hitId)) view.select([ev.hitId]);
      this.showAnnotationMenu(e.clientX, e.clientY);
      return;
    }
    const pt = ev.pt;
    const page = ev.page;
    showMenu([
      { ...item('paste'), run: () => c.pasteInternal(page >= 0 ? page : null, pt) },
      item('selectAll'),
      '-',
      { label: t('Notiz hier einfügen'), icon: 'MessageSquare', disabled: !pt || this.doc?.readOnly, run: () => this.tools.get('note').onPointerDown({ ...ev, view }) },
      { label: t('Text hier einfügen'), icon: 'Type', disabled: !pt || this.doc?.readOnly, run: () => { this.tools.setTool('typewriter'); const tool = this.tools.active; tool.onPointerDown(ev); tool.onPointerUp({ ...ev, cancelled: false }); } },
      '-',
      { label: t('Werkzeug'), icon: 'MousePointer2', items: ['hand', 'select', 'text'].map((id) => ({ label: t(this.tools.defs.get(id).label), icon: this.tools.defs.get(id).icon, checked: this.tools.activeId === id, run: () => this.tools.setTool(id) })) },
      { label: t('Zoom'), icon: 'ZoomIn', items: [item('zoomIn'), item('zoomOut'), item('actualSize'), item('fitWidth'), item('fitPage')] },
      { label: t('Seite'), icon: 'File', items: [item('rotatePagesCw'), item('rotatePagesCcw'), item('insertBlank'), item('insertFile'), item('extractPages'), item('deletePages')] },
      item('addBookmark'),
      '-',
      item('undo'), item('redo'),
    ], e.clientX, e.clientY);
  }

  showAnnotationMenu(x, y) {
    const c = this.commands;
    const item = (id, extra = {}) => ({ label: t(c.get(id).label), icon: c.get(id).icon, shortcut: c.shortcut(id) || c.get(id).shortcutText, disabled: !c.enabled(id), checked: c.get(id).checked?.(), run: () => c.run(id), ...extra });
    const sel = this.view.selectedAnnots;
    const single = sel.length === 1 ? sel[0] : null;
    showMenu([
      single ? { ...item('editAnnot'), label: single.type === 'freetext' ? t('Text bearbeiten') : t('Kommentar bearbeiten') } : null,
      single && single.type === 'freetext' ? { label: t('Kommentar bearbeiten'), icon: 'MessageSquare', run: () => this.notePopup.open(this.view, this.view.pageViews[this.doc.find(single.id).page], single.id) } : null,
      '-',
      item('cut'), item('copy'), item('duplicate'), item('delete'),
      '-',
      { label: t('Anordnen'), icon: 'Layers', items: [item('bringFront'), item('forward'), item('backward'), item('sendBack')] },
      item('lock'),
      item('copyFormat'),
      '-',
      { label: t('Eigenschaften'), icon: 'PanelRight', run: () => { if (!this.props.isOpen) this.props.toggle(); } },
    ], x, y);
  }

  closeMenus() {
    closeMenus();
  }

  // ------------------------------------------------------------------ global handlers
  #isTyping(target) {
    return !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  #installGlobalHandlers() {
    document.addEventListener('keydown', (e) => this.#onKeyDown(e));
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && this.spaceHand) {
        this.spaceHand = false;
        if (this.view) this.applyToolMode(this.view);
        this.refreshUI();
      }
    });
    window.addEventListener('blur', () => {
      if (this.spaceHand) {
        this.spaceHand = false;
        if (this.view) this.applyToolMode(this.view);
      }
    });
    document.addEventListener('copy', (e) => this.#onCopy(e, false));
    document.addEventListener('cut', (e) => this.#onCopy(e, true));
    document.addEventListener('paste', (e) => this.#onPaste(e));
    window.addEventListener('beforeunload', (e) => {
      if (this.tabs.some((x) => x.doc.modified)) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    // drag & drop files anywhere
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragDepth++;
      this.dropOverlay.classList.add('show');
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) this.dropOverlay.classList.remove('show');
    });
    window.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      dragDepth = 0;
      this.dropOverlay.classList.remove('show');
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      this.#onDropFiles([...e.dataTransfer.files], e);
    });
  }

  async #onDropFiles(files, e) {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    const images = files.filter((f) => f.type.startsWith('image/'));
    for (const f of pdfs) await this.openFile(f);
    if (!images.length) return;
    if (!this.doc || this.doc.readOnly || pdfs.length) {
      const bytes = await withBusy(t('PDF wird erstellt …'), () => imagesToPdf(images, { pageSize: PAGE_SIZES.A4, margin: 20 }));
      await this.openBytes(bytes, `${images[0].name.replace(/\.[^.]+$/, '')}.pdf`);
      return;
    }
    const pv = this.view.pageAtClient(e.clientX, e.clientY);
    if (pv) this.view.goToPage(pv.index, { instant: true });
    for (const img of images) await this.placeImageNow(img);
  }

  #onCopy(e, cut) {
    if (this.#isTyping(e.target) || !this.view?.selection.size) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    e.preventDefault();
    this.commands.copy();
    const text = this.view.selectedAnnots.map((a) => a.text || a.contents || '').filter(Boolean).join('\n');
    this.clipboard.text = text || '​';
    e.clipboardData.setData('text/plain', this.clipboard.text);
    if (cut) this.commands.deleteSel();
  }

  async #onPaste(e) {
    if (this.#isTyping(e.target) || !this.doc || this.doc.readOnly) return;
    const items = [...(e.clipboardData?.items || [])];
    const text = e.clipboardData?.getData('text/plain') || '';
    if (this.clipboard && (text === this.clipboard.text || (!text && !items.some((i) => i.type.startsWith('image/'))))) {
      e.preventDefault();
      this.commands.pasteInternal();
      return;
    }
    const imgItem = items.find((i) => i.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      await this.placeImageNow(imgItem.getAsFile());
      return;
    }
    if (text.trim()) {
      e.preventDefault();
      this.pasteText(text.replace(/\r\n?/g, '\n'));
    }
  }

  #onKeyDown(e) {
    if (document.querySelector('.backdrop')) return; // modal dialog handles its own keys
    const target = e.target;
    const combo = comboOf(e);
    if (this.backstage.isOpen) {
      if (e.key === 'Escape') { e.preventDefault(); this.backstage.close(); return; }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) return;
    }
    if (this.#isTyping(target)) {
      if (combo === 'Ctrl+S' || combo === 'Ctrl+Shift+S' || combo === 'Ctrl+O' || combo === 'Ctrl+P') {
        e.preventDefault();
        this.commands.run(this.commands.keymap.get(combo));
      }
      return;
    }
    if (document.querySelector('.menu') && e.key === 'Escape') { closeMenus(); return; }
    const view = this.view;
    if (e.code === 'Space' && !e.ctrlKey && !e.altKey && view) {
      e.preventDefault();
      if (!this.spaceHand) {
        this.spaceHand = true;
        this.applyToolMode(view);
        this.refreshUI();
      }
      return;
    }
    if (view && this.tools.active.onKeyDown?.(e, view)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (this.notePopup.active) { this.notePopup.close(); return; }
      this.tools.active.cancel?.();
      if (view?.selection.size) view.clearSelection();
      else if (!this.tools.defs.get(this.tools.activeId).nav) this.tools.setTool(this.tools.lastNav);
      else if (!this.findbar.el.hidden) this.findbar.close();
      window.getSelection()?.removeAllRanges();
      return;
    }
    if (view?.selection.size && e.key.startsWith('Arrow') && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      this.#nudge(e);
      return;
    }
    if ((combo === 'Delete' || combo === 'Backspace') && !view?.selection.size) return;
    if ((combo === 'Enter' || combo === 'F2') && !view?.selection.size) return;
    if ((combo === 'Home' || combo === 'End') && target.closest?.('.thumbs, .side-content')) return;
    const id = this.commands.keymap.get(combo);
    if (id) {
      e.preventDefault();
      this.commands.run(id);
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && this.doc) {
      const def = [...this.tools.defs.values()].find((d) => d.key === e.key.toLowerCase());
      if (def && (def.nav || !this.doc.readOnly)) {
        e.preventDefault();
        this.tools.setTool(def.id);
      }
    }
  }

  #nudge(e) {
    const view = this.view;
    const pv = view.pageViews[view.selectionPage];
    if (!pv) return;
    const step = (e.shiftKey ? 10 : 1) * pv.scale;
    const [sx, sy] = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key] || [0, 0];
    const a = pv.toPdf(0, 0), b = pv.toPdf(sx, sy);
    const now = Date.now();
    const history = now - (this.lastNudge || 0) > 1000;
    this.lastNudge = now;
    view.doc.translate([...view.selection], b[0] - a[0], b[1] - a[1], { history, label: 'Verschieben' });
  }
}

