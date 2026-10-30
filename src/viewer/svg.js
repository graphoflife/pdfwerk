// Renders annotation primitives (see core/appearance.js) as SVG in PDF user space.
import { buildAppearance } from '../core/appearance.js';
import { svgPathData } from '../core/geometry.js';
import { CSS_FONT } from '../core/fonts.js';

export const SVGNS = 'http://www.w3.org/2000/svg';
const CAPS = ['butt', 'round', 'square'];
const JOINS = ['miter', 'round', 'bevel'];

export function svgEl(tag, attrs = {}, children = []) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null && v !== false) e.setAttribute(k, v);
  }
  for (const c of children) if (c) e.append(c);
  return e;
}

export const cssColor = (c) => (c ? `rgb(${c.map((v) => Math.round(v * 255)).join(',')})` : 'none');

/** Object URL for an image in the document image store (created lazily). */
export function imageUrl(images, id) {
  const img = images?.get(id);
  if (!img) return '';
  if (!img.url) img.url = URL.createObjectURL(new Blob([img.bytes], { type: img.mime }));
  return img.url;
}

function renderItem(it, images, opts) {
  if (it.t === 'path') {
    const stroke = it.stroke && it.width > 0;
    return svgEl('path', {
      d: svgPathData(it.cmds),
      fill: it.fill ? cssColor(it.fill) : 'none',
      stroke: stroke ? cssColor(it.stroke) : 'none',
      'stroke-width': stroke ? it.width : null,
      'stroke-dasharray': stroke && it.dash ? it.dash.join(' ') : null,
      'stroke-linecap': CAPS[it.cap || 0],
      'stroke-linejoin': JOINS[it.join || 0],
    });
  }
  if (it.t === 'text') {
    if (opts.hideText) return null;
    const g = svgEl('g', {
      'font-family': CSS_FONT[it.family] || CSS_FONT.Helvetica,
      'font-size': it.size,
      'font-weight': it.bold ? 'bold' : null,
      'font-style': it.italic ? 'italic' : null,
      fill: cssColor(it.color || [0, 0, 0]),
    });
    for (const l of it.lines) {
      if (!l.s) continue;
      const t = svgEl('text', { transform: `matrix(1 0 0 -1 ${l.x} ${l.y})` });
      t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.textContent = l.s;
      g.append(t);
    }
    return g;
  }
  if (it.t === 'image') {
    const href = imageUrl(images, it.imageId);
    if (!href) return null;
    return svgEl('image', {
      href, x: 0, y: 0, width: 1, height: 1, preserveAspectRatio: 'none',
      transform: `matrix(${it.w} 0 0 ${-it.h} ${it.x} ${it.y + it.h})`,
    });
  }
  return null;
}

/**
 * Render one annotation. Returns { visual, hit, blend } where visual goes into the
 * normal or the multiply-blend layer and hit is the invisible pointer target.
 */
export function renderAnnotation(a, images, { scale = 1, hideText = false, withHit = true } = {}) {
  const app = buildAppearance(a, images);
  const visual = svgEl('g', { 'data-id': a.id, class: `annot annot-${a.type}`, opacity: app.opacity < 1 ? app.opacity : null });
  for (const it of app.items) {
    const n = renderItem(it, images, { hideText });
    if (n) visual.append(n);
  }
  let hit = null;
  if (withHit && app.hit) {
    const tol = 7 / scale;
    hit = svgEl('path', {
      d: svgPathData(app.hit.cmds),
      class: `hit hit-${a.type}`,
      'data-id': a.id,
      fill: app.hit.mode === 'fill' ? 'transparent' : 'none',
      stroke: 'transparent',
      'stroke-width': Math.max(a.width || 0, 0) + tol * 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'pointer-events': app.hit.mode === 'fill' ? 'all' : 'stroke',
    });
  }
  return { visual, hit, blend: !!app.blend, bbox: app.bbox };
}

/** Standalone SVG of a page's annotations (used for thumbnails and previews). */
export function annotationsSvg(annots, images, viewport) {
  const [a, b, c, d, e, f] = viewport.transform;
  const svg = svgEl('svg', { width: viewport.width, height: viewport.height, class: 'annot-svg' });
  const g = svgEl('g', { transform: `matrix(${a} ${b} ${c} ${d} ${e} ${f})` });
  for (const an of annots) {
    const { visual, blend } = renderAnnotation(an, images, { withHit: false });
    if (blend) visual.style.mixBlendMode = 'multiply';
    g.append(visual);
  }
  svg.append(g);
  return svg;
}
