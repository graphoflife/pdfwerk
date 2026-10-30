// Quick Launch box in the title bar: type to find and run any command or tool (Ctrl+.).
import { h } from './dom.js';
import { icon } from './icons.js';
import { t } from '../i18n.js';

const MAX_RESULTS = 12;

export class QuickLaunch {
  constructor(app) {
    this.app = app;
    this.results = [];
    this.index = 0;
    this.input = h('input', {
      class: 'ql-input', type: 'search', placeholder: `${t('Schnellstart')} (Ctrl+.)`, 'aria-label': t('Schnellstart'),
      oninput: () => this.#update(),
      onfocus: () => this.#update(),
      onblur: () => this.#hide(),
      onkeydown: (e) => this.#onKey(e),
    });
    // preventDefault keeps the focus in the input while clicking a result
    this.pop = h('div', { class: 'ql-pop', hidden: true, role: 'listbox', onpointerdown: (e) => e.preventDefault() });
    this.el = h('div', { class: 'quick-launch' }, icon('Search', 14), this.input, this.pop);
  }

  focus() {
    this.input.focus();
    this.input.select();
  }

  #entries() {
    const app = this.app;
    const out = [];
    for (const def of app.tools.defs.values()) {
      out.push({ label: t(def.label), icon: def.icon, key: def.key ? def.key.toUpperCase() : t('Werkzeug'), enabled: () => !!app.doc && (def.nav || !app.doc.readOnly), run: () => app.tools.setTool(def.id) });
    }
    for (const c of app.commands.map.values()) {
      if (c.id === 'quickLaunch') continue;
      out.push({ label: t(c.label).replace(/ …$/, ''), icon: c.icon, key: app.commands.shortcut(c.id), enabled: () => app.commands.enabled(c.id), run: () => app.commands.run(c.id) });
    }
    return out;
  }

  #update() {
    const q = this.input.value.trim().toLowerCase();
    if (!q) {
      this.#hide();
      return;
    }
    const words = q.split(/\s+/);
    const scored = [];
    for (const e of this.#entries()) {
      const l = e.label.toLowerCase();
      if (words.every((w) => l.includes(w))) scored.push([l.startsWith(q) ? 0 : l.includes(q) ? 1 : 2, e]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label));
    const seen = new Set();
    this.results = [];
    for (const [, e] of scored) {
      if (seen.has(e.label)) continue;
      seen.add(e.label);
      this.results.push(e);
      if (this.results.length >= MAX_RESULTS) break;
    }
    this.index = 0;
    this.#render();
  }

  #render() {
    this.pop.hidden = false;
    if (!this.results.length) {
      this.pop.replaceChildren(h('div', { class: 'ql-empty', text: t('Keine Treffer') }));
      return;
    }
    this.pop.replaceChildren(...this.results.map((e, i) => h('button', {
      class: `ql-item ${i === this.index ? 'active' : ''}`, type: 'button', role: 'option', disabled: !e.enabled(), onclick: () => this.#run(e),
    }, h('span', { class: 'mi-icon' }, icon(e.icon, 15)), h('span', { class: 'mi-label', text: e.label }), h('span', { class: 'mi-key', text: e.key || '' }))));
  }

  #hide() {
    this.pop.hidden = true;
  }

  #run(e) {
    if (!e.enabled()) return;
    this.input.value = '';
    this.#hide();
    this.input.blur();
    e.run();
  }

  #onKey(e) {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.results.length) return;
      this.index = (this.index + (e.key === 'ArrowDown' ? 1 : -1) + this.results.length) % this.results.length;
      this.#render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = this.results[this.index];
      if (r) this.#run(r);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.input.value = '';
      this.#hide();
      this.input.blur();
      this.app.view?.el.focus({ preventScroll: true });
    }
  }
}
