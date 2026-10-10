const { P: CAMERA, VIEW, FRONT, BACK, PULL, APART, SPRING, STAGGER: ORDER, STUDS, LEAD, REST, GLYPHS: LIST } = DATA;
const stage = document.querySelector(".iso-stage");
const figure = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const live = document.querySelector(".hh-live");
const buttons = [...document.querySelectorAll(".hh-part")];
const still = matchMedia("(prefers-reduced-motion: reduce)");
const nodes = LIST.map((_, index) => figure.querySelector(`[data-glyph="${index}"]`));
const shadows = LIST.map((_, index) => figure.querySelector(`[data-shadow="${index}"]`));
const glow = figure.querySelector("[data-glow]");
const leads = [figure.querySelector('[data-lead="back"]'), figure.querySelector('[data-lead="front"]')];
const AMBER = LIST.findIndex((glyph) => glyph.amber);
const READING = LIST.map((_, index) => index);
const [stepX, stepY] = axisVector(CAMERA, [0, 1, 0]);
const camera = cameraOf(CAMERA);
const shade = Number(getComputedStyle(document.body).getPropertyValue("--hh-shadow-opacity")) || 0.6;
const shine = Number(getComputedStyle(document.body).getPropertyValue("--hh-glow-opacity")) || 0.5;

const parts = LIST.map(() => ({ at: 0, rate: 0, target: 0, due: null, drawn: -1 }));
let picked = -1;
let group = "";
let frame = 0;
let last = 0;
let clock = 0;
let visible = false;
let touring = !still.matches;
let tourClock = -1.4;
let idleTimer = 0;
let said = "";

const wantOf = (index) => {
  const glyph = LIST[index];
  if (group === "all") return APART[glyph.group];
  if (group && glyph.group === group) return PULL;
  return index === picked ? PULL : 0;
};

function aim() {
  const changing = [];
  for (const index of ORDER) {
    const part = parts[index];
    const want = wantOf(index);
    if ((part.due ? part.due.value : part.target) === want) continue;
    if (part.target === want) part.due = null;
    else changing.push(index);
  }
  const opening = changing.some((index) => wantOf(index) > parts[index].target);
  const queue = opening ? changing : [...changing].reverse();
  queue.forEach((index, place) => {
    parts[index].due = { value: wantOf(index), at: clock + (still.matches ? 0 : place * SPRING.stagger) };
  });
  buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.group === group)));
  run();
}

function describe() {
  let text = "Assembled";
  if (group === "all") text = `Taken apart: ${LIST.length} glyphs on ${STUDS} studs`;
  else if (group) text = `${group === "amp" ? "The ampersand" : group.toUpperCase()} stands out`;
  else if (picked >= 0) text = `${LIST[picked].letter === "&" ? "Ampersand" : LIST[picked].letter}, ${LIST[picked].word} line, ${LIST[picked].size} units${LIST[picked].amber ? ", amber" : ""}`;
  if (live && live.textContent !== text) live.textContent = text;
}

function say() {
  const moving = parts.some((part) => part.due || part.at !== part.target);
  let text = REST;
  if (group === "all") text = moving ? "taking apart" : `apart · ${LIST.length} glyphs · ${STUDS} studs`;
  else if (group) {
    const members = LIST.filter((glyph) => glyph.group === group);
    const out = parts[LIST.findIndex((glyph) => glyph.group === group)].at;
    text = `${group === "amp" ? "&" : group.toUpperCase()} · ${members.length} ${members.length === 1 ? "glyph" : "glyphs"} · out ${out.toFixed(1)}`;
  } else if (picked >= 0) text = `${LIST[picked].letter} · ${LIST[picked].word} · ${LIST[picked].size} · out ${parts[picked].at.toFixed(1)}`;
  else if (moving) text = "closing up";
  if (text !== said) {
    said = text;
    readout.textContent = text;
  }
}

function draw() {
  parts.forEach((part, index) => {
    if (part.drawn === part.at) return;
    part.drawn = part.at;
    const dx = Math.round(stepX * part.at * 100) / 100;
    const dy = Math.round(stepY * part.at * 100) / 100;
    const node = nodes[index];
    if (part.at) node.setAttribute("transform", `translate(${dx} ${dy})`);
    else node.removeAttribute("transform");
    holdStill(node, [dx, dy]);
    if (shadows[index]) shadows[index].style.opacity = String(shade / (1 + part.at / 9));
    if (index === AMBER) {
      const far = part.at / 30;
      glow.style.opacity = String(shine / (1 + far * far));
      glow.style.filter = `blur(${(7 + part.at * 0.2).toFixed(2)}px)`;
      const lead = coil(LEAD.from, BACK + Math.max(0, part.at), [LEAD.x, LEAD.z], LEAD.r, LEAD.turns, "y", CAMERA, 14);
      leads[0].setAttribute("d", lead.back);
      leads[1].setAttribute("d", lead.front);
    }
  });
  say();
}

const TOUR = [...READING.map((index) => ({ pick: index, hold: 1.05 })), { group: "", hold: 0.9 }, { group: "hunt", hold: 1.5 }, { group: "amp", hold: 1.5 }, { group: "hackett", hold: 1.5 }, { group: "all", hold: 3.4 }, { group: "", hold: 2.2 }];
const TOUR_LENGTH = TOUR.reduce((sum, step) => sum + step.hold, 0);
let tourStep = -1;

function tour() {
  if (tourClock < 0) return;
  let t = tourClock % TOUR_LENGTH;
  let index = 0;
  while (t >= TOUR[index].hold) t -= TOUR[index++].hold;
  if (index === tourStep) return;
  tourStep = index;
  picked = TOUR[index].pick ?? -1;
  group = TOUR[index].group ?? "";
  aim();
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  const calm = still.matches;
  if (touring) {
    tourClock += dt;
    tour();
  }
  let moving = false;
  for (const part of parts) {
    if (part.due && clock >= part.due.at) {
      part.target = part.due.value;
      part.due = null;
    }
    if (calm) {
      part.at = part.target;
      part.rate = 0;
    } else if (part.at !== part.target || part.rate) {
      const h = dt / SPRING.substeps;
      for (let step = 0; step < SPRING.substeps; step++) {
        part.rate += ((part.target - part.at) * SPRING.stiffness - part.rate * SPRING.damping) * h;
        part.at += part.rate * h;
      }
      if (Math.abs(part.target - part.at) < 0.01 && Math.abs(part.rate) < 0.02) {
        part.at = part.target;
        part.rate = 0;
      }
    }
    if (part.due || part.at !== part.target) moving = true;
  }
  draw();
  frame = visible && (moving || touring) ? requestAnimationFrame(tick) : 0;
}

function run() {
  if (!frame && visible) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}

function hold() {
  touring = false;
  tourStep = -1;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (still.matches || stage.matches(":hover") || stage.matches(":focus-visible") || group) return;
    touring = true;
    tourClock = -0.4;
    run();
  }, 3600);
}

function glyphAt(event) {
  const box = figure.getBoundingClientRect();
  const sx = ((event.clientX - box.left) / box.width) * VIEW[0];
  const sy = ((event.clientY - box.top) / box.height) * VIEW[1];
  const u = (sx - CAMERA.origin[0]) / camera.k;
  const v = (sy - CAMERA.origin[1]) / camera.k;
  const x = (u + FRONT * camera.cosA) / camera.sinA;
  const z = ((x * camera.cosA + FRONT * camera.sinA) * camera.sinE - v) / camera.cosE;
  let best = -1;
  let reach = Infinity;
  LIST.forEach((glyph, index) => {
    const [x0, x1, z0, z1] = glyph.box;
    if (x < x0 - 2 || x > x1 + 2 || z < z0 - 4 || z > z1 + 4) return;
    const gap = Math.abs(x - (x0 + x1) / 2);
    if (gap < reach) {
      reach = gap;
      best = index;
    }
  });
  return best;
}

function choose(next, nextGroup = "") {
  if (picked === next && group === nextGroup) return;
  picked = next;
  group = nextGroup;
  aim();
  describe();
}

stage.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch") return;
  hold();
  if (!group) choose(glyphAt(event));
});
stage.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "touch") return;
  hold();
  if (!group) choose(-1);
});
let pointer = "mouse";
stage.addEventListener("pointerdown", (event) => {
  pointer = event.pointerType || "mouse";
});
stage.addEventListener("click", (event) => {
  hold();
  const under = glyphAt(event);
  const touch = pointer === "touch" || pointer === "pen";
  if (touch && !group && under >= 0 && under !== picked) choose(under);
  else if (group) choose(touch ? -1 : under, "");
  else choose(-1, "all");
});
stage.addEventListener("keydown", (event) => {
  const count = LIST.length;
  let next = null;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") next = picked < 0 ? 0 : (picked + 1) % count;
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = picked < 0 ? count - 1 : (picked + count - 1) % count;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = count - 1;
  else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    hold();
    choose(-1, group === "all" ? "" : "all");
    return;
  } else if (event.key === "Escape") {
    hold();
    choose(-1, "");
    return;
  }
  if (next === null) return;
  event.preventDefault();
  hold();
  choose(next, "");
});
stage.addEventListener("focus", () => {
  if (stage.matches(":focus-visible")) hold();
  describe();
});
stage.addEventListener("blur", hold);
buttons.forEach((button) => {
  button.addEventListener("click", () => {
    hold();
    choose(-1, group === button.dataset.group ? "" : button.dataset.group);
  });
});
still.addEventListener("change", () => {
  if (still.matches) touring = false;
  run();
});
new IntersectionObserver(
  (entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run();
  },
  { rootMargin: "120px 0px" },
).observe(stage);
draw();
