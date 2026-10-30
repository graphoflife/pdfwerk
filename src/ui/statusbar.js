// Status bar (options, page size, page navigation, layout, zoom) and the find bar.
import { h, iconButton, showMenu } from './dom.js';
import { icon } from './icons.js';
import { t } from '../i18n.js';
import { TOOL_HINTS } from './ribbon.js';
import { ZoomCombo, ZoomSlider } from './zoom.js';

export class StatusBar {
  constructor(app, host) {
    this.app = app;
    this.host = host;
    const c = (id) => iconButton(app.commands.get(id).icon, `${t(app.commands.get(id).label)} ${app.commands.shortcut(id) ? `(${app.commands.shortcut(id)})` : ''}`.trim(), () => app.commands.run(id), { size: 16, cls: `sb-${id}` });
    this.options = h('button', { class: 'sb-options', type: 'button', title: t('Optionen'), onclick: () => this.#optionsMenu() },
      icon('SlidersHorizontal', 15), h('span', { text: t('Optionen …') }), icon('ChevronDown', 12));
    this.size = h('div', { class: 'sb-size', title: t('Seitengröße') });
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
    this.zoom = new ZoomCombo(app, 'sb-zoom');
    this.slider = new ZoomSlider(app);
    host.append(
      this.options,
      this.size,
      this.coords,
      this.hint,
      h('div', { class: 'sb-group sb-nav' }, c('firstPage'), c('prevPage'), h('div', { class: 'sb-pagebox' }, this.pageInput, this.pageTotal), c('nextPage'), c('lastPage')),
      h('div', { class: 'sb-group sb-layout' }, c('layoutSingle'), c('layoutContinuous'), c('layoutTwo')),
      h('div', { class: 'sb-group sb-zoomgroup' }, this.zoom.el, c('zoomOut'), this.slider.el, c('zoomIn')),
    );
  }

  #optionsMenu() {
    const cmds = this.app.commands;
    const item = (id) => ({ label: t(cmds.get(id).label), icon: cmds.get(id).icon, shortcut: cmds.shortcut(id), checked: cmds.get(id).checked?.(), disabled: !cmds.enabled(id), run: () => cmds.run(id) });
    showMenu([item('toggleLeft'), item('toggleRight'), '-', item('toggleAnnots'), item('highlightFields'), item('stickyTools'), '-', item('theme'), item('fullscreen'), '-', item('settings')], 0, 0, { anchor: this.options });
  }

  focusPageInput() {
    this.pageInput.focus();
    this.pageInput.select();
  }

  focusZoom() {
    this.zoom.focus();
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
    if (doc && view) {
      const p = doc.pages[view.current];
      const [x1, y1, x2, y2] = p.view;
      const rotated = (p.rotate || 0) % 180 !== 0;
      const cm = (v) => ((v * 2.54) / 72).toFixed(2);
      const [w, hgt] = rotated ? [y2 - y1, x2 - x1] : [x2 - x1, y2 - y1];
      this.size.textContent = `${cm(w)} × ${cm(hgt)} cm`;
    } else {
      this.size.textContent = '';
      this.coords.textContent = '';
    }
    this.zoom.refresh();
    this.slider.refresh();
    for (const b of this.host.querySelectorAll('.icon-btn')) {
      const id = [...b.classList].find((x) => x.startsWith('sb-'))?.slice(3);
      if (!id) continue;
      b.disabled = !app.commands.enabled(id);
      b.classList.toggle('on', !!app.commands.get(id).checked?.());
    }
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
