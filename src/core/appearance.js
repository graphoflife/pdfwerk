// Turns an annotation model into drawing primitives. The SVG overlay and the PDF
// appearance-stream writer both consume these, so screen and file always match.
//
// Item kinds:
//   { t:'path', cmds, stroke:[r,g,b]|null, fill:[r,g,b]|null, width, dash:[..]|null, cap, join }
//   { t:'text', lines:[{s,x,y,w}], fontName, family, bold, italic, size, color }
//   { t:'image', imageId, x, y, w, h }
import {
  rectPath, roundRectPath, ellipsePath, ellipsePoints, polyPath, smoothPath, cloudPath, lineEnding,
  pathPoints, bboxOfPoints, unionBox, expandBox, normRect, dist, polylineLength, polygonArea,
  polygonCentroid, boxW, boxH,
} from './geometry.js';
import { layoutText, stdFontName, textWidth, fontAscent } from './fonts.js';
import { formatMeasure } from './model.js';

export const FREETEXT_MIN_PAD = 3;
export const NOTE_SIZE = 20;

export function freetextPadding(a) {
  return FREETEXT_MIN_PAD + (a.width > 0 ? a.width : 0);
}

function dashArray(a) {
  const w = Math.max(a.width, 0.5);
  if (a.dash === 'dashed') return [Math.max(3, w * 4), Math.max(2, w * 3)];
  if (a.dash === 'dotted') return [0.01, Math.max(2, w * 2.2)];
  return null;
}

function strokeItem(cmds, a, extra = {}) {
  const dotted = a.dash === 'dotted';
  return {
    t: 'path', cmds, stroke: a.color, fill: null, width: a.width,
    dash: dashArray(a), cap: dotted ? 1 : 0, join: 0, ...extra,
  };
}

function capItems(style, tip, from, a) {
  const end = lineEnding(style, tip, from, a.width);
  if (!end) return [];
  return [{
    t: 'path', cmds: end.cmds, stroke: a.color,
    fill: end.closed ? (a.fill || a.color) : null, width: a.width, dash: null, cap: 0, join: 1,
  }];
}

function lineItems(points, a, closed = false) {
  const items = [];
  if (points.length < 2) return items;
  items.push(strokeItem(polyPath(points, closed), a, closed ? { fill: a.fill } : { join: 1 }));
  if (!closed) {
    items.push(...capItems(a.startCap, points[0], points[1], a));
    const n = points.length;
    items.push(...capItems(a.endCap, points[n - 1], points[n - 2], a));
  }
  return items;
}

function closedShape(cmds, cloudPts, a) {
  if (a.dash === 'cloudy' && cloudPts) {
    const cloud = cloudPath(cloudPts, 4 + a.width * 2.5);
    return [{ t: 'path', cmds: cloud, stroke: a.width > 0 ? a.color : null, fill: a.fill, width: a.width, dash: null, cap: 1, join: 1 }];
  }
  return [{ ...strokeItem(cmds, a), stroke: a.width > 0 ? a.color : null, fill: a.fill }];
}

function insetRect(r, d) {
  const n = normRect(r);
  const dx = Math.min(d, boxW(n) / 2), dy = Math.min(d, boxH(n) / 2);
  return [n[0] + dx, n[1] + dy, n[2] - dx, n[3] - dy];
}

function textItem(layout, a, color, family, bold, italic, size) {
  return { t: 'text', lines: layout.lines, fontName: layout.fontName, family, bold: !!bold, italic: !!italic, size, color };
}

/** Text label with a white backing box, used by measurements. */
function labelItems(text, cx, cy, size = 9) {
  const fontName = stdFontName('Helvetica');
  const w = textWidth(text, fontName, size);
  const x = cx - w / 2, base = cy - size * 0.35;
  const pad = 1.5;
  return [
    { t: 'path', cmds: rectPath([x - pad, base - size * 0.28 - pad, x + w + pad, base + size * 0.78 + pad]), stroke: null, fill: [1, 1, 1], width: 0, dash: null, cap: 0, join: 0 },
    { t: 'text', lines: [{ s: text, x, y: base, w }], fontName, family: 'Helvetica', size, color: [0, 0, 0] },
  ];
}

export function measureLabel(a) {
  const m = a.measure || {};
  const pts = a.points || [];
  if (m.mode === 'area') return formatMeasure(polygonArea(pts), m, 'area');
  return formatMeasure(polylineLength(m.mode === 'perimeter' ? [...pts] : pts.slice(0, 2)), m);
}

/** Point on the rectangle's border closest to p (midpoints of edges), for callouts. */
export function calloutAttach(rect, p) {
  const [x1, y1, x2, y2] = normRect(rect);
  const cands = [[(x1 + x2) / 2, y2], [(x1 + x2) / 2, y1], [x1, (y1 + y2) / 2], [x2, (y1 + y2) / 2]];
  let best = cands[0], bd = Infinity;
  for (const c of cands) {
    const d = dist(c, p);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function noteIcon(a) {
  const [x1, y1, x2, y2] = normRect(a.rect);
  const w = x2 - x1, h = y2 - y1;
  const r = [x1 + w * 0.08, y1 + h * 0.25, x2 - w * 0.08, y2 - h * 0.08];
  const tail = [['M', x1 + w * 0.28, r[1]], ['L', x1 + w * 0.2, y1 + h * 0.05], ['L', x1 + w * 0.5, r[1]]];
  const lines = [];
  for (let i = 0; i < 3; i++) {
    const ly = r[3] - (r[3] - r[1]) * (0.28 + i * 0.22);
    lines.push(['M', r[0] + w * 0.14, ly], ['L', r[2] - w * (i === 2 ? 0.34 : 0.14), ly]);
  }
  const fill = a.color || [1, 0.85, 0.2];
  const dark = [0.25, 0.25, 0.25];
  return [
    { t: 'path', cmds: roundRectPath(r, w * 0.12), stroke: dark, fill, width: 0.8, dash: null, cap: 1, join: 1 },
    { t: 'path', cmds: [...tail, ['Z']], stroke: dark, fill, width: 0.8, dash: null, cap: 1, join: 1 },
    { t: 'path', cmds: [['M', x1 + w * 0.29, r[1] + 0.5], ['L', x1 + w * 0.49, r[1] + 0.5]], stroke: fill, fill: null, width: 1.2, dash: null, cap: 0, join: 0 },
    { t: 'path', cmds: lines, stroke: dark, fill: null, width: 0.9, dash: null, cap: 1, join: 0 },
  ];
}

function quadPolygon(q) {
  // UL, UR, LL, LR -> polygon UL UR LR LL
  return [[q[0], q[1]], [q[2], q[3]], [q[6], q[7]], [q[4], q[5]]];
}

function markupItems(a) {
  const items = [];
  for (const q of a.quads || []) {
    const ul = [q[0], q[1]], ur = [q[2], q[3]], ll = [q[4], q[5]], lr = [q[6], q[7]];
    const hx = ul[0] - ll[0], hy = ul[1] - ll[1];
    const h = Math.hypot(hx, hy) || 1;
    if (a.type === 'highlight') {
      items.push({ t: 'path', cmds: polyPath(quadPolygon(q), true), stroke: null, fill: a.color, width: 0, dash: null, cap: 0, join: 0 });
      continue;
    }
    const thick = Math.max(0.5, h * 0.07);
    const at = (f) => [[ll[0] + hx * f, ll[1] + hy * f], [lr[0] + hx * f, lr[1] + hy * f]];
    if (a.type === 'underline' || a.type === 'strikeout') {
      const [p, r] = at(a.type === 'underline' ? 0.08 : 0.42);
      items.push({ t: 'path', cmds: [['M', p[0], p[1]], ['L', r[0], r[1]]], stroke: a.color, fill: null, width: thick, dash: null, cap: 0, join: 0 });
    } else if (a.type === 'squiggly') {
      const [p, r] = at(0.06);
      const len = dist(p, r), ux = (r[0] - p[0]) / len, uy = (r[1] - p[1]) / len;
      const amp = h * 0.06, step = Math.max(1.5, h * 0.12);
      const cmds = [['M', p[0], p[1]]];
      for (let d = step, k = 1; d <= len; d += step, k++) {
        const off = k % 2 ? amp : -amp;
        cmds.push(['L', p[0] + ux * d + (hx / h) * off, p[1] + uy * d + (hy / h) * off]);
      }
      items.push({ t: 'path', cmds, stroke: a.color, fill: null, width: Math.max(0.4, thick * 0.8), dash: null, cap: 1, join: 1 });
    }
  }
  return items;
}

function stampItems(a, images) {
  const r = normRect(a.rect);
  const w = boxW(r), h = boxH(r);
  const s = a.stamp || {};
  if (s.kind === 'image') {
    return images?.has?.(s.imageId) || !images ? [{ t: 'image', imageId: s.imageId, x: r[0], y: r[1], w, h }] : [];
  }
  const color = a.color || [0.8, 0.1, 0.1];
  const bw = Math.max(1, Math.min(4, h * 0.06));
  const items = [{
    t: 'path', cmds: roundRectPath(insetRect(r, bw / 2), h * 0.14), stroke: color, fill: a.fill,
    width: bw, dash: null, cap: 1, join: 1,
  }];
  const fontName = stdFontName('Helvetica', true);
  const label = s.label || '';
  const hasSub = !!s.sub;
  const avail = w - bw * 2 - h * 0.3;
  let size = Math.min(h * (hasSub ? 0.42 : 0.56), avail / Math.max(1, textWidth(label, fontName, 1)));
  size = Math.max(2, size);
  const lw = textWidth(label, fontName, size);
  const asc = fontAscent(fontName, size);
  const lines = [];
  if (hasSub) {
    const subSize = Math.max(2, Math.min(size * 0.45, avail / Math.max(1, textWidth(s.sub, stdFontName('Helvetica'), 1))));
    const sw = textWidth(s.sub, stdFontName('Helvetica'), subSize);
    const total = asc + subSize * 1.3;
    const top = (r[1] + r[3]) / 2 + total / 2;
    lines.push({ s: label, x: (r[0] + r[2]) / 2 - lw / 2, y: top - asc, w: lw });
    items.push({ t: 'text', lines, fontName, family: 'Helvetica', bold: true, size, color });
    items.push({ t: 'text', lines: [{ s: s.sub, x: (r[0] + r[2]) / 2 - sw / 2, y: top - asc - subSize * 1.3, w: sw }], fontName: stdFontName('Helvetica'), family: 'Helvetica', size: subSize, color });
  } else {
    lines.push({ s: label, x: (r[0] + r[2]) / 2 - lw / 2, y: (r[1] + r[3]) / 2 - asc / 2, w: lw });
    items.push({ t: 'text', lines, fontName, family: 'Helvetica', bold: true, size, color });
  }
  return items;
}

function freetextItems(a) {
  const r = normRect(a.rect);
  const items = [];
  const pad = freetextPadding(a);
  const f = a.font || {};
  if (a.callout?.length) {
    const tip = a.callout[0];
    const knee = a.callout[1] || null;
    const attach = calloutAttach(r, knee || tip);
    const pts = knee ? [tip, knee, attach] : [tip, attach];
    const lineStyle = { ...a, color: a.color || a.textColor || [0, 0, 0], width: Math.max(a.width, 0.75), dash: 'solid', fill: null };
    items.push(strokeItem(polyPath(pts), lineStyle, { join: 1 }));
    items.push(...capItems(a.endCap || 'OpenArrow', tip, pts[1], lineStyle));
  }
  if (a.fill || a.width > 0) {
    items.push({
      t: 'path', cmds: rectPath(insetRect(r, a.width / 2)), stroke: a.width > 0 ? a.color : null,
      fill: a.fill, width: a.width, dash: dashArray(a), cap: a.dash === 'dotted' ? 1 : 0, join: 0,
    });
  }
  const layout = layoutText({
    text: a.text || '', family: f.family, bold: f.bold, italic: f.italic, size: f.size || 12, align: a.align,
    x: r[0], top: r[3], width: a.autoWidth ? null : boxW(r), wrap: !a.autoWidth, padding: pad,
  });
  items.push(textItem(layout, a, a.textColor || [0, 0, 0], f.family || 'Helvetica', f.bold, f.italic, f.size || 12));
  return items;
}

/** Recompute a free-text box so it fits its text (typewriter behaviour). */
export function fitFreeText(a) {
  const f = a.font || {};
  const r = normRect(a.rect);
  const pad = freetextPadding(a);
  const layout = layoutText({
    text: a.text || ' ', family: f.family, bold: f.bold, italic: f.italic, size: f.size || 12,
    align: a.align, x: r[0], top: r[3], width: a.autoWidth ? null : boxW(r), wrap: !a.autoWidth, padding: pad,
  });
  const width = a.autoWidth ? Math.max(layout.width, (f.size || 12) * 0.6 + pad * 2) : boxW(r);
  const height = Math.max(layout.height, a.minHeight || 0);
  return [r[0], r[3] - height, r[0] + width, r[3]];
}

function measureItems(a) {
  const pts = a.points || [];
  const mode = a.measure?.mode || 'distance';
  const items = [];
  if (pts.length < 2) return items;
  const label = measureLabel(a);
  const size = a.font?.size || 9;
  if (mode === 'distance') {
    items.push(...lineItems(pts.slice(0, 2), a));
    const [p, q] = pts;
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const len = dist(p, q) || 1;
    let nx = -(q[1] - p[1]) / len, ny = (q[0] - p[0]) / len;
    if (ny < 0) { nx = -nx; ny = -ny; }
    items.push(...labelItems(label, mx + nx * (size * 0.9 + a.width), my + ny * (size * 0.9 + a.width), size));
  } else if (mode === 'perimeter') {
    items.push(...lineItems(pts, a));
    const last = pts[pts.length - 1];
    items.push(...labelItems(label, last[0], last[1] + size * 1.2 + a.width, size));
  } else {
    items.push(...closedShape(polyPath(pts, true), pts, a));
    const c = pts.length >= 3 ? polygonCentroid(pts) : pts[0];
    items.push(...labelItems(label, c[0], c[1], size));
  }
  return items;
}

/**
 * Build the drawing primitives for an annotation.
 * Returns { items, bbox, opacity, blend, hit } where hit = { cmds, mode:'stroke'|'fill' }.
 */
export function buildAppearance(a, images) {
  let items = [];
  let hit = null;
  switch (a.type) {
    case 'rect': {
      const r = insetRect(a.rect, a.width / 2);
      const cmds = rectPath(r);
      items = closedShape(cmds, [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], a);
      hit = { cmds, mode: a.fill ? 'fill' : 'stroke' };
      break;
    }
    case 'ellipse': {
      const r = insetRect(a.rect, a.width / 2);
      const cmds = ellipsePath(r);
      items = closedShape(cmds, ellipsePoints(r, 20), a);
      hit = { cmds, mode: a.fill ? 'fill' : 'stroke' };
      break;
    }
    case 'line':
    case 'polyline':
      items = lineItems(a.points, a);
      hit = { cmds: polyPath(a.points), mode: 'stroke' };
      break;
    case 'polygon': {
      const cmds = polyPath(a.points, true);
      items = closedShape(cmds, a.points, a);
      hit = { cmds, mode: a.fill ? 'fill' : 'stroke' };
      break;
    }
    case 'ink': {
      const cmds = [];
      for (const p of a.paths || []) cmds.push(...smoothPath(p));
      items = [{ t: 'path', cmds, stroke: a.color, fill: null, width: a.width, dash: null, cap: 1, join: 1 }];
      hit = { cmds, mode: 'stroke' };
      break;
    }
    case 'freetext':
      items = freetextItems(a);
      hit = { cmds: rectPath(normRect(a.rect)), mode: 'fill' };
      break;
    case 'note':
      items = noteIcon(a);
      hit = { cmds: rectPath(normRect(a.rect)), mode: 'fill' };
      break;
    case 'highlight':
    case 'underline':
    case 'strikeout':
    case 'squiggly':
      items = markupItems(a);
      hit = { cmds: (a.quads || []).flatMap((q) => polyPath(quadPolygon(q), true)), mode: 'fill' };
      break;
    case 'stamp':
      items = stampItems(a, images);
      hit = { cmds: rectPath(normRect(a.rect)), mode: 'fill' };
      break;
    case 'measure':
      items = measureItems(a);
      hit = { cmds: polyPath(a.points, a.measure?.mode === 'area'), mode: a.measure?.mode === 'area' && a.fill ? 'fill' : 'stroke' };
      break;
    case 'redact': {
      const r = normRect(a.rect);
      items = [
        { t: 'path', cmds: rectPath(r), stroke: null, fill: [1, 0.85, 0.85], width: 0, dash: null, cap: 0, join: 0 },
        { t: 'path', cmds: rectPath(insetRect(r, 0.75)), stroke: [0.85, 0, 0], fill: null, width: 1.5, dash: [4, 2], cap: 0, join: 0 },
      ];
      hit = { cmds: rectPath(r), mode: 'fill' };
      break;
    }
    default:
      break;
  }
  return { items, bbox: itemsBBox(items, a), opacity: a.opacity ?? 1, blend: a.type === 'highlight' ? 'Multiply' : null, hit };
}

export function itemsBBox(items, a) {
  let box = null;
  for (const it of items) {
    if (it.t === 'path') {
      const pts = pathPoints(it.cmds);
      if (!pts.length) continue;
      box = unionBox(box, expandBox(bboxOfPoints(pts), (it.stroke ? it.width / 2 : 0) + 0.5));
    } else if (it.t === 'text') {
      for (const l of it.lines) {
        box = unionBox(box, [l.x, l.y - it.size * 0.25, l.x + Math.max(l.w, 1), l.y + it.size * 0.9]);
      }
    } else if (it.t === 'image') {
      box = unionBox(box, [it.x, it.y, it.x + it.w, it.y + it.h]);
    }
  }
  if (a?.rect) box = unionBox(box, normRect(a.rect));
  return box || [0, 0, 1, 1];
}
