// Writes annotation models into a pdf-lib document as standard PDF annotations with
// appearance streams (so every PDF viewer shows them), or flattens them into page content.
import {
  PDFName, PDFString, PDFHexString, PDFArray, PDFDict, PDFRef,
  pushGraphicsState, popGraphicsState, drawObject,
} from 'pdf-lib';
import { buildAppearance } from './appearance.js';
import { sanitizeText } from './fonts.js';
import { normRect } from './geometry.js';

export const PRIVATE_KEY = 'PDFwerkData';

const fmt = (v) => {
  const s = (Math.round(v * 1000) / 1000).toString();
  return s === '-0' ? '0' : s;
};
const col = (c) => c.map(fmt).join(' ');

function pathOps(cmds) {
  const out = [];
  for (const c of cmds) {
    switch (c[0]) {
      case 'M': out.push(`${fmt(c[1])} ${fmt(c[2])} m`); break;
      case 'L': out.push(`${fmt(c[1])} ${fmt(c[2])} l`); break;
      case 'C': out.push(`${c.slice(1).map(fmt).join(' ')} c`); break;
      case 'Z': out.push('h'); break;
      default: break;
    }
  }
  return out.join('\n');
}

const SUBTYPE = {
  rect: 'Square', ellipse: 'Circle', line: 'Line', polyline: 'PolyLine', polygon: 'Polygon',
  ink: 'Ink', freetext: 'FreeText', note: 'Text', highlight: 'Highlight', underline: 'Underline',
  strikeout: 'StrikeOut', squiggly: 'Squiggly', stamp: 'Stamp', redact: 'Redact',
};

function pdfDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  return PDFString.fromDate(Number.isNaN(d.getTime()) ? new Date() : d);
}

const text = (s) => PDFHexString.fromText(String(s ?? ''));

export class AnnotationWriter {
  /**
   * @param {import('pdf-lib').PDFDocument} pdfDoc
   * @param {Map<string,{bytes:Uint8Array,mime:string}>} images
   */
  constructor(pdfDoc, images) {
    this.doc = pdfDoc;
    this.ctx = pdfDoc.context;
    this.images = images || new Map();
    this.fontCache = new Map();
    this.imageCache = new Map();
  }

  font(name) {
    let f = this.fontCache.get(name);
    if (!f) {
      f = this.doc.embedStandardFont(name);
      this.fontCache.set(name, f);
    }
    return f;
  }

  async image(id) {
    if (this.imageCache.has(id)) return this.imageCache.get(id);
    const img = this.images.get(id);
    let embedded = null;
    if (img) {
      embedded = img.mime === 'image/jpeg' ? await this.doc.embedJpg(img.bytes) : await this.doc.embedPng(img.bytes);
    }
    this.imageCache.set(id, embedded);
    return embedded;
  }

  /** Build a Form XObject that draws the annotation in absolute user-space coordinates. */
  async appearanceStream(a) {
    const app = buildAppearance(a, this.images);
    const ops = ['q'];
    const res = { Font: {}, XObject: {}, ExtGState: {} };
    if (app.opacity < 1 || app.blend) {
      res.ExtGState.GS0 = { Type: 'ExtGState', CA: app.opacity, ca: app.opacity, ...(app.blend ? { BM: app.blend } : {}) };
      ops.push('/GS0 gs');
    }
    let fontN = 0, imgN = 0;
    const fontNames = new Map();
    for (const it of app.items) {
      if (it.t === 'path') {
        const stroke = it.stroke && it.width > 0;
        const fill = !!it.fill;
        if (!stroke && !fill) continue;
        ops.push('q');
        if (stroke) {
          ops.push(`${col(it.stroke)} RG ${fmt(it.width)} w ${it.cap || 0} J ${it.join || 0} j`);
          if (it.dash) ops.push(`[${it.dash.map(fmt).join(' ')}] 0 d`);
        }
        if (fill) ops.push(`${col(it.fill)} rg`);
        ops.push(pathOps(it.cmds));
        ops.push(stroke && fill ? 'B' : stroke ? 'S' : 'f');
        ops.push('Q');
      } else if (it.t === 'text') {
        const font = this.font(it.fontName);
        let fname = fontNames.get(it.fontName);
        if (!fname) {
          fname = `F${++fontN}`;
          fontNames.set(it.fontName, fname);
          res.Font[fname] = font.ref;
        }
        ops.push(`BT /${fname} ${fmt(it.size)} Tf ${col(it.color || [0, 0, 0])} rg`);
        for (const l of it.lines) {
          if (!l.s) continue;
          ops.push(`1 0 0 1 ${fmt(l.x)} ${fmt(l.y)} Tm ${font.encodeText(sanitizeText(l.s, it.fontName)).toString()} Tj`);
        }
        ops.push('ET');
      } else if (it.t === 'image') {
        const img = await this.image(it.imageId);
        if (!img) continue;
        const iname = imgN ? `Img${imgN}` : 'Img';
        imgN++;
        res.XObject[iname] = img.ref;
        ops.push(`q ${fmt(it.w)} 0 0 ${fmt(it.h)} ${fmt(it.x)} ${fmt(it.y)} cm /${iname} Do Q`);
      }
    }
    ops.push('Q');
    for (const k of Object.keys(res)) if (!Object.keys(res[k]).length) delete res[k];
    const bbox = app.bbox;
    const stream = this.ctx.flateStream(ops.join('\n'), {
      Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: bbox, Matrix: [1, 0, 0, 1, 0, 0], Resources: res,
    });
    return { ref: this.ctx.register(stream), bbox, app };
  }

  /** Write all annotations of one page. Untouched imported annotations are kept verbatim. */
  async writePage(pageIndex, annots, { flatten = false } = {}) {
    const page = this.doc.getPage(pageIndex);
    const pageRef = page.ref;
    let annotsArr = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    const ensureArr = () => {
      if (!annotsArr) {
        annotsArr = this.ctx.obj([]);
        page.node.set(PDFName.of('Annots'), annotsArr);
      }
      return annotsArr;
    };

    for (const a of annots) {
      if (flatten) {
        if (a.type === 'redact' || a.type === 'note') continue; // marks only, never burned in
        const { ref } = await this.appearanceStream(a);
        const name = page.node.newXObject('PWFlat', ref);
        page.pushOperators(pushGraphicsState(), drawObject(name), popGraphicsState());
        continue;
      }
      const kept = !a.dirty && this.validRef(a.orig);
      let ref;
      if (kept) {
        ref = PDFRef.of(a.orig.num, a.orig.gen);
        ensureArr().push(ref);
        if (this.validRef(a.orig.popup)) ensureArr().push(PDFRef.of(a.orig.popup.num, a.orig.popup.gen));
      } else {
        ref = await this.writeAnnotation(a, pageRef);
        ensureArr().push(ref);
      }
      for (const r of a.replies || []) {
        if (kept && !r.dirty && this.validRef(r.orig)) {
          ensureArr().push(PDFRef.of(r.orig.num, r.orig.gen));
        } else {
          ensureArr().push(this.writeReply(r, ref, a, pageRef));
        }
      }
    }
  }

  validRef(o) {
    if (!o || typeof o.num !== 'number') return false;
    return this.ctx.lookupMaybe(PDFRef.of(o.num, o.gen || 0), PDFDict) instanceof PDFDict;
  }

  writeReply(r, parentRef, parent, pageRef) {
    const rect = normRect(parent.rect || [0, 0, 20, 20]);
    const dict = this.ctx.obj({
      Type: 'Annot', Subtype: 'Text', Rect: rect, F: 28, P: pageRef, IRT: parentRef, RT: 'R',
      Name: 'Comment', Open: false,
    });
    dict.set(PDFName.of('Contents'), text(r.contents));
    dict.set(PDFName.of('T'), text(r.author));
    dict.set(PDFName.of('M'), pdfDate(r.modified));
    dict.set(PDFName.of('NM'), text(r.id));
    return this.ctx.register(dict);
  }

  async writeAnnotation(a, pageRef) {
    const { ref: apRef, bbox } = await this.appearanceStream(a);
    const subtype = a.type === 'measure'
      ? (a.measure?.mode === 'area' ? 'Polygon' : a.measure?.mode === 'perimeter' ? 'PolyLine' : 'Line')
      : SUBTYPE[a.type];
    const d = {
      Type: 'Annot', Subtype: subtype, Rect: bbox, F: 4, P: pageRef,
      AP: { N: apRef },
      Border: [0, 0, a.width ?? 1],
      BS: { Type: 'Border', W: a.width ?? 1, S: a.dash === 'dashed' || a.dash === 'dotted' ? 'D' : 'S' },
    };
    if (a.dash === 'dashed') d.BS.D = [3, 2];
    if (a.dash === 'dotted') d.BS.D = [1, 2];
    if (a.dash === 'cloudy') d.BE = { S: 'C', I: 1 };
    if (a.color && a.type !== 'freetext') d.C = a.color;
    if ((a.opacity ?? 1) < 1) d.CA = a.opacity;
    if (a.fill && ['rect', 'ellipse', 'line', 'polyline', 'polygon', 'measure', 'redact'].includes(a.type)) d.IC = a.fill;

    switch (a.type) {
      case 'rect':
      case 'ellipse':
      case 'redact': {
        const r = normRect(a.rect);
        d.RD = [r[0] - bbox[0], r[1] - bbox[1], bbox[2] - r[2], bbox[3] - r[3]].map((v) => Math.max(0, v));
        if (a.type === 'redact') { d.IC = [0, 0, 0]; d.OC = [0.85, 0, 0]; delete d.C; }
        break;
      }
      case 'line':
        d.L = [...a.points[0], ...a.points[1]];
        d.LE = [a.startCap || 'None', a.endCap || 'None'];
        break;
      case 'polyline':
      case 'polygon':
        d.Vertices = a.points.flat();
        if (a.type === 'polyline') d.LE = [a.startCap || 'None', a.endCap || 'None'];
        break;
      case 'measure': {
        const mode = a.measure?.mode;
        if (mode === 'distance') { d.L = [...a.points[0], ...a.points[1]]; d.IT = 'LineDimension'; d.LE = [a.startCap || 'None', a.endCap || 'None']; }
        else { d.Vertices = a.points.flat(); d.IT = mode === 'area' ? 'PolygonDimension' : 'PolyLineDimension'; }
        break;
      }
      case 'ink':
        d.InkList = a.paths.map((p) => p.flat());
        break;
      case 'freetext': {
        const f = a.font || {};
        const tc = a.textColor || [0, 0, 0];
        const fam = { Helvetica: 'Helv', Times: 'TiRo', Courier: 'Cour' }[f.family || 'Helvetica'];
        d.DA = PDFString.of(`/${fam} ${fmt(f.size || 12)} Tf ${col(tc)} rg${a.color && a.width > 0 ? ` ${col(a.color)} RG` : ''}`);
        d.Q = { left: 0, center: 1, right: 2 }[a.align || 'left'];
        if (a.fill) d.C = a.fill;
        if (a.callout?.length) {
          d.IT = 'FreeTextCallout';
          d.LE = a.endCap || 'OpenArrow';
          d.CL = a.callout.flat();
        } else if (!(a.width > 0) && !a.fill) {
          d.IT = 'FreeTextTypeWriter';
        }
        const r = normRect(a.rect);
        d.RD = [r[0] - bbox[0], r[1] - bbox[1], bbox[2] - r[2], bbox[3] - r[3]].map((v) => Math.max(0, v));
        d.DS = PDFString.of(`font: ${f.bold ? 'bold ' : ''}${f.italic ? 'italic ' : ''}${fmt(f.size || 12)}pt ${f.family || 'Helvetica'}; text-align:${a.align || 'left'}; color:#${tc.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`);
        break;
      }
      case 'note':
        d.Name = a.icon || 'Comment';
        d.Open = false;
        break;
      case 'highlight':
      case 'underline':
      case 'strikeout':
      case 'squiggly':
        d.QuadPoints = a.quads.flat();
        break;
      case 'stamp':
        d.Name = a.stamp?.kind === 'image' ? 'Image' : 'Draft';
        break;
      default:
        break;
    }

    const dict = this.ctx.obj(d);
    dict.set(PDFName.of('Contents'), text(a.type === 'freetext' ? (a.text || '') : a.contents || ''));
    if (a.type === 'freetext' && a.contents) dict.set(PDFName.of('Subj'), text(a.contents));
    if (a.author) dict.set(PDFName.of('T'), text(a.author));
    dict.set(PDFName.of('M'), pdfDate(a.modified));
    dict.set(PDFName.of('CreationDate'), pdfDate(a.created));
    dict.set(PDFName.of('NM'), text(a.id));
    const { orig, dirty, replies, ...rest } = a;
    void orig; void dirty; void replies;
    dict.set(PDFName.of(PRIVATE_KEY), text(JSON.stringify({ v: 1, rect: bbox, a: rest })));
    return this.ctx.register(dict);
  }
}
