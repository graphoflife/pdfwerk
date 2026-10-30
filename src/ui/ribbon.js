// Ribbon toolbar: tab row (with the File backstage button and the contextual Format tab)
// and the grouped commands/tools of the active tab. Tab order and grouping follow the
// classic desktop PDF editors so switching from them is easy.
import { h, iconButton } from './dom.js';
import { icon } from './icons.js';
import { t } from '../i18n.js';
import { displayKey } from '../commands.js';
import { ZoomCombo } from './zoom.js';
import { styleControls } from './properties.js';

/*
 * Group items: { tool | cmd | widget, big, text } or { rows: [[item, …], …] } for rows of
 * icon-only buttons. Consecutive small items stack in columns of three.
 */
const TABS = [
  {
    id: 'home', label: 'Start', groups: [
      { label: 'Werkzeuge', items: [{ tool: 'hand' }, { tool: 'text' }, { tool: 'select' }] },
      {
        label: 'Ansicht', items: [{
          rows: [
            [{ cmd: 'zoomOut' }, { widget: 'zoom' }, { cmd: 'zoomIn' }],
            [{ cmd: 'actualSize' }, { cmd: 'fitPage' }, { cmd: 'fitWidth' }, { cmd: 'rotateViewCcw' }, { cmd: 'rotateViewCw' }],
            [{ cmd: 'panelBookmarks' }, { cmd: 'panelThumbs' }, { cmd: 'panelComments' }, { cmd: 'toggleRight' }, { cmd: 'find' }],
          ],
        }],
      },
      { label: 'Objekte', items: [{ tool: 'image', big: true, text: 'Bild hinzufügen' }, { cmd: 'copy' }, { cmd: 'paste' }, { cmd: 'delete' }] },
      {
        label: 'Kommentar', items: [
          {
            rows: [
              [{ tool: 'typewriter' }, { tool: 'note' }, { tool: 'textbox' }],
              [{ tool: 'highlight' }, { tool: 'underline' }, { tool: 'strikeout' }],
              [{ tool: 'rect' }, { tool: 'arrow' }, { tool: 'ink' }],
            ],
          },
          { tool: 'stamp', big: true },
        ],
      },
      { label: 'Seiten', items: [{ cmd: 'insertFile', big: true, text: 'Seiten einfügen' }, { cmd: 'rotatePagesCcw' }, { cmd: 'rotatePagesCw' }, { cmd: 'deletePages' }] },
      { label: 'Schützen', items: [{ tool: 'signature', big: true, text: 'Unterschreiben' }, { tool: 'redact', big: true, text: 'Schwärzen' }] },
    ],
  },
  {
    id: 'view', label: 'Ansicht', groups: [
      { label: 'Bereiche', items: [{ cmd: 'panelThumbs', big: true, text: 'Miniaturen' }, { cmd: 'panelBookmarks', big: true, text: 'Lesezeichen' }, { cmd: 'panelComments', big: true, text: 'Kommentare' }, { cmd: 'toggleRight', big: true, text: 'Eigenschaften' }] },
      { label: 'Zoom', items: [{ widget: 'zoom' }, { cmd: 'zoomIn' }, { cmd: 'zoomOut' }, { cmd: 'actualSize' }, { cmd: 'fitPage' }, { cmd: 'fitWidth' }] },
      { label: 'Seitenanzeige', items: [{ cmd: 'layoutSingle' }, { cmd: 'layoutContinuous' }, { cmd: 'layoutTwo' }] },
      { label: 'Drehen', items: [{ cmd: 'rotateViewCcw' }, { cmd: 'rotateViewCw' }] },
      { label: 'Navigation', items: [{ cmd: 'firstPage' }, { cmd: 'prevPage' }, { cmd: 'goToPage' }, { cmd: 'nextPage' }, { cmd: 'lastPage' }] },
      { label: 'Anzeigen', items: [{ cmd: 'fullscreen', big: true, text: 'Vollbild' }, { cmd: 'toggleLeft' }, { cmd: 'toggleAnnots' }, { cmd: 'theme' }] },
    ],
  },
  {
    id: 'comment', label: 'Kommentar', groups: [
      { label: 'Text', items: [{ tool: 'note', big: true }, { tool: 'typewriter' }, { tool: 'textbox' }, { tool: 'callout' }] },
      { label: 'Textmarkierung', items: [{ tool: 'highlight', big: true }, { tool: 'underline' }, { tool: 'strikeout' }, { tool: 'squiggly' }] },
      { label: 'Zeichnen', items: [{ tool: 'rect' }, { tool: 'ellipse' }, { tool: 'polygon' }, { tool: 'cloud' }, { tool: 'line' }, { tool: 'arrow' }, { tool: 'polyline' }, { tool: 'ink' }, { tool: 'eraser' }] },
      { label: 'Stempel', items: [{ tool: 'stamp', big: true }, { tool: 'image' }, { tool: 'signature' }] },
      { label: 'Messen', items: [{ tool: 'distance' }, { tool: 'perimeter' }, { tool: 'area' }, { cmd: 'scaleSettings' }] },
      { label: 'Kommentare verwalten', items: [{ cmd: 'panelComments', big: true, text: 'Kommentarliste' }, { cmd: 'toggleAnnots' }, { cmd: 'showAnnots' }, { cmd: 'stickyTools' }, { cmd: 'flattenAnnots' }, { cmd: 'deleteAllAnnots' }] },
    ],
  },
  {
    id: 'protect', label: 'Schützen', groups: [
      { label: 'Schwärzen', items: [{ tool: 'redact', big: true, text: 'Schwärzung markieren' }, { cmd: 'applyRedactions', big: true }] },
      { label: 'Unterschreiben', items: [{ tool: 'signature', big: true, text: 'Unterschreiben' }] },
      { label: 'Dokument', items: [{ cmd: 'sanitize' }, { cmd: 'properties' }, { cmd: 'saveFlat' }] },
    ],
  },
  {
    id: 'form', label: 'Formular', groups: [
      { label: 'Formularfelder', items: [{ cmd: 'highlightFields', big: true, text: 'Felder hervorheben' }, { cmd: 'resetForm', big: true, text: 'Zurücksetzen' }] },
      { label: 'Abflachen', items: [{ cmd: 'saveFlat', big: true, text: 'Abgeflachte Kopie' }] },
    ],
  },
  {
    id: 'organize', label: 'Organisieren', groups: [
      { label: 'Einfügen', items: [{ cmd: 'insertFile', big: true, text: 'Seiten einfügen' }, { cmd: 'insertBlank' }, { cmd: 'mergeFiles' }] },
      { label: 'Seiten', items: [{ cmd: 'deletePages', big: true, text: 'Löschen' }, { cmd: 'extractPages', big: true, text: 'Extrahieren' }, { cmd: 'duplicatePages' }, { cmd: 'movePages' }, { cmd: 'reversePages' }, { cmd: 'splitDoc' }] },
      { label: 'Drehen', items: [{ cmd: 'rotatePagesCcw' }, { cmd: 'rotatePagesCw' }, { cmd: 'rotatePages' }] },
      { label: 'Seitengestaltung', items: [{ cmd: 'cropPages', big: true, text: 'Zuschneiden' }, { cmd: 'watermark', big: true, text: 'Wasserzeichen' }, { cmd: 'headerFooter', big: true, text: 'Kopf-/Fußzeile' }] },
    ],
  },
  {
    id: 'convert', label: 'Konvertieren', groups: [
      { label: 'Exportieren', items: [{ cmd: 'exportImages', big: true, text: 'In Bilder' }, { cmd: 'extractPages', big: true, text: 'Seiten extrahieren' }, { cmd: 'splitDoc', big: true, text: 'Teilen' }] },
      { label: 'Erstellen', items: [{ cmd: 'fromImages', big: true, text: 'Aus Bildern' }, { cmd: 'new', big: true, text: 'Leeres PDF' }, { cmd: 'mergeFiles', big: true, text: 'Dateien anhängen' }] },
    ],
  },
  {
    id: 'bookmarks', label: 'Lesezeichen', groups: [
      { label: 'Lesezeichen', items: [{ cmd: 'addBookmark', big: true, text: 'Hinzufügen' }, { cmd: 'panelBookmarks', big: true, text: 'Lesezeichen-Bereich' }] },
    ],
  },
  {
    id: 'help', label: 'Hilfe', groups: [
      { label: 'Hilfe', items: [{ cmd: 'shortcuts', big: true, text: 'Tastenkürzel' }, { cmd: 'about', big: true, text: 'Über PDFwerk' }] },
      { label: 'Einstellungen', items: [{ cmd: 'settings', big: true, text: 'Einstellungen' }, { cmd: 'theme', big: true, text: 'Dunkles Design' }] },
    ],
  },
];

const LEGACY_TABS = { pages: 'organize' };

export class Ribbon {
  constructor(app, tabsHost, bodyHost) {
    this.app = app;
    this.tabsHost = tabsHost;
    this.bodyHost = bodyHost;
    const saved = app.prefs.get('ribbonTab', 'home');
    this.tab = LEGACY_TABS[saved] || (TABS.some((x) => x.id === saved) ? saved : 'home');
    this.prevTab = this.tab;
    this.formatSticky = false;
    this.collapsed = app.prefs.get('ribbonCollapsed', false);
    this.zoomCombos = [];
    this.render();
  }

  render() {
    const app = this.app;
    const fileBtn = h('button', { class: `rtab file-tab ${app.backstage?.isOpen ? 'open' : ''}`, type: 'button', text: t('Datei'), title: `${t('Datei')} (Alt+F)`, onclick: () => app.backstage.toggle() });
    const tabs = TABS.map((tab) => h('button', {
      class: `rtab ${tab.id === this.tab ? 'active' : ''}`, type: 'button', role: 'tab', text: t(tab.label),
      onclick: () => this.select(tab.id),
      ondblclick: () => this.toggleCollapsed(),
    }));
    this.hasFormat = !!app.props?.formatTarget();
    const format = this.hasFormat ? h('button', {
      class: `rtab ctx ${this.tab === 'format' ? 'active' : ''}`, type: 'button', role: 'tab', text: t('Format'),
      title: t('Format der Auswahl bzw. des Werkzeugs'),
      onclick: () => this.select('format'),
      ondblclick: () => this.toggleCollapsed(),
    }) : null;
    const collapse = iconButton(this.collapsed ? 'ChevronDown' : 'ChevronUp', t('Menüband ein-/ausklappen'), () => this.toggleCollapsed(), { size: 15, cls: 'rcollapse' });
    this.tabsHost.replaceChildren(fileBtn, ...tabs, ...(format ? [format] : []), collapse);
    this.bodyHost.classList.toggle('collapsed', this.collapsed);
    this.renderBody();
  }

  renderBody() {
    this.zoomCombos = [];
    if (this.tab === 'format') {
      this.formatKey = this.app.props.contextKey();
      this.bodyHost.replaceChildren(...this.#formatGroups());
    } else {
      const tab = TABS.find((x) => x.id === this.tab) || TABS[0];
      this.bodyHost.replaceChildren(...tab.groups.map((g) => this.#group(g)));
    }
    this.refresh();
  }

  select(id) {
    if (id !== 'format') {
      this.prevTab = id;
      this.app.prefs.set('ribbonTab', id);
    }
    this.formatSticky = id === 'format';
    this.tab = id;
    this.app.backstage?.close();
    if (this.collapsed) this.toggleCollapsed();
    else this.render();
  }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    this.app.prefs.set('ribbonCollapsed', this.collapsed);
    this.render();
  }

  #group(g, children = null) {
    const parts = [];
    let column = [];
    const flush = () => {
      for (let i = 0; i < column.length; i += 3) parts.push(h('div', { class: 'rcol' }, ...column.slice(i, i + 3)));
      column = [];
    };
    for (const it of g.items || []) {
      if (it.rows) {
        flush();
        parts.push(h('div', { class: 'rrows' }, ...it.rows.map((row) => h('div', { class: 'rrow' }, ...row.map((x) => this.#item(x, 'tiny'))))));
      } else if (it.big) {
        flush();
        parts.push(this.#item(it, 'big'));
      } else {
        column.push(this.#item(it, 'small'));
      }
    }
    flush();
    return h('div', { class: 'rgroup' },
      h('div', { class: 'ritems' }, ...parts, ...(children || [])),
      h('div', { class: 'rlabel', text: t(g.label) }));
  }

  #item(it, size) {
    const app = this.app;
    if (it.widget === 'zoom') {
      const combo = new ZoomCombo(app);
      this.zoomCombos.push(combo);
      return combo.el;
    }
    let label, iconName, key, run, data;
    if (it.tool) {
      const def = app.tools.defs.get(it.tool);
      label = t(def.label);
      iconName = def.icon;
      key = def.key ? def.key.toUpperCase() : '';
      run = () => app.tools.setTool(it.tool);
      data = { tool: it.tool };
    } else {
      const c = app.commands.get(it.cmd);
      label = t(c.label).replace(/ …$/, '');
      iconName = c.icon;
      key = app.commands.shortcut(it.cmd) || displayKey(c.shortcutText);
      run = () => app.commands.run(it.cmd);
      data = { cmd: it.cmd };
    }
    const hint = it.tool ? t(TOOL_HINTS[it.tool] || '') : '';
    const title = `${label}${key ? ` (${key})` : ''}${hint ? `\n${hint}` : ''}`;
    const text = it.text ? t(it.text) : label;
    const iconSize = { big: 32, small: 16, tiny: 16 }[size];
    return h('button', { class: `rbtn ${size}`, type: 'button', dataset: data, title, 'aria-label': label, onclick: run },
      icon(iconName, iconSize), size === 'tiny' ? null : h('span', { text }));
  }

  // ------------------------------------------------------------------ contextual Format tab
  #formatGroups() {
    const app = this.app;
    const target = app.props.formatTarget();
    if (!target) return [];
    const groups = [];
    const textKeys = ['font', 'align', 'textColor'];
    const ctl = target.locked ? [] : styleControls(target.fields, target.a, target.apply, { compact: true });
    const row = (c) => h('div', { class: 'rctl' }, h('span', { class: 'rctl-label', text: c.label }), c.el);
    const columns = (list) => {
      const cols = [];
      for (let i = 0; i < list.length; i += 3) cols.push(h('div', { class: 'rcol rctl-col' }, ...list.slice(i, i + 3).map(row)));
      return cols;
    };
    const style = ctl.filter((c) => !textKeys.includes(c.key));
    const text = ctl.filter((c) => textKeys.includes(c.key));
    if (style.length) groups.push(this.#group({ label: 'Darstellung' }, columns(style)));
    if (text.length) groups.push(this.#group({ label: 'Schrift' }, columns(text)));
    if (target.kind === 'selection') {
      groups.push(this.#group({ label: 'Anordnen', items: [{ cmd: 'bringFront' }, { cmd: 'forward' }, { cmd: 'backward' }, { cmd: 'sendBack' }] }));
      groups.push(this.#group({ label: 'Kommentar', items: [{ cmd: 'editAnnot', big: true, text: 'Bearbeiten' }, { cmd: 'lock' }, { cmd: 'copyFormat' }, { cmd: 'delete' }] }));
    } else {
      groups.push(this.#group({ label: target.def.label, items: [{ cmd: 'stickyTools' }, { cmd: 'toggleRight' }] }));
    }
    if (!ctl.length && target.locked) groups.unshift(h('div', { class: 'rgroup rnote', text: t('Gesperrte Anmerkung') }));
    return groups;
  }

  /** Show, hide or re-render the Format tab when its target changes. */
  #syncFormat() {
    const app = this.app;
    const has = !!app.props?.formatTarget();
    if (has !== this.hasFormat) {
      if (!has && this.tab === 'format') this.tab = this.prevTab;
      if (has && this.formatSticky) this.tab = 'format';
      this.render();
      return true;
    }
    if (this.tab === 'format' && app.props.contextKey() !== this.formatKey) {
      const typing = this.bodyHost.contains(document.activeElement) && document.activeElement.matches('input, select, textarea');
      if (!typing) {
        this.renderBody();
        return true;
      }
    }
    return false;
  }

  refresh() {
    const app = this.app;
    if (this.#syncFormat()) return;
    for (const b of this.bodyHost.querySelectorAll('[data-cmd]')) {
      const id = b.dataset.cmd;
      b.disabled = !app.commands.enabled(id);
      const c = app.commands.get(id);
      b.classList.toggle('checked', !!c.checked?.());
    }
    for (const b of this.bodyHost.querySelectorAll('[data-tool]')) {
      b.classList.toggle('active', app.tools.activeId === b.dataset.tool);
      const def = app.tools.defs.get(b.dataset.tool);
      b.disabled = !app.doc || (!def.nav && app.doc.readOnly);
    }
    this.tabsHost.querySelector('.file-tab')?.classList.toggle('open', !!app.backstage?.isOpen);
    for (const z of this.zoomCombos) z.refresh();
  }
}

export const TOOL_HINTS = {
  hand: 'Ziehen zum Verschieben der Ansicht; Klick auf Anmerkungen wählt sie aus. Leertaste halten = Hand.',
  select: 'Klicken/Aufziehen zum Auswählen. Shift: Achse sperren beim Verschieben, Seitenverhältnis beim Skalieren. Strg+Ziehen: duplizieren.',
  text: 'Text markieren und mit Strg+C kopieren. Rechtsklick für Hervorheben/Unterstreichen.',
  typewriter: 'Klicken und tippen. Aufziehen für festen Textbereich. Esc beendet die Eingabe.',
  textbox: 'Aufziehen oder klicken für ein Textfeld mit Rahmen.',
  callout: 'Am Pfeilziel drücken und zur Textposition ziehen. Shift: 45°-Schritte.',
  note: 'Klicken, um eine Notiz zu platzieren.',
  highlight: 'Text markieren oder Bereich aufziehen.',
  underline: 'Text markieren oder Bereich aufziehen.',
  strikeout: 'Text markieren oder Bereich aufziehen.',
  squiggly: 'Text markieren oder Bereich aufziehen.',
  rect: 'Aufziehen. Shift: Quadrat, Alt: vom Mittelpunkt.',
  ellipse: 'Aufziehen. Shift: Kreis, Alt: vom Mittelpunkt.',
  line: 'Ziehen oder Klicken–Klicken. Shift: 0°/45°/90° einrasten.',
  arrow: 'Ziehen oder Klicken–Klicken. Shift: 0°/45°/90° einrasten.',
  polyline: 'Punkte setzen, Doppelklick/Enter beendet. Shift: 45°-Schritte, Rücktaste: letzter Punkt weg.',
  polygon: 'Punkte setzen, Doppelklick/Enter oder Klick auf Startpunkt schließt. Shift: 45°-Schritte.',
  cloud: 'Punkte setzen, Doppelklick/Enter schließt die Wolke. Shift: 45°-Schritte.',
  ink: 'Freihand zeichnen. Shift: gerade Linie in 45°-Schritten.',
  eraser: 'Über Freihand-Striche ziehen, um sie zu radieren.',
  stamp: 'Stempel wählen, dann klicken oder aufziehen.',
  image: 'Bild wählen, dann klicken oder aufziehen. Strg+V fügt Bilder aus der Zwischenablage ein.',
  signature: 'Unterschrift wählen/zeichnen, dann klicken oder aufziehen.',
  distance: 'Strecke messen. Shift: 0°/45°/90° einrasten.',
  perimeter: 'Umfang messen: Punkte setzen, Doppelklick beendet.',
  area: 'Fläche messen: Punkte setzen, Doppelklick beendet.',
  redact: 'Bereiche zum Schwärzen markieren, dann „Schwärzungen anwenden“.',
};
