// Text selection and text markup (highlight, underline, strike-out, squiggly).
import { Tool, clampToPage, rectQuad } from './draw.js';
import { rectFromPoints } from '../core/geometry.js';

/** Convert the current DOM text selection into quads per page (user space). */
export function selectionToQuads(view) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return new Map();
  const range = sel.getRangeAt(0);
  const out = new Map();
  for (const pv of view.pageViews) {
    if (!pv.visible || !range.intersectsNode(pv.textDiv)) continue;
    const rects = [];
    const walker = document.createTreeWalker(pv.textDiv, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!range.intersectsNode(n) || !n.textContent.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      if (n === range.startContainer) r.setStart(n, range.startOffset);
      if (n === range.endContainer) r.setEnd(n, range.endOffset);
      if (r.collapsed) continue;
      for (const cr of r.getClientRects()) if (cr.width > 0.5 && cr.height > 0.5) rects.push(cr);
    }
    if (!rects.length) continue;
    const base = pv.el.getBoundingClientRect();
    const boxes = mergeLineRects(rects.map((r) => [r.left - base.left, r.top - base.top, r.right - base.left, r.bottom - base.top]));
    const quads = boxes.map(([l, t, r, b]) => {
      const ul = pv.toPdf(l, t), ur = pv.toPdf(r, t), ll = pv.toPdf(l, b), lr = pv.toPdf(r, b);
      return [...ul, ...ur, ...ll, ...lr].map((v) => Math.round(v * 100) / 100);
    });
    out.set(pv.index, quads);
  }
  return out;
}

/** Merge rectangles that sit on the same text line and touch each other. */
function mergeLineRects(rects) {
  rects.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out = [];
  for (const r of rects) {
    const h = r[3] - r[1];
    const prev = out.find((o) => {
      const oh = o[3] - o[1];
      const overlap = Math.min(o[3], r[3]) - Math.max(o[1], r[1]);
      return overlap > Math.min(h, oh) * 0.6 && r[0] <= o[2] + Math.max(h, oh) * 0.8 && r[2] >= o[0] - Math.max(h, oh) * 0.8;
    });
    if (prev) {
      prev[0] = Math.min(prev[0], r[0]); prev[1] = Math.min(prev[1], r[1]);
      prev[2] = Math.max(prev[2], r[2]); prev[3] = Math.max(prev[3], r[3]);
    } else out.push([...r]);
  }
  return out;
}

export class TextSelectTool extends Tool {
  get mode() { return 'text'; }
  get cursor() { return 'text'; }

  onPointerDown() {
    return 'native';
  }

  onPointerUp() {}
}

/** Create markup annotations of `type` from the current text selection. */
export function markupFromSelection(app, view, type) {
  const map = selectionToQuads(view);
  if (!map.size) return [];
  const style = app.tools.styleFor(type);
  const ids = [];
  view.doc.checkpoint('Textmarkierung');
  for (const [page, quads] of map) {
    const a = app.tools.get(type).make(type, { quads, color: style.color, opacity: style.opacity ?? 1 });
    view.doc.add(page, [a], { history: false });
    ids.push(a.id);
  }
  window.getSelection()?.removeAllRanges();
  return ids;
}

export class MarkupTool extends Tool {
  get mode() { return 'markup'; }
  get cursor() { return 'text'; }

  onPointerDown(ev) {
    if (!ev.pv) return false;
    if (ev.target.closest('.textLayer span')) {
      this.native = true;
      return 'native';
    }
    // Not on text: highlight an area by dragging a rectangle.
    window.getSelection()?.removeAllRanges();
    this.s = { pv: ev.pv, p0: clampToPage(ev.pv, ev.pt) };
    return true;
  }

  #areaAnnot(ev) {
    const r = rectFromPoints(this.s.p0, clampToPage(this.s.pv, ev.pt));
    return this.make(this.def.type, { quads: [rectQuad(r)] });
  }

  onPointerMove(ev) {
    if (this.s) this.s.pv.setPreview(this.#areaAnnot(ev));
  }

  onPointerUp(ev) {
    if (this.native) {
      this.native = false;
      setTimeout(() => {
        const ids = markupFromSelection(this.app, ev.view, this.def.type);
        if (ids.length) this.app.tools.afterCreate(ev.view, ids, this, { select: false });
      }, 0);
      return;
    }
    const s = this.s;
    if (!s) return;
    s.pv.setPreview(null);
    const a = this.#areaAnnot(ev);
    this.s = null;
    if (ev.cancelled) return;
    const q = a.quads[0];
    if (Math.abs(q[2] - q[0]) * s.pv.scale < 4 || Math.abs(q[1] - q[5]) * s.pv.scale < 4) return;
    this.finish(ev.view, s.pv, [a], 'Textmarkierung');
  }

  cancel() {
    this.s?.pv.setPreview(null);
    this.s = null;
  }
}
