// Annotation model. Every annotation is a plain, JSON-serialisable object in PDF user space.
//
// Common fields: id, type, author, contents, created, modified (ISO strings),
//   color [r,g,b] (0..1) | null, fill [r,g,b] | null, opacity 0..1, width, dash
//   ('solid'|'dashed'|'dotted'|'cloudy'), replies [], locked, orig (source object ref), dirty.
// Type specific:
//   rect, ellipse, redact          rect [x1,y1,x2,y2]
//   line, polyline, polygon        points [[x,y],...], startCap, endCap (PDF line-ending names)
//   ink                            paths [[[x,y],...], ...]
//   freetext                       rect, text, font {family,size,bold,italic}, textColor, align,
//                                  autoWidth, callout [[tipX,tipY],[kneeX,kneeY]?] | null
//   note                           rect (icon box), icon
//   highlight, underline,
//   strikeout, squiggly            quads [[x1,y1,x2,y2,x3,y3,x4,y4]] (UL, UR, LL, LR)
//   stamp                          rect, stamp {kind:'text', label, sub} | {kind:'image', imageId}
//   measure                        points, measure {mode:'distance'|'perimeter'|'area', ratio, unit}

export const TYPES = {
  rect: { label: 'Rechteck', icon: 'Square' },
  ellipse: { label: 'Ellipse', icon: 'Circle' },
  line: { label: 'Linie', icon: 'Minus' },
  polyline: { label: 'Polylinie', icon: 'Spline' },
  polygon: { label: 'Polygon', icon: 'Pentagon' },
  ink: { label: 'Freihand', icon: 'PenLine' },
  freetext: { label: 'Textfeld', icon: 'Type' },
  note: { label: 'Notiz', icon: 'MessageSquare' },
  highlight: { label: 'Hervorhebung', icon: 'Highlighter' },
  underline: { label: 'Unterstreichung', icon: 'Underline' },
  strikeout: { label: 'Durchstreichung', icon: 'Strikethrough' },
  squiggly: { label: 'Wellenlinie', icon: 'Waves' },
  stamp: { label: 'Stempel', icon: 'Stamp' },
  measure: { label: 'Messung', icon: 'Ruler' },
  redact: { label: 'Schwärzung', icon: 'EyeOff' },
};

export const MARKUP_TYPES = new Set(['highlight', 'underline', 'strikeout', 'squiggly']);
export const RECT_TYPES = new Set(['rect', 'ellipse', 'redact', 'freetext', 'note', 'stamp']);
export const POINT_TYPES = new Set(['line', 'polyline', 'polygon', 'measure']);

let counter = 0;
export function newId() {
  counter = (counter + 1) % 1e6;
  return `a${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createAnnotation(type, props = {}) {
  const now = new Date().toISOString();
  return {
    id: newId(),
    type,
    author: '',
    contents: '',
    created: now,
    modified: now,
    color: [0, 0, 0],
    fill: null,
    opacity: 1,
    width: 1,
    dash: 'solid',
    replies: [],
    dirty: true,
    ...props,
  };
}

export function cloneAnnotation(a) {
  return structuredClone(a);
}

/** Return a copy translated by (dx, dy) in user space. */
export function translateAnnotation(a, dx, dy) {
  const b = cloneAnnotation(a);
  const mv = (p) => [p[0] + dx, p[1] + dy];
  if (b.rect) b.rect = [b.rect[0] + dx, b.rect[1] + dy, b.rect[2] + dx, b.rect[3] + dy];
  if (b.points) b.points = b.points.map(mv);
  if (b.paths) b.paths = b.paths.map((p) => p.map(mv));
  if (b.callout) b.callout = b.callout.map(mv);
  if (b.quads) b.quads = b.quads.map((q) => q.map((v, i) => v + (i % 2 ? dy : dx)));
  return b;
}

export const UNITS = {
  mm: { perMm: 1, label: 'mm' },
  cm: { perMm: 0.1, label: 'cm' },
  m: { perMm: 0.001, label: 'm' },
  km: { perMm: 1e-6, label: 'km' },
  in: { perMm: 1 / 25.4, label: 'in' },
  ft: { perMm: 1 / 304.8, label: 'ft' },
  pt: { perMm: 72 / 25.4, label: 'pt' },
};

const MM_PER_PT = 25.4 / 72;

export function formatMeasure(valuePt, measure, kind = 'length') {
  const { ratio = 1, unit = 'mm' } = measure || {};
  const u = UNITS[unit] || UNITS.mm;
  let v;
  if (kind === 'area') v = valuePt * (MM_PER_PT * ratio * u.perMm) ** 2;
  else v = valuePt * MM_PER_PT * ratio * u.perMm;
  const nf = new Intl.NumberFormat(document.documentElement.lang || undefined, { maximumFractionDigits: 2 });
  return `${nf.format(v)} ${u.label}${kind === 'area' ? '²' : ''}`;
}
