// Drawing tools. Shift constrains: lines/segments snap to 45° steps (0°, 45°, 90° …),
// rectangles/ellipses become squares/circles, freehand strokes become straight lines.
// Alt draws rectangles/ellipses from the centre.
import { createAnnotation, cloneAnnotation } from '../core/model.js';
import { fitFreeText, NOTE_SIZE, buildAppearance } from '../core/appearance.js';
import {
  rectFromPoints, snapAngle, squareFrom, dist, clamp, boxIntersects, expandBox, bboxOfPoints, normRect,
} from '../core/geometry.js';

export class Tool {
  constructor(app, def) {
    this.app = app;
    this.def = def;
    this.id = def.id;
  }

  get mode() { return 'draw'; }
  get cursor() { return 'crosshair'; }
  get style() { return this.app.tools.styleFor(this.id); }

  make(type, props) {
    const s = structuredClone(this.style);
    delete s.measure;
    return createAnnotation(type, { author: this.app.prefs.get('author', ''), ...s, ...props });
  }

  finish(view, pv, list, label) {
    view.doc.add(pv.index, list, { label: label || 'Anmerkung hinzufügen' });
    this.app.tools.afterCreate(view, list.map((a) => a.id), this);
  }

  activate() {}
  deactivate() { this.cancel(); }
  cancel() {}
  onKeyDown() { return false; }
}

export function clampToPage(pv, p) {
  const [x1, y1, x2, y2] = normRect(pv.viewBox);
  return [clamp(p[0], x1, x2), clamp(p[1], y1, y2)];
}

const minScreen = (pv, a, b) => dist(a, b) * pv.scale;

// -------------------------------------------------------------------- rectangles & ellipses
export class DragShapeTool extends Tool {
  onPointerDown(ev) {
    if (!ev.pv) return false;
    this.s = { pv: ev.pv, p0: clampToPage(ev.pv, ev.pt) };
    return true;
  }

  #rect(ev, s = this.s) {
    const { pv, p0 } = s;
    let p1 = clampToPage(pv, ev.pt);
    if (ev.shift) p1 = squareFrom(p0, p1);
    if (ev.alt) return rectFromPoints([2 * p0[0] - p1[0], 2 * p0[1] - p1[1]], p1);
    return rectFromPoints(p0, p1);
  }

  #annot(rect) {
    const type = this.def.type;
    if (type === 'redact') return this.make('redact', { rect, color: [0.85, 0, 0], fill: [0, 0, 0] });
    return this.make(type, { rect });
  }

  onPointerMove(ev) {
    if (!this.s) return;
    this.s.pv.setPreview(this.#annot(this.#rect(ev)));
  }

  onPointerUp(ev) {
    const s = this.s;
    this.s = null;
    if (!s) return;
    s.pv.setPreview(null);
    if (ev.cancelled) return;
    const rect = this.#rect(ev, s);
    if ((rect[2] - rect[0]) * s.pv.scale < 4 && (rect[3] - rect[1]) * s.pv.scale < 4) return;
    this.finish(ev.view, s.pv, [this.#annot(rect)]);
  }

  cancel() {
    this.s?.pv.setPreview(null);
    this.s = null;
  }
}

// -------------------------------------------------------------------- lines, arrows, distance
export class LineTool extends Tool {
  #point(ev) {
    const { pv, p0 } = this.s;
    let p = clampToPage(pv, ev.pt);
    if (ev.shift) p = snapAngle(p0, p);
    return p;
  }

  #annot(p0, p1) {
    if (this.def.type === 'measure') return this.make('measure', { points: [p0, p1], measure: { mode: 'distance', ...this.style.measure } });
    return this.make('line', { points: [p0, p1] });
  }

  onPointerDown(ev) {
    if (!ev.pv) return false;
    if (this.s?.waiting) {
      if (ev.pv !== this.s.pv) return true;
      const p1 = this.#point(ev);
      this.#commit(ev.view, p1);
      return true;
    }
    this.s = { pv: ev.pv, p0: clampToPage(ev.pv, ev.pt), waiting: false };
    return true;
  }

  onPointerMove(ev) {
    if (!this.s) return;
    this.s.pv.setPreview(this.#annot(this.s.p0, this.#point(ev)));
  }

  onHover(ev) {
    if (this.s?.waiting && ev.pv === this.s.pv) this.onPointerMove(ev);
  }

  onPointerUp(ev) {
    const s = this.s;
    if (!s || s.waiting) return;
    if (ev.cancelled) return this.cancel();
    const p1 = this.#point(ev);
    if (minScreen(s.pv, s.p0, p1) < 4) {
      // Click-move-click mode
      s.waiting = true;
      return;
    }
    this.#commit(ev.view, p1);
  }

  #commit(view, p1) {
    const s = this.s;
    this.s = null;
    s.pv.setPreview(null);
    if (minScreen(s.pv, s.p0, p1) < 3) return;
    this.finish(view, s.pv, [this.#annot(s.p0, p1)]);
  }

  onKeyDown(e) {
    if (e.key === 'Escape' && this.s) { this.cancel(); return true; }
    return false;
  }

  cancel() {
    this.s?.pv.setPreview(null);
    this.s = null;
  }
}

// -------------------------------------------------------------------- polylines, polygons, clouds, area
export class PolyTool extends Tool {
  get closed() { return ['polygon', 'cloud', 'area'].includes(this.def.variant); }

  #annot(points) {
    const v = this.def.variant;
    if (v === 'perimeter' || v === 'area') {
      return this.make('measure', { points, measure: { mode: v, ...this.style.measure } });
    }
    return this.make(this.closed ? 'polygon' : 'polyline', { points, ...(v === 'cloud' ? { dash: 'cloudy' } : {}) });
  }

  #point(ev) {
    let p = clampToPage(this.s.pv, ev.pt);
    const pts = this.s.points;
    if (ev.shift && pts.length) p = snapAngle(pts[pts.length - 1], p);
    return p;
  }

  onPointerDown(ev) {
    if (!ev.pv) return false;
    if (!this.s) this.s = { pv: ev.pv, points: [] };
    if (ev.pv !== this.s.pv) return true;
    const p = this.#point(ev);
    const pts = this.s.points;
    if (pts.length >= 3 && this.closed && minScreen(ev.pv, p, pts[0]) < 8) {
      this.#commit(ev.view);
      return true;
    }
    if (ev.raw.detail >= 2) return true; // the double-click finishes (handled in onDoubleClick)
    pts.push(p);
    this.#preview(p);
    return true;
  }

  #preview(cursor) {
    const pts = [...this.s.points];
    if (cursor && (!pts.length || dist(pts[pts.length - 1], cursor) > 0)) pts.push(cursor);
    this.s.pv.setPreview(pts.length >= 2 ? this.#annot(pts) : null);
  }

  onPointerMove(ev) {
    if (this.s && ev.pv === this.s.pv) this.#preview(this.#point(ev));
  }

  onHover(ev) {
    this.onPointerMove(ev);
  }

  onPointerUp() {}

  onDoubleClick(ev) {
    if (this.s) this.#commit(ev.view);
  }

  onKeyDown(e, view) {
    if (!this.s) return false;
    if (e.key === 'Enter') { this.#commit(view); return true; }
    if (e.key === 'Escape') { this.cancel(); return true; }
    if (e.key === 'Backspace') {
      this.s.points.pop();
      this.#preview(null);
      return true;
    }
    return false;
  }

  #commit(view) {
    const s = this.s;
    this.s = null;
    if (!s) return;
    s.pv.setPreview(null);
    // drop duplicate trailing points (from double-click)
    const pts = s.points.filter((p, i, arr) => i === 0 || minScreen(s.pv, p, arr[i - 1]) > 2);
    if (pts.length < (this.closed ? 3 : 2)) return;
    this.finish(view, s.pv, [this.#annot(pts)]);
  }

  cancel() {
    this.s?.pv.setPreview(null);
    this.s = null;
  }
}

// -------------------------------------------------------------------- freehand & eraser
export class InkTool extends Tool {
  get cursor() { return 'crosshair'; }

  onPointerDown(ev) {
    if (!ev.pv) return false;
    this.s = { pv: ev.pv, points: [clampToPage(ev.pv, ev.pt)] };
    return true;
  }

  #points(ev) {
    const pts = this.s.points;
    if (ev.shift) return [pts[0], snapAngle(pts[0], clampToPage(this.s.pv, ev.pt))];
    return pts;
  }

  onPointerMove(ev) {
    if (!this.s) return;
    const p = clampToPage(this.s.pv, ev.pt);
    const pts = this.s.points;
    if (minScreen(this.s.pv, pts[pts.length - 1], p) >= 1.5) pts.push(p);
    this.s.pv.setPreview(this.make('ink', { paths: [this.#points(ev)] }));
  }

  onPointerUp(ev) {
    const s = this.s;
    if (!s) return;
    let path = this.#points(ev);
    this.s = null;
    s.pv.setPreview(null);
    if (ev.cancelled) return;
    if (path.length === 1) path = [path[0], [path[0][0] + 0.01, path[0][1]]];
    path = path.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
    const view = ev.view;
    // Strokes drawn in quick succession are merged into one ink annotation (handwriting).
    const last = this.lastStroke;
    const prev = last && Date.now() - last.time < 1500 && last.page === s.pv.index ? view.doc.find(last.id) : null;
    if (prev && !ev.shift) {
      const n = cloneAnnotation(prev.a);
      n.paths.push(path);
      view.doc.replace([n], { label: 'Freihand' });
      this.lastStroke = { id: n.id, page: s.pv.index, time: Date.now() };
      return;
    }
    const a = this.make('ink', { paths: [path] });
    this.lastStroke = { id: a.id, page: s.pv.index, time: Date.now() };
    view.doc.add(s.pv.index, [a], { label: 'Freihand' });
  }

  cancel() {
    this.s?.pv.setPreview(null);
    this.s = null;
  }
}

export class EraserTool extends Tool {
  get cursor() { return 'cell'; }

  onPointerDown(ev) {
    if (!ev.pv) return false;
    this.s = { pv: ev.pv, drafts: new Map() };
    this.#erase(ev);
    return true;
  }

  onPointerMove(ev) {
    if (this.s) this.#erase(ev);
  }

  #erase(ev) {
    const { pv, drafts } = this.s;
    const r = Math.max(4, (this.style.width || 6) * 1.5) / pv.scale * 2;
    const box = expandBox([ev.pt[0], ev.pt[1], ev.pt[0], ev.pt[1]], r);
    let changed = false;
    for (const a0 of pv.annots) {
      if (a0.type !== 'ink' || a0.locked) continue;
      const a = drafts.get(a0.id) || a0;
      if (!a.paths.length || !boxIntersects(bboxOfPoints(a.paths.flat()), box)) continue;
      const paths = [];
      let hit = false;
      for (const path of a.paths) {
        let cur = [];
        for (const p of path) {
          if (dist(p, ev.pt) <= r) {
            hit = true;
            if (cur.length > 1) paths.push(cur);
            cur = [];
          } else cur.push(p);
        }
        if (cur.length > 1) paths.push(cur);
      }
      if (hit) {
        drafts.set(a.id, { ...cloneAnnotation(a), paths });
        changed = true;
      }
    }
    if (changed) pv.setDrafts([...drafts.values()]);
  }

  onPointerUp(ev) {
    const s = this.s;
    this.s = null;
    if (!s) return;
    s.pv.drafts.clear();
    if (ev.cancelled || !s.drafts.size) { s.pv.renderAnnotations(); return; }
    const doc = ev.view.doc;
    doc.checkpoint('Radieren');
    const keep = [...s.drafts.values()].filter((a) => a.paths.length);
    const gone = [...s.drafts.values()].filter((a) => !a.paths.length).map((a) => a.id);
    if (keep.length) doc.replace(keep, { history: false });
    if (gone.length) doc.remove(gone, { history: false });
  }
}

// -------------------------------------------------------------------- sticky note
export class NoteTool extends Tool {
  get cursor() { return 'copy'; }

  onPointerDown(ev) {
    if (!ev.pv) return false;
    const p = clampToPage(ev.pv, ev.pt);
    const a = this.make('note', { rect: [p[0], p[1] - NOTE_SIZE, p[0] + NOTE_SIZE, p[1]], icon: 'Comment' });
    ev.view.doc.add(ev.pv.index, [a], { label: 'Notiz' });
    this.app.tools.afterCreate(ev.view, [a.id], this);
    this.app.notePopup.open(ev.view, ev.pv, a.id);
    return true;
  }
}

// -------------------------------------------------------------------- typewriter, text box, callout
export class FreeTextTool extends Tool {
  get cursor() { return this.def.variant === 'typewriter' ? 'text' : 'crosshair'; }

  onPointerDown(ev) {
    if (!ev.pv) return false;
    // Clicking an existing text box edits it.
    if (ev.hitId && this.def.variant !== 'callout') {
      const f = ev.view.doc.find(ev.hitId);
      if (f?.a.type === 'freetext' && !f.a.locked) {
        this.app.textEditor.open(ev.view, ev.pv, f.a.id);
        return true;
      }
    }
    this.s = { pv: ev.pv, p0: clampToPage(ev.pv, ev.pt) };
    return true;
  }

  #build(ev, final) {
    const { pv, p0 } = this.s;
    let p1 = clampToPage(pv, ev.pt);
    const v = this.def.variant;
    const size = this.style.font?.size || 12;
    const dragged = minScreen(pv, p0, p1) >= 6;
    if (v === 'callout') {
      if (ev.shift) p1 = snapAngle(p0, p1);
      if (!dragged && final) p1 = [p0[0] + 40, p0[1] + 40];
      const w = 140;
      const [vx1, vy1, vx2, vy2] = normRect(pv.viewBox);
      const knee = p1;
      let boxX = p1[0] >= p0[0] ? knee[0] + 18 : knee[0] - 18 - w;
      // keep the text box on the page
      if (boxX + w > vx2) boxX = knee[0] - 18 - w;
      if (boxX < vx1) boxX = Math.min(knee[0] + 18, vx2 - w);
      const top = clamp(knee[1] + size * 0.8, vy1 + size * 2, vy2);
      const a = this.make('freetext', { rect: [boxX, top - size * 2, boxX + w, top], text: final ? '' : ' ', callout: [p0, knee], autoWidth: false });
      a.rect = fitFreeText(a);
      return a;
    }
    if (!dragged) {
      // click: typewriter grows with the text, text box gets a default width
      const top = p0[1] + size * 0.6;
      const a = v === 'typewriter'
        ? this.make('freetext', { rect: [p0[0] - 3, top - size * 1.4, p0[0] + size, top], text: '', autoWidth: true })
        : this.make('freetext', { rect: [p0[0], p0[1] - size * 2, p0[0] + 180, p0[1]], text: '', autoWidth: false });
      a.rect = fitFreeText(a);
      return a;
    }
    const r = rectFromPoints(p0, p1);
    const a = this.make('freetext', { rect: r, text: '', autoWidth: false, minHeight: r[3] - r[1] });
    a.rect = fitFreeText(a);
    return a;
  }

  onPointerMove(ev) {
    if (!this.s) return;
    if (minScreen(this.s.pv, this.s.p0, ev.pt) < 6) return;
    this.s.pv.setPreview(this.#build(ev, false));
  }

  onPointerUp(ev) {
    const s = this.s;
    if (!s) return;
    s.pv.setPreview(null);
    if (ev.cancelled) { this.s = null; return; }
    const a = this.#build(ev, true);
    this.s = null;
    ev.view.doc.add(s.pv.index, [a], { label: 'Text hinzufügen' });
    this.app.tools.afterCreate(ev.view, [a.id], this, { select: false });
    this.app.textEditor.open(ev.view, s.pv, a.id, { isNew: true });
  }

  cancel() {
    this.s?.pv.setPreview(null);
    this.s = null;
  }
}

// -------------------------------------------------------------------- stamps, images, signatures
export class PlaceTool extends Tool {
  get cursor() { return 'copy'; }

  /** payload: { stamp: {...}, color, size: [w,h] } */
  arm(payload) {
    this.payload = payload;
  }

  activate() {
    if (!this.payload) this.app.tools.requestPayload(this);
  }

  /** Image payloads may have been prepared in another tab: make sure the doc has the image. */
  #ensureImage(doc) {
    const p = this.payload;
    if (p?.image && p.stamp?.imageId && !doc.images.has(p.stamp.imageId)) doc.images.set(p.stamp.imageId, p.image);
  }

  #annot(rect) {
    const p = this.payload;
    return this.make('stamp', { rect, stamp: structuredClone(p.stamp), color: p.color || this.style.color, fill: null, width: 0 });
  }

  #defaultRect(pt) {
    const [w, h] = this.payload.size;
    return [pt[0] - w / 2, pt[1] - h / 2, pt[0] + w / 2, pt[1] + h / 2];
  }

  onHover(ev) {
    if (!this.payload || !ev.pv || this.s) return;
    this.#ensureImage(ev.view.doc);
    if (this.hoverPv && this.hoverPv !== ev.pv) this.hoverPv.setPreview(null);
    this.hoverPv = ev.pv;
    const a = this.#annot(this.#defaultRect(ev.pt));
    a.opacity = 0.6;
    ev.pv.setPreview(a);
  }

  onPointerDown(ev) {
    if (!ev.pv || !this.payload) return false;
    this.#ensureImage(ev.view.doc);
    this.s = { pv: ev.pv, p0: ev.pt };
    return true;
  }

  #rect(ev, s = this.s) {
    const { p0, pv } = s;
    const p1 = ev.pt;
    if (minScreen(pv, p0, p1) < 6) return this.#defaultRect(p0);
    const [w0, h0] = this.payload.size;
    let w = Math.abs(p1[0] - p0[0]), h = Math.abs(p1[1] - p0[1]);
    if (!ev.shift) {
      const s = Math.max(w / w0, h / h0);
      w = w0 * s; h = h0 * s;
    }
    const x = p1[0] >= p0[0] ? p0[0] : p0[0] - w;
    const y = p1[1] >= p0[1] ? p0[1] : p0[1] - h;
    return [x, y, x + w, y + h];
  }

  onPointerMove(ev) {
    if (!this.s) return;
    this.s.pv.setPreview(this.#annot(this.#rect(ev)));
  }

  onPointerUp(ev) {
    const s = this.s;
    if (!s) return;
    this.s = null;
    s.pv.setPreview(null);
    if (ev.cancelled) return;
    this.finish(ev.view, s.pv, [this.#annot(this.#rect(ev, s))], 'Stempel');
  }

  cancel() {
    this.s?.pv.setPreview(null);
    this.hoverPv?.setPreview(null);
    this.s = null;
  }

  deactivate() {
    this.cancel();
    if (this.def.id !== 'stamp') this.payload = null;
  }
}

// -------------------------------------------------------------------- markup by area (non-text)
export function rectQuad(r) {
  const [x1, y1, x2, y2] = normRect(r);
  return [x1, y2, x2, y2, x1, y1, x2, y1];
}

export function annotBBox(a, images) {
  return buildAppearance(a, images).bbox;
}
