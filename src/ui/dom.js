// DOM helpers: element builder, toasts, modal dialogs, menus, page ranges, colour inputs.
import { icon } from './icons.js';
import { t } from '../i18n.js';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function iconButton(name, title, onClick, { cls = '', size = 18 } = {}) {
  return h('button', { class: `icon-btn ${cls}`, title, 'aria-label': title, type: 'button', onclick: onClick }, icon(name, size));
}

// ------------------------------------------------------------------ toasts
let toastHost;
export function toast(message, { type = 'info', timeout = 3500 } = {}) {
  toastHost ??= document.body.appendChild(h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' }));
  const el = h('div', { class: `toast toast-${type}` }, message);
  toastHost.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, timeout);
}

// ------------------------------------------------------------------ busy overlay
let busyEl, busyCount = 0;
export async function withBusy(label, fn) {
  busyCount++;
  busyEl ??= document.body.appendChild(h('div', { class: 'busy' }, h('div', { class: 'spinner' }), h('div', { class: 'busy-label' })));
  busyEl.querySelector('.busy-label').textContent = label || t('Bitte warten …');
  busyEl.classList.add('show');
  await new Promise((r) => setTimeout(r, 30));
  try {
    return await fn();
  } finally {
    if (--busyCount <= 0) {
      busyCount = 0;
      busyEl.classList.remove('show');
    }
  }
}

// ------------------------------------------------------------------ dialogs
/**
 * Modal dialog. buttons: [{ label, value, primary, danger }]. `validate(value)` can veto.
 * Resolves to the button value (or result of collect()) or null when cancelled.
 */
export function openDialog({ title, body, buttons = [{ label: t('OK'), value: true, primary: true }], width = 460, collect, onOpen, cls = '' }) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (v) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      prevFocus?.focus?.({ preventScroll: true });
      resolve(v);
    };
    const onKey = (e) => {
      if (!backdrop.isConnected) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const primary = buttons.find((b) => b.primary);
        if (primary) { e.preventDefault(); e.stopPropagation(); finish(primary); }
      }
      e.stopPropagation();
    };
    const finish = async (b) => {
      if (b.value === null) return close(null);
      const v = collect && b.primary ? await collect(b.value) : b.value;
      if (v === undefined) return; // collect vetoed
      close(v);
    };
    const footer = h('div', { class: 'dlg-footer' }, ...buttons.map((b) => h('button', {
      class: `btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}`, type: 'button', text: b.label, onclick: () => finish(b),
    })));
    const dlg = h('div', { class: `dialog ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { width: `min(${width}px, calc(100vw - 32px))` } },
      h('div', { class: 'dlg-head' }, h('h2', { text: title }), iconButton('X', t('Schließen'), () => close(null))),
      h('div', { class: 'dlg-body' }, body),
      footer);
    const backdrop = h('div', { class: 'backdrop', onpointerdown: (e) => { if (e.target === backdrop) close(null); } }, dlg);
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey, true);
    const first = dlg.querySelector('input:not([type=hidden]):not([type=color]), select, textarea') || footer.querySelector('.primary');
    first?.focus();
    if (first?.select && first.type === 'text') first.select();
    onOpen?.(dlg, close);
  });
}

export async function confirmDialog(message, { title = t('Bestätigen'), ok = t('OK'), danger = false } = {}) {
  const v = await openDialog({
    title, body: h('p', { text: message }),
    buttons: [{ label: t('Abbrechen'), value: null }, { label: ok, value: true, primary: true, danger }],
  });
  return !!v;
}

export async function promptDialog(label, value = '', { title = '', type = 'text' } = {}) {
  const input = h('input', { type, value, class: 'input' });
  return openDialog({
    title: title || label, body: h('label', { class: 'field' }, h('span', { text: label }), input),
    buttons: [{ label: t('Abbrechen'), value: null }, { label: t('OK'), value: true, primary: true }],
    collect: () => input.value,
  });
}

/** Labelled form row helper. */
export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { text: label }), control, hint ? h('small', { class: 'hint', text: hint }) : null);
}

export function select(options, value) {
  return h('select', { class: 'input' }, ...options.map(([v, l]) => h('option', { value: v, text: l, selected: String(v) === String(value) })));
}

// ------------------------------------------------------------------ menus
let openMenuEl = null;
export function closeMenus() {
  openMenuEl?.remove();
  openMenuEl = null;
}

/** items: [{ label, icon, shortcut, disabled, checked, run, items:[...] } | '-'] */
export function showMenu(items, x, y, { anchor = null } = {}) {
  closeMenus();
  const menu = buildMenu(items);
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  if (anchor) {
    const a = anchor.getBoundingClientRect();
    x = a.left;
    y = a.bottom + 2;
  }
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, y + r.height > innerHeight ? y - r.height : y)}px`;
  openMenuEl = menu;
  const items0 = menu.querySelectorAll('.menu-item:not([disabled])');
  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll(':scope > .menu-item:not([disabled])')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); closeMenus(); }
    e.stopPropagation();
  });
  items0[0]?.focus({ preventScroll: true });
  return menu;
}

function buildMenu(items) {
  const menu = h('div', { class: 'menu', role: 'menu', onpointerdown: (e) => e.stopPropagation() });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { menu.append(h('div', { class: 'menu-sep' })); continue; }
    const btn = h('button', {
      class: `menu-item ${it.checked ? 'checked' : ''}`, role: 'menuitem', type: 'button', disabled: !!it.disabled,
      onclick: (e) => {
        e.stopPropagation();
        if (it.items) return;
        closeMenus();
        it.run?.();
      },
    },
    h('span', { class: 'mi-icon' }, it.checked ? icon('Check', 15) : it.icon ? icon(it.icon, 15) : null),
    h('span', { class: 'mi-label', text: it.label }),
    h('span', { class: 'mi-key', text: it.shortcut || '' }),
    it.items ? h('span', { class: 'mi-sub' }, icon('ChevronRight', 14)) : null);
    if (it.items) {
      const sub = buildMenu(it.items);
      sub.classList.add('submenu');
      btn.append(sub);
    }
    menu.append(btn);
  }
  return menu;
}

document.addEventListener('pointerdown', () => closeMenus());
window.addEventListener('blur', () => closeMenus());

// ------------------------------------------------------------------ page ranges
/** Parse "1-3, 5, 8-" (1-based) into sorted 0-based indices. */
export function parseRange(str, total) {
  const out = new Set();
  const s = String(str || '').trim();
  if (!s || /^(alle|all|\*)$/i.test(s)) return [...Array(total).keys()];
  for (const part of s.split(/[,;\s]+/)) {
    if (!part) continue;
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (m) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : total;
      for (let i = Math.max(1, Math.min(a, b)); i <= Math.min(total, Math.max(a, b)); i++) out.add(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = +part;
      if (n >= 1 && n <= total) out.add(n - 1);
    } else if (/^(gerade|even)$/i.test(part)) {
      for (let i = 2; i <= total; i += 2) out.add(i - 1);
    } else if (/^(ungerade|odd)$/i.test(part)) {
      for (let i = 1; i <= total; i += 2) out.add(i - 1);
    } else return null;
  }
  return [...out].sort((a, b) => a - b);
}

export function formatRange(indices) {
  const s = [...indices].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(i === j ? `${s[i] + 1}` : `${s[i] + 1}-${s[j] + 1}`);
    i = j;
  }
  return parts.join(', ');
}

// ------------------------------------------------------------------ colours
export const toHex = (c) => (c ? `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}` : '#000000');
export const fromHex = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((v) => Math.round(v * 1000) / 1000);
};

export const SWATCHES = ['#000000', '#ffffff', '#7f7f7f', '#dc2626', '#f97316', '#facc15', '#16a34a', '#0ea5e9', '#2563eb', '#7c3aed', '#db2777', '#fff59d'];

/** Colour control with swatches; value null allowed when allowNone. */
export function colorControl(value, onChange, { allowNone = false } = {}) {
  const wrap = h('div', { class: 'color-ctl' });
  const input = h('input', { type: 'color', value: toHex(value || [0, 0, 0]), title: t('Eigene Farbe') });
  const render = (v) => {
    wrap.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', v != null && s.dataset.hex === toHex(v)));
    noneBtn?.classList.toggle('active', v == null);
    if (v) input.value = toHex(v);
  };
  input.addEventListener('input', () => { onChange(fromHex(input.value)); render(fromHex(input.value)); });
  let noneBtn = null;
  if (allowNone) {
    noneBtn = h('button', { type: 'button', class: 'swatch none', title: t('Keine'), onclick: () => { onChange(null); render(null); } });
    wrap.append(noneBtn);
  }
  for (const hex of SWATCHES) {
    wrap.append(h('button', {
      type: 'button', class: 'swatch', title: hex, dataset: { hex }, style: { background: hex },
      onclick: () => { onChange(fromHex(hex)); render(fromHex(hex)); },
    }));
  }
  wrap.append(input);
  render(value);
  return wrap;
}

export function downloadBlob(data, filename, type = 'application/pdf') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
