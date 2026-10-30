// Ribbon toolbar (tabs with grouped commands and tools) plus the File menu.
import { h, showMenu } from './dom.js';
import { icon } from './icons.js';
import { t } from '../i18n.js';
import { displayKey } from '../commands.js';

const TABS = [
  {
    id: 'home', label: 'Start', groups: [
      { label: 'Datei', items: [{ cmd: 'open', big: true }, { cmd: 'save' }, { cmd: 'saveAs' }, { cmd: 'print' }] },
      { label: 'Werkzeuge', items: [{ tool: 'hand', big: true }, { tool: 'select', big: true }, { tool: 'text', big: true }] },
      { label: 'Zoom', items: [{ widget: 'zoom' }, { cmd: 'fitWidth' }, { cmd: 'fitPage' }, { cmd: 'actualSize' }] },
      { label: 'Kommentieren', items: [{ tool: 'typewriter' }, { tool: 'note' }, { tool: 'highlight' }, { tool: 'rect' }, { tool: 'arrow' }, { tool: 'ink' }, { tool: 'stamp' }, { tool: 'signature' }, { tool: 'image' }] },
      { label: 'Seiten', items: [{ cmd: 'rotatePagesCcw' }, { cmd: 'rotatePagesCw' }, { cmd: 'insertFile' }, { cmd: 'deletePages' }, { cmd: 'extractPages' }] },
      { label: 'Bearbeiten', items: [{ cmd: 'undo' }, { cmd: 'redo' }, { cmd: 'find' }] },
    ],
  },
  {
    id: 'comment', label: 'Kommentar', groups: [
      { label: 'Text', items: [{ tool: 'typewriter', big: true }, { tool: 'textbox' }, { tool: 'callout' }, { tool: 'note' }] },
      { label: 'Textmarkierung', items: [{ tool: 'highlight', big: true }, { tool: 'underline' }, { tool: 'strikeout' }, { tool: 'squiggly' }] },
      { label: 'Zeichnen', items: [{ tool: 'rect' }, { tool: 'ellipse' }, { tool: 'line' }, { tool: 'arrow' }, { tool: 'polyline' }, { tool: 'polygon' }, { tool: 'cloud' }, { tool: 'ink' }, { tool: 'eraser' }] },
      { label: 'Einfügen', items: [{ tool: 'stamp', big: true }, { tool: 'image' }, { tool: 'signature' }] },
      { label: 'Messen', items: [{ tool: 'distance' }, { tool: 'perimeter' }, { tool: 'area' }, { cmd: 'scaleSettings' }] },
      { label: 'Verwalten', items: [{ cmd: 'panelComments' }, { cmd: 'toggleAnnots' }, { cmd: 'stickyTools' }, { cmd: 'flattenAnnots' }, { cmd: 'deleteAllAnnots' }] },
    ],
  },
  {
    id: 'pages', label: 'Seiten', groups: [
      { label: 'Einfügen', items: [{ cmd: 'insertFile', big: true }, { cmd: 'insertBlank' }, { cmd: 'mergeFiles' }] },
      { label: 'Organisieren', items: [{ cmd: 'deletePages', big: true }, { cmd: 'extractPages' }, { cmd: 'splitDoc' }, { cmd: 'duplicatePages' }, { cmd: 'movePages' }, { cmd: 'reversePages' }] },
      { label: 'Drehen', items: [{ cmd: 'rotatePagesCcw' }, { cmd: 'rotatePagesCw' }, { cmd: 'rotatePages' }] },
      { label: 'Gestalten', items: [{ cmd: 'cropPages', big: true }, { cmd: 'watermark' }, { cmd: 'headerFooter' }] },
      { label: 'Ansicht', items: [{ cmd: 'panelThumbs', big: true }] },
    ],
  },
  {
    id: 'protect', label: 'Schützen', groups: [
      { label: 'Schwärzen', items: [{ tool: 'redact', big: true }, { cmd: 'applyRedactions', big: true }] },
      { label: 'Dokument', items: [{ cmd: 'sanitize' }, { cmd: 'properties' }, { cmd: 'saveFlat' }] },
      { label: 'Formular', items: [{ cmd: 'highlightFields' }, { cmd: 'resetForm' }] },
    ],
  },
  {
    id: 'view', label: 'Ansicht', groups: [
      { label: 'Navigation', items: [{ cmd: 'firstPage' }, { cmd: 'prevPage' }, { cmd: 'nextPage' }, { cmd: 'lastPage' }, { cmd: 'goToPage' }] },
      { label: 'Zoom', items: [{ widget: 'zoom' }, { cmd: 'zoomIn' }, { cmd: 'zoomOut' }, { cmd: 'actualSize' }, { cmd: 'fitWidth' }, { cmd: 'fitPage' }] },
      { label: 'Seitenanzeige', items: [{ cmd: 'layoutSingle' }, { cmd: 'layoutContinuous' }, { cmd: 'layoutTwo' }, { cmd: 'rotateViewCcw' }, { cmd: 'rotateViewCw' }] },
      { label: 'Fenster', items: [{ cmd: 'panelThumbs' }, { cmd: 'panelBookmarks' }, { cmd: 'panelComments' }, { cmd: 'toggleRight' }, { cmd: 'fullscreen' }, { cmd: 'theme' }] },
    ],
  },
  {
    id: 'help', label: 'Hilfe', groups: [
      { label: 'Hilfe', items: [{ cmd: 'shortcuts', big: true }, { cmd: 'about', big: true }, { cmd: 'settings', big: true }] },
    ],
  },
];

export const FILE_MENU = ['open', 'new', 'fromImages', '-', 'save', 'saveAs', 'saveFlat', '-', 'print', 'exportImages', '-', 'properties', 'settings', '-', 'close'];

export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8];

export class Ribbon {
  constructor(app, tabsHost, bodyHost) {
    this.app = app;
    this.tabsHost = tabsHost;
    this.bodyHost = bodyHost;
    this.tab = app.prefs.get('ribbonTab', 'home');
    this.collapsed = app.prefs.get('ribbonCollapsed', false);
    this.zoomSelects = [];
    this.render();
  }

  render() {
    const fileBtn = h('button', { class: 'rtab file-tab', type: 'button', text: t('Datei'), onclick: (e) => this.openFileMenu(e.currentTarget) });
    const tabs = TABS.map((tab) => h('button', {
      class: `rtab ${tab.id === this.tab ? 'active' : ''}`, type: 'button', role: 'tab', text: t(tab.label),
      onclick: () => this.select(tab.id),
      ondblclick: () => this.toggleCollapsed(),
    }));
    const collapse = h('button', { class: 'icon-btn rcollapse', title: t('Menüband ein-/ausklappen'), type: 'button', onclick: () => this.toggleCollapsed() }, icon(this.collapsed ? 'ChevronDown' : 'ChevronUp', 16));
    this.tabsHost.replaceChildren(fileBtn, ...tabs, collapse);
    this.bodyHost.classList.toggle('collapsed', this.collapsed);
    const tab = TABS.find((x) => x.id === this.tab) || TABS[0];
    this.zoomSelects = [];
    this.bodyHost.replaceChildren(...tab.groups.map((g) => this.#group(g)));
    this.refresh();
  }

  select(id) {
    this.tab = id;
    this.app.prefs.set('ribbonTab', id);
    if (this.collapsed) this.toggleCollapsed();
    this.render();
  }

  toggleCollapsed() {
    this.collapsed = !this.collapsed;
    this.app.prefs.set('ribbonCollapsed', this.collapsed);
    this.render();
  }

  openFileMenu(anchor) {
    const cmds = this.app.commands;
    showMenu(FILE_MENU.map((id) => (id === '-' ? '-' : {
      label: t(cmds.get(id).label), icon: cmds.get(id).icon, shortcut: cmds.shortcut(id), disabled: !cmds.enabled(id), run: () => cmds.run(id),
    })), 0, 0, { anchor });
  }

  #group(g) {
    const big = g.items.filter((i) => i.big);
    const small = g.items.filter((i) => !i.big);
    const cols = [];
    for (let i = 0; i < small.length; i += 3) cols.push(h('div', { class: 'rcol' }, ...small.slice(i, i + 3).map((it) => this.#item(it))));
    return h('div', { class: 'rgroup' },
      h('div', { class: 'ritems' }, ...big.map((it) => this.#item(it)), ...cols),
      h('div', { class: 'rlabel', text: t(g.label) }));
  }

  #item(it) {
    const app = this.app;
    if (it.widget === 'zoom') return this.#zoomWidget();
    if (it.tool) {
      const def = app.tools.defs.get(it.tool);
      const key = def.key ? def.key.toUpperCase() : '';
      return h('button', {
        class: `rbtn ${it.big ? 'big' : 'small'}`, type: 'button', dataset: { tool: it.tool },
        title: `${t(def.label)}${key ? ` (${key})` : ''}\n${t(TOOL_HINTS[it.tool] || '')}`.trim(),
        onclick: () => app.tools.setTool(it.tool),
      }, icon(def.icon, it.big ? 26 : 17), h('span', { text: t(def.label) }));
    }
    const c = app.commands.get(it.cmd);
    const key = app.commands.shortcut(it.cmd) || displayKey(c.shortcutText);
    return h('button', {
      class: `rbtn ${it.big ? 'big' : 'small'}`, type: 'button', dataset: { cmd: it.cmd },
      title: `${t(c.label)}${key ? ` (${key})` : ''}`,
      onclick: () => app.commands.run(it.cmd),
    }, icon(c.icon, it.big ? 26 : 17), h('span', { text: t(c.label).replace(/ …$/, '') }));
  }

  #zoomWidget() {
    const sel = h('select', {
      class: 'input zoom-select', title: t('Zoom'),
      onchange: () => {
        const v = sel.value;
        const view = this.app.view;
        if (!view) return;
        if (v === 'width' || v === 'page') view.setFit(v);
        else view.setZoom(+v);
        this.app.view?.el.focus({ preventScroll: true });
      },
    });
    this.zoomSelects.push(sel);
    return h('div', { class: 'rcol zoom-col' }, sel);
  }

  refreshZoom() {
    const view = this.app.view;
    for (const sel of this.zoomSelects) {
      const z = view?.zoom || 1;
      const opts = [['width', t('Seitenbreite')], ['page', t('Ganze Seite')], ...ZOOM_PRESETS.map((p) => [String(p), `${Math.round(p * 100)} %`])];
      if (!ZOOM_PRESETS.some((p) => Math.abs(p - z) < 0.001)) opts.push([String(z), `${Math.round(z * 100)} %`]);
      sel.replaceChildren(...opts.map(([v, l]) => h('option', { value: v, text: l })));
      sel.value = view?.fit || String(ZOOM_PRESETS.find((p) => Math.abs(p - z) < 0.001) ?? z);
      sel.disabled = !view;
    }
  }

  refresh() {
    const app = this.app;
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
    this.refreshZoom();
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
