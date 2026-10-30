// Status bar (page navigation, zoom, layout, cursor position) and the find bar.
import { h, iconButton } from './dom.js';
import { icon } from './icons.js';
import { t } from '../i18n.js';
import { TOOL_HINTS, ZOOM_PRESETS } from './ribbon.js';

export class StatusBar {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    const c = (id) => iconButton(app.commands.get(id).icon, `${t(app.commands.get(id).label)} ${app.commands.shortcut(id) ? `(${app.commands.shortcut(id)})` : ''}`.trim(), () => app.commands.run(id), { size: 16, cls: `sb-${id}` });
    this.hint = h('div', { class: 'sb-hint' });
    this.coords = h('div', { class: 'sb-coords' });
    this.pageInput = h('input', {
      class: 'input sb-page', type: 'text', inputMode: 'numeric', 'aria-label': t('Seite'),
      onkeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const n = parseInt(this.pageInput.value, 10);
          if (n) app.view?.goToPage(n - 1);
          app.view?.el.focus({ preventScroll: true });
        }
        if (e.key === 'Escape') app.view?.el.focus({ preventScroll: true });
      },
      onfocus: () => this.pageInput.select(),
    });
    this.pageTotal = h('span', { class: 'sb-total' });
    this.zoomSel = h('select', {
      class: 'input sb-zoom', 'aria-label': t('Zoom'),
      onchange: () => {
        const v = this.zoomSel.value;
        if (v === 'width' || v === 'page') app.view?.setFit(v); else app.view?.setZoom(+v);
        app.view?.el.focus({ preventScroll: true });
      },
    });
    this.navEls = [c('firstPage'), c('prevPage'), this.pageInput, this.pageTotal, c('nextPage'), c('lastPage')];
    this.zoomEls = [c('zoomOut'), this.zoomSel, c('zoomIn'), c('fitWidth'), c('fitPage')];
    this.layoutEls = [c('layoutSingle'), c('layoutContinuous'), c('layoutTwo')];
    host.append(
      this.hint,
      h('div', { class: 'sb-spacer' }),
      this.coords,
      h('div', { class: 'sb-group' }, ...this.navEls),
      h('div', { class: 'sb-group' }, ...this.zoomEls),
      h('div', { class: 'sb-group sb-layout' }, ...this.layoutEls),
    );
  }

  focusPageInput() {
    this.pageInput.focus();
    this.pageInput.select();
  }

  setCoords(pt) {
    const mm = (v) => ((v * 25.4) / 72).toFixed(1);
    this.coords.textContent = `x ${mm(pt[0])}  y ${mm(pt[1])} mm`;
  }

  refresh() {
    const app = this.app;
    const view = app.view;
    const doc = app.doc;
    const tool = app.tools.activeId;
    this.hint.textContent = app.spaceHand ? t('Hand (Leertaste)') : t(TOOL_HINTS[tool] || '');
    this.hint.title = this.hint.textContent;
    if (document.activeElement !== this.pageInput) this.pageInput.value = doc ? String((view?.current ?? 0) + 1) : '';
    this.pageTotal.textContent = doc ? `/ ${doc.numPages}` : '';
    this.pageInput.disabled = !doc;
    const z = view?.zoom || 1;
    const opts = [['width', t('Seitenbreite')], ['page', t('Ganze Seite')], ...ZOOM_PRESETS.map((p) => [String(p), `${Math.round(p * 100)} %`])];
    const custom = !ZOOM_PRESETS.some((p) => Math.abs(p - z) < 0.001);
    if (custom) opts.push([String(z), `${Math.round(z * 100)} %`]);
    this.zoomSel.replaceChildren(...opts.map(([v, l]) => h('option', { value: v, text: l })));
    this.zoomSel.value = view?.fit ? view.fit : custom ? String(z) : String(ZOOM_PRESETS.find((p) => Math.abs(p - z) < 0.001));
    if (view?.fit) this.zoomSel.querySelector(`option[value="${view.fit}"]`).textContent = `${Math.round(z * 100)} %`;
    this.zoomSel.disabled = !doc;
    for (const b of this.host.querySelectorAll('.icon-btn')) {
      const id = [...b.classList].find((x) => x.startsWith('sb-'))?.slice(3);
      if (!id) continue;
      b.disabled = !app.commands.enabled(id);
      b.classList.toggle('on', !!app.commands.get(id).checked?.());
    }
    if (!doc) this.coords.textContent = '';
  }
}

export class FindBar {
  constructor(app, host) {
    this.app = app;
    this.caseSensitive = false;
    this.wholeWord = false;
    this.input = h('input', {
      class: 'input', type: 'search', placeholder: t('Im Dokument suchen …'), 'aria-label': t('Suchen'),
      oninput: () => { clearTimeout(this.timer); this.timer = setTimeout(() => this.#search(), 250); },
      onkeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this.#pending() ? this.#search() : this.next(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') { e.preventDefault(); this.close(); }
        if (e.key === 'F3') { e.preventDefault(); this.next(e.shiftKey ? -1 : 1); }
      },
    });
    this.count = h('span', { class: 'find-count' });
    const toggle = (name, title, key) => {
      const b = h('button', { class: 'icon-btn toggle', type: 'button', title, onclick: () => { this[key] = !this[key]; b.classList.toggle('on', this[key]); this.#search(); } }, icon(name, 16));
      return b;
    };
    this.el = h('div', { class: 'findbar', hidden: true },
      icon('Search', 16), this.input, this.count,
      toggle('CaseSensitive', t('Groß-/Kleinschreibung beachten'), 'caseSensitive'),
      toggle('WholeWord', t('Ganzes Wort'), 'wholeWord'),
      iconButton('ChevronUp', `${t('Vorheriger Treffer')} (Shift+F3)`, () => this.next(-1), { size: 16 }),
      iconButton('ChevronDown', `${t('Nächster Treffer')} (F3)`, () => this.next(1), { size: 16 }),
      iconButton('X', t('Schließen'), () => this.close(), { size: 16 }));
    host.append(this.el);
  }

  get search() {
    return this.app.view?.search;
  }

  #pending() {
    return this.search && this.input.value !== this.search.query;
  }

  open() {
    this.el.hidden = false;
    const sel = String(window.getSelection() || '').trim();
    if (sel && sel.length < 80) this.input.value = sel;
    this.input.focus();
    this.input.select();
    if (this.input.value && this.#pending()) this.#search();
  }

  close() {
    this.el.hidden = true;
    this.search?.clear();
    this.app.view?.el.focus({ preventScroll: true });
  }

  next(dir) {
    if (this.el.hidden) { this.open(); return; }
    if (this.#pending()) this.#search();
    else this.search?.next(dir);
  }

  async #search() {
    const s = this.search;
    if (!s) return;
    s.removeEventListener('update', this.onUpdate);
    this.onUpdate = () => this.#updateCount();
    s.addEventListener('update', this.onUpdate);
    await s.find(this.input.value, { caseSensitive: this.caseSensitive, wholeWord: this.wholeWord });
  }

  #updateCount() {
    const s = this.search;
    if (!s?.query) { this.count.textContent = ''; return; }
    this.count.textContent = s.matches.length ? `${s.index + 1} / ${s.matches.length}` : t('Keine Treffer');
  }

  /** The active document changed. */
  setDoc() {
    if (!this.el.hidden && this.input.value) this.#search();
    else this.count.textContent = '';
  }
}
