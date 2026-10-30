// File backstage: full-window File menu with a command column on the left and pages for
// opening (recent files), creating and exporting documents.
import { h, iconButton, toast } from './dom.js';
import { icon } from './icons.js';
import { t, fmtDate } from '../i18n.js';
import { listRecent, removeRecent, openRecent, recentSupported } from '../core/recent.js';

const ENTRIES = [
  { page: 'open', label: 'Öffnen' },
  { cmd: 'save' }, { cmd: 'saveAs' },
  '-',
  { page: 'new', label: 'Neues Dokument' },
  '-',
  { cmd: 'print' }, { page: 'export', label: 'Exportieren' },
  '-',
  { cmd: 'properties' },
  '-',
  { cmd: 'close' }, { cmd: 'closeAll' },
  '-',
  { cmd: 'settings' }, { cmd: 'shortcuts' }, { cmd: 'about' },
];

const PAGES = {
  new: { title: 'Neues Dokument', items: [['new', 'Leeres Dokument mit wählbarer Seitengröße und Seitenzahl.'], ['fromImages', 'Fotos oder Scans zu einem PDF zusammenfassen.']] },
  export: {
    title: 'Exportieren', items: [
      ['exportImages', 'Seiten als PNG- oder JPEG-Bilder speichern.'],
      ['extractPages', 'Ausgewählte Seiten als neues PDF speichern.'],
      ['splitDoc', 'Dokument in mehrere PDFs aufteilen (ZIP).'],
      ['saveFlat', 'Kopie mit eingebrannten Anmerkungen und Formularfeldern.'],
    ],
  },
};

export class Backstage {
  constructor(app) {
    this.app = app;
    this.page = 'open';
    this.filter = '';
    this.el = h('div', { class: 'backstage', hidden: true, role: 'dialog', 'aria-label': t('Datei'),
      onkeydown: (e) => {
        if (e.key === 'Escape') { e.preventDefault(); this.close(); }
        e.stopPropagation();
      } });
  }

  get isOpen() {
    return !this.el.hidden;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(page = 'open') {
    this.page = page;
    const top = this.app.tabsHost.getBoundingClientRect().bottom;
    this.el.style.top = `${Math.round(top)}px`;
    this.el.hidden = false;
    this.render();
    this.app.refreshUI();
  }

  close() {
    if (!this.isOpen) return;
    this.el.hidden = true;
    this.app.refreshUI();
    this.app.view?.el.focus({ preventScroll: true });
  }

  /** Run a command after closing the backstage. */
  #run(id) {
    this.close();
    this.app.commands.run(id);
  }

  render() {
    const cmds = this.app.commands;
    const nav = h('nav', { class: 'bs-nav' },
      h('button', { class: 'bs-back', type: 'button', title: t('Zurück'), onclick: () => this.close() }, icon('ArrowLeft', 18)));
    for (const e of ENTRIES) {
      if (e === '-') { nav.append(h('div', { class: 'bs-sep' })); continue; }
      if (e.page) {
        nav.append(h('button', { class: `bs-item ${this.page === e.page ? 'active' : ''}`, type: 'button', text: t(e.label), onclick: () => { this.page = e.page; this.render(); } }));
        continue;
      }
      const c = cmds.get(e.cmd);
      nav.append(h('button', {
        class: 'bs-item', type: 'button', disabled: !cmds.enabled(e.cmd), text: t(c.label).replace(/ …$/, ''),
        title: cmds.shortcut(e.cmd) || '', onclick: () => this.#run(e.cmd),
      }));
    }
    const content = this.page === 'open' ? this.#openPage() : this.#optionsPage(PAGES[this.page]);
    this.el.replaceChildren(nav, content);
    nav.querySelector('.bs-item.active, .bs-item:not(:disabled)')?.focus({ preventScroll: true });
  }

  #option(iconName, label, text, onclick, active = false) {
    return h('button', { class: `bs-option ${active ? 'active' : ''}`, type: 'button', onclick },
      icon(iconName, 32), h('span', {}, h('b', { text: label }), text ? h('small', { text }) : null));
  }

  #optionsPage(page) {
    const cmds = this.app.commands;
    return h('section', { class: 'bs-main' },
      h('h1', { text: t(page.title) }),
      h('div', { class: 'bs-options wide' }, ...page.items.map(([id, text]) => {
        const b = this.#option(cmds.get(id).icon, t(cmds.get(id).label).replace(/ …$/, ''), t(text), () => this.#run(id));
        b.disabled = !cmds.enabled(id);
        return b;
      })));
  }

  #openPage() {
    const list = h('div', { class: 'bs-recent-list' });
    const filter = h('input', {
      class: 'input', type: 'search', placeholder: t('Suchen …'), value: this.filter,
      oninput: () => { this.filter = filter.value; this.#fillRecent(list); },
    });
    const middle = h('section', { class: 'bs-main bs-middle' },
      h('h1', { text: t('Öffnen') }),
      h('div', { class: 'bs-options' },
        this.#option('Clock', t('Zuletzt verwendet'), '', () => filter.focus(), true),
        this.#option('FolderOpen', t('Durchsuchen …'), t('PDF-Datei vom Computer öffnen'), () => this.#run('open'))));
    const right = h('section', { class: 'bs-side' },
      h('h2', { text: t('Zuletzt verwendete Dateien') }),
      recentSupported ? filter : null,
      list);
    this.#fillRecent(list);
    return h('div', { class: 'bs-split' }, middle, right);
  }

  async #fillRecent(list) {
    if (!recentSupported) {
      list.replaceChildren(h('p', { class: 'hint', text: t('Dein Browser erlaubt keine Liste zuletzt verwendeter Dateien. In Chrome oder Edge werden geöffnete Dateien hier angezeigt.') }));
      return;
    }
    const q = this.filter.trim().toLowerCase();
    const entries = (await listRecent()).filter((e) => !q || e.name.toLowerCase().includes(q));
    if (!entries.length) {
      list.replaceChildren(h('p', { class: 'hint', text: q ? t('Keine Treffer') : t('Noch keine Dateien geöffnet.') }));
      return;
    }
    list.replaceChildren(...entries.map((e) => recentRow(this.app, e, () => this.close(), () => this.#fillRecent(list))));
  }
}

/** One row of the recent-files list (also used on the start screen). */
export function recentRow(app, entry, beforeOpen, onRemoved) {
  return h('div', { class: 'recent-row' },
    h('button', {
      class: 'recent-open', type: 'button', title: entry.name,
      onclick: async () => {
        const file = await openRecent(entry).catch(() => null);
        if (!file) {
          toast(t('Die Datei ist nicht mehr verfügbar oder der Zugriff wurde verweigert.'), { type: 'error' });
          return;
        }
        beforeOpen?.();
        await app.openFile(file, entry.handle);
      },
    }, icon('FileText', 22), h('span', {}, h('b', { text: entry.name }), h('small', { text: fmtDate(new Date(entry.time).toISOString()) }))),
    iconButton('X', t('Aus der Liste entfernen'), async () => { await removeRecent(entry.id); onRemoved?.(); }, { size: 14, cls: 'recent-remove' }));
}
