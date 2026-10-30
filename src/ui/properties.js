// Right sidebar: properties of the selected annotations, or default style of the active tool.
import { h, colorControl, select, iconButton } from './dom.js';
import { icon } from './icons.js';
import { t, fmtDate } from '../i18n.js';
import { TYPES, UNITS } from '../core/model.js';
import { FONT_FAMILIES } from '../core/fonts.js';

const LINE_ENDS = [
  ['None', 'Keine'], ['OpenArrow', 'Offener Pfeil'], ['ClosedArrow', 'Geschlossener Pfeil'], ['ROpenArrow', 'Umgekehrter Pfeil'],
  ['Circle', 'Kreis'], ['Square', 'Quadrat'], ['Diamond', 'Raute'], ['Butt', 'Querstrich'], ['Slash', 'Schrägstrich'],
];
const DASHES = [['solid', 'Durchgezogen'], ['dashed', 'Gestrichelt'], ['dotted', 'Gepunktet'], ['cloudy', 'Wolke']];

const FIELDS = {
  rect: ['color', 'fill', 'width', 'dash', 'opacity'],
  ellipse: ['color', 'fill', 'width', 'dash', 'opacity'],
  polygon: ['color', 'fill', 'width', 'dash', 'opacity'],
  line: ['color', 'width', 'dash', 'startCap', 'endCap', 'fill', 'opacity'],
  polyline: ['color', 'width', 'dash', 'startCap', 'endCap', 'fill', 'opacity'],
  ink: ['color', 'width', 'opacity'],
  freetext: ['font', 'textColor', 'align', 'color', 'width', 'dash', 'fill', 'opacity'],
  callout: ['font', 'textColor', 'align', 'color', 'width', 'fill', 'endCap', 'opacity'],
  note: ['color', 'opacity'],
  highlight: ['color', 'opacity'],
  underline: ['color', 'opacity'],
  strikeout: ['color', 'opacity'],
  squiggly: ['color', 'opacity'],
  stamp: ['color', 'opacity'],
  image: ['opacity'],
  measure: ['measure', 'color', 'width', 'startCap', 'endCap', 'fontSize', 'opacity'],
  area: ['measure', 'color', 'fill', 'width', 'fontSize', 'opacity'],
  eraser: ['eraserSize'],
  redact: [],
};

const TOOL_KIND = {
  rect: 'rect', ellipse: 'ellipse', line: 'line', arrow: 'line', polyline: 'polyline', polygon: 'polygon', cloud: 'polygon',
  ink: 'ink', eraser: 'eraser', typewriter: 'freetext', textbox: 'freetext', callout: 'callout', note: 'note',
  highlight: 'highlight', underline: 'underline', strikeout: 'strikeout', squiggly: 'squiggly', stamp: 'stamp',
  image: 'image', signature: 'image', distance: 'measure', perimeter: 'measure', area: 'area', redact: 'redact',
};

function kindOf(a) {
  if (a.type === 'freetext' && a.callout?.length) return 'callout';
  if (a.type === 'stamp' && a.stamp?.kind === 'image') return 'image';
  if (a.type === 'measure' && a.measure?.mode === 'area') return 'area';
  return a.type;
}

export class PropertiesPanel {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    this.isOpen = app.prefs.get('rightOpen', true);
    this.body = h('div', { class: 'props-body' });
    this.titleEl = h('span', { class: 'panel-title' });
    host.append(h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, this.titleEl, iconButton('X', t('Schließen'), () => this.toggle(), { size: 16 })),
      this.body));
    host.classList.toggle('closed', !this.isOpen);
    this.last = { key: null, time: 0 };
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.app.prefs.set('rightOpen', this.isOpen);
    this.host.classList.toggle('closed', !this.isOpen);
    this.refresh(true);
    this.app.refreshUI();
  }

  toolIdFor(a) {
    switch (a.type) {
      case 'line': return a.endCap && a.endCap !== 'None' ? 'arrow' : 'line';
      case 'polygon': return a.dash === 'cloudy' ? 'cloud' : 'polygon';
      case 'freetext': return a.callout?.length ? 'callout' : a.width > 0 || a.fill ? 'textbox' : 'typewriter';
      case 'stamp': return a.stamp?.kind === 'image' ? 'image' : 'stamp';
      case 'measure': return { distance: 'distance', perimeter: 'perimeter', area: 'area' }[a.measure?.mode] || 'distance';
      default: return this.app.tools.defs.has(a.type) ? a.type : null;
    }
  }

  /** Re-render unless the user is typing inside the panel. */
  refresh(force = false) {
    if (!this.isOpen) return;
    const ctxKey = this.#contextKey();
    if (!force && ctxKey === this.ctxKey && this.host.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) return;
    this.ctxKey = ctxKey;
    this.render();
  }

  #contextKey() {
    const v = this.app.view;
    const ids = v ? [...v.selection].join(',') : '';
    const sel = v?.selectedAnnots || [];
    return `${this.app.doc?.id}|${ids}|${this.app.tools.activeId}|${sel.map((a) => a.modified).join(',')}`;
  }

  render() {
    const app = this.app;
    const view = app.view;
    const sel = view?.selectedAnnots || [];
    this.body.replaceChildren();
    if (sel.length) return this.#renderSelection(sel);
    const toolId = app.tools.activeId;
    const def = app.tools.defs.get(toolId);
    if (!def.nav) return this.#renderTool(toolId, def);
    return this.#renderDoc();
  }

  #renderSelection(sel) {
    const app = this.app;
    const kinds = [...new Set(sel.map(kindOf))];
    const fields = kinds.map((k) => FIELDS[k] || []).reduce((acc, f) => acc.filter((x) => f.includes(x)));
    const a = sel[0];
    this.titleEl.textContent = sel.length === 1 ? t(TYPES[a.type]?.label || a.type) : t('{n} Anmerkungen', { n: sel.length });
    const locked = sel.every((x) => x.locked);
    const ids = sel.map((x) => x.id);
    const apply = (key, fn) => {
      const now = Date.now();
      const history = !(this.last.key === `${ids}|${key}` && now - this.last.time < 1200);
      this.last = { key: `${ids}|${key}`, time: now };
      app.doc.update(ids, fn, { history, label: 'Eigenschaften ändern' });
    };
    if (!locked) this.#fields(fields, a, apply);
    const sec = this.#section(t('Kommentar'));
    const authorIn = h('input', { class: 'input', value: a.author || '', disabled: locked, onchange: () => apply('author', (n) => { n.author = authorIn.value; }) });
    const contents = h('textarea', { class: 'input', rows: 4, disabled: locked, placeholder: t('Kommentar eingeben …') });
    contents.value = sel.length === 1 ? a.contents || '' : '';
    contents.addEventListener('change', () => apply('contents', (n) => { n.contents = contents.value; }));
    sec.append(this.#row(t('Autor'), authorIn));
    if (sel.length === 1) {
      sec.append(this.#row(t('Text'), contents));
      sec.append(h('div', { class: 'meta-line', text: `${t('Erstellt')}: ${fmtDate(a.created)}` }), h('div', { class: 'meta-line', text: `${t('Geändert')}: ${fmtDate(a.modified)}` }));
    }
    const lockBox = h('input', { type: 'checkbox', checked: locked, onchange: () => app.doc.update(ids, { locked: lockBox.checked }, { label: 'Sperren' }) });
    sec.append(h('label', { class: 'check' }, lockBox, h('span', { text: t('Gesperrt (nicht verschiebbar/änderbar)') })));
    this.body.append(sec);
    const actions = h('div', { class: 'props-actions' },
      sel.length === 1 && !locked ? h('button', { class: 'btn small', type: 'button', onclick: () => app.commands.run('copyFormat') }, icon('Paintbrush', 14), t('Als Standard')) : null,
      h('button', { class: 'btn small', type: 'button', onclick: () => app.commands.run('bringFront') }, icon('BringToFront', 14), t('Vordergrund')),
      h('button', { class: 'btn small danger', type: 'button', onclick: () => app.commands.run('delete') }, icon('Trash2', 14), t('Löschen')));
    this.body.append(actions);
  }

  #renderTool(toolId, def) {
    const app = this.app;
    this.titleEl.textContent = t(def.label);
    const kind = TOOL_KIND[toolId];
    const style = app.tools.styleFor(toolId);
    const fields = FIELDS[kind] || [];
    this.body.append(h('p', { class: 'hint', text: t('Standardeinstellungen für neue Anmerkungen dieses Werkzeugs.') }));
    this.#fields(fields, { ...style, type: kind, measure: style.measure }, (key, fn) => {
      const draft = structuredClone(style);
      fn(draft);
      app.tools.setStyle(toolId, draft);
    });
    if (toolId === 'stamp' || toolId === 'image' || toolId === 'signature') {
      this.body.append(h('button', { class: 'btn', type: 'button', onclick: () => app.tools.requestPayload(app.tools.active) }, icon(def.icon, 15), t('Auswählen …')));
    }
    if (!fields.length) this.body.append(h('p', { class: 'hint', text: t('Keine Einstellungen für dieses Werkzeug.') }));
    const reset = h('button', { class: 'btn small', type: 'button', onclick: () => { app.tools.resetStyles(); this.refresh(true); } }, icon('RotateCcw', 14), t('Alle Werkzeug-Stile zurücksetzen'));
    this.body.append(h('div', { class: 'props-actions' }, reset));
  }

  #renderDoc() {
    const app = this.app;
    const doc = app.doc;
    this.titleEl.textContent = t('Dokument');
    if (!doc) {
      this.body.append(h('p', { class: 'hint', text: t('Öffne eine PDF-Datei, um zu beginnen.') }));
      return;
    }
    const p = doc.pages[app.view.current];
    const [x1, y1, x2, y2] = p.view;
    const mm = (v) => Math.round((v * 25.4) / 72);
    const sec = this.#section(t('Informationen'));
    const rows = [
      [t('Datei'), doc.name],
      [t('Seiten'), String(doc.numPages)],
      [t('Seitengröße'), `${mm(x2 - x1)} × ${mm(y2 - y1)} mm${p.rotate ? ` (${p.rotate}°)` : ''}`],
      [t('Titel'), doc.meta.title || '–'],
      [t('Autor'), doc.meta.author || '–'],
      [t('Anmerkungen'), String(doc.allAnnotations().length)],
    ];
    for (const [k, v] of rows) sec.append(h('div', { class: 'kv' }, h('span', { text: k }), h('b', { text: v })));
    if (doc.readOnly) sec.append(h('p', { class: 'warn', text: t('Geschütztes/verschlüsseltes PDF: Nur Ansehen und Formulare ausfüllen möglich.') }));
    this.body.append(sec);
    this.body.append(h('div', { class: 'props-actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => app.commands.run('properties') }, icon('Info', 14), t('Eigenschaften …'))));
    const tips = this.#section(t('Tipps'));
    for (const tip of ['Shift beim Zeichnen: Linien rasten bei 0°/45°/90° ein, Rechtecke werden Quadrate.', 'Leertaste gedrückt halten: vorübergehend Hand-Werkzeug.', 'Strg + Mausrad: Zoomen. Strg+0/1/2: Seite/100 %/Breite.', 'Strg + Ziehen: Anmerkung duplizieren.', 'F1 zeigt alle Tastenkürzel.']) {
      tips.append(h('div', { class: 'tip' }, icon('Info', 13), h('span', { text: t(tip) })));
    }
    this.body.append(tips);
  }

  #section(title) {
    return h('div', { class: 'props-section' }, h('div', { class: 'props-title', text: title }));
  }

  #row(label, control) {
    return h('div', { class: 'prop-row' }, h('label', { text: label }), control);
  }

  #fields(fields, a, apply) {
    const sec = this.#section(t('Darstellung'));
    for (const f of fields) {
      switch (f) {
        case 'color':
          sec.append(this.#row(a.type === 'freetext' || a.type === 'callout' ? t('Rahmenfarbe') : t('Farbe'), colorControl(a.color, (c) => apply('color', (n) => { n.color = c; }))));
          break;
        case 'fill':
          sec.append(this.#row(t('Füllung'), colorControl(a.fill, (c) => apply('fill', (n) => { n.fill = c; }), { allowNone: true })));
          break;
        case 'textColor':
          sec.append(this.#row(t('Textfarbe'), colorControl(a.textColor || [0, 0, 0], (c) => apply('textColor', (n) => { n.textColor = c; }))));
          break;
        case 'opacity': {
          const out = h('span', { class: 'range-val', text: `${Math.round((a.opacity ?? 1) * 100)} %` });
          const r = h('input', { type: 'range', min: 5, max: 100, value: Math.round((a.opacity ?? 1) * 100) });
          r.addEventListener('input', () => { out.textContent = `${r.value} %`; apply('opacity', (n) => { n.opacity = r.value / 100; }); });
          sec.append(this.#row(t('Deckkraft'), h('div', { class: 'range-row' }, r, out)));
          break;
        }
        case 'width': {
          const inp = h('input', { type: 'number', class: 'input num', min: 0, max: 50, step: 0.25, value: a.width ?? 1 });
          inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (v >= 0) apply('width', (n) => { n.width = v; }); });
          sec.append(this.#row(a.type === 'freetext' || a.type === 'callout' ? t('Rahmenstärke (pt)') : t('Linienstärke (pt)'), inp));
          break;
        }
        case 'eraserSize': {
          const inp = h('input', { type: 'number', class: 'input num', min: 1, max: 60, step: 1, value: a.width ?? 6 });
          inp.addEventListener('input', () => { const v = parseFloat(inp.value); if (v > 0) apply('width', (n) => { n.width = v; }); });
          sec.append(this.#row(t('Radiergröße'), inp));
          break;
        }
        case 'dash': {
          const opts = DASHES.filter(([v]) => v !== 'cloudy' || ['rect', 'ellipse', 'polygon'].includes(a.type)).map(([v, l]) => [v, t(l)]);
          const s = select(opts, a.dash || 'solid');
          s.addEventListener('change', () => apply('dash', (n) => { n.dash = s.value; }));
          sec.append(this.#row(t('Linienstil'), s));
          break;
        }
        case 'startCap':
        case 'endCap': {
          const s = select(LINE_ENDS.map(([v, l]) => [v, t(l)]), a[f] || (f === 'endCap' && a.type === 'callout' ? 'OpenArrow' : 'None'));
          s.addEventListener('change', () => apply(f, (n) => { n[f] = s.value; }));
          sec.append(this.#row(f === 'startCap' ? t('Linienanfang') : t('Linienende'), s));
          break;
        }
        case 'font': {
          const font = a.font || { family: 'Helvetica', size: 12 };
          const fam = select(FONT_FAMILIES.map((x) => [x, x]), font.family || 'Helvetica');
          fam.addEventListener('change', () => apply('font', (n) => { n.font = { ...n.font, family: fam.value }; }));
          const size = h('input', { type: 'number', class: 'input num', min: 4, max: 200, step: 1, value: font.size || 12 });
          size.addEventListener('input', () => { const v = parseFloat(size.value); if (v >= 2) apply('fontSize', (n) => { n.font = { ...n.font, size: v }; }); });
          const bold = h('button', { class: `icon-btn toggle ${font.bold ? 'on' : ''}`, type: 'button', title: t('Fett'), onclick: () => apply('bold', (n) => { n.font = { ...n.font, bold: !font.bold }; }) }, icon('Bold', 16));
          const ital = h('button', { class: `icon-btn toggle ${font.italic ? 'on' : ''}`, type: 'button', title: t('Kursiv'), onclick: () => apply('italic', (n) => { n.font = { ...n.font, italic: !font.italic }; }) }, icon('Italic', 16));
          sec.append(this.#row(t('Schrift'), h('div', { class: 'font-row' }, fam, size, bold, ital)));
          break;
        }
        case 'fontSize': {
          const size = h('input', { type: 'number', class: 'input num', min: 4, max: 72, step: 1, value: a.font?.size || 9 });
          size.addEventListener('input', () => { const v = parseFloat(size.value); if (v >= 2) apply('fontSize', (n) => { n.font = { ...n.font, size: v }; }); });
          sec.append(this.#row(t('Schriftgröße'), size));
          break;
        }
        case 'align': {
          const row = h('div', { class: 'seg' }, ...[['left', 'AlignLeft'], ['center', 'AlignCenter'], ['right', 'AlignRight']].map(([v, ic]) => h('button', {
            class: `icon-btn toggle ${(a.align || 'left') === v ? 'on' : ''}`, type: 'button', title: t({ left: 'Links', center: 'Zentriert', right: 'Rechts' }[v]),
            onclick: () => apply('align', (n) => { n.align = v; }),
          }, icon(ic, 16))));
          sec.append(this.#row(t('Ausrichtung'), row));
          break;
        }
        case 'measure': {
          const m = a.measure || { ratio: 1, unit: 'mm' };
          const ratio = h('input', { type: 'number', class: 'input num', min: 0.0001, step: 'any', value: m.ratio ?? 1 });
          ratio.addEventListener('input', () => { const v = parseFloat(ratio.value); if (v > 0) apply('ratio', (n) => { n.measure = { ...n.measure, ratio: v }; }); });
          const unit = select(Object.keys(UNITS).map((u) => [u, UNITS[u].label]), m.unit || 'mm');
          unit.addEventListener('change', () => apply('unit', (n) => { n.measure = { ...n.measure, unit: unit.value }; }));
          sec.append(this.#row(t('Maßstab 1 :'), ratio), this.#row(t('Einheit'), unit));
          break;
        }
        default:
          break;
      }
    }
    if (sec.children.length > 1) this.body.append(sec);
  }
}
