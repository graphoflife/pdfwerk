// Feature dialogs (page operations, watermark, header/footer, stamps, signatures, settings …).
import { PDFDocument } from 'pdf-lib';
import {
  h, openDialog, field, select, parseRange, formatRange, toast, withBusy, colorControl, confirmDialog, downloadBlob,
} from './dom.js';
import { icon } from './icons.js';
import { t, setLang, getLang } from '../i18n.js';
import { PAGE_SIZES } from '../core/page-ops.js';
import { pickFiles } from '../core/file-io.js';
import { UNITS } from '../core/model.js';
import { annotationsSvg } from '../viewer/svg.js';
import { createAnnotation } from '../core/model.js';
import { makeZip } from '../core/zip.js';
import { displayKey } from '../commands.js';
import { TOOL_DEFS } from '../tools/index.js';

const CANCEL = { label: 'Abbrechen', value: null };
const btns = (ok, danger = false) => [{ ...CANCEL, label: t(CANCEL.label) }, { label: ok, value: true, primary: true, danger }];
const mmToPt = (mm) => (mm * 72) / 25.4;

export const STAMPS = [
  { label: 'GENEHMIGT', en: 'APPROVED', color: [0.1, 0.55, 0.2] },
  { label: 'GEPRÜFT', en: 'REVIEWED', color: [0.1, 0.55, 0.2] },
  { label: 'ERLEDIGT', en: 'COMPLETED', color: [0.1, 0.55, 0.2] },
  { label: 'BEZAHLT', en: 'PAID', color: [0.1, 0.55, 0.2] },
  { label: 'FINAL', en: 'FINAL', color: [0.1, 0.55, 0.2] },
  { label: 'ABGELEHNT', en: 'REJECTED', color: [0.8, 0.1, 0.1] },
  { label: 'NICHT GENEHMIGT', en: 'NOT APPROVED', color: [0.8, 0.1, 0.1] },
  { label: 'VERTRAULICH', en: 'CONFIDENTIAL', color: [0.8, 0.1, 0.1] },
  { label: 'ENTWURF', en: 'DRAFT', color: [0.15, 0.3, 0.75] },
  { label: 'KOPIE', en: 'COPY', color: [0.15, 0.3, 0.75] },
  { label: 'ZUR KENNTNIS', en: 'FOR INFORMATION', color: [0.15, 0.3, 0.75] },
  { label: 'EINGEGANGEN', en: 'RECEIVED', color: [0.15, 0.3, 0.75], dated: true },
];

export class Dialogs {
  constructor(app) {
    this.app = app;
  }

  get doc() { return this.app.doc; }
  get view() { return this.app.view; }

  #rangeInput(defaultIndices) {
    const input = h('input', { class: 'input', value: formatRange(defaultIndices) });
    const all = h('button', { class: 'btn small', type: 'button', text: t('Alle'), onclick: () => { input.value = formatRange([...Array(this.doc.numPages).keys()]); } });
    const cur = h('button', { class: 'btn small', type: 'button', text: t('Aktuelle'), onclick: () => { input.value = String(this.view.current + 1); } });
    const wrap = field(t('Seiten'), h('div', { class: 'inline' }, input, cur, all), t('z. B. 1-3, 5, 8-  ·  „gerade“ / „ungerade“'));
    return { el: wrap, get: () => parseRange(input.value, this.doc.numPages) };
  }

  #pagesOrToast(range) {
    const v = range.get();
    if (!v || !v.length) {
      toast(t('Ungültiger Seitenbereich.'), { type: 'error' });
      return undefined;
    }
    return v;
  }

  // ------------------------------------------------------------------ file
  async newBlank() {
    const size = select(Object.keys(PAGE_SIZES).map((k) => [k, k]), 'A4');
    const orient = select([['portrait', t('Hochformat')], ['landscape', t('Querformat')]], 'portrait');
    const count = h('input', { class: 'input num', type: 'number', min: 1, max: 500, value: 1 });
    const ok = await openDialog({
      title: t('Neues leeres PDF'), body: h('div', { class: 'form' }, field(t('Format'), size), field(t('Ausrichtung'), orient), field(t('Seitenanzahl'), count)),
      buttons: btns(t('Erstellen')),
    });
    if (!ok) return;
    let [w, hh] = PAGE_SIZES[size.value];
    if (orient.value === 'landscape') [w, hh] = [hh, w];
    const lib = await PDFDocument.create();
    for (let i = 0; i < Math.max(1, Math.min(500, +count.value || 1)); i++) lib.addPage([w, hh]);
    await this.app.openBytes(await lib.save(), `${t('Neu')}.pdf`);
  }

  async docProperties() {
    const doc = this.doc;
    const m = doc.meta;
    const inp = (v) => h('input', { class: 'input', value: v || '', disabled: doc.readOnly });
    const title = inp(m.title), author = inp(m.author), subject = inp(m.subject), keywords = inp(m.keywords);
    const p = doc.pages[0];
    const mm = (v) => Math.round((v * 25.4) / 72);
    const info = h('div', { class: 'kv-list' },
      ...[[t('Datei'), doc.name], [t('Seiten'), doc.numPages], [t('Seitengröße (S. 1)'), `${mm(p.view[2] - p.view[0])} × ${mm(p.view[3] - p.view[1])} mm`],
        [t('Ersteller'), m.creator || '–'], [t('Erzeugt mit'), m.producer || '–'], [t('Geschützt'), doc.readOnly ? t('Ja') : t('Nein')]]
        .map(([k, v]) => h('div', { class: 'kv' }, h('span', { text: k }), h('b', { text: String(v) }))));
    const ok = await openDialog({
      title: t('Dokumenteigenschaften'), width: 520,
      body: h('div', { class: 'form' }, field(t('Titel'), title), field(t('Autor'), author), field(t('Betreff'), subject), field(t('Stichwörter'), keywords, t('Durch Kommas getrennt')), info),
      buttons: doc.readOnly ? [{ label: t('Schließen'), value: null }] : btns(t('Übernehmen')),
    });
    if (ok) doc.setMeta({ title: title.value, author: author.value, subject: subject.value, keywords: keywords.value });
  }

  async settings() {
    const app = this.app;
    const author = h('input', { class: 'input', value: app.prefs.get('author', '') });
    const lang = select([['de', 'Deutsch'], ['en', 'English']], getLang());
    const theme = select([['system', t('System')], ['light', t('Hell')], ['dark', t('Dunkel')]], app.prefs.get('theme', 'light'));
    const zoom = select([['width', t('Seitenbreite')], ['page', t('Ganze Seite')], ['100', '100 %']], app.prefs.get('defaultZoom', 'width') || '100');
    const layout = select([['continuous', t('Fortlaufend')], ['single', t('Einzelseite')], ['two', t('Doppelseite')]], app.prefs.get('layout', 'continuous'));
    const sticky = h('input', { type: 'checkbox', checked: app.tools.sticky });
    const ok = await openDialog({
      title: t('Einstellungen'), width: 480,
      body: h('div', { class: 'form' },
        field(t('Autorname für Anmerkungen'), author),
        field(t('Sprache'), lang),
        field(t('Design'), theme),
        field(t('Standard-Zoom'), zoom),
        field(t('Standard-Seitenanzeige'), layout),
        h('label', { class: 'check' }, sticky, h('span', { text: t('Werkzeug nach dem Zeichnen beibehalten') }))),
      buttons: btns(t('Speichern')),
    });
    if (!ok) return;
    app.prefs.set('author', author.value.trim());
    app.prefs.set('theme', theme.value);
    app.prefs.set('defaultZoom', zoom.value === '100' ? null : zoom.value);
    app.prefs.set('layout', layout.value);
    app.tools.setSticky(sticky.checked);
    app.applyTheme();
    if (lang.value !== getLang()) {
      app.prefs.set('lang', lang.value);
      setLang(lang.value);
      app.rebuildUI();
    }
  }

  async askAuthor() {
    const input = h('input', { class: 'input', value: this.app.prefs.get('author', '') });
    const v = await openDialog({
      title: t('Wie heißt du?'),
      body: h('div', { class: 'form' }, h('p', { text: t('Dein Name wird als Autor bei Anmerkungen gespeichert. Du kannst ihn jederzeit in den Einstellungen ändern.') }), field(t('Name'), input)),
      buttons: btns(t('OK')), collect: () => input.value.trim(),
    });
    if (v != null) this.app.prefs.set('author', v);
  }

  shortcuts() {
    const c = this.app.commands;
    const rows = [];
    const sec = (title) => rows.push(h('tr', { class: 'sc-sec' }, h('td', { colspan: 2, text: t(title) })));
    const row = (keys, label) => rows.push(h('tr', {}, h('td', {}, ...String(keys).split(' / ').map((k) => h('kbd', { text: displayKey(k) }))), h('td', { text: t(label) })));
    sec('Werkzeuge');
    for (const d of TOOL_DEFS) if (d.key) row(d.key.toUpperCase(), d.label);
    row('Space', 'Leertaste halten: vorübergehend Hand');
    row('Esc', 'Abbrechen / Auswahl aufheben / zurück zur Hand');
    sec('Zeichnen mit Modifikatoren');
    row('Shift', 'Linien, Pfeile, Polygone, Messungen: in 45°-Schritten (0°/45°/90°) einrasten');
    row('Shift', 'Rechteck/Ellipse: Quadrat/Kreis · Freihand: gerade Linie');
    row('Alt', 'Rechteck/Ellipse vom Mittelpunkt aus aufziehen');
    row('Shift', 'Verschieben: nur waagrecht/senkrecht · Skalieren: Seitenverhältnis halten');
    row('Ctrl', 'Ziehen mit Strg: Anmerkung duplizieren');
    row('Shift / Ctrl', 'Klick: Auswahl erweitern');
    row('ArrowUp', 'Pfeiltasten: Auswahl um 1 pt verschieben (mit Shift 10 pt)');
    row('Enter', 'Polylinie/Polygon abschließen · Kommentar der Auswahl bearbeiten');
    row('Backspace', 'Beim Polygon-Zeichnen: letzten Punkt entfernen');
    const groups = {
      'Datei': ['fileMenu', 'open', 'new', 'save', 'saveAs', 'print', 'properties', 'close', 'settings', 'quickLaunch'],
      'Bearbeiten': ['undo', 'redo', 'copy', 'cut', 'paste', 'delete', 'selectAll', 'bringFront', 'sendBack', 'forward', 'backward', 'editAnnot'],
      'Ansicht': ['zoomIn', 'zoomOut', 'zoomTo', 'fitPage', 'actualSize', 'fitWidth', 'rotateViewCw', 'rotateViewCcw', 'layoutSingle', 'layoutContinuous', 'layoutTwo', 'firstPage', 'lastPage', 'prevPage', 'nextPage', 'goToPage', 'find', 'findNext', 'findPrev', 'fullscreen'],
      'Bereiche': ['panelBookmarks', 'panelThumbs', 'panelComments', 'toggleLeft', 'toggleRight', 'showAnnots', 'toggleAnnots'],
      'Seiten': ['rotatePagesCw', 'rotatePagesCcw', 'deletePages', 'insertFile', 'extractPages', 'cropPages', 'addBookmark', 'scaleSettings'],
    };
    for (const [g, ids] of Object.entries(groups)) {
      sec(g);
      for (const id of ids) {
        const cmd = c.get(id);
        const keys = (cmd.keys || (cmd.shortcutText ? [cmd.shortcutText] : [])).join(' / ');
        if (keys) row(keys, cmd.label.replace(/ …$/, ''));
      }
    }
    row('Ctrl+Mausrad', 'Zoomen');
    openDialog({ title: t('Tastenkürzel'), width: 640, cls: 'shortcuts', body: h('table', { class: 'sc-table' }, ...rows), buttons: [{ label: t('Schließen'), value: true, primary: true }] });
  }

  about() {
    openDialog({
      title: t('Über PDFwerk'), width: 480,
      body: h('div', { class: 'about' },
        h('div', { class: 'about-logo' }, icon('FileText', 40), h('div', {}, h('h3', { text: 'PDFwerk' }), h('div', { class: 'hint', text: `Version ${__APP_VERSION__}` }))),
        h('p', { text: t('Freier PDF-Editor, der komplett im Browser läuft. Deine Dateien verlassen nie deinen Rechner.') }),
        h('p', {}, t('Lizenz: '), h('b', { text: 'MIT' })),
        h('p', { class: 'hint', text: t('Verwendet pdf.js (Apache-2.0), pdf-lib (MIT) und Lucide-Icons (ISC).') }),
        h('p', {}, h('a', { href: 'https://github.com/', target: '_blank', rel: 'noopener', id: 'about-repo' }, icon('Github', 14), ' GitHub'))),
      buttons: [{ label: t('Schließen'), value: true, primary: true }],
    });
  }

  // ------------------------------------------------------------------ pages
  async rotatePages() {
    const range = this.#rangeInput(this.app.targetPages());
    const angle = select([['90', t('90° im Uhrzeigersinn')], ['-90', t('90° gegen den Uhrzeigersinn')], ['180', '180°']], '90');
    const ok = await openDialog({ title: t('Seiten drehen'), body: h('div', { class: 'form' }, range.el, field(t('Richtung'), angle)), buttons: btns(t('Drehen')), collect: () => this.#pagesOrToast(range) });
    if (!ok) return;
    await withBusy(t('Seiten drehen'), () => this.doc.rotatePages(ok, +angle.value));
  }

  async deletePages(preset) {
    const doc = this.doc;
    if (!doc || doc.readOnly) return;
    const range = this.#rangeInput(preset || this.app.targetPages());
    const pages = await openDialog({ title: t('Seiten löschen'), body: h('div', { class: 'form' }, range.el), buttons: btns(t('Löschen'), true), collect: () => this.#pagesOrToast(range) });
    if (!pages) return;
    if (pages.length >= doc.numPages) {
      toast(t('Es muss mindestens eine Seite übrig bleiben.'), { type: 'error' });
      return;
    }
    await withBusy(t('Seiten löschen'), () => doc.deletePages(pages));
    this.app.left.thumbs.selected.clear();
    toast(t('{n} Seite(n) gelöscht.', { n: pages.length }));
  }

  #positionControl(defaultPos = 'after') {
    const pos = select([['before', t('Vor Seite')], ['after', t('Nach Seite')], ['start', t('Am Anfang')], ['end', t('Am Ende')]], defaultPos);
    const page = h('input', { class: 'input num', type: 'number', min: 1, max: this.doc.numPages, value: this.view.current + 1 });
    pos.addEventListener('change', () => { page.disabled = pos.value === 'start' || pos.value === 'end'; });
    page.disabled = defaultPos === 'start' || defaultPos === 'end';
    return {
      el: field(t('Position'), h('div', { class: 'inline' }, pos, page)),
      get: () => {
        const n = Math.max(1, Math.min(this.doc.numPages, +page.value || 1));
        return { before: n - 1, after: n, start: 0, end: this.doc.numPages }[pos.value];
      },
    };
  }

  async insertBlank() {
    const doc = this.doc;
    const cur = doc.pages[this.view.current];
    const size = select([['same', t('Wie aktuelle Seite')], ...Object.keys(PAGE_SIZES).map((k) => [k, k])], 'same');
    const orient = select([['portrait', t('Hochformat')], ['landscape', t('Querformat')]], 'portrait');
    const count = h('input', { class: 'input num', type: 'number', min: 1, max: 200, value: 1 });
    const pos = this.#positionControl('after');
    const ok = await openDialog({ title: t('Leere Seiten einfügen'), body: h('div', { class: 'form' }, field(t('Anzahl'), count), field(t('Format'), size), field(t('Ausrichtung'), orient), pos.el), buttons: btns(t('Einfügen')) });
    if (!ok) return;
    let dims;
    if (size.value === 'same') {
      const [x1, y1, x2, y2] = cur.view;
      dims = cur.rotate % 180 ? [y2 - y1, x2 - x1] : [x2 - x1, y2 - y1];
    } else {
      dims = [...PAGE_SIZES[size.value]];
      if (orient.value === 'landscape') dims.reverse();
    }
    const at = pos.get();
    await withBusy(t('Seiten einfügen'), () => doc.insertBlankPages(at, Math.max(1, +count.value || 1), dims));
    this.view.goToPage(at);
  }

  async insertFromFile({ atEnd = false, multiple = false } = {}) {
    const files = await pickFiles({ kind: 'pdf', multiple });
    if (!files.length) return;
    const doc = this.doc;
    const pos = this.#positionControl(atEnd ? 'end' : 'after');
    const srcRange = h('input', { class: 'input', value: t('alle') });
    const ok = await openDialog({
      title: t('Seiten einfügen'),
      body: h('div', { class: 'form' },
        h('p', { class: 'hint', text: files.map((f) => f.file.name).join(', ') }),
        files.length === 1 ? field(t('Seiten der Quelldatei'), srcRange, t('z. B. 1-3, 5 oder „alle“')) : null,
        pos.el),
      buttons: btns(t('Einfügen')),
    });
    if (!ok) return;
    let at = pos.get();
    try {
      await withBusy(t('Seiten einfügen'), async () => {
        for (const { file } of files) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          let idx = null;
          if (files.length === 1) {
            const src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
            idx = parseRange(srcRange.value, src.getPageCount());
            if (!idx?.length) throw new Error(t('Ungültiger Seitenbereich.'));
          }
          const before = doc.numPages;
          await doc.insertPdf(bytes, at, idx);
          at += doc.numPages - before;
        }
      });
      toast(t('Seiten eingefügt.'), { type: 'success' });
    } catch (e) {
      toast(e.message === 'encrypted' ? t('Verschlüsselte PDFs können nicht eingefügt werden.') : `${t('Fehler')}: ${e.message}`, { type: 'error', timeout: 6000 });
    }
  }

  async extractPages() {
    const doc = this.doc;
    const range = this.#rangeInput(this.app.targetPages());
    const del = h('input', { type: 'checkbox' });
    const ok = await openDialog({
      title: t('Seiten extrahieren'),
      body: h('div', { class: 'form' }, range.el, doc.readOnly ? null : h('label', { class: 'check' }, del, h('span', { text: t('Seiten danach aus diesem Dokument löschen') }))),
      buttons: btns(t('Extrahieren')), collect: () => this.#pagesOrToast(range),
    });
    if (!ok) return;
    const bytes = await withBusy(t('Seiten extrahieren'), () => doc.extract(ok));
    const name = `${doc.name.replace(/\.pdf$/i, '')}_S${formatRange(ok).replace(/[ ,]+/g, '_')}.pdf`;
    const open = await confirmDialog(t('Extrahierte Seiten in neuem Tab öffnen? (Sonst wird die Datei heruntergeladen.)'), { ok: t('Öffnen') });
    if (open) await this.app.openBytes(bytes, name);
    else downloadBlob(bytes, name);
    if (del.checked && ok.length < doc.numPages) await withBusy(t('Seiten löschen'), () => doc.deletePages(ok));
  }

  async splitDocument() {
    const doc = this.doc;
    const mode = select([['every', t('Alle N Seiten')], ['bookmarks', t('An Lesezeichen der obersten Ebene')]], 'every');
    const n = h('input', { class: 'input num', type: 'number', min: 1, value: 1 });
    const ok = await openDialog({ title: t('Dokument teilen'), body: h('div', { class: 'form' }, field(t('Teilen'), mode), field(t('Seiten pro Datei'), n), h('p', { class: 'hint', text: t('Die Teile werden als ZIP-Datei heruntergeladen.') })), buttons: btns(t('Teilen')) });
    if (!ok) return;
    const parts = [];
    if (mode.value === 'bookmarks') {
      const starts = [...new Set(doc.outline.map((b) => b.pageIndex).filter((x) => x != null))].sort((a, b) => a - b);
      if (!starts.length) return toast(t('Keine Lesezeichen vorhanden.'), { type: 'error' });
      if (starts[0] !== 0) starts.unshift(0);
      starts.forEach((s, i) => parts.push([...Array((starts[i + 1] ?? doc.numPages) - s).keys()].map((k) => s + k)));
    } else {
      const size = Math.max(1, +n.value || 1);
      for (let s = 0; s < doc.numPages; s += size) parts.push([...Array(Math.min(size, doc.numPages - s)).keys()].map((k) => s + k));
    }
    await withBusy(t('Dokument teilen'), async () => {
      const full = await PDFDocument.load(await doc.save(), { updateMetadata: false });
      const base = doc.name.replace(/\.pdf$/i, '');
      const files = [];
      for (const [i, idx] of parts.entries()) {
        const out = await PDFDocument.create();
        (await out.copyPages(full, idx)).forEach((p) => out.addPage(p));
        files.push({ name: `${base}_${String(i + 1).padStart(3, '0')}.pdf`, data: await out.save() });
      }
      downloadBlob(makeZip(files), `${base}_geteilt.zip`, 'application/zip');
    });
  }

  async movePages() {
    const doc = this.doc;
    const range = this.#rangeInput(this.app.targetPages());
    const pos = this.#positionControl('after');
    const ok = await openDialog({ title: t('Seiten verschieben'), body: h('div', { class: 'form' }, range.el, pos.el), buttons: btns(t('Verschieben')), collect: () => this.#pagesOrToast(range) });
    if (!ok) return;
    await withBusy(t('Seiten verschieben'), () => doc.movePages(ok, pos.get()));
  }

  async cropPages() {
    const doc = this.doc;
    const range = this.#rangeInput(this.app.targetPages());
    const num = (v) => h('input', { class: 'input num', type: 'number', min: 0, step: 0.5, value: v });
    const top = num(10), right = num(10), bottom = num(10), left = num(10);
    const ok = await openDialog({
      title: t('Seiten zuschneiden'),
      body: h('div', { class: 'form' },
        h('p', { class: 'hint', text: t('Ränder in Millimetern, die von der sichtbaren Seite entfernt werden.') }),
        h('div', { class: 'grid2' }, field(t('Oben'), top), field(t('Unten'), bottom), field(t('Links'), left), field(t('Rechts'), right)),
        range.el),
      buttons: btns(t('Zuschneiden')), collect: () => this.#pagesOrToast(range),
    });
    if (!ok) return;
    const m = { top: mmToPt(+top.value || 0), right: mmToPt(+right.value || 0), bottom: mmToPt(+bottom.value || 0), left: mmToPt(+left.value || 0) };
    await withBusy(t('Seiten zuschneiden'), () => doc.cropPages(ok, m));
  }

  async watermark() {
    const doc = this.doc;
    const range = this.#rangeInput([...Array(doc.numPages).keys()]);
    const text = h('input', { class: 'input', value: t('VERTRAULICH') });
    const font = select([['Helvetica', 'Helvetica'], ['Times', 'Times'], ['Courier', 'Courier']], 'Helvetica');
    const bold = h('input', { type: 'checkbox', checked: true });
    const fit = h('input', { type: 'checkbox', checked: true });
    const size = h('input', { class: 'input num', type: 'number', min: 6, max: 400, value: 60 });
    const rot = h('input', { class: 'input num', type: 'number', min: -180, max: 180, value: 45 });
    const opacity = h('input', { type: 'range', min: 5, max: 100, value: 25 });
    const pos = select([['center', t('Mitte')], ['top', t('Oben')], ['bottom', t('Unten')]], 'center');
    let color = [0.8, 0.1, 0.1];
    const ok = await openDialog({
      title: t('Wasserzeichen hinzufügen'), width: 520,
      body: h('div', { class: 'form' },
        field(t('Text'), text),
        h('div', { class: 'grid2' }, field(t('Schrift'), font), h('label', { class: 'check' }, bold, h('span', { text: t('Fett') }))),
        h('div', { class: 'grid2' }, field(t('Größe (pt)'), size), h('label', { class: 'check' }, fit, h('span', { text: t('An Seite anpassen') }))),
        h('div', { class: 'grid2' }, field(t('Drehung (°)'), rot), field(t('Position'), pos)),
        field(t('Farbe'), colorControl(color, (c) => { color = c; })),
        field(t('Deckkraft'), opacity),
        range.el,
        h('p', { class: 'hint', text: t('Das Wasserzeichen wird fest in den Seiteninhalt geschrieben (rückgängig machbar mit Strg+Z).') })),
      buttons: btns(t('Hinzufügen')), collect: () => (text.value.trim() ? this.#pagesOrToast(range) : undefined),
    });
    if (!ok) return;
    await withBusy(t('Wasserzeichen'), () => doc.addWatermark(ok, {
      text: text.value, font: font.value, bold: bold.checked, size: +size.value || 60, fit: fit.checked,
      rotation: +rot.value || 0, opacity: +opacity.value / 100, color, position: pos.value,
    }));
  }

  async headerFooter() {
    const doc = this.doc;
    const range = this.#rangeInput([...Array(doc.numPages).keys()]);
    const slot = (v = '') => h('input', { class: 'input', value: v });
    const slots = { tl: slot(), tc: slot(), tr: slot(), bl: slot(), bc: slot(t('Seite {page} von {pages}')), br: slot() };
    const size = h('input', { class: 'input num', type: 'number', min: 5, max: 48, value: 10 });
    const margin = h('input', { class: 'input num', type: 'number', min: 0, max: 100, value: 10 });
    const start = h('input', { class: 'input num', type: 'number', min: 0, value: 1 });
    const font = select([['Helvetica', 'Helvetica'], ['Times', 'Times'], ['Courier', 'Courier']], 'Helvetica');
    let color = [0, 0, 0];
    const preset = select([
      ['', t('Vorlage wählen …')], ['p', t('Seitenzahl unten Mitte')], ['pn', t('„Seite X von Y“ unten rechts')], ['date', t('Datum oben rechts')], ['title', t('Titel oben Mitte')],
    ], '');
    preset.addEventListener('change', () => {
      const v = preset.value;
      if (v === 'p') { slots.bc.value = '{page}'; }
      if (v === 'pn') { slots.br.value = t('Seite {page} von {pages}'); slots.bc.value = ''; }
      if (v === 'date') slots.tr.value = '{date}';
      if (v === 'title') slots.tc.value = '{title}';
    });
    const ok = await openDialog({
      title: t('Kopf-/Fußzeile & Seitenzahlen'), width: 620,
      body: h('div', { class: 'form' },
        field(t('Vorlage'), preset),
        h('div', { class: 'hf-grid' },
          h('span', { text: t('Kopfzeile') }), slots.tl, slots.tc, slots.tr,
          h('span', { text: t('Fußzeile') }), slots.bl, slots.bc, slots.br),
        h('p', { class: 'hint', text: t('Platzhalter: {page} Seitenzahl, {pages} Gesamtzahl, {date} Datum, {title} Titel, {file} Dateiname') }),
        h('div', { class: 'grid3' }, field(t('Schrift'), font), field(t('Größe (pt)'), size), field(t('Randabstand (mm)'), margin)),
        h('div', { class: 'grid2' }, field(t('Erste Seitenzahl'), start), field(t('Farbe'), colorControl(color, (c) => { color = c; }))),
        range.el),
      buttons: btns(t('Hinzufügen')), collect: () => this.#pagesOrToast(range),
    });
    if (!ok) return;
    const s = Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v.value]));
    await withBusy(t('Kopf-/Fußzeile'), () => doc.addHeaderFooter(ok, {
      slots: s, size: +size.value || 10, margin: mmToPt(+margin.value || 0), start: +start.value || 1, color, font: font.value,
      title: doc.meta.title || doc.name.replace(/\.pdf$/i, ''), file: doc.name, locale: getLang() === 'de' ? 'de-DE' : 'en-US',
    }));
  }

  async exportImages() {
    const range = this.#rangeInput([this.view.current]);
    const dpi = select([['72', '72 dpi'], ['150', '150 dpi'], ['200', '200 dpi'], ['300', '300 dpi'], ['600', '600 dpi']], '150');
    const fmt = select([['png', 'PNG'], ['jpg', 'JPEG']], 'png');
    const ok = await openDialog({ title: t('Seiten als Bilder exportieren'), body: h('div', { class: 'form' }, range.el, h('div', { class: 'grid2' }, field(t('Auflösung'), dpi), field(t('Format'), fmt)), h('p', { class: 'hint', text: t('Mehrere Seiten werden als ZIP heruntergeladen.') })), buttons: btns(t('Exportieren')), collect: () => this.#pagesOrToast(range) });
    if (!ok) return;
    await this.app.commands.exportImages(ok, { dpi: +dpi.value, format: fmt.value });
  }

  async measureScale() {
    const app = this.app;
    const st = app.tools.styleFor('distance').measure || { ratio: 1, unit: 'mm' };
    const ratio = h('input', { class: 'input num', type: 'number', min: 0.0001, step: 'any', value: st.ratio });
    const unit = select(Object.keys(UNITS).map((u) => [u, UNITS[u].label]), st.unit);
    const applySel = h('input', { type: 'checkbox', checked: true });
    const ok = await openDialog({
      title: t('Maßstab für Messungen'),
      body: h('div', { class: 'form' },
        h('p', { class: 'hint', text: t('Beispiel: Bei einem Plan im Maßstab 1:100 trägst du 100 ein und wählst „m“ als Einheit.') }),
        h('div', { class: 'grid2' }, field(t('Maßstab 1 :'), ratio), field(t('Einheit'), unit)),
        app.view?.selectedAnnots.some((a) => a.type === 'measure') ? h('label', { class: 'check' }, applySel, h('span', { text: t('Auch auf ausgewählte Messungen anwenden') })) : null),
      buttons: btns(t('Übernehmen')),
    });
    if (!ok) return;
    const m = { ratio: +ratio.value || 1, unit: unit.value };
    for (const id of ['distance', 'perimeter', 'area']) app.tools.setStyle(id, { measure: m });
    const sel = app.view?.selectedAnnots.filter((a) => a.type === 'measure') || [];
    if (sel.length && applySel.checked) app.doc.update(sel.map((a) => a.id), (n) => { n.measure = { ...n.measure, ...m }; }, { label: 'Maßstab' });
  }

  // ------------------------------------------------------------------ stamps & signatures
  async pickStamp() {
    const app = this.app;
    const en = getLang() !== 'de';
    const withDate = h('input', { type: 'checkbox', checked: app.prefs.get('stampDate', false) });
    const custom = h('input', { class: 'input', placeholder: t('Eigener Stempeltext …') });
    let customColor = [0.8, 0.1, 0.1];
    const grid = h('div', { class: 'stamp-grid' });
    let chosen = null;
    const close = { fn: null };
    const sub = () => {
      if (!withDate.checked) return null;
      const author = app.prefs.get('author', '');
      const d = new Date().toLocaleString(en ? 'en-US' : 'de-DE', { dateStyle: 'short', timeStyle: 'short' });
      return author ? `${author}, ${d}` : d;
    };
    const preview = (label, color, s) => {
      const a = createAnnotation('stamp', { rect: [0, 0, 160, 44], stamp: { kind: 'text', label, sub: s }, color, width: 0 });
      return annotationsSvg([a], null, { width: 160, height: 44, transform: [1, 0, 0, -1, 0, 44] });
    };
    for (const st of STAMPS) {
      const label = en ? st.en : st.label;
      grid.append(h('button', {
        class: 'stamp-btn', type: 'button', title: label,
        onclick: () => { chosen = { label, color: st.color, dated: st.dated }; close.fn?.(true); },
      }, preview(label, st.color, st.dated ? '01.01.2026' : null)));
    }
    const ok = await openDialog({
      title: t('Stempel wählen'), width: 600,
      body: h('div', { class: 'form' }, grid,
        h('label', { class: 'check' }, withDate, h('span', { text: t('Name und Datum hinzufügen') })),
        h('div', { class: 'inline' }, custom, colorControl(customColor, (c) => { customColor = c; }))),
      buttons: [{ label: t('Abbrechen'), value: null }, { label: t('Eigenen Stempel verwenden'), value: 'custom', primary: true }],
      onOpen: (_dlg, c) => { close.fn = c; },
      collect: () => (custom.value.trim() ? 'custom' : undefined),
    });
    if (!ok) return;
    if (ok === 'custom') chosen = { label: custom.value.trim().toUpperCase(), color: customColor };
    if (!chosen) return;
    app.prefs.set('stampDate', withDate.checked);
    const s = chosen.dated || withDate.checked ? sub() || new Date().toLocaleDateString() : null;
    const w = Math.max(90, chosen.label.length * 11 + 30);
    app.tools.setTool('stamp', { payload: { stamp: { kind: 'text', label: chosen.label, sub: s }, color: chosen.color, size: [w, 40] } });
  }

  async signature() {
    const app = this.app;
    const saved = app.prefs.get('signatures', []);
    let result = null;
    const tabs = h('div', { class: 'seg tabs' });
    const body = h('div', { class: 'sig-body' });
    const savedList = h('div', { class: 'sig-saved' });
    const keep = h('input', { type: 'checkbox', checked: true });
    let mode = saved.length ? 'saved' : 'draw';
    let current = null; // () => Promise<{dataUrl}>
    let ink = '#1a2a6c';

    const renderSaved = () => {
      savedList.replaceChildren(...saved.map((s, i) => h('div', { class: 'sig-item' },
        h('button', { class: 'sig-pick', type: 'button', title: t('Verwenden'), onclick: () => { result = s; closeFn(true); } }, h('img', { src: s, alt: '' })),
        h('button', { class: 'icon-btn', type: 'button', title: t('Löschen'), onclick: () => { saved.splice(i, 1); app.prefs.set('signatures', saved); renderSaved(); } }, icon('Trash2', 14)))));
      if (!saved.length) savedList.append(h('div', { class: 'empty', text: t('Noch keine gespeicherten Unterschriften.') }));
    };

    const drawPane = () => {
      const canvas = h('canvas', { class: 'sig-canvas', width: 900, height: 300 });
      const ctx = canvas.getContext('2d');
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      let drawing = false, last = null, dirty = false;
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
      };
      canvas.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = pos(e);
        ctx.strokeStyle = ink;
        ctx.lineWidth = 4 + (e.pressure && e.pointerType === 'pen' ? e.pressure * 4 : 1.5);
        ctx.beginPath();
        ctx.moveTo(...last);
        ctx.quadraticCurveTo(last[0], last[1], (last[0] + p[0]) / 2, (last[1] + p[1]) / 2);
        ctx.lineTo(...p);
        ctx.stroke();
        last = p;
        dirty = true;
      });
      canvas.addEventListener('pointerup', () => { drawing = false; });
      current = async () => (dirty ? trimCanvas(canvas) : null);
      const colors = h('div', { class: 'inline' }, ...['#1a2a6c', '#000000', '#0b57d0'].map((c) => h('button', { class: 'swatch', type: 'button', style: { background: c }, onclick: () => { ink = c; } })),
        h('button', { class: 'btn small', type: 'button', text: t('Leeren'), onclick: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; } }));
      return h('div', {}, canvas, colors, h('p', { class: 'hint', text: t('Mit Maus, Stift oder Finger unterschreiben.') }));
    };

    const typePane = () => {
      const input = h('input', { class: 'input', value: app.prefs.get('author', ''), placeholder: t('Name') });
      const fonts = ["'Segoe Script', 'Brush Script MT', 'Lucida Handwriting', cursive", "'Brush Script MT', 'Snell Roundhand', cursive", "'Lucida Handwriting', 'Apple Chancery', cursive"];
      let font = fonts[0];
      const prev = h('div', { class: 'sig-type-prev', style: { fontFamily: font, color: ink } });
      const upd = () => { prev.textContent = input.value || ' '; prev.style.fontFamily = font; };
      input.addEventListener('input', upd);
      upd();
      const sel = h('div', { class: 'inline' }, ...fonts.map((f, i) => h('button', { class: 'btn small', type: 'button', style: { fontFamily: f }, text: `${t('Stil')} ${i + 1}`, onclick: () => { font = f; upd(); } })));
      current = async () => {
        if (!input.value.trim()) return null;
        const c = document.createElement('canvas');
        c.width = 1200; c.height = 300;
        const x = c.getContext('2d');
        x.fillStyle = ink;
        x.font = `140px ${font}`;
        x.textBaseline = 'middle';
        x.fillText(input.value, 30, 160);
        return trimCanvas(c);
      };
      return h('div', {}, input, sel, prev);
    };

    const imagePane = () => {
      const removeBg = h('input', { type: 'checkbox', checked: true });
      const img = h('img', { class: 'sig-img-prev', alt: '' });
      let file = null;
      const btn = h('button', { class: 'btn', type: 'button', onclick: async () => { const f = await pickFiles({ kind: 'image' }); if (f[0]) { file = f[0].file; img.src = URL.createObjectURL(file); } } }, icon('ImagePlus', 15), t('Bild wählen …'));
      current = async () => {
        if (!file) return null;
        const bmp = await createImageBitmap(file);
        const c = document.createElement('canvas');
        const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
        const x = c.getContext('2d');
        x.drawImage(bmp, 0, 0, c.width, c.height);
        if (removeBg.checked) {
          const d = x.getImageData(0, 0, c.width, c.height);
          for (let i = 0; i < d.data.length; i += 4) {
            const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
            if (l > 225) d.data[i + 3] = 0; else if (l > 180) d.data[i + 3] = Math.round(((225 - l) / 45) * 255);
          }
          x.putImageData(d, 0, 0);
        }
        return trimCanvas(c);
      };
      return h('div', {}, btn, img, h('label', { class: 'check' }, removeBg, h('span', { text: t('Weißen Hintergrund entfernen') })));
    };

    const panes = { saved: () => { current = null; renderSaved(); return savedList; }, draw: drawPane, type: typePane, image: imagePane };
    const labels = { saved: 'Gespeichert', draw: 'Zeichnen', type: 'Tippen', image: 'Bild' };
    const show = (m) => {
      mode = m;
      tabs.replaceChildren(...Object.keys(panes).map((k) => h('button', { class: `btn small ${k === mode ? 'on' : ''}`, type: 'button', text: t(labels[k]), onclick: () => show(k) })));
      body.replaceChildren(panes[m]());
    };
    let closeFn = () => {};
    show(mode);
    const ok = await openDialog({
      title: t('Unterschrift'), width: 620,
      body: h('div', { class: 'form' }, tabs, body, h('label', { class: 'check' }, keep, h('span', { text: t('Unterschrift für später speichern (nur in diesem Browser)') }))),
      buttons: btns(t('Platzieren')),
      onOpen: (_d, c) => { closeFn = c; },
      collect: async () => {
        if (mode === 'saved') return result || (toast(t('Bitte eine Unterschrift auswählen.')), undefined);
        const url = await current?.();
        if (!url) { toast(t('Bitte zuerst unterschreiben.')); return undefined; }
        return url;
      },
    });
    const dataUrl = typeof ok === 'string' ? ok : result;
    if (!dataUrl) return;
    if (keep.checked && !saved.includes(dataUrl)) {
      saved.unshift(dataUrl);
      app.prefs.set('signatures', saved.slice(0, 8));
    }
    await app.armImage(dataUrl, 'signature', 160);
  }

  async askPassword(retry) {
    const input = h('input', { class: 'input', type: 'password', autocomplete: 'off' });
    return openDialog({
      title: t('Passwortgeschützte PDF'),
      body: h('div', { class: 'form' }, retry ? h('p', { class: 'warn', text: t('Falsches Passwort, bitte erneut versuchen.') }) : null, field(t('Passwort'), input)),
      buttons: btns(t('Öffnen')), collect: () => input.value,
    });
  }
}

/** Crop transparent borders and return a PNG data URL. */
function trimCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const d = ctx.getImageData(0, 0, width, height).data;
  let x1 = width, y1 = height, x2 = -1, y2 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (d[(y * width + x) * 4 + 3] > 8) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  if (x2 < 0) return null;
  const pad = 6;
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad);
  x2 = Math.min(width - 1, x2 + pad); y2 = Math.min(height - 1, y2 + pad);
  const out = document.createElement('canvas');
  out.width = x2 - x1 + 1;
  out.height = y2 - y1 + 1;
  out.getContext('2d').drawImage(canvas, x1, y1, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
