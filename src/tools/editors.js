// In-place editors: free-text editing (textarea over the page) and the comment popup.
import { cloneAnnotation, newId } from '../core/model.js';
import { fitFreeText, freetextPadding, buildAppearance } from '../core/appearance.js';
import { normRect } from '../core/geometry.js';
import { CSS_FONT } from '../core/fonts.js';
import { cssColor } from '../viewer/svg.js';
import { t, fmtDate } from '../i18n.js';
import { icon } from '../ui/icons.js';

export class TextEditor {
  constructor(app) {
    this.app = app;
    this.ta = null;
  }

  get active() {
    return !!this.ta;
  }

  open(view, pv, id, { isNew = false, caretEnd = true } = {}) {
    this.commit();
    const f = view.doc.find(id);
    if (!f || f.a.type !== 'freetext') return;
    this.view = view;
    this.pv = pv;
    this.id = id;
    this.isNew = isNew;
    this.original = cloneAnnotation(f.a);
    view.hideHandles = true;
    pv.hiddenText.add(id);
    pv.renderAnnotations();
    const ta = (this.ta = document.createElement('textarea'));
    ta.className = 'text-editor';
    ta.spellcheck = true;
    ta.value = f.a.text || '';
    ta.addEventListener('input', () => this.#onInput());
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        this.commit();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        ta.setRangeText('    ', ta.selectionStart, ta.selectionEnd, 'end');
        this.#onInput();
      }
    });
    ta.addEventListener('blur', () => setTimeout(() => { if (this.ta === ta && document.activeElement !== ta) this.commit(); }, 0));
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    pv.el.append(ta);
    this.#position(f.a);
    ta.focus({ preventScroll: true });
    if (caretEnd) ta.setSelectionRange(ta.value.length, ta.value.length);
    else ta.select();
  }

  #draft() {
    const f = this.view.doc.find(this.id);
    if (!f) return null;
    const d = cloneAnnotation(f.a);
    d.text = this.ta.value;
    d.rect = fitFreeText(d);
    return d;
  }

  #onInput() {
    const d = this.#draft();
    if (!d) return;
    this.pv.setDrafts([d]);
    this.#position(d);
  }

  #position(a) {
    const { pv, ta } = this;
    const r = normRect(a.rect);
    const [x, y] = pv.toScreen(r[0], r[3]);
    const s = pv.scale;
    const rot = (pv.viewport.rotation || 0) % 360;
    const f = a.font || {};
    const pad = freetextPadding(a) * s;
    const w = (r[2] - r[0]) * s, h = (r[3] - r[1]) * s;
    Object.assign(ta.style, {
      left: `${x}px`, top: `${y}px`, width: `${w + (a.autoWidth ? (f.size || 12) * s : 0)}px`, height: `${h}px`,
      transform: rot ? `rotate(${rot}deg)` : '',
      fontFamily: CSS_FONT[f.family] || CSS_FONT.Helvetica,
      fontSize: `${(f.size || 12) * s}px`,
      fontWeight: f.bold ? 'bold' : 'normal',
      fontStyle: f.italic ? 'italic' : 'normal',
      padding: `${pad}px`,
      color: cssColor(a.textColor || [0, 0, 0]),
      textAlign: a.align || 'left',
      whiteSpace: a.autoWidth ? 'pre' : 'pre-wrap',
    });
  }

  commit() {
    const ta = this.ta;
    if (!ta) return;
    this.ta = null;
    const { view, pv, id, isNew } = this;
    const text = ta.value;
    ta.remove();
    pv.hiddenText.delete(id);
    pv.drafts.delete(id);
    view.hideHandles = false;
    const f = view.doc.find(id);
    if (!f) { pv.renderAnnotations(); return; }
    if (!text.trim()) {
      if (isNew) view.doc.cancelAdd(id);
      else view.doc.remove([id], { label: 'Text löschen' });
      return;
    }
    if (text !== this.original.text) {
      view.doc.update([id], { text }, { history: !isNew, label: 'Text bearbeiten' });
    } else {
      pv.renderAnnotations();
    }
    view.select([id]);
  }

  cancel() {
    this.commit();
  }
}

/** Popup for an annotation's comment text and replies. */
export class NotePopup {
  constructor(app) {
    this.app = app;
    this.el = null;
  }

  get active() {
    return !!this.el;
  }

  open(view, pv, id, { focus = true } = {}) {
    this.close();
    const f = view.doc.find(id);
    if (!f) return;
    this.view = view;
    this.pv = pv;
    this.id = id;
    const a = f.a;
    const el = (this.el = document.createElement('div'));
    el.className = 'note-popup';
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    });
    const head = document.createElement('div');
    head.className = 'note-head';
    const who = document.createElement('div');
    who.className = 'note-who';
    who.textContent = a.author || t('Unbekannt');
    const when = document.createElement('div');
    when.className = 'note-when';
    when.textContent = fmtDate(a.modified);
    const close = document.createElement('button');
    close.className = 'icon-btn';
    close.title = t('Schließen');
    close.append(icon('X'));
    close.onclick = () => this.close();
    head.append(who, when, close);
    const ta = (this.ta = document.createElement('textarea'));
    ta.value = a.contents || '';
    ta.placeholder = t('Kommentar eingeben …');
    ta.rows = 5;
    const replies = document.createElement('div');
    replies.className = 'note-replies';
    for (const r of a.replies || []) {
      const d = document.createElement('div');
      d.className = 'note-reply';
      const h = document.createElement('div');
      h.className = 'note-reply-head';
      h.textContent = `${r.author || t('Unbekannt')} · ${fmtDate(r.modified)}`;
      const b = document.createElement('div');
      b.textContent = r.contents;
      d.append(h, b);
      replies.append(d);
    }
    const replyRow = document.createElement('div');
    replyRow.className = 'note-reply-row';
    const replyInput = document.createElement('input');
    replyInput.placeholder = t('Antworten …');
    const replyBtn = document.createElement('button');
    replyBtn.className = 'btn small';
    replyBtn.textContent = t('Antworten');
    const sendReply = () => {
      const v = replyInput.value.trim();
      if (!v) return;
      this.#saveContents();
      view.doc.update([id], (n) => {
        n.replies = [...(n.replies || []), { id: newId(), author: this.app.prefs.get('author', ''), contents: v, modified: new Date().toISOString(), dirty: true }];
      }, { label: 'Antworten' });
      this.open(view, pv, id, { focus: false });
    };
    replyBtn.onclick = sendReply;
    replyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendReply(); } });
    replyRow.append(replyInput, replyBtn);
    el.append(head, ta, replies, replyRow);
    pv.el.append(el);
    this.#position(a);
    if (focus) ta.focus({ preventScroll: true });
  }

  #position(a) {
    const { pv, el } = this;
    const box = buildAppearance(a, pv.doc.images).bbox;
    const [x1, y1] = pv.toScreen(box[2], box[3]);
    const [x2, y2] = pv.toScreen(box[0], box[1]);
    const right = Math.max(x1, x2) + 8;
    const top = Math.min(y1, y2);
    const w = 260;
    const pageW = pv.el.clientWidth;
    el.style.left = `${right + w > pageW ? Math.max(4, Math.min(x1, x2) - w - 8) : right}px`;
    el.style.top = `${Math.max(4, top)}px`;
  }

  #saveContents() {
    if (!this.el) return;
    const f = this.view.doc.find(this.id);
    if (f && (f.a.contents || '') !== this.ta.value) {
      this.view.doc.update([this.id], { contents: this.ta.value }, { label: 'Kommentar bearbeiten' });
    }
  }

  close() {
    if (!this.el) return;
    this.#saveContents();
    this.el.remove();
    this.el = null;
  }
}
