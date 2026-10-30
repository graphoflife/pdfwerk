// Full-text search over pdf.js text content with highlight rendering in the overlay.
import { svgEl } from './svg.js';

function normalize(s, caseSensitive) {
  const n = s.normalize('NFKC');
  return caseSensitive ? n : n.toLocaleLowerCase();
}

export class SearchController extends EventTarget {
  constructor(view) {
    super();
    this.view = view;
    this.texts = new Map(); // page -> { str, chars, items }
    this.matches = [];
    this.index = -1;
    this.query = '';
    this.token = 0;
  }

  async pageText(i) {
    let t = this.texts.get(i);
    if (t) return t;
    const proxy = this.view.doc.pages[i].proxy;
    const content = await proxy.getTextContent();
    let str = '';
    const chars = []; // per char: [itemIndex, offsetInItem] or null for separators
    content.items.forEach((it, idx) => {
      if (typeof it.str !== 'string') return;
      const s = it.str.normalize('NFKC');
      for (let k = 0; k < s.length; k++) chars.push([idx, k, s.length]);
      str += s;
      if (it.hasEOL) { str += ' '; chars.push(null); }
    });
    t = { str, chars, items: content.items };
    this.texts.set(i, t);
    return t;
  }

  invalidate() {
    this.texts.clear();
    if (this.query) this.find(this.query, this.opts);
  }

  async find(query, opts = {}) {
    this.query = query;
    this.opts = opts;
    const token = ++this.token;
    this.matches = [];
    this.index = -1;
    this.#renderAll();
    if (!query) { this.emit(); return; }
    const q = normalize(query, opts.caseSensitive);
    const start = this.view.current;
    const n = this.view.doc.numPages;
    let firstAfter = -1;
    for (let k = 0; k < n; k++) {
      const i = k;
      const text = await this.pageText(i);
      if (token !== this.token) return;
      const hay = normalize(text.str, opts.caseSensitive);
      let pos = hay.indexOf(q);
      while (pos >= 0) {
        const end = pos + q.length;
        const ok = !opts.wholeWord || ((pos === 0 || !/[\p{L}\p{N}]/u.test(hay[pos - 1])) && (end >= hay.length || !/[\p{L}\p{N}]/u.test(hay[end])));
        if (ok) {
          this.matches.push({ page: i, rects: this.#rects(text, pos, end) });
          if (firstAfter < 0 && i >= start) firstAfter = this.matches.length - 1;
        }
        pos = hay.indexOf(q, pos + Math.max(1, q.length));
      }
      if (k % 20 === 19) this.emit();
    }
    if (this.matches.length) {
      this.index = firstAfter >= 0 ? firstAfter : 0;
      this.#reveal();
    }
    this.#renderAll();
    this.emit();
  }

  #rects(text, from, to) {
    const groups = new Map();
    for (let c = from; c < to; c++) {
      const m = text.chars[c];
      if (!m) continue;
      const g = groups.get(m[0]) || { item: m[0], a: m[1], b: m[1] + 1, len: m[2] };
      g.a = Math.min(g.a, m[1]);
      g.b = Math.max(g.b, m[1] + 1);
      groups.set(m[0], g);
    }
    const out = [];
    for (const g of groups.values()) {
      const it = text.items[g.item];
      const [a, b, c, d, e, f] = it.transform;
      const ang = Math.atan2(b, a);
      const ux = Math.cos(ang), uy = Math.sin(ang);
      const hgt = it.height || Math.hypot(c, d) || 10;
      const w = it.width || 0;
      const x0 = (w * g.a) / g.len, x1 = (w * g.b) / g.len;
      const nx = -uy, ny = ux;
      const p = (s, v) => [e + ux * s + nx * v, f + uy * s + ny * v];
      out.push([p(x0, -hgt * 0.22), p(x1, -hgt * 0.22), p(x1, hgt * 0.95), p(x0, hgt * 0.95)]);
    }
    return out;
  }

  next(dir = 1) {
    if (!this.matches.length) return;
    this.index = (this.index + dir + this.matches.length) % this.matches.length;
    this.#reveal();
    this.#renderAll();
    this.emit();
  }

  #reveal() {
    const m = this.matches[this.index];
    if (!m) return;
    const pts = m.rects.flat();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    this.view.revealRect(m.page, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }

  clear() {
    this.token++;
    this.query = '';
    this.matches = [];
    this.index = -1;
    this.#renderAll();
    this.emit();
  }

  #renderAll() {
    for (const pv of this.view.pageViews) if (pv.visible) this.renderPage(pv);
  }

  renderPage(pv) {
    pv.searchG.replaceChildren();
    this.matches.forEach((m, i) => {
      if (m.page !== pv.index) return;
      for (const r of m.rects) {
        pv.searchG.append(svgEl('polygon', {
          points: r.map((p) => p.join(',')).join(' '),
          class: i === this.index ? 'search-hit current' : 'search-hit',
        }));
      }
    });
  }

  emit() {
    this.dispatchEvent(new Event('update'));
  }
}
