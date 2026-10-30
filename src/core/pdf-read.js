// Imports editable annotations from a pdf-lib document into our model and removes them
// from the page /Annots arrays (pdf.js then renders the "base" document without them).
// Annotations we cannot reproduce (links, widgets, foreign stamps, ...) stay in the PDF.
import {
  PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFString, PDFHexString, PDFRawStream, decodePDFRawStream,
} from 'pdf-lib';
import { PRIVATE_KEY } from './pdf-write.js';
import { newId } from './model.js';
import { normRect } from './geometry.js';
import { NOTE_SIZE } from './appearance.js';

const N = (k) => PDFName.of(k);

function nameStr(obj) {
  if (!obj) return null;
  if (obj instanceof PDFName) return obj.decodeText ? obj.decodeText() : obj.asString().slice(1);
  return null;
}

function textStr(obj) {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return '';
}

function num(obj, dflt = null) {
  return obj instanceof PDFNumber ? obj.asNumber() : dflt;
}

function nums(dict, key) {
  const arr = dict.lookup(N(key));
  if (!(arr instanceof PDFArray)) return null;
  const out = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i);
    if (v instanceof PDFNumber) out.push(v.asNumber());
    else if (v instanceof PDFArray) out.push(...arrNums(v));
  }
  return out;
}

function arrNums(arr) {
  const out = [];
  for (let i = 0; i < arr.size(); i++) {
    const v = arr.lookup(i);
    if (v instanceof PDFNumber) out.push(v.asNumber());
  }
  return out;
}

function color(dict, key) {
  const c = nums(dict, key);
  if (!c || !c.length) return null;
  if (c.length === 1) return [c[0], c[0], c[0]];
  if (c.length === 4) {
    const [C, M, Y, K] = c;
    return [(1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)];
  }
  return c.slice(0, 3);
}

export function parsePdfDate(s) {
  if (!s) return null;
  const m = /D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?/.exec(s);
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m;
  let iso = `${y}-${mo}-${d}T${h}:${mi}:${se}`;
  if (tz === 'Z' || !tz) iso += 'Z';
  else iso += `${tz}${th}:${tm}`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateOf(dict, key) {
  const v = dict.lookup(N(key));
  return parsePdfDate(textStr(v));
}

function refKey(ref) {
  return ref instanceof PDFRef ? `${ref.objectNumber} ${ref.generationNumber}` : null;
}

function insetRD(rect, rd) {
  if (!rd || rd.length !== 4) return rect;
  const r = normRect(rect);
  const out = [r[0] + rd[0], r[1] + rd[1], r[2] - rd[2], r[3] - rd[3]];
  return out[2] > out[0] && out[3] > out[1] ? out : r;
}

const segIntersect = (p1, p2, p3, p4) => {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return d(p1, p2, p3) * d(p1, p2, p4) < 0 && d(p3, p4, p1) * d(p3, p4, p2) < 0;
};

/** Normalise quad points to the de-facto order UL, UR, LL, LR. */
function normQuad(q) {
  const p = [[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]];
  // polygon UL UR LR LL must be simple
  if (!segIntersect(p[0], p[1], p[3], p[2]) && !segIntersect(p[1], p[3], p[2], p[0])) return q;
  const s = [...p].sort((a, b) => b[1] - a[1]);
  const top = s.slice(0, 2).sort((a, b) => a[0] - b[0]);
  const bot = s.slice(2).sort((a, b) => a[0] - b[0]);
  return [...top[0], ...top[1], ...bot[0], ...bot[1]];
}

const DA_FONT = /\/([A-Za-z0-9_+-]+)\s+([\d.]+)\s+Tf/;
const DA_RGB = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/;
const DA_GRAY = /([\d.]+)\s+g(?:\s|$)/;
const DA_RGB_STROKE = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG/;

function parseDA(da) {
  const out = { family: 'Helvetica', size: 12, bold: false, italic: false, color: [0, 0, 0], stroke: null };
  if (!da) return out;
  const f = DA_FONT.exec(da);
  if (f) {
    const n = f[1].toLowerCase();
    out.family = /cour|mono/.test(n) ? 'Courier' : /tim|tiro|serif|roman/.test(n) ? 'Times' : 'Helvetica';
    out.bold = /bold|bd|black|heavy/.test(n);
    out.italic = /ital|obl|it$/.test(n);
    out.size = +f[2] || 12;
  }
  const c = DA_RGB.exec(da);
  if (c) out.color = [+c[1], +c[2], +c[3]];
  else {
    const g = DA_GRAY.exec(da);
    if (g) out.color = [+g[1], +g[1], +g[1]];
  }
  const s = DA_RGB_STROKE.exec(da);
  if (s) out.stroke = [+s[1], +s[2], +s[3]];
  return out;
}

function borderOf(dict) {
  const bs = dict.lookup(N('BS'));
  let width = 1, dash = 'solid';
  if (bs instanceof PDFDict) {
    width = num(bs.lookup(N('W')), 1);
    const s = nameStr(bs.lookup(N('S')));
    if (s === 'D') {
      const d = nums(bs, 'D');
      dash = d && d[0] <= 1.01 ? 'dotted' : 'dashed';
    }
  } else {
    const b = nums(dict, 'Border');
    if (b && b.length >= 3) width = b[2];
  }
  const be = dict.lookup(N('BE'));
  if (be instanceof PDFDict && nameStr(be.lookup(N('S'))) === 'C') dash = 'cloudy';
  return { width, dash };
}

const LE_ALLOWED = new Set(['None', 'Square', 'Circle', 'Diamond', 'OpenArrow', 'ClosedArrow', 'Butt', 'ROpenArrow', 'RClosedArrow', 'Slash']);

function lineEnds(dict) {
  const le = dict.lookup(N('LE'));
  const names = [];
  if (le instanceof PDFArray) for (let i = 0; i < le.size(); i++) names.push(nameStr(le.lookup(i)));
  else if (le instanceof PDFName) names.push('None', nameStr(le));
  const fix = (n) => (LE_ALLOWED.has(n) ? (n === 'RClosedArrow' ? 'ClosedArrow' : n) : 'None');
  return { startCap: fix(names[0]), endCap: fix(names[1]) };
}

function pairs(arr) {
  const out = [];
  for (let i = 0; i + 1 < (arr?.length || 0); i += 2) out.push([arr[i], arr[i + 1]]);
  return out;
}

/** Decode an image XObject (as written by pdf-lib) to PNG/JPEG bytes. */
async function decodeImage(stream) {
  if (!(stream instanceof PDFRawStream)) return null;
  const dict = stream.dict;
  const filter = dict.lookup(N('Filter'));
  const filterName = filter instanceof PDFArray ? nameStr(filter.lookup(0)) : nameStr(filter);
  const w = num(dict.lookup(N('Width'))), h = num(dict.lookup(N('Height')));
  if (filterName === 'DCTDecode') {
    return { bytes: stream.contents.slice(), mime: 'image/jpeg', width: w, height: h };
  }
  if (filterName !== 'FlateDecode' || num(dict.lookup(N('BitsPerComponent'))) !== 8) return null;
  const cs = nameStr(dict.lookup(N('ColorSpace')));
  const comps = cs === 'DeviceGray' ? 1 : cs === 'DeviceRGB' ? 3 : 0;
  if (!comps) return null;
  const px = decodePDFRawStream(stream).decode();
  let alpha = null;
  const smask = dict.lookup(N('SMask'));
  if (smask instanceof PDFRawStream) alpha = decodePDFRawStream(smask).decode();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(w, h);
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    if (comps === 3) {
      data.data[j] = px[i * 3]; data.data[j + 1] = px[i * 3 + 1]; data.data[j + 2] = px[i * 3 + 2];
    } else {
      data.data[j] = data.data[j + 1] = data.data[j + 2] = px[i];
    }
    data.data[j + 3] = alpha ? alpha[i] : 255;
  }
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', width: w, height: h };
}

async function stampImage(dict) {
  const ap = dict.lookup(N('AP'));
  if (!(ap instanceof PDFDict)) return null;
  const n = ap.lookup(N('N'));
  if (!(n instanceof PDFRawStream)) return null;
  const res = n.dict.lookup(N('Resources'));
  if (!(res instanceof PDFDict)) return null;
  const xo = res.lookup(N('XObject'));
  if (!(xo instanceof PDFDict)) return null;
  const img = xo.lookup(N('Img'));
  return decodeImage(img);
}

function common(dict) {
  const { width, dash } = borderOf(dict);
  const ca = num(dict.lookup(N('CA')), 1);
  return {
    id: textStr(dict.lookup(N('NM'))) || newId(),
    author: textStr(dict.lookup(N('T'))),
    contents: textStr(dict.lookup(N('Contents'))),
    created: dateOf(dict, 'CreationDate') || dateOf(dict, 'M') || new Date().toISOString(),
    modified: dateOf(dict, 'M') || new Date().toISOString(),
    color: color(dict, 'C'),
    fill: color(dict, 'IC'),
    opacity: ca,
    width,
    dash,
    replies: [],
  };
}

async function parseStandard(dict, subtype, images) {
  const rect = nums(dict, 'Rect');
  if (!rect || rect.length !== 4) return null;
  const base = common(dict);
  const it = nameStr(dict.lookup(N('IT')));
  switch (subtype) {
    case 'Square':
    case 'Circle':
      return { ...base, type: subtype === 'Square' ? 'rect' : 'ellipse', rect: insetRD(rect, nums(dict, 'RD')), color: base.color || [0, 0, 0] };
    case 'Line': {
      const l = nums(dict, 'L');
      if (!l || l.length < 4) return null;
      const pts = [[l[0], l[1]], [l[2], l[3]]];
      if (it === 'LineDimension') return { ...base, type: 'measure', points: pts, measure: { mode: 'distance', ratio: 1, unit: 'mm' }, ...lineEnds(dict) };
      return { ...base, type: 'line', points: pts, ...lineEnds(dict), color: base.color || [0, 0, 0] };
    }
    case 'PolyLine':
    case 'Polygon': {
      const pts = pairs(nums(dict, 'Vertices'));
      if (pts.length < 2) return null;
      if (it === 'PolyLineDimension' || it === 'PolygonDimension') {
        return { ...base, type: 'measure', points: pts, measure: { mode: it === 'PolygonDimension' ? 'area' : 'perimeter', ratio: 1, unit: 'mm' }, ...lineEnds(dict) };
      }
      return { ...base, type: subtype === 'Polygon' ? 'polygon' : 'polyline', points: pts, ...(subtype === 'PolyLine' ? lineEnds(dict) : {}), color: base.color || [0, 0, 0] };
    }
    case 'Ink': {
      const ink = dict.lookup(N('InkList'));
      if (!(ink instanceof PDFArray)) return null;
      const paths = [];
      for (let i = 0; i < ink.size(); i++) {
        const a = ink.lookup(i);
        if (a instanceof PDFArray) paths.push(pairs(arrNums(a)));
      }
      return { ...base, type: 'ink', paths: paths.filter((p) => p.length), color: base.color || [0, 0, 0] };
    }
    case 'FreeText': {
      const da = parseDA(textStr(dict.lookup(N('DA'))));
      const q = num(dict.lookup(N('Q')), 0);
      const cl = pairs(nums(dict, 'CL'));
      const typewriter = it === 'FreeTextTypeWriter';
      const hasBS = dict.lookup(N('BS')) instanceof PDFDict || !!nums(dict, 'Border');
      const width = typewriter ? 0 : hasBS ? base.width : 1;
      const callout = it === 'FreeTextCallout' && cl.length >= 2 ? (cl.length >= 3 ? [cl[0], cl[1]] : [cl[0]]) : null;
      return {
        ...base,
        type: 'freetext',
        rect: insetRD(rect, nums(dict, 'RD')),
        text: base.contents,
        contents: textStr(dict.lookup(N('Subj'))) || '',
        font: { family: da.family, size: da.size, bold: da.bold, italic: da.italic },
        textColor: da.color,
        color: da.stroke || [0, 0, 0],
        fill: base.color, // FreeText /C is the background colour
        width,
        align: ['left', 'center', 'right'][q] || 'left',
        autoWidth: false,
        callout,
        endCap: lineEnds(dict).endCap || 'OpenArrow',
      };
    }
    case 'Text': {
      const r = normRect(rect);
      return { ...base, type: 'note', rect: [r[0], r[3] - NOTE_SIZE, r[0] + NOTE_SIZE, r[3]], icon: nameStr(dict.lookup(N('Name'))) || 'Comment', color: base.color || [1, 0.85, 0.2] };
    }
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut':
    case 'Squiggly': {
      const qp = nums(dict, 'QuadPoints');
      if (!qp || qp.length < 8) return null;
      const quads = [];
      for (let i = 0; i + 7 < qp.length; i += 8) quads.push(normQuad(qp.slice(i, i + 8)));
      const type = { Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strikeout', Squiggly: 'squiggly' }[subtype];
      return { ...base, type, quads, color: base.color || [1, 0.9, 0] };
    }
    case 'Redact': {
      const qp = nums(dict, 'QuadPoints');
      let r = normRect(rect);
      if (qp && qp.length >= 8) {
        const xs = qp.filter((_, i) => i % 2 === 0), ys = qp.filter((_, i) => i % 2 === 1);
        r = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }
      return { ...base, type: 'redact', rect: r, color: [0.85, 0, 0], fill: [0, 0, 0] };
    }
    case 'Stamp':
      return null; // foreign stamps keep their original appearance in the base document
    default:
      return null;
  }
}

async function parseAnnotation(dict, subtype, images) {
  const priv = dict.lookup(N(PRIVATE_KEY));
  if (priv) {
    try {
      const data = JSON.parse(textStr(priv));
      const rect = nums(dict, 'Rect');
      const same = rect && data.rect && rect.every((v, i) => Math.abs(v - data.rect[i]) < 0.6);
      if (same && data.a?.type) {
        const a = data.a;
        if (a.type === 'stamp' && a.stamp?.kind === 'image') {
          const img = await stampImage(dict);
          if (!img) return null;
          images.set(a.stamp.imageId, img);
        }
        a.contents = a.type === 'freetext' ? a.contents || '' : textStr(dict.lookup(N('Contents')));
        if (a.type === 'freetext') a.text = textStr(dict.lookup(N('Contents')));
        a.replies = [];
        return a;
      }
    } catch (e) {
      console.warn('Private annotation data unreadable, falling back', e);
    }
  }
  return parseStandard(dict, subtype, images);
}

const SUPPORTED = new Set(['Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'FreeText', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly', 'Stamp', 'Redact']);

/**
 * Extract editable annotations from all pages and strip them from the document.
 * @returns {Promise<Array<Array<object>>>} annotations per page index
 */
export async function extractAnnotations(pdfDoc, images, { keepRefs = true } = {}) {
  const ctx = pdfDoc.context;
  const result = [];
  for (const page of pdfDoc.getPages()) {
    const list = [];
    result.push(list);
    const arr = page.node.lookupMaybe(N('Annots'), PDFArray);
    if (!arr) continue;
    const entries = [];
    for (let i = 0; i < arr.size(); i++) {
      const raw = arr.get(i);
      const dict = raw instanceof PDFRef ? ctx.lookupMaybe(raw, PDFDict) : raw instanceof PDFDict ? raw : null;
      entries.push({ raw, dict, key: refKey(raw) });
    }
    const removed = new Set();
    const removedEntries = new Set();
    const byKey = new Map();
    const replies = [];
    for (const e of entries) {
      if (!e.dict) continue;
      const subtype = nameStr(e.dict.lookup(N('Subtype')));
      if (!SUPPORTED.has(subtype)) continue;
      const flags = num(e.dict.lookup(N('F')), 0);
      if (flags & 2) continue; // hidden
      const irt = e.dict.get(N('IRT'));
      if (irt && subtype === 'Text') {
        replies.push({ e, parentKey: refKey(irt) });
        continue;
      }
      let a = null;
      try {
        a = await parseAnnotation(e.dict, subtype, images);
      } catch (err) {
        console.warn('Annotation import failed', err);
      }
      if (!a) continue;
      a.dirty = !(keepRefs && e.key);
      if (keepRefs && e.key) {
        const popup = e.dict.get(N('Popup'));
        a.orig = { num: e.raw.objectNumber, gen: e.raw.generationNumber };
        if (popup instanceof PDFRef) {
          a.orig.popup = { num: popup.objectNumber, gen: popup.generationNumber };
          removed.add(refKey(popup));
        }
      } else {
        delete a.orig;
      }
      if (e.key) byKey.set(e.key, a);
      removedEntries.add(e);
      list.push(a);
    }
    for (const { e, parentKey } of replies) {
      const parent = byKey.get(parentKey);
      if (!parent) continue;
      const d = e.dict;
      parent.replies.push({
        id: textStr(d.lookup(N('NM'))) || newId(),
        author: textStr(d.lookup(N('T'))),
        contents: textStr(d.lookup(N('Contents'))),
        modified: dateOf(d, 'M') || new Date().toISOString(),
        dirty: !(keepRefs && e.key),
        ...(keepRefs && e.key ? { orig: { num: e.raw.objectNumber, gen: e.raw.generationNumber } } : {}),
      });
      removedEntries.add(e);
      const popup = d.get(N('Popup'));
      if (popup instanceof PDFRef) removed.add(refKey(popup));
    }
    // Popups whose parent we imported
    for (const e of entries) {
      if (!e.dict || nameStr(e.dict.lookup(N('Subtype'))) !== 'Popup') continue;
      const parent = e.dict.get(N('Parent'));
      if (parent && (byKey.has(refKey(parent)) || removed.has(refKey(parent)))) removedEntries.add(e);
    }
    if (removed.size || removedEntries.size) {
      const keep = entries.filter((e) => !removedEntries.has(e) && !(e.key && removed.has(e.key)));
      if (keep.length) page.node.set(N('Annots'), ctx.obj(keep.map((e) => e.raw)));
      else page.node.delete(N('Annots'));
    }
  }
  return result;
}
