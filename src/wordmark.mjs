import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "wordmark.json"), "utf8"));

export const WIDTH = SOURCE.width;
export const HEIGHT = SOURCE.height;
export const NAVY = SOURCE.navy;
export const AMBER = SOURCE.amber;

const TOLERANCE = 0.05;

function tokensOf(d) {
  const tokens = [];
  let at = 0;
  let flags = 0;
  const number = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/;
  while (at < d.length) {
    const char = d[at];
    if (/[\s,]/.test(char)) {
      at++;
      continue;
    }
    if (/[a-zA-Z]/.test(char)) {
      tokens.push(char);
      flags = 0;
      at++;
      continue;
    }
    const command = [...tokens].reverse().find((token) => typeof token === "string");
    if (command && /a/i.test(command)) {
      const index = flags % 7;
      if (index === 3 || index === 4) {
        tokens.push(Number(char));
        flags++;
        at++;
        continue;
      }
    }
    const match = number.exec(d.slice(at));
    if (!match) throw new Error(`bad path data at ${at}: ${d.slice(at, at + 12)}`);
    tokens.push(Number(match[0]));
    flags++;
    at += match[0].length;
  }
  return tokens;
}

function cubic(out, p0, p1, p2, p3) {
  const flat = (a, b, c, e) => {
    const dx = e[0] - a[0];
    const dy = e[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const off = (p) => Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / length;
    return Math.max(off(b), off(c));
  };
  const split = (a, b, c, e, depth) => {
    if (depth > 12 || flat(a, b, c, e) < TOLERANCE) {
      out.push(e);
      return;
    }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ce = mid(c, e);
    const abc = mid(ab, bc);
    const bce = mid(bc, ce);
    const middle = mid(abc, bce);
    split(a, ab, abc, middle, depth + 1);
    split(middle, bce, ce, e, depth + 1);
  };
  split(p0, p1, p2, p3, 0);
}

function arc(out, from, rx, ry, turn, large, sweep, to) {
  if (!rx || !ry) {
    out.push(to);
    return;
  }
  const phi = (turn * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  let a = Math.abs(rx);
  let b = Math.abs(ry);
  const scale = (x1 * x1) / (a * a) + (y1 * y1) / (b * b);
  if (scale > 1) {
    a *= Math.sqrt(scale);
    b *= Math.sqrt(scale);
  }
  const top = a * a * b * b - a * a * y1 * y1 - b * b * x1 * x1;
  const bottom = a * a * y1 * y1 + b * b * x1 * x1;
  const factor = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, top / bottom));
  const cx1 = (factor * a * y1) / b;
  const cy1 = (-factor * b * x1) / a;
  const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const start = angle(1, 0, (x1 - cx1) / a, (y1 - cy1) / b);
  let span = angle((x1 - cx1) / a, (y1 - cy1) / b, (-x1 - cx1) / a, (-y1 - cy1) / b);
  if (!sweep && span > 0) span -= Math.PI * 2;
  if (sweep && span < 0) span += Math.PI * 2;
  const radius = Math.max(a, b);
  const step = 2 * Math.acos(Math.max(0, 1 - TOLERANCE / radius));
  const count = Math.max(2, Math.ceil(Math.abs(span) / step));
  for (let index = 1; index <= count; index++) {
    const t = start + (span * index) / count;
    out.push([cx + a * Math.cos(t) * cos - b * Math.sin(t) * sin, cy + a * Math.cos(t) * sin + b * Math.sin(t) * cos]);
  }
  out[out.length - 1] = to;
}

export function contoursOf(d) {
  const tokens = tokensOf(d);
  const contours = [];
  let current = null;
  let at = [0, 0];
  let start = [0, 0];
  let control = null;
  let quad = null;
  let command = "";
  let index = 0;
  const take = () => tokens[index++];
  const close = () => {
    if (current && current.length > 2) contours.push(current);
    current = null;
  };
  while (index < tokens.length) {
    if (typeof tokens[index] === "string") command = take();
    const relative = command === command.toLowerCase();
    const point = () => {
      const x = take();
      const y = take();
      return relative ? [at[0] + x, at[1] + y] : [x, y];
    };
    const kind = command.toUpperCase();
    if (kind === "M") {
      close();
      at = point();
      start = at;
      current = [at];
      command = relative ? "l" : "L";
      control = null;
    } else if (kind === "L") {
      at = point();
      current.push(at);
      control = null;
    } else if (kind === "H") {
      const x = take();
      at = [relative ? at[0] + x : x, at[1]];
      current.push(at);
      control = null;
    } else if (kind === "V") {
      const y = take();
      at = [at[0], relative ? at[1] + y : y];
      current.push(at);
      control = null;
    } else if (kind === "C") {
      const a = point();
      const b = point();
      const to = point();
      cubic(current, at, a, b, to);
      control = b;
      at = to;
    } else if (kind === "S") {
      const a = control ? [2 * at[0] - control[0], 2 * at[1] - control[1]] : at;
      const b = point();
      const to = point();
      cubic(current, at, a, b, to);
      control = b;
      at = to;
    } else if (kind === "Q") {
      const q = point();
      const to = point();
      cubic(current, at, [at[0] + ((q[0] - at[0]) * 2) / 3, at[1] + ((q[1] - at[1]) * 2) / 3], [to[0] + ((q[0] - to[0]) * 2) / 3, to[1] + ((q[1] - to[1]) * 2) / 3], to);
      control = null;
      quad = q;
      at = to;
      continue;
    } else if (kind === "T") {
      const q = quad ? [2 * at[0] - quad[0], 2 * at[1] - quad[1]] : at;
      const to = point();
      cubic(current, at, [at[0] + ((q[0] - at[0]) * 2) / 3, at[1] + ((q[1] - at[1]) * 2) / 3], [to[0] + ((q[0] - to[0]) * 2) / 3, to[1] + ((q[1] - to[1]) * 2) / 3], to);
      control = null;
      quad = q;
      at = to;
      continue;
    } else if (kind === "A") {
      const rx = take();
      const ry = take();
      const turn = take();
      const large = take();
      const sweep = take();
      const to = point();
      arc(current, at, rx, ry, turn, large, sweep, to);
      control = null;
      at = to;
    } else if (kind === "Z") {
      at = start;
      close();
      control = null;
    } else {
      throw new Error(`unsupported path command ${command}`);
    }
    quad = null;
  }
  close();
  return contours.map(tidy).filter((ring) => ring.length > 2);
}

function tidy(ring) {
  const out = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.02) out.push(point);
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= 0.02) out.pop();
  const kept = [];
  const count = out.length;
  for (let index = 0; index < count; index++) {
    const a = out[(index + count - 1) % count];
    const b = out[index];
    const c = out[(index + 1) % count];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const along = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (Math.abs(cross) > 1e-4 || along < 0) kept.push(b);
  }
  return kept;
}

export const areaOf = (ring) => {
  let area = 0;
  for (let index = 0; index < ring.length; index++) {
    const [ax, ay] = ring[index];
    const [bx, by] = ring[(index + 1) % ring.length];
    area += ax * by - bx * ay;
  }
  return area / 2;
};

function boxOf(contours) {
  const xs = contours.flat().map(([x]) => x);
  const ys = contours.flat().map(([, y]) => y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

const LINES = [
  { name: "HUNT", letters: ["H", "U", "N", "T", "&"] },
  { name: "HACKETT", letters: ["H", "A", "C", "K", "E", "T", "T"] },
];

function read() {
  const raw = SOURCE.paths.map(({ d, amber }) => {
    const contours = contoursOf(d);
    return { contours, amber, source: d, box: boxOf(contours) };
  });
  const split = HEIGHT / 2;
  const rows = [raw.filter((glyph) => (glyph.box.y0 + glyph.box.y1) / 2 < split), raw.filter((glyph) => (glyph.box.y0 + glyph.box.y1) / 2 >= split)];
  const glyphs = [];
  rows.forEach((row, line) => {
    row.sort((a, b) => a.box.x0 - b.box.x0);
    if (row.length !== LINES[line].letters.length) throw new Error(`line ${line + 1} has ${row.length} glyphs`);
    row.forEach((glyph, index) => {
      const outer = [...glyph.contours].sort((a, b) => Math.abs(areaOf(b)) - Math.abs(areaOf(a)))[0];
      glyphs.push({
        index: glyphs.length,
        letter: LINES[line].letters[index],
        line,
        word: LINES[line].name,
        amber: glyph.amber,
        source: glyph.source,
        contours: glyph.contours,
        outer,
        box: glyph.box,
        width: glyph.box.x1 - glyph.box.x0,
        height: glyph.box.y1 - glyph.box.y0,
      });
    });
  });
  return glyphs;
}

export const GLYPHS = read();

export const BYTES = GLYPHS.reduce((sum, glyph) => sum + glyph.source.length, 0);

const flatOf = (letter, line) => GLYPHS.find((glyph) => glyph.letter === letter && glyph.line === line);

export const METRICS = (() => {
  const upper = flatOf("H", 0).box;
  const lower = flatOf("H", 1).box;
  return {
    caps: [upper.y1 - upper.y0, lower.y1 - lower.y0],
    capLines: [upper.y0, lower.y0],
    baselines: [upper.y1, lower.y1],
    leading: lower.y0 - upper.y1,
    ratio: (lower.y1 - lower.y0) / (upper.y1 - upper.y0),
    advance: [Math.max(...GLYPHS.filter((glyph) => glyph.line === 0).map((glyph) => glyph.box.x1)), Math.max(...GLYPHS.filter((glyph) => glyph.line === 1).map((glyph) => glyph.box.x1))],
  };
})();
