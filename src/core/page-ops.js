// Structural page operations on a pdf-lib document. Each operation that changes the
// page list returns `order`: for every new page index either the old page index it came
// from or { annots: [...] } for a brand-new page.
import { PDFDocument, PDFName, PDFArray, degrees, rgb, StandardFonts } from 'pdf-lib';
import { AnnotationMode } from './pdfjs.js';

export const PAGE_SIZES = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
};

const identity = (n) => Array.from({ length: n }, (_, i) => i);

export function rotatePages(lib, indices, delta) {
  for (const i of indices) {
    const p = lib.getPage(i);
    p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360));
  }
  return identity(lib.getPageCount());
}

export function deletePages(lib, indices) {
  const del = new Set(indices);
  const order = identity(lib.getPageCount()).filter((i) => !del.has(i));
  [...del].sort((a, b) => b - a).forEach((i) => lib.removePage(i));
  return order;
}

/** Move the pages in `indices` so they start at position `target` (index in the old list). */
export function movePages(lib, indices, target) {
  const n = lib.getPageCount();
  const sel = [...new Set(indices)].sort((a, b) => a - b);
  const set = new Set(sel);
  const rest = identity(n).filter((i) => !set.has(i));
  const insertAt = rest.filter((i) => i < target).length;
  const order = [...rest.slice(0, insertAt), ...sel, ...rest.slice(insertAt)];
  applyOrder(lib, order);
  return order;
}

export function reversePages(lib, indices) {
  const n = lib.getPageCount();
  const sel = [...indices].sort((a, b) => a - b);
  const order = identity(n);
  const rev = [...sel].reverse();
  sel.forEach((pos, k) => { order[pos] = rev[k]; });
  applyOrder(lib, order);
  return order;
}

function applyOrder(lib, order) {
  const pages = lib.getPages();
  for (let i = pages.length - 1; i >= 0; i--) lib.removePage(i);
  order.forEach((oldIdx, k) => lib.insertPage(k, pages[oldIdx]));
}

export function insertBlankPages(lib, at, count, size) {
  const n = lib.getPageCount();
  const order = identity(n);
  for (let k = 0; k < count; k++) {
    lib.insertPage(at + k, size);
    order.splice(at + k, 0, { annots: [] });
  }
  return order;
}

/** Copy pages from another pdf-lib document. `annotsBySrc` holds imported annotations per source page. */
export async function insertPdfPages(lib, src, srcIndices, at, annotsBySrc) {
  const copied = await lib.copyPages(src, srcIndices);
  const order = identity(lib.getPageCount());
  copied.forEach((p, k) => {
    lib.insertPage(at + k, p);
    order.splice(at + k, 0, { annots: annotsBySrc?.[srcIndices[k]] || [] });
  });
  return order;
}

export async function duplicatePages(lib, indices, cloneAnnots) {
  const sel = [...indices].sort((a, b) => a - b);
  const copied = await lib.copyPages(lib, sel);
  const at = sel[sel.length - 1] + 1;
  const order = identity(lib.getPageCount());
  copied.forEach((p, k) => {
    lib.insertPage(at + k, p);
    order.splice(at + k, 0, { annots: cloneAnnots(sel[k]) });
  });
  return order;
}

/** Crop by margins (points) measured on the visible page; margins = {top,right,bottom,left}. */
export function cropPages(lib, indices, m) {
  for (const i of indices) {
    const p = lib.getPage(i);
    const box = p.getCropBox();
    const rot = p.getRotation().angle;
    // Map visual margins to user-space edges depending on rotation.
    const [l, r, b, t] = {
      0: [m.left, m.right, m.bottom, m.top],
      90: [m.bottom, m.top, m.left, m.right],
      180: [m.right, m.left, m.top, m.bottom],
      270: [m.top, m.bottom, m.right, m.left],
    }[rot] || [m.left, m.right, m.bottom, m.top];
    const w = box.width - l - r, h = box.height - b - t;
    if (w < 10 || h < 10) continue;
    p.setCropBox(box.x + l, box.y + b, w, h);
  }
  return identity(lib.getPageCount());
}

/** Visual (as displayed) page coordinates → user space, plus text angle for upright text. */
function visualFrame(page) {
  const box = page.getCropBox();
  const rot = page.getRotation().angle % 360;
  const { x: x0, y: y0, width: W, height: H } = box;
  const vw = rot % 180 ? H : W, vh = rot % 180 ? W : H;
  const toUser = (vx, vy) => {
    switch (rot) {
      case 90: return [x0 + W - vy, y0 + vx];
      case 180: return [x0 + W - vx, y0 + H - vy];
      case 270: return [x0 + vy, y0 + H - vx];
      default: return [x0 + vx, y0 + vy];
    }
  };
  return { vw, vh, toUser, angle: rot };
}

const FONT_MAP = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold],
};

function safe(font, text) {
  let out = '';
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

/** Draw text upright on the visual page, centred on (cx, cy) and rotated by `angle` degrees. */
function drawVisualText(page, font, text, size, frame, cx, cy, angle, color, opacity) {
  const w = font.widthOfTextAtSize(text, size);
  const h = font.heightAtSize(size, { descender: false });
  const a = ((angle + frame.angle) * Math.PI) / 180;
  const [ux, uy] = frame.toUser(cx, cy);
  const x = ux - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a);
  const y = uy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
  page.drawText(text, { x, y, size, font, color, opacity, rotate: degrees(angle + frame.angle) });
}

export async function addWatermark(lib, indices, opts) {
  const font = await lib.embedFont(FONT_MAP[opts.font || 'Helvetica'][opts.bold ? 1 : 0]);
  const color = rgb(...opts.color);
  const text = safe(font, opts.text);
  for (const i of indices) {
    const page = lib.getPage(i);
    const frame = visualFrame(page);
    let size = opts.size;
    if (opts.fit) {
      const diag = Math.hypot(frame.vw, frame.vh) * (Math.abs(Math.sin((opts.rotation * Math.PI) / 180)) > 0.3 ? 0.75 : 0.85);
      const limit = opts.rotation % 180 === 0 ? frame.vw * 0.85 : diag;
      size = Math.max(8, limit / Math.max(1, font.widthOfTextAtSize(text, 1)));
    }
    const pos = opts.position || 'center';
    const cy = pos === 'top' ? frame.vh - size * 1.5 : pos === 'bottom' ? size * 1.5 : frame.vh / 2;
    drawVisualText(page, font, text, size, frame, frame.vw / 2, cy, opts.rotation || 0, color, opts.opacity);
  }
  return identity(lib.getPageCount());
}

function fillTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Header/footer and page numbers. opts.slots = {tl, tc, tr, bl, bc, br} templates with
 * {page} {pages} {date} {title} {file} placeholders.
 */
export async function addHeaderFooter(lib, indices, opts) {
  const font = await lib.embedFont(FONT_MAP[opts.font || 'Helvetica'][0]);
  const color = rgb(...opts.color);
  const total = indices.length;
  const date = new Date().toLocaleDateString(opts.locale);
  indices.forEach((i, k) => {
    const page = lib.getPage(i);
    const frame = visualFrame(page);
    const vars = { page: (opts.start || 1) + k, pages: total + (opts.start || 1) - 1, date, title: opts.title || '', file: opts.file || '' };
    const m = opts.margin;
    for (const [slot, tpl] of Object.entries(opts.slots || {})) {
      if (!tpl) continue;
      const text = safe(font, fillTemplate(tpl, vars));
      const w = font.widthOfTextAtSize(text, opts.size);
      const top = slot[0] === 't';
      const cy = top ? frame.vh - m - opts.size * 0.35 : m + opts.size * 0.35;
      const cx = slot[1] === 'l' ? m + w / 2 : slot[1] === 'r' ? frame.vw - m - w / 2 : frame.vw / 2;
      drawVisualText(page, font, text, opts.size, frame, cx, cy, 0, color, 1);
    }
  });
  return identity(lib.getPageCount());
}

/**
 * Burn redactions in: the page is re-rendered as an image with black boxes, so no text or
 * vector content survives underneath. rectsByPage: Map<pageIndex, Array<[x1,y1,x2,y2]>>.
 */
export async function rasterizeRedactions(lib, pdf, rectsByPage, { dpi = 200, fill = [0, 0, 0] } = {}) {
  for (const [i, rects] of rectsByPage) {
    const old = lib.getPage(i);
    const pjPage = await pdf.getPage(i + 1);
    const scale = dpi / 72;
    const viewport = pjPage.getViewport({ scale, rotation: 0 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pjPage.render({ canvas, canvasContext: ctx, viewport, intent: 'print', annotationMode: AnnotationMode.DISABLE }).promise;
    ctx.fillStyle = `rgb(${fill.map((v) => Math.round(v * 255)).join(',')})`;
    for (const r of rects) {
      const [ax, ay] = viewport.convertToViewportPoint(r[0], r[1]);
      const [bx, by] = viewport.convertToViewportPoint(r[2], r[3]);
      ctx.fillRect(Math.min(ax, bx) - 0.5, Math.min(ay, by) - 0.5, Math.abs(bx - ax) + 1, Math.abs(by - ay) + 1);
    }
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    const img = await lib.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const [x0, y0, x1, y1] = pjPage.view;
    const page = lib.insertPage(i, [x1 - x0, y1 - y0]);
    page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
    page.drawImage(img, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    page.setRotation(old.getRotation());
    const annots = old.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) page.node.set(PDFName.of('Annots'), annots);
    lib.removePage(i + 1);
    canvas.width = canvas.height = 0;
  }
  return identity(lib.getPageCount());
}

export async function imagesToPdf(files, { pageSize = null, margin = 0 } = {}) {
  const lib = await PDFDocument.create();
  for (const f of files) {
    const { bytes, mime, width, height } = await normalizeImage(f);
    const img = mime === 'image/jpeg' ? await lib.embedJpg(bytes) : await lib.embedPng(bytes);
    let pw = width * 0.75, ph = height * 0.75;
    if (pageSize) [pw, ph] = width > height && pageSize[0] < pageSize[1] ? [pageSize[1], pageSize[0]] : pageSize;
    const page = lib.addPage([pw, ph]);
    const s = Math.min((pw - margin * 2) / width, (ph - margin * 2) / height);
    const w = width * s, h = height * s;
    page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }
  return lib.save();
}

/** Read an image file/blob and return PNG or JPEG bytes (other formats are converted). */
export async function normalizeImage(file) {
  const mime = file.type;
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  if (mime === 'image/png' || mime === 'image/jpeg') {
    bitmap.close?.();
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime, width, height };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', width, height };
}
