import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./kit/iso-kit.mjs";
import * as G from "./kit/lathe.mjs";
import * as A from "./kit/audit.mjs";
import { tubePieces, tubeSvg } from "./kit/tube.mjs";
import * as W from "./src/wordmark.mjs";
import { upright, faceOf, wallGlyph, glyphSvg, anchorsOf, roomiest } from "./src/letters.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file) => readFileSync(join(HERE, file), "utf8");
const AUDIT = process.argv.includes("--audit");

const WIDTH = 760;
const HEIGHT = 500;
const AZIMUTH = 60;

const X0 = -W.WIDTH / 2;
const Z0 = 30;
const TOP = Z0 + W.HEIGHT;
const SLEEVE = 2.2;
const BACK = 4.6;
const FRONT = 10;
const REACH = 62;
const PULL = 44;
const APART = { hunt: 26, hackett: 40, amp: 48 };
const SPRING = { stiffness: 64, damping: 14.2, substeps: 4, stagger: 0.035 };

const BASE = { x: -234, y: -36, w: 468, d: 100, r: 9 };
const BASE_H = 10;
const FOOT_H = 5;
const PLINTH = { x: -196, y: -7, w: 392, d: 12, r: 1 };
const PLINTH_H = 12;
const PANEL = { x: -196, y: -4, w: 392, d: 4, r: 0.5 };
const PANEL_TOP = 160;
const POSTS = [-210, 196].map((x) => ({ x, y: -8, w: 14, d: 14, r: 1.5 }));
const BLOCKS = [-216, 196].map((x) => ({ x, y: -30, w: 20, d: 46, r: 2.5 }));
const BLOCK_H = 5;
const CAP = { x: -213, y: -10, w: 426, d: 18, r: 2 };
const CAP_H = 6;
const DRIVER = { x: -172, y: 24, w: 58, d: 26, r: 3 };
const DRIVER_H = 14;
const CABLE_Y = DRIVER.y + 13;
const CABLE_Z = 3;
const CABLE_R = 1;

const P = k.fitProjection(
  [...k.boxCorners(BASE, -BASE_H - FOOT_H, 0), ...k.boxCorners(CAP, PANEL_TOP, PANEL_TOP + CAP_H), [X0, FRONT + REACH, Z0], [X0, FRONT + REACH, TOP]],
  WIDTH,
  HEIGHT,
  { pad: 30, azimuth: AZIMUTH },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const onWall = (points, y = 0, closed = false) => k.pathOf(points.map(([x, z]) => at([x, y, z])), closed);
const outward = (origin) => G.frameAlong(origin, [0, 1, 0]);
const sideways = (origin) => G.frameAlong(origin, [1, 0, 0]);
const WALL = G.frameOf([0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]);
const one = (value) => Math.round(value * 10) / 10;

const toWorld = ([x, y]) => [x + X0, Z0 + (W.HEIGHT - y)];
const LINES = W.METRICS.baselines.map((baseline, line) => ({ base: Z0 + W.HEIGHT - baseline, cap: Z0 + W.HEIGHT - W.METRICS.capLines[line] }));

const GLYPHS = W.GLYPHS.map((glyph) => {
  const contours = upright(glyph.contours.map((ring) => ring.map(toWorld)));
  const xs = contours[0].map(([x]) => x);
  const zs = contours[0].map(([, z]) => z);
  const studs = anchorsOf(contours, { count: 3, clear: 1.7 });
  const group = glyph.amber ? "amp" : glyph.line === 0 ? "hunt" : "hackett";
  return {
    ...glyph,
    contours,
    group,
    piece: `glyph${glyph.index}`,
    move: [0, APART[group], 0],
    studs,
    lead: glyph.amber ? roomiest(contours, studs, { clear: 2 }) : null,
    world: { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) },
  };
});
const AMP = GLYPHS.find((glyph) => glyph.amber);
const STUDS = GLYPHS.reduce((sum, glyph) => sum + glyph.studs.length, 0);
if (GLYPHS.some((glyph) => glyph.studs.length < 2) || !AMP.lead) throw new Error("a glyph has nowhere to stand");
const STAGGER = [...GLYPHS.filter((glyph) => glyph.group === "hackett"), ...GLYPHS.filter((glyph) => glyph.group === "hunt"), AMP].map((glyph) => glyph.index);

const R = A.recorder(P, { order: STAGGER.map((index) => GLYPHS[index].piece), spring: SPRING });
let drawn = 0;
const put = (name, shapes, extra = {}) => R.put({ name: R.nameFor(name), key: ++drawn * 1000, shapes: shapes.map((shape) => R.solid(shape)), ...extra });
const slab = (name, plan, z, height, { steps = 8, bevel = 0, meta = {}, ...style } = {}) => {
  const svg = S(k.slabOf(plan, z, height, P, steps, bevel), style);
  put(name, [A.slab(plan, z, height, { name, ...meta }, steps)], { svg });
  return svg;
};
const round = (name, x, y, r, z, height, { steps = 32, bevel = 0, meta = {}, ...style } = {}) => {
  const svg = S(k.cylinder(x, y, r, z, height, P, steps, bevel), style);
  put(name, [A.cylinder(x, y, r, z, height, { name, ...meta })], { svg });
  return svg;
};
const turned = (name, F, s0, s1, r, { meta = {}, ...style } = {}) => {
  const svg = S(G.disc(s0, s1, r, F, P), style);
  put(name, [A.disc(F, s0, s1, r, { name, ...meta })], { svg });
  return svg;
};
const ball = (name, centre, r, { meta = {}, ...style } = {}) => {
  const svg = S(G.sphereOf(centre, r, P), style);
  put(name, [A.ball(centre, r, { name, ...meta })], { svg });
  return svg;
};

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  const feet = byDepth([...k.corners(BASE, 26), [0, BASE.y + 24], [0, BASE.y + BASE.d - 24]]);
  for (const [x, y] of feet) {
    out.push(round("foot.pad", x, y, 8, -BASE_H - FOOT_H, 1.6, { tone: "lo" }));
    out.push(round("foot", x, y, 6.2, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, { tone: "mid" }));
    out.push(L(k.knurl(x, y, 6.2, -BASE_H - FOOT_H + 1.6, -BASE_H, 30, P, 0.3), { tone: "lo" }));
  }
  out.push(slab("stand.base", BASE, -BASE_H, BASE_H, { steps: 10, bevel: 1.6, tone: "mid", inner: L(k.sideSeam(BASE, -BASE_H + 3, P, 10), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(BASE, 5), 0, P, 10), { tone: "lo" }));
  const screws = k.corners(BASE, 12);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 18)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.55 }));
  return out.join("");
}

function block(plan) {
  const out = [slab("block", plan, 0, BLOCK_H, { steps: 5, bevel: 0.6, tone: "mid" })];
  const screws = [
    [plan.x + 4, plan.y + 4],
    [plan.x + plan.w - 4, plan.y + 4],
    [plan.x + 4, plan.y + plan.d - 4],
    [plan.x + plan.w - 4, plan.y + plan.d - 4],
  ];
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 1.6, BLOCK_H, P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, BLOCK_H])), { size: 0.45 }));
  return out.join("");
}

function strut(plan, side) {
  const face = side > 0 ? plan.x + plan.w : plan.x;
  const x = face + side * 3.4;
  const low = [x, -24, BLOCK_H + 4];
  const high = [x, -6.2, 78];
  const reach = G.sub3(high, low);
  const rim = Math.sqrt(2.6 * 2.6 - 1.5 * 1.5);
  const seat = Math.sqrt(2.6 * 2.6 - 1.7 * 1.7);
  const lug = G.frameAlong([face, high[1], high[2]], [side, 0, 0]);
  const meta = { owner: side > 0 ? "strut.right" : "strut.left" };
  const foot = [
    () => round("strut.pad", low[0], low[1], 3.4, BLOCK_H, 0.8, { steps: 20, tone: "mid", meta }),
    () => round("strut.stem", low[0], low[1], 1.7, BLOCK_H + 0.8, 4 - seat - 0.8, { steps: 16, tone: "mid", crease: "none", meta }),
    () => ball("strut.ball", low, 2.6, { tone: "mid", meta }),
  ];
  const joint = [
    () => turned("strut.lug", lug, 0, 0.7, 1.8, { tone: "mid", meta }),
    () => turned("strut.pin", lug, 0.7, 3.4 - seat, 1.7, { tone: "mid", crease: "none", meta }),
  ];
  const brace = [
    () => turned("strut.rod", G.frameAlong(low, reach), rim, G.len3(reach) - rim, 1.5, { tone: "mid", crease: "none", meta }),
    () => ball("strut.ball", high, 2.6, { tone: "mid", meta }),
  ];
  return [...foot, ...(side > 0 ? [...joint, ...brace] : [...brace, ...joint.reverse()])].map((draw) => draw()).join("");
}

function upstand(plan) {
  const seams = [BLOCK_H + 6, PANEL_TOP - 6].map((z) => k.sideSeam(plan, z, P, 4)).join("");
  return slab("post", plan, BLOCK_H, PANEL_TOP - BLOCK_H, { steps: 4, bevel: 0.8, tone: "mid", inner: L(seams, { tone: "faint" }) });
}

function plinth() {
  const out = [slab("plinth", PLINTH, 0, PLINTH_H, { steps: 3, bevel: 0.8, tone: "mid", inner: L(k.sideSeam(PLINTH, 2.4, P, 3), { tone: "faint" }) })];
  const front = PLINTH.y + PLINTH.d;
  const lip = [];
  for (let x = PLINTH.x + 14; x <= PLINTH.x + PLINTH.w - 14; x += 28) lip.push(at([x, front - 2.4, PLINTH_H]));
  out.push(D(lip, { size: 0.4, tone: "lo" }));
  const bolts = [-182, -91, 91, 182].map((x) => [x, front, 7.6]);
  out.push(L(bolts.map((point) => k.sideRing(point, 1.7, "y", P, 14)).join(""), { tone: "lo" }));
  out.push(D(bolts.map(at), { size: 0.45 }));
  return out.join("");
}

const byStud = (studs) => [...studs].sort((a, b) => k.depthOf([a.x, 0, a.z], P) - k.depthOf([b.x, 0, b.z], P));

function panel() {
  const out = [slab("panel", PANEL, PLINTH_H, PANEL_TOP - PLINTH_H, { steps: 2, tone: "mid" })];

  const rule = { x: -194, y: 0, w: 7, d: 0.6, r: 0 };
  out.push(slab("rule.height", rule, Z0 - 6, W.HEIGHT + 12, { steps: 1, tone: "lo", crease: "none" }));
  const minor = [];
  const major = [];
  for (let step = 0; Z0 + step * 5 <= TOP + 0.01; step++) {
    const z = Z0 + step * 5;
    const big = step % 5 === 0;
    (big ? major : minor).push(k.segment([rule.x, 0.6, z], [rule.x + (big ? 4 : 2.2), 0.6, z], P));
  }
  out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }));
  out.push(D([at([rule.x + 3.5, 0.6, Z0 - 3.4]), at([rule.x + 3.5, 0.6, TOP + 3.4])], { size: 0.4 }));

  const scale = { x: X0 - 6, y: 0, w: W.WIDTH + 12, d: 0.6, r: 0 };
  out.push(slab("rule.width", scale, 15, 6.5, { steps: 1, tone: "lo" }));
  const small = [];
  const large = [];
  for (let step = 0; step * 5 <= W.WIDTH + 0.01; step++) {
    const x = X0 + step * 5;
    const big = step % 5 === 0;
    (big ? large : small).push(k.segment([x, 0.6, 21.5], [x, 0.6, 21.5 - (big ? 3.8 : 2)], P));
  }
  out.push(L(small.join(""), { tone: "lo" }), L(large.join(""), { tone: "mid" }));
  out.push(D([at([scale.x + 2.6, 0.6, 16.8]), at([scale.x + scale.w - 2.6, 0.6, 16.8])], { size: 0.4 }));

  const stops = [...new Set(LINES.flatMap((line) => [line.base, line.cap]))];
  for (const z of stops) {
    out.push(L(k.segment([rule.x + rule.w + 3, 0, z], [PANEL.x + PANEL.w, 0, z], P), { tone: "lo" }));
    out.push(slab("rule.stop", { x: rule.x - 1.2, y: 0.6, w: 11.2, d: 0.8, r: 0.3 }, z - 1.5, 3, { steps: 1, tone: "mid", crease: "none" }));
    out.push(D([at([rule.x + 1.4, 1.4, z])], { size: 0.4, tone: "hi" }));
  }

  const fixings = [-150, -50, 50, 150].map((x) => [x, 0, PANEL_TOP - 7]);
  out.push(L(fixings.map((point) => k.sideRing(point, 2, "y", P, 16)).join(""), { tone: "lo" }));
  out.push(D(fixings.map(at), { size: 0.5 }));

  out.push(`<path class="hh-glow" data-glow d="${faceOf(AMP.contours, 0, P)}"/>`);
  for (const glyph of GLYPHS) {
    if (!glyph.amber) out.push(`<path class="hh-shadow" data-shadow="${glyph.index}" d="${faceOf(glyph.contours, 0, P)}"/>`);
    out.push(`<path class="iso-line hh-print" data-tone="faint" d="${faceOf(glyph.contours, 0, P)}"/>`);
  }
  for (const glyph of GLYPHS) {
    for (const stud of byStud(glyph.studs)) out.push(turned("sleeve", outward([stud.x, 0, stud.z]), 0, SLEEVE, 1.5, { tone: "mid" }));
  }
  const socket = outward([AMP.lead.x, 0, AMP.lead.z]);
  out.push(turned("socket", socket, 0, 1.6, 2.6, { tone: "mid" }));
  out.push(L(G.circleOf(socket, 1.6, 1.7, P), { tone: "lo" }));
  out.push(D([at([AMP.lead.x, 1.6, AMP.lead.z])], { size: 0.55, tone: "hi" }));
  return out.join("");
}

function cap() {
  const top = PANEL_TOP + CAP_H;
  const out = [slab("cap", CAP, PANEL_TOP, CAP_H, { steps: 5, bevel: 0.8, tone: "mid" })];
  out.push(L(k.planOutline(k.insetPlan(CAP, 3.4), top, P, 5), { tone: "faint" }));
  const screws = [-203, -68, 68, 203].map((x) => [x, CAP.y + CAP.d / 2]);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 1.9, top, P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, top])), { size: 0.45 }));
  return out.join("");
}

function slot(x0, x1, z0, z1, y) {
  const r = (x1 - x0) / 2;
  const points = [];
  for (let step = 0; step <= 8; step++) {
    const angle = Math.PI + (step / 8) * Math.PI;
    points.push([x0 + r + r * Math.cos(angle), z0 + r + r * Math.sin(angle)]);
  }
  for (let step = 0; step <= 8; step++) {
    const angle = (step / 8) * Math.PI;
    points.push([x0 + r + r * Math.cos(angle), z1 - r + r * Math.sin(angle)]);
  }
  return onWall(points, y, true);
}

function floor() {
  const out = [];
  const strip = { x: 150, y: 7, w: 7, d: 53, r: 1 };
  out.push(slab("rule.depth", strip, 0, 0.6, { steps: 3, tone: "lo", crease: "none" }));
  const ticks = k.topTicks(10, 58, 2, 5, strip.x + 0.7, 0.6, [2, 3.8], P, "y");
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(D([at([strip.x + 5.2, strip.y + 1.8, 0.6]), at([strip.x + 5.2, strip.y + strip.d - 1.8, 0.6])], { size: 0.4 }));
  const plate = { x: 74, y: 40, w: 58, d: 15, r: 1.5 };
  out.push(slab("label", plate, 0, 0.8, { steps: 4, tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(plate, 1.6), 0.8, P, 4), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([plate.x + 6, plate.y + 7], 0.8, P, "x"), `${W.WIDTH} × ${W.HEIGHT}`, { size: 3.6, tone: "lo" }));
  out.push(L(k.lineOnTop([plate.x + 6, plate.y + 10.4], [plate.x + 34, plate.y + 10.4], 0.8, P), { tone: "lo", free: true }));
  out.push(D([at([plate.x + 3, plate.y + 7.5, 0.8]), at([plate.x + plate.w - 3, plate.y + 7.5, 0.8])], { size: 0.45 }));
  return out.join("");
}

function driver() {
  const top = DRIVER_H;
  const front = DRIVER.y + DRIVER.d;
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(DRIVER, 2), 0, 0.1, P)}" style="filter:blur(5px)"/>`];
  out.push(slab("driver", DRIVER, 0, DRIVER_H, { steps: 6, bevel: 0.9, tone: "mid", inner: L(k.sideSeam(DRIVER, DRIVER_H - 3.2, P, 6), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(DRIVER, 3), top, P, 6), { tone: "faint" }));
  out.push(D(k.corners(DRIVER, 5.5).map(([x, y]) => at([x, y, top])), { size: 0.45 }));
  const vents = [];
  for (let index = 0; index < 6; index++) vents.push(slot(DRIVER.x + 9 + index * 5, DRIVER.x + 11.4 + index * 5, 3.4, 9.2, front));
  out.push(L(vents.join(""), { tone: "lo" }));
  const plate = { x: DRIVER.x + 26, y: DRIVER.y + 14, w: 26, d: 7.5, r: 0.8 };
  out.push(slab("driver.label", plate, top, 0.5, { steps: 3, tone: "lo", crease: "none" }));
  out.push(L([0, 1].map((row) => k.lineOnTop([plate.x + 2.4, plate.y + 2.4 + row * 2.6], [plate.x + plate.w - 2.4 - row * 9, plate.y + 2.4 + row * 2.6], top + 0.5, P)).join(""), { tone: "lo", free: true }));
  const lamp = [DRIVER.x + 31, DRIVER.y + 8];
  out.push(round("driver.lamp", lamp[0], lamp[1], 2.2, top, 1.1, { steps: 20, tone: "mid" }));
  const lit = at([lamp[0], lamp[1], top + 1.1]);
  out.push(`<circle class="hh-pilot" cx="${one(lit[0])}" cy="${one(lit[1])}" r="1.1"/>`);
  const knob = [DRIVER.x + 15, DRIVER.y + 13];
  out.push(round("driver.dial", knob[0], knob[1], 6.4, top, 0.7, { steps: 36, tone: "lo" }));
  const marks = k.radialTicks(knob[0], knob[1], 9.4, 16, 4, top, [1.2, 2], P, -Math.PI * 0.75, Math.PI * 1.5);
  out.push(L(k.ring(knob[0], knob[1], 9.4, top, P, 48), { tone: "faint" }), L(marks.minor, { tone: "lo" }), L(marks.major, { tone: "mid" }));
  out.push(round("driver.knob", knob[0], knob[1], 5, top + 0.7, 4.2, { steps: 36, bevel: 0.5, tone: "mid" }));
  out.push(L(k.knurl(knob[0], knob[1], 5, top + 0.7, top + 4.9, 34, P), { tone: "lo" }));
  const turn = Math.PI * 0.32;
  out.push(L(k.lineOnTop([knob[0], knob[1]], [knob[0] + Math.sin(turn) * 5, knob[1] - Math.cos(turn) * 5], top + 4.9, P), { tone: "hi" }));
  out.push(D([at([knob[0], knob[1], top + 4.9])], { size: 0.5, tone: "hi" }));
  out.push(turned("driver.port", sideways([DRIVER.x + DRIVER.w, CABLE_Y, CABLE_Z]), 0, 0.8, 2.6, { tone: "mid" }));
  return out.join("");
}

function cable() {
  const start = [DRIVER.x + DRIVER.w + 0.8, CABLE_Y, CABLE_Z];
  const end = [AMP.lead.x, PLINTH.y + PLINTH.d + 0.8, CABLE_Z];
  const route = G.resample(G.fillet([start, [end[0], CABLE_Y, CABLE_Z], end], 10, 9, { P, tube: CABLE_R }), 0.8);
  const total = G.pathLength(route);
  const clips = [
    { at: [-80, CABLE_Y], plan: { x: -81.6, y: CABLE_Y - 3.6, w: 3.2, d: 7.2, r: 1.2 } },
    { at: [-22, CABLE_Y], plan: { x: -23.6, y: CABLE_Y - 3.6, w: 3.2, d: 7.2, r: 1.2 } },
    { at: [end[0], 22], plan: { x: end[0] - 3.6, y: 20.4, w: 7.2, d: 3.2, r: 1.2 } },
  ];
  const lengths = [0];
  for (let index = 1; index < route.length; index++) lengths.push(lengths[index - 1] + G.len3(G.sub3(route[index], route[index - 1])));
  const shells = [
    [0, 3.7],
    [total - 4.2, total],
  ];
  const gaps = [
    shells[0],
    ...clips.map((clip) => {
      let best = 0;
      route.forEach((point, index) => {
        if (Math.hypot(point[0] - clip.at[0], point[1] - clip.at[1]) < Math.hypot(route[best][0] - clip.at[0], route[best][1] - clip.at[1])) best = index;
      });
      return [lengths[best] - 1.6, lengths[best] + 1.6];
    }),
    shells[1],
  ].sort((a, b) => a[0] - b[0]);
  R.route("cable", route, CABLE_R, { gaps, limp: true, touch: ["cable.clip", "cable.shell"], rims: [1.8, 1.8] });
  const V = G.viewOf(P);
  const entries = tubePieces(route, CABLE_R, P, { maxLength: 36, gaps }).map((piece, chunk) => ({
    depth: G.dot3(piece.mid, V),
    draw: () => {
      const svg = tubeSvg(piece, { tone: "mid" });
      R.put({ name: R.nameFor("cable.run"), key: ++drawn * 1000, route: "cable", chunk, svg, shapes: [A.tube(piece.points, piece.radii, { name: "cable", owner: "cable" })] });
      return svg;
    },
  }));
  for (const clip of clips) {
    const centre = [clip.plan.x + clip.plan.w / 2, clip.plan.y + clip.plan.d / 2];
    const ends = clip.plan.w < clip.plan.d ? [[centre[0], clip.plan.y + 1.3], [centre[0], clip.plan.y + clip.plan.d - 1.3]] : [[clip.plan.x + 1.3, centre[1]], [clip.plan.x + clip.plan.w - 1.3, centre[1]]];
    const height = CABLE_Z + CABLE_R + 0.7;
    entries.push({
      depth: G.dot3([centre[0], centre[1], CABLE_Z], V) + 0.4,
      draw: () => slab("cable.clip", clip.plan, 0, height, { steps: 3, bevel: 0.3, tone: "mid", meta: { fitting: true, anchor: false } }) + D(ends.map(([x, y]) => at([x, y, height])), { size: 0.35 }),
    });
  }
  entries.push({ depth: G.dot3(G.pointAlong(route, 1.85), V) + 0.2, draw: () => turned("cable.shell", sideways(start), 0, 3.7, 1.8, { tone: "mid", meta: { owner: "cable" } }) });
  const plug = outward([AMP.lead.x, PLINTH.y + PLINTH.d, CABLE_Z]);
  entries.push({ depth: G.dot3(G.pointAlong(route, total - 2.1), V) + 0.2, draw: () => turned("cable.shell", plug, 0.8, 5, 1.8, { tone: "mid", meta: { owner: "cable" } }) });
  entries.sort((a, b) => a.depth - b.depth);
  return turned("plinth.port", plug, 0, 0.8, 2.6, { tone: "mid" }) + entries.map((entry) => entry.draw()).join("");
}

function letter(glyph) {
  const item = { piece: glyph.piece, move: glyph.move };
  const rods = byStud(glyph.studs)
    .map((stud, index) => {
      const F = outward([stud.x, 0, stud.z]);
      const rod = G.rodOut(F, SLEEVE, BACK, 0.75, P, { stroke: REACH });
      const id = `hh-rod-${glyph.index}-${index}`;
      const svg = `<clipPath id="${id}"><path data-hold d="${rod.clip}"/></clipPath><g clip-path="url(#${id})">${S(rod.paths, { tone: "mid", crease: "none" })}</g>`;
      put("stud", [A.slide(F, SLEEVE, BACK, 0.75, { name: "stud" })], { ...item, svg });
      return svg;
    })
    .join("");
  const body = glyphSvg(wallGlyph(glyph.contours, BACK, FRONT, P));
  put(`glyph.${glyph.letter}`, [A.prism(WALL, glyph.contours[0].map(([x, z]) => [z, x]), BACK, FRONT, { name: `glyph.${glyph.letter}` })], { ...item, svg: body });
  return `<g class="hh-glyph" data-glyph="${glyph.index}"${glyph.amber ? " data-amber" : ""}>${rods}${body}</g>`;
}

const TURNS = 7;
const LEAD_R = 1.5;
const leadAt = (out) => k.coil(1.6, BACK + out, [AMP.lead.x, AMP.lead.z], LEAD_R, TURNS, "y", P, 14);

function letters() {
  const rows = [GLYPHS.filter((glyph) => glyph.line === 1), GLYPHS.filter((glyph) => glyph.line === 0 && !glyph.amber)];
  const lead = leadAt(0);
  return [
    ...rows.flat().map(letter),
    `<path class="iso-line hh-lead" data-lead="back" d="${lead.back}"/><path class="iso-line hh-lead" data-lead="front" d="${lead.front}"/>`,
    letter(AMP),
  ].join("");
}

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "The Hunt & Hackett wordmark built as a stand-off sign on an assembly stand. Eleven white letters and one amber ampersand stand on studs in front of a navy panel, HUNT & above HACKETT, with rules along the panel measuring its two cap heights and its width. Any glyph slides out along its studs, and the ampersand stays lit on a coiled lead.",
  body: [base(), block(BLOCKS[0]), strut(POSTS[0], -1), upstand(POSTS[0]), plinth(), block(BLOCKS[1]), panel(), upstand(POSTS[1]), strut(POSTS[1], 1), cap(), floor(), driver(), cable(), letters()],
});

if (AUDIT) {
  const keys = R.items.map((item) => item.key);
  const share = (glyph, out) => out / glyph.move[1];
  const poses = [
    ...GLYPHS.map((glyph) => ({ label: `only ${glyph.letter}${glyph.index}`, shares: { [glyph.piece]: share(glyph, PULL) } })),
    ...["hunt", "amp", "hackett"].map((group) => ({ label: `only ${group}`, shares: Object.fromEntries(GLYPHS.filter((glyph) => glyph.group === group).map((glyph) => [glyph.piece, share(glyph, PULL)])) })),
  ];
  A.settle(R, P, { states: [...A.explodeStates(R.order, R.spring).depth, ...poses] });
  const shifted = R.items.filter((item, index) => Math.abs(item.key - keys[index]) > 1e-6);
  console.log(`painter's order as drawn: ${shifted.length} items the measured depth would move`);
  for (const item of shifted.slice(0, 20)) console.log(`  ${item.name}`);
  A.auditOrExit(R, P, { frames: [...A.explodeStates(R.order, R.spring).frames, ...poses], crowd: [["cable", "stand.base"]] });
  if (shifted.length) process.exitCode = 1;
}

const caps = W.METRICS.caps.map((height) => height.toFixed(1));
const DATA = {
  P,
  VIEW: [WIDTH, HEIGHT],
  FRONT,
  BACK,
  PULL,
  APART,
  SPRING,
  STAGGER,
  STUDS,
  LEAD: { x: AMP.lead.x, z: AMP.lead.z, r: LEAD_R, turns: TURNS, from: 1.6 },
  REST: `${GLYPHS.length} glyphs · caps ${caps[0]} / ${caps[1]} · 1 amber`,
  GLYPHS: GLYPHS.map((glyph) => ({
    letter: glyph.letter,
    word: glyph.amber ? "amber" : glyph.word,
    group: glyph.group,
    amber: glyph.amber,
    size: `${glyph.width.toFixed(1)} × ${glyph.height.toFixed(1)}`,
    box: [glyph.world.x0, glyph.world.x1, glyph.world.z0, glyph.world.z1].map(one),
  })),
};

const parts = [
  { group: "hunt", label: "HUNT", note: `4 caps · ${caps[0]} tall` },
  { group: "amp", label: "&", note: "the one amber glyph" },
  { group: "hackett", label: "HACKETT", note: `7 caps · ${caps[1]} tall` },
  { group: "all", label: "Take apart", note: `${GLYPHS.length} glyphs · ${STUDS} studs` },
];

const plate = k.plateHtml({
  fig: "Fig 1",
  title: "Hunt & Hackett · wordmark",
  hint: "Hover a glyph · click to take apart",
  readout: DATA.REST,
  keys: [
    { mark: "lit", label: "The ampersand: the one amber part, lit on its own lead" },
    { mark: "raised", label: "Eleven letters on stand-off studs, set at two cap heights" },
    { mark: "dim", label: "Guide lines: both baselines and both cap lines" },
  ],
  caption: `The wordmark is ${W.WIDTH} units wide and ${W.HEIGHT} tall. HUNT & is set ${caps[0]} tall and HACKETT ${caps[1]}, a ratio of ${W.METRICS.ratio.toFixed(2)}, with ${W.METRICS.leading.toFixed(1)} units between the lines; every glyph is its own part, and one of the twelve is amber.`,
  body: `<div class="iso-stage" tabindex="0" role="group" aria-label="Hunt and Hackett wordmark as a stand-off sign. Arrow keys step through the twelve glyphs, Space takes the sign apart, Escape puts it back.">${svg}</div><p class="hh-live" aria-live="polite"></p>`,
});

const controls = `<div class="hh-parts" role="group" aria-label="Parts of the wordmark">${parts
  .map((part, index) => `<button class="hh-part" type="button" data-group="${part.group}" aria-pressed="false"><span class="hh-part-no">${String(index + 1).padStart(2, "0")}</span><span class="hh-part-name">${part.label.replace("&", "&amp;")}</span><span class="hh-part-note">${part.note}</span></button>`)
  .join("")}</div>`;

const mark = W.GLYPHS.find((glyph) => glyph.amber);
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${one(mark.box.x0 - 14)} -14 72 72"><rect x="${one(mark.box.x0 - 14)}" y="-14" width="72" height="72" fill="${W.NAVY}"/><path fill="${W.AMBER}" d="${mark.contours.map((ring) => k.pathOf(ring, true)).join("")}"/></svg>`;
const HEAD = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(ICON)}"><meta name="description" content="An interactive isometric anatomy of the Hunt &amp; Hackett wordmark: twelve glyphs on stand-off studs that slide apart."><meta property="og:title" content="The wordmark, taken apart"><meta property="og:description" content="An interactive isometric anatomy of the Hunt &amp; Hackett wordmark."><meta property="og:image" content="https://cozybear-dev.github.io/hackett-logo/assets/preview.png"><meta name="theme-color" content="${W.NAVY}">`;

const other = (theme) => (theme === "dark" ? `<a class="hh-theme" href="light.html">Light</a>` : `<a class="hh-theme" href="./">Dark</a>`);

const page = (theme) => {
  const body = `<header class="hh-head"><p class="hh-kicker"><span>Anatomy</span>${other(theme)}</p><h1>The wordmark, taken apart</h1><p class="hh-lede">Twelve glyphs on two baselines. Eleven are white; the ampersand is amber and carries the mark’s only flourish.</p></header>${plate}${controls}<footer class="hh-foot"><p>Drawn from the wordmark’s own outlines with the <a href="https://github.com/wheresryan22/anatomy">Anatomy</a> skill. <a href="https://github.com/cozybear-dev/hackett-logo">Source</a>.</p><p>An unofficial illustration. Hunt &amp; Hackett and its logo are trademarks of their owner.</p></footer>`;
  const html = k.pageHtml({ title: "Hunt & Hackett · the wordmark, taken apart", theme, body, script: read("kit/iso-kit.mjs").replace(/^export /gm, "") + `\nconst DATA = ${JSON.stringify(DATA)};\n` + read("src/live.js"), width: 860 });
  return html.replace("</style></head>", `${read("src/figure.css")}</style>${HEAD}</head>`);
};

writeFileSync(join(HERE, "index.html"), page("dark"));
writeFileSync(join(HERE, "light.html"), page("light"));
console.log(`wrote index.html and light.html · ${GLYPHS.length} glyphs · ${STUDS} studs · ${R.items.length} recorded items`);
