import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";

const SHARP = 0.45;

const signed = (points) => {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    area += ax * by - bx * ay;
  }
  return area / 2;
};

const positive = (points) => (signed(points) < 0 ? [...points].reverse() : points);

export function upright(contours) {
  const sorted = [...contours].sort((a, b) => Math.abs(signed(b)) - Math.abs(signed(a)));
  return sorted.map((ring, index) => {
    const area = signed(ring);
    return (index === 0 ? area > 0 : area < 0) ? ring : [...ring].reverse();
  });
}

export function faceOf(contours, y, P) {
  const rings = contours.map((ring) => ring.map(([x, z]) => k.iso([x, y, z], P)));
  const flip = signed(rings[0]) < 0;
  return rings.map((ring) => k.pathOf(flip ? [...ring].reverse() : ring, true)).join("");
}

export function wallGlyph(contours, back, front, P) {
  const V = G.viewOf(P);
  const light = G.lightOf(P);
  const quads = [];
  const tones = [[], [], [], [], []];
  const crease = [];
  for (const ring of contours) {
    const count = ring.length;
    const near = ring.map(([x, z]) => k.iso([x, front, z], P));
    const far = ring.map(([x, z]) => k.iso([x, back, z], P));
    const seen = [];
    for (let index = 0; index < count; index++) {
      const [ax, az] = ring[index];
      const [bx, bz] = ring[(index + 1) % count];
      const normal = G.unit3([bz - az, 0, -(bx - ax)]);
      const visible = G.dot3(normal, V) > 1e-9;
      seen.push(visible);
      if (!visible) continue;
      const next = (index + 1) % count;
      const quad = k.pathOf(positive([near[index], near[next], far[next], far[index]]), true);
      quads.push(quad);
      tones[G.bandOf(G.dot3(normal, light))].push(quad);
    }
    let run = [];
    const flush = () => {
      if (run.length > 1) crease.push(k.pathOf(run));
      run = [];
    };
    const first = seen.findIndex((visible, index) => visible && !seen[(index + count - 1) % count]);
    const start = first < 0 ? 0 : first;
    for (let step = 0; step < count; step++) {
      const index = (start + step) % count;
      if (seen[index]) {
        if (!run.length) run.push(near[index]);
        run.push(near[(index + 1) % count]);
      } else flush();
    }
    flush();
    for (let index = 0; index < count; index++) {
      const before = (index + count - 1) % count;
      if (!seen[index] || !seen[before]) continue;
      const a = [ring[index][0] - ring[before][0], ring[index][1] - ring[before][1]];
      const b = [ring[(index + 1) % count][0] - ring[index][0], ring[(index + 1) % count][1] - ring[index][1]];
      const turn = Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
      if (turn > SHARP) crease.push(k.pathOf([near[index], far[index]]));
    }
  }
  const face = faceOf(contours, front, P);
  return { body: quads.join("") + face, tones: tones.map((list) => list.join("")), face, crease: crease.join("") };
}

export function glyphSvg(parts) {
  const out = [`<path class="hh-body" d="${parts.body}"/>`];
  parts.tones.forEach((d, tone) => {
    if (d) out.push(`<path class="hh-wall" data-shade="${tone}" d="${d}"/>`);
  });
  out.push(`<path class="hh-face" d="${parts.face}"/>`);
  if (parts.crease) out.push(`<path class="iso-line hh-crease" d="${parts.crease}"/>`);
  return out.join("");
}

function inside(contours, x, z) {
  let hit = false;
  for (const ring of contours) {
    for (let index = 0, before = ring.length - 1; index < ring.length; before = index++) {
      const [ax, az] = ring[index];
      const [bx, bz] = ring[before];
      if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) hit = !hit;
    }
  }
  return hit;
}

function clearanceOf(contours, x, z) {
  let least = Infinity;
  for (const ring of contours) {
    for (let index = 0; index < ring.length; index++) {
      const [ax, az] = ring[index];
      const [bx, bz] = ring[(index + 1) % ring.length];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      least = Math.min(least, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
  }
  return least;
}

export function anchorsOf(contours, { count = 3, clear = 2.4, apart = 13, grid = 0.6 } = {}) {
  const xs = contours.flat().map(([x]) => x);
  const zs = contours.flat().map(([, z]) => z);
  const spots = [];
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += grid) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += grid) {
      if (!inside(contours, x, z)) continue;
      const room = clearanceOf(contours, x, z);
      if (room >= clear) spots.push({ x, z, room });
    }
  }
  if (!spots.length) return [];
  const top = Math.max(...zs);
  const picked = [[...spots].sort((a, b) => b.room * 3 - (top - b.z) - (a.room * 3 - (top - a.z)))[0]];
  while (picked.length < count) {
    let best = null;
    let reach = 0;
    for (const spot of spots) {
      const gap = Math.min(...picked.map((p) => Math.hypot(p.x - spot.x, p.z - spot.z)));
      const score = gap + spot.room * 2;
      if (gap >= apart && score > reach) {
        reach = score;
        best = spot;
      }
    }
    if (!best) break;
    picked.push(best);
  }
  return picked.map(({ x, z, room }) => ({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, room }));
}

export function roomiest(contours, avoid, { clear = 3, grid = 0.6 } = {}) {
  const xs = contours.flat().map(([x]) => x);
  const zs = contours.flat().map(([, z]) => z);
  let best = null;
  let reach = -Infinity;
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += grid) {
    for (let z = Math.min(...zs); z <= Math.max(...zs); z += grid) {
      if (!inside(contours, x, z)) continue;
      const room = clearanceOf(contours, x, z);
      if (room < clear) continue;
      const gap = Math.min(...avoid.map((p) => Math.hypot(p.x - x, p.z - z)));
      const score = Math.min(gap, 14) + room * 4;
      if (gap > 7 && score > reach) {
        reach = score;
        best = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, room };
      }
    }
  }
  return best;
}
