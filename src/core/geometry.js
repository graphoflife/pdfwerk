// Geometry helpers. All annotation geometry lives in PDF user space (points, y-up).
// Paths are arrays of commands: ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Z'].

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function normRect([x1, y1, x2, y2]) {
  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

export function rectFromPoints(p, q) {
  return normRect([p[0], p[1], q[0], q[1]]);
}

export function bboxOfPoints(points) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of points) {
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  return [x1, y1, x2, y2];
}

export function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export const expandBox = (b, m) => [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
export const boxW = (b) => b[2] - b[0];
export const boxH = (b) => b[3] - b[1];
export const boxCenter = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

export function boxIntersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function pointInBox(p, b, tol = 0) {
  return p[0] >= b[0] - tol && p[0] <= b[2] + tol && p[1] >= b[1] - tol && p[1] <= b[3] + tol;
}

export function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Snap the vector origin→p to the nearest multiple of `stepDeg` (Shift-constraint). */
export function snapAngle(origin, p, stepDeg = 45) {
  const dx = p[0] - origin[0], dy = p[1] - origin[1];
  const len = Math.hypot(dx, dy);
  if (!len) return [p[0], p[1]];
  const step = (stepDeg * Math.PI) / 180;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  // Project onto the snapped direction so the point stays under the cursor as much as possible.
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const proj = dx * ux + dy * uy;
  return [origin[0] + ux * proj, origin[1] + uy * proj].map((v) => Math.round(v * 1000) / 1000);
}

/** Make the rectangle spanned by origin→p a square (Shift-constraint for shapes). */
export function squareFrom(origin, p) {
  const dx = p[0] - origin[0], dy = p[1] - origin[1];
  const s = Math.max(Math.abs(dx), Math.abs(dy));
  return [origin[0] + Math.sign(dx || 1) * s, origin[1] + Math.sign(dy || 1) * s];
}

/** Constrain a move delta to the dominant axis. */
export function axisLock(dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];
}

// ---------- matrices ([a b c d e f] like PDF/canvas) ----------
export const applyMatrix = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function invertMatrix(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

export function multiplyMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

// ---------- path builders ----------
const K = 0.5522847498; // bezier circle constant

export function rectPath([x1, y1, x2, y2]) {
  return [['M', x1, y1], ['L', x2, y1], ['L', x2, y2], ['L', x1, y2], ['Z']];
}

export function roundRectPath([x1, y1, x2, y2], r) {
  r = Math.min(r, (x2 - x1) / 2, (y2 - y1) / 2);
  const k = r * (1 - K);
  return [
    ['M', x1 + r, y1], ['L', x2 - r, y1], ['C', x2 - k, y1, x2, y1 + k, x2, y1 + r],
    ['L', x2, y2 - r], ['C', x2, y2 - k, x2 - k, y2, x2 - r, y2],
    ['L', x1 + r, y2], ['C', x1 + k, y2, x1, y2 - k, x1, y2 - r],
    ['L', x1, y1 + r], ['C', x1, y1 + k, x1 + k, y1, x1 + r, y1], ['Z'],
  ];
}

export function ellipsePath([x1, y1, x2, y2]) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
  const ox = rx * K, oy = ry * K;
  return [
    ['M', cx + rx, cy],
    ['C', cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry],
    ['C', cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy],
    ['C', cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry],
    ['C', cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy],
    ['Z'],
  ];
}

export function polyPath(points, closed = false) {
  const cmds = points.map((p, i) => [i ? 'L' : 'M', p[0], p[1]]);
  if (closed) cmds.push(['Z']);
  return cmds;
}

/** Smooth freehand stroke: quadratic midpoint smoothing expressed as cubics. */
export function smoothPath(points) {
  if (points.length < 3) return polyPath(points.length === 1 ? [points[0], points[0]] : points);
  const cmds = [['M', points[0][0], points[0][1]]];
  let prev = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const c = points[i];
    const mid = [(c[0] + points[i + 1][0]) / 2, (c[1] + points[i + 1][1]) / 2];
    // quadratic prev→c→mid as cubic
    cmds.push(['C', prev[0] + (2 / 3) * (c[0] - prev[0]), prev[1] + (2 / 3) * (c[1] - prev[1]),
      mid[0] + (2 / 3) * (c[0] - mid[0]), mid[1] + (2 / 3) * (c[1] - mid[1]), mid[0], mid[1]]);
    prev = mid;
  }
  const last = points[points.length - 1];
  cmds.push(['L', last[0], last[1]]);
  return cmds;
}

/** Arc approximated by cubic beziers (angles in radians, counter-clockwise when a1 > a0). */
function arcCubics(cx, cy, r, a0, a1) {
  const cmds = [];
  const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const da = (a1 - a0) / segs;
  const k = (4 / 3) * Math.tan(da / 4);
  for (let i = 0; i < segs; i++) {
    const s = a0 + i * da, e = s + da;
    const p0 = [cx + r * Math.cos(s), cy + r * Math.sin(s)];
    const p3 = [cx + r * Math.cos(e), cy + r * Math.sin(e)];
    cmds.push(['C', p0[0] - k * r * Math.sin(s), p0[1] + k * r * Math.cos(s),
      p3[0] + k * r * Math.sin(e), p3[1] - k * r * Math.cos(e), p3[0], p3[1]]);
  }
  return cmds;
}

function signedArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Cloudy border around a closed polygon: semicircle bumps pointing outward. */
export function cloudPath(points, bump = 8) {
  if (points.length < 3) return polyPath(points, true);
  const ccw = signedArea(points) > 0;
  const cmds = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const len = dist(a, b);
    if (len < 1e-6) continue;
    const n = Math.max(1, Math.round(len / (bump * 2)));
    const seg = len / n, r = seg / 2;
    const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
    const base = Math.atan2(uy, ux);
    for (let j = 0; j < n; j++) {
      const cx = a[0] + ux * (j * seg + r), cy = a[1] + uy * (j * seg + r);
      if (!cmds.length) cmds.push(['M', cx - ux * r, cy - uy * r]);
      // Outward side is to the right of travel for CCW polygons, to the left for CW ones.
      const a0 = base + Math.PI;
      cmds.push(...arcCubics(cx, cy, r, a0, ccw ? a0 + Math.PI : a0 - Math.PI));
    }
  }
  cmds.push(['Z']);
  return cmds;
}

export function ellipsePoints(rect, n = 24) {
  const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
  const rx = (rect[2] - rect[0]) / 2, ry = (rect[3] - rect[1]) / 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/**
 * Line ending shape at `tip`, with the line arriving from `from`.
 * Returns { cmds, closed } in user space; size scales with the stroke width.
 */
export function lineEnding(style, tip, from, width) {
  if (!style || style === 'None') return null;
  const size = Math.max(4, width * 3 + 3);
  const len = dist(tip, from) || 1;
  const ux = (tip[0] - from[0]) / len, uy = (tip[1] - from[1]) / len;
  const nx = -uy, ny = ux;
  const back = (d, s) => [tip[0] - ux * d + nx * s, tip[1] - uy * d + ny * s];
  switch (style) {
    case 'OpenArrow': {
      const a = back(size * 1.6, size * 0.75), b = back(size * 1.6, -size * 0.75);
      return { cmds: [['M', a[0], a[1]], ['L', tip[0], tip[1]], ['L', b[0], b[1]]], closed: false };
    }
    case 'ClosedArrow': {
      const a = back(size * 1.6, size * 0.75), b = back(size * 1.6, -size * 0.75);
      return { cmds: [['M', a[0], a[1]], ['L', tip[0], tip[1]], ['L', b[0], b[1]], ['Z']], closed: true };
    }
    case 'ROpenArrow': {
      const a = back(-size * 1.6, size * 0.75), b = back(-size * 1.6, -size * 0.75);
      return { cmds: [['M', a[0], a[1]], ['L', tip[0], tip[1]], ['L', b[0], b[1]]], closed: false };
    }
    case 'Circle': {
      const r = size * 0.6;
      return { cmds: ellipsePath([tip[0] - r, tip[1] - r, tip[0] + r, tip[1] + r]), closed: true };
    }
    case 'Square': {
      const r = size * 0.55;
      const pts = [back(-r, r), back(-r, -r), back(r, -r), back(r, r)];
      return { cmds: polyPath(pts, true), closed: true };
    }
    case 'Diamond': {
      const r = size * 0.75;
      const pts = [back(-r, 0), back(0, -r), back(r, 0), back(0, r)];
      return { cmds: polyPath(pts, true), closed: true };
    }
    case 'Butt': {
      const a = back(0, size * 0.9), b = back(0, -size * 0.9);
      return { cmds: [['M', a[0], a[1]], ['L', b[0], b[1]]], closed: false };
    }
    case 'Slash': {
      const a = back(size * 0.5, size * 0.9), b = back(-size * 0.5, -size * 0.9);
      return { cmds: [['M', a[0], a[1]], ['L', b[0], b[1]]], closed: false };
    }
    default:
      return null;
  }
}

export function pathPoints(cmds) {
  const pts = [];
  for (const c of cmds) {
    for (let i = 1; i + 1 < c.length; i += 2) pts.push([c[i], c[i + 1]]);
  }
  return pts;
}

export function translatePath(cmds, dx, dy) {
  return cmds.map((c) => c.map((v, i) => (i === 0 ? v : i % 2 ? v + dx : v + dy)));
}

export function svgPathData(cmds) {
  const f = (n) => +n.toFixed(3);
  return cmds.map((c) => c[0] + (c.length > 1 ? c.slice(1).map(f).join(' ') : '')).join(' ');
}

export function polylineLength(points) {
  let l = 0;
  for (let i = 1; i < points.length; i++) l += dist(points[i - 1], points[i]);
  return l;
}

export const polygonArea = (points) => Math.abs(signedArea(points));

export function polygonCentroid(points) {
  const a = signedArea(points);
  if (Math.abs(a) < 1e-9) {
    const b = bboxOfPoints(points);
    return boxCenter(b);
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** Map a point inside box `from` to the equivalent position inside box `to` (resize). */
export function mapBoxPoint(p, from, to) {
  const sx = boxW(from) ? boxW(to) / boxW(from) : 1;
  const sy = boxH(from) ? boxH(to) / boxH(from) : 1;
  return [to[0] + (p[0] - from[0]) * sx, to[1] + (p[1] - from[1]) * sy];
}
