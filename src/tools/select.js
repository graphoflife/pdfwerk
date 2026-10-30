// Selecting, moving, resizing and vertex-editing annotations (shared by Hand and Select tools).
import { svgEl } from '../viewer/svg.js';
import { buildAppearance } from '../core/appearance.js';
import {
  normRect, bboxOfPoints, mapBoxPoint, snapAngle, axisLock, boxIntersects, rectFromPoints, unionBox,
} from '../core/geometry.js';
import { cloneAnnotation, translateAnnotation, newId, POINT_TYPES } from '../core/model.js';

const RESIZABLE = new Set(['rect', 'ellipse', 'redact', 'stamp', 'freetext', 'ink']);
const HANDLE_SIZE = 9;

/** User-space frame used for resizing. */
export function frameOf(a) {
  if (a.type === 'ink') return bboxOfPoints(a.paths.flat());
  if (a.rect) return normRect(a.rect);
  if (a.points) return bboxOfPoints(a.points);
  return buildAppearance(a).bbox;
}

function screenRect(pv, r) {
  const [ax, ay] = pv.toScreen(r[0], r[1]);
  const [bx, by] = pv.toScreen(r[2], r[3]);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

function userRectFromScreen(pv, s) {
  const p = pv.toPdf(s[0], s[1]);
  const q = pv.toPdf(s[2], s[3]);
  return rectFromPoints(p, q);
}

/** Draw selection outline and handles for the page that holds the selection. */
export function drawHandles(view, pv) {
  const g = pv.handlesG;
  g.replaceChildren();
  if (!view.selection.size || view.selectionPage !== pv.index || view.hideHandles) return;
  const sel = view.selectedAnnots;
  if (!sel.length) return;
  let box = null;
  for (const a of sel) box = unionBox(box, buildAppearance(pv.drafts.get(a.id) || a, pv.doc.images).bbox);
  const s = screenRect(pv, box);
  g.append(svgEl('rect', { class: 'sel-outline', x: s[0] - 2, y: s[1] - 2, width: s[2] - s[0] + 4, height: s[3] - s[1] + 4 }));
  if (sel.length !== 1) return;
  const a = pv.drafts.get(sel[0].id) || sel[0];
  if (a.locked) return;
  const hs = HANDLE_SIZE;
  if (POINT_TYPES.has(a.type)) {
    a.points.forEach((p, i) => {
      const [x, y] = pv.toScreen(...p);
      g.append(svgEl('circle', { class: 'handle vertex', 'data-handle': `v${i}`, cx: x, cy: y, r: hs / 2 + 0.5 }));
    });
    return;
  }
  if (RESIZABLE.has(a.type)) {
    const f = screenRect(pv, frameOf(a));
    const mx = (f[0] + f[2]) / 2, my = (f[1] + f[3]) / 2;
    const pts = { nw: [f[0], f[1]], n: [mx, f[1]], ne: [f[2], f[1]], e: [f[2], my], se: [f[2], f[3]], s: [mx, f[3]], sw: [f[0], f[3]], w: [f[0], my] };
    for (const [k, [x, y]] of Object.entries(pts)) {
      g.append(svgEl('rect', { class: `handle h-${k}`, 'data-handle': k, x: x - hs / 2, y: y - hs / 2, width: hs, height: hs }));
    }
  }
  if (a.type === 'freetext' && a.callout?.length) {
    a.callout.forEach((p, i) => {
      const [x, y] = pv.toScreen(...p);
      g.append(svgEl('circle', { class: 'handle vertex', 'data-handle': `c${i}`, cx: x, cy: y, r: hs / 2 + 0.5 }));
    });
  }
}

/** Shared drag logic for selecting/moving/resizing annotations. */
export class SelectionController {
  constructor(app) {
    this.app = app;
    this.drag = null;
  }

  /** Returns true if the pointer-down was consumed. */
  onPointerDown(ev, { marquee = false } = {}) {
    const { view, pv } = ev;
    if (!pv) return false;
    if (ev.handle && view.selection.size === 1) {
      const a = view.selectedAnnots[0];
      if (!a || a.locked) return false;
      this.drag = { kind: 'handle', handle: ev.handle, pv, a, start: ev.pt, startLocal: ev.local, frame: frameOf(a), frameS: screenRect(pv, frameOf(a)) };
      view.hideHandles = false;
      return true;
    }
    if (ev.hitId) {
      const id = ev.hitId;
      if (ev.shift || ev.ctrl) {
        if (!view.selection.has(id) || ev.shift) view.select([id], { toggle: ev.ctrl && !ev.shift, add: ev.shift });
        else view.select([id], { toggle: true });
      } else if (!view.selection.has(id)) {
        view.select([id]);
      }
      if (!view.selection.has(id)) return true;
      const ids = [...view.selection].filter((x) => !view.doc.find(x)?.a.locked);
      this.drag = { kind: 'move', pv, ids, start: ev.pt, dx: 0, dy: 0, dup: false, moved: false, clickedId: id, mods: ev.shift || ev.ctrl };
      return true;
    }
    if (marquee) {
      if (!ev.shift && !ev.ctrl) view.clearSelection();
      this.drag = { kind: 'marquee', pv, startLocal: ev.local, add: ev.shift || ev.ctrl };
      return true;
    }
    if (!ev.shift && !ev.ctrl) view.clearSelection();
    return false;
  }

  onPointerMove(ev) {
    const d = this.drag;
    if (!d) return;
    const { pv } = d;
    if (d.kind === 'move') {
      let dx = ev.pt[0] - d.start[0], dy = ev.pt[1] - d.start[1];
      if (!d.moved && Math.hypot(dx, dy) * pv.scale < 3) return;
      d.moved = true;
      if (ev.shift) [dx, dy] = axisLock(dx, dy);
      d.dx = dx; d.dy = dy;
      d.dup = ev.ctrl;
      pv.setMoveOffset(d.ids, dx, dy);
      pv.handlesG.setAttribute('transform', `translate(${pv.toScreen(dx, dy)[0] - pv.toScreen(0, 0)[0]} ${pv.toScreen(dx, dy)[1] - pv.toScreen(0, 0)[1]})`);
      pv.el.classList.toggle('dup-cursor', d.dup);
      return;
    }
    if (d.kind === 'marquee') {
      const [x0, y0] = d.startLocal, [x1, y1] = ev.local;
      let r = pv.handlesG.querySelector('.marquee');
      if (!r) {
        r = svgEl('rect', { class: 'marquee' });
        pv.handlesG.append(r);
      }
      r.setAttribute('x', Math.min(x0, x1));
      r.setAttribute('y', Math.min(y0, y1));
      r.setAttribute('width', Math.abs(x1 - x0));
      r.setAttribute('height', Math.abs(y1 - y0));
      d.end = ev.local;
      return;
    }
    if (d.kind === 'handle') {
      const draft = this.#applyHandle(d, ev);
      if (draft) {
        d.draft = draft;
        pv.setDrafts([draft]);
      }
    }
  }

  #applyHandle(d, ev) {
    const { pv, a, handle } = d;
    const n = cloneAnnotation(a);
    if (handle[0] === 'v') {
      const i = +handle.slice(1);
      let p = ev.pt;
      if (ev.shift) {
        const ref = n.points[i - 1] || n.points[i + 1];
        if (ref) p = snapAngle(ref, p);
      }
      n.points[i] = p;
      return n;
    }
    if (handle[0] === 'c') {
      const i = +handle.slice(1);
      let p = ev.pt;
      if (ev.shift) {
        const ref = i === 0 ? n.callout[1] : n.callout[0];
        if (ref) p = snapAngle(ref, p);
      }
      n.callout[i] = p;
      return n;
    }
    // bbox handle in screen space
    const f = [...d.frameS];
    const [lx, ly] = ev.local;
    if (handle.includes('w')) f[0] = lx;
    if (handle.includes('e')) f[2] = lx;
    if (handle.includes('n')) f[1] = ly;
    if (handle.includes('s')) f[3] = ly;
    const keepAspect = (a.type === 'stamp') !== ev.shift && handle.length === 2;
    if (keepAspect) {
      const w0 = d.frameS[2] - d.frameS[0], h0 = d.frameS[3] - d.frameS[1];
      const w = f[2] - f[0], h = f[3] - f[1];
      const s = Math.max(Math.abs(w) / w0, Math.abs(h) / h0);
      const nw = w0 * s * Math.sign(w || 1), nh = h0 * s * Math.sign(h || 1);
      if (handle.includes('w')) f[0] = f[2] - nw; else f[2] = f[0] + nw;
      if (handle.includes('n')) f[1] = f[3] - nh; else f[3] = f[1] + nh;
    }
    const nf = userRectFromScreen(pv, [Math.min(f[0], f[2]), Math.min(f[1], f[3]), Math.max(f[0], f[2]), Math.max(f[1], f[3])]);
    if (nf[2] - nf[0] < 2 || nf[3] - nf[1] < 2) return null;
    if (a.type === 'ink') {
      n.paths = n.paths.map((path) => path.map((p) => mapBoxPoint(p, d.frame, nf)));
    } else {
      n.rect = nf;
      if (n.type === 'freetext') {
        n.autoWidth = false;
        n.minHeight = nf[3] - nf[1];
        if (n.callout) n.callout = n.callout.map((p, i) => (i === 1 ? mapBoxPoint(p, d.frame, nf) : p));
      }
    }
    return n;
  }

  onPointerUp(ev) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const { pv, view } = { pv: d.pv, view: ev.view };
    pv.handlesG.removeAttribute('transform');
    pv.el.classList.remove('dup-cursor');
    if (d.kind === 'move') {
      pv.setMoveOffset(d.ids, 0, 0);
      if (!d.moved || ev.cancelled) {
        if (!d.moved && !d.mods && view.selection.size > 1) view.select([d.clickedId]);
        return;
      }
      if (d.dup) {
        const clones = d.ids.map((id) => view.doc.find(id)).filter(Boolean).map((f) => ({ ...translateAnnotation(f.a, d.dx, d.dy), id: newId(), orig: undefined, replies: [] }));
        view.doc.add(pv.index, clones, { label: 'Duplizieren' });
        view.select(clones.map((c) => c.id));
      } else {
        view.doc.translate(d.ids, d.dx, d.dy);
      }
      return;
    }
    if (d.kind === 'marquee') {
      pv.handlesG.querySelector('.marquee')?.remove();
      if (!d.end) return;
      const r = rectFromPoints(pv.toPdf(...d.startLocal), pv.toPdf(...d.end));
      const ids = pv.annots.filter((a) => boxIntersects(buildAppearance(a, pv.doc.images).bbox, r)).map((a) => a.id);
      view.select(ids, { add: d.add });
      if (!ids.length) view.renderHandles(pv);
      return;
    }
    if (d.kind === 'handle') {
      pv.drafts.clear();
      if (d.draft && !ev.cancelled) view.doc.replace([d.draft], { label: 'Größe ändern' });
      else pv.renderAnnotations();
    }
  }

  get active() {
    return !!this.drag;
  }

  cancel() {
    if (!this.drag) return;
    const d = this.drag;
    this.drag = null;
    d.pv.setMoveOffset(d.ids || [], 0, 0);
    d.pv.handlesG.removeAttribute('transform');
    d.pv.clearDrafts();
    d.pv.handlesG.querySelector('.marquee')?.remove();
  }
}

/** Hover cursor feedback for handles/annotations. */
export function hoverCursor(ev) {
  if (ev.handle) {
    const h = ev.handle;
    if (h[0] === 'v' || h[0] === 'c') return 'move';
    const map = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };
    return map[h];
  }
  if (ev.hitId) return 'move';
  return null;
}
