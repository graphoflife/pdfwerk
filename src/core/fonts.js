// Text measurement and layout shared by the on-screen renderer and the PDF writer.
// We use the PDF standard-14 fonts (WinAnsi encoding) so layout is identical in both.
import { StandardFontEmbedder, StandardFonts } from 'pdf-lib';

export const FONT_FAMILIES = ['Helvetica', 'Times', 'Courier'];

const STD = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  Courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

// CSS stacks with metric-compatible fonts so screen and PDF match closely.
export const CSS_FONT = {
  Helvetica: "Helvetica, Arial, 'Liberation Sans', 'Nimbus Sans', sans-serif",
  Times: "'Times New Roman', Times, 'Liberation Serif', 'Nimbus Roman', serif",
  Courier: "'Courier New', Courier, 'Liberation Mono', 'Nimbus Mono PS', monospace",
};

// Distance from the top of a line box (line-height 1.2) to the baseline, as a
// fraction of the font size. Matches how browsers lay out a <textarea>.
const BASELINE = { Helvetica: 0.946, Times: 0.938, Courier: 0.866 };
export const LINE_HEIGHT = 1.2;

const embedderCache = new Map();

export function stdFontName(family = 'Helvetica', bold = false, italic = false) {
  const list = STD[family] || STD.Helvetica;
  return list[(bold ? 1 : 0) + (italic ? 2 : 0)];
}

function embedder(name) {
  let e = embedderCache.get(name);
  if (!e) {
    e = StandardFontEmbedder.for(name);
    embedderCache.set(name, e);
  }
  return e;
}

/** Replace characters the WinAnsi encoding cannot represent. */
export function sanitizeText(text, fontName = StandardFonts.Helvetica) {
  const enc = embedder(fontName).encoding;
  let out = '';
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') { out += ch; continue; }
    if (ch === '\t') { out += '    '; continue; }
    out += enc.canEncodeUnicodeCodePoint(ch.codePointAt(0)) ? ch : '?';
  }
  return out;
}

export function textWidth(text, fontName, size) {
  if (!text) return 0;
  return embedder(fontName).widthOfTextAtSize(sanitizeText(text, fontName), size);
}

export function fontAscent(fontName, size) {
  const f = embedder(fontName).font;
  return ((f.Ascender || f.FontBBox[3]) / 1000) * size;
}

/** Wrap text into lines that fit maxWidth (Infinity = only explicit line breaks). */
export function wrapText(text, fontName, size, maxWidth = Infinity) {
  const lines = [];
  for (const para of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (maxWidth === Infinity || !para) { lines.push(para); continue; }
    const words = para.split(/( +)/);
    let line = '';
    for (const w of words) {
      const candidate = line + w;
      if (!line || textWidth(candidate.trimEnd(), fontName, size) <= maxWidth) {
        line = candidate;
        // Break words that are longer than the whole line.
        while (textWidth(line.trimEnd(), fontName, size) > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && textWidth(line.slice(0, cut), fontName, size) > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        lines.push(line.trimEnd());
        line = w.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/**
 * Lay out a text block whose top-left corner is (x, top).
 * Returns positioned lines with baselines plus the block's natural size.
 */
export function layoutText({ text, family = 'Helvetica', bold, italic, size = 12, align = 'left', x, top, width, wrap = true, padding = 0 }) {
  const fontName = stdFontName(family, bold, italic);
  const inner = width != null ? Math.max(1, width - padding * 2) : Infinity;
  const raw = wrapText(text, fontName, size, wrap ? inner : Infinity);
  const widths = raw.map((l) => textWidth(l, fontName, size));
  const natural = Math.max(0, ...widths);
  const boxInner = width != null ? inner : natural;
  const lh = size * LINE_HEIGHT;
  const firstBase = top - padding - size * (BASELINE[family] ?? BASELINE.Helvetica);
  const lines = raw.map((s, i) => {
    let lx = x + padding;
    if (align === 'center') lx += (boxInner - widths[i]) / 2;
    else if (align === 'right') lx += boxInner - widths[i];
    return { s, x: lx, y: firstBase - i * lh, w: widths[i] };
  });
  return {
    fontName,
    lines,
    width: natural + padding * 2,
    height: Math.max(1, raw.length) * lh + padding * 2,
  };
}
