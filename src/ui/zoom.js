// Zoom controls shared by the ribbon and the status bar: an editable percentage field with
// a preset menu, and a logarithmic zoom slider.
import { h, showMenu } from './dom.js';
import { icon } from './icons.js';
import { t, getLang } from '../i18n.js';

export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8];

const SLIDER_MIN = Math.log(0.1);
const SLIDER_MAX = Math.log(8);

const pct = (z) => `${(Math.round(z * 1000) / 10).toLocaleString(getLang() === 'de' ? 'de-DE' : 'en-US')} %`;

/** Editable zoom field ("125 %") with a dropdown of presets and fit modes. */
export class ZoomCombo {
  constructor(app, cls = '') {
    this.app = app;
    this.input = h('input', {
      class: 'input zc-input', type: 'text', 'aria-label': t('Zoom'), title: `${t('Zoom')} (Ctrl+Shift+M)`,
      onkeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); this.#apply(); }
        if (e.key === 'Escape') { e.preventDefault(); this.input.blur(); this.app.view?.el.focus({ preventScroll: true }); }
      },
      onfocus: () => this.input.select(),
      onblur: () => this.refresh(),
    });
    this.btn = h('button', { class: 'zc-btn', type: 'button', tabIndex: -1, title: t('Zoomstufen'), onclick: () => this.#menu() }, icon('ChevronDown', 12));
    this.el = h('div', { class: `zoom-combo ${cls}` }, this.input, this.btn);
  }

  focus() {
    this.input.focus();
  }

  #apply() {
    const view = this.app.view;
    const v = parseFloat(this.input.value.replace(',', '.'));
    if (view && v > 0) view.setZoom(v / 100);
    view?.el.focus({ preventScroll: true });
    this.refresh();
  }

  #menu() {
    const view = this.app.view;
    if (!view) return;
    showMenu([
      { label: t('Seitenbreite'), icon: 'StretchHorizontal', checked: view.fit === 'width', run: () => view.setFit('width') },
      { label: t('Ganze Seite'), icon: 'Expand', checked: view.fit === 'page', run: () => view.setFit('page') },
      '-',
      ...ZOOM_PRESETS.map((p) => ({ label: `${Math.round(p * 100)} %`, checked: !view.fit && Math.abs(view.zoom - p) < 0.001, run: () => view.setZoom(p) })),
    ], 0, 0, { anchor: this.el });
  }

  refresh() {
    const view = this.app.view;
    this.input.disabled = this.btn.disabled = !view;
    if (document.activeElement !== this.input) this.input.value = view ? pct(view.zoom) : '';
  }
}

/** Logarithmic zoom slider (10 % … 800 %). */
export class ZoomSlider {
  constructor(app) {
    this.app = app;
    this.el = h('input', {
      class: 'zoom-slider', type: 'range', min: 0, max: 1000, step: 1, 'aria-label': t('Zoom'),
      oninput: () => {
        const z = Math.exp(SLIDER_MIN + ((SLIDER_MAX - SLIDER_MIN) * this.el.value) / 1000);
        this.app.view?.setZoom(Math.round(z * 100) / 100);
      },
      onchange: () => this.app.view?.el.focus({ preventScroll: true }),
    });
  }

  refresh() {
    const view = this.app.view;
    this.el.disabled = !view;
    if (!view || document.activeElement === this.el) return;
    const v = ((Math.log(Math.min(8, Math.max(0.1, view.zoom))) - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 1000;
    this.el.value = String(Math.round(v));
  }
}
