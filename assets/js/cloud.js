// Procedural terrestrial-LiDAR point cloud: one scanned tree plus a toy digital twin of its plot.
// Runs as a module worker (so generation never blocks the page) or as a plain import (fallback).
// Everything is generated from a fixed seed; no 3D assets are downloaded.

const TAU = Math.PI * 2;
const GROUND = 0, STEM = 1, WOOD = 2, LEAF = 3, MARK = 4;
const KINDS = 5;
const S = [-4.5, 1.6, 9];      // scanner position (x, head height, z)
const EL_STEP = 0.0058;        // scanner vertical angular step (rad), gives scan lines on the stem
const AZ0 = -2.44;             // azimuth where the sweep starts
const BREAST_HEIGHT = 1.3;     // DBH is measured at 1.3 m

/* ---------- small vector helpers ---------- */
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => mul(a, 1 / (len(a) || 1));
export const mix = (a, b, t) => a + (b - a) * t;
export const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function rng(seed) { // mulberry32
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function unit(rand) {
  const z = rand() * 2 - 1, a = rand() * TAU, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

// Split `total` points across items in proportion to `weight`, hitting the total exactly.
function distribute(items, total, weight, fn) {
  const w = items.map(weight), sum = w.reduce((a, b) => a + b, 0) || 1;
  let acc = 0, done = 0;
  items.forEach((item, k) => {
    acc += (w[k] / sum) * Math.round(total);
    const count = Math.round(acc) - done;
    done += count;
    if (count > 0) fn(item, count);
  });
}

const buckets = () => Array.from({ length: KINDS }, () => ({ p: [], i: [] }));
const put = (b, kind, p, i) => { b[kind].p.push(p[0], p[1], p[2]); b[kind].i.push(i); };

function rawTerrain(x, z) {
  return 0.22 * Math.sin(x * 0.16 + 0.7) * Math.cos(z * 0.13) + 0.06 * Math.sin(x * 0.7 + z * 0.5);
}
const TERRAIN_0 = rawTerrain(0, 0);
const terrain = (x, z) => rawTerrain(x, z) - TERRAIN_0;

// Return intensity drops with range.
const falloff = p => clamp(Math.sqrt(12 / Math.hypot(p[0] - S[0], p[2] - S[2])), 0.45, 1);

// Snap a point onto the scanner's discrete elevation angles, which is what draws
// the horizontal scan lines you see on real TLS stems.
function snapToScanLine(p) {
  const dh = Math.hypot(p[0] - S[0], p[2] - S[2]);
  const el = Math.round(Math.atan2(p[1] - S[1], dh) / EL_STEP) * EL_STEP;
  p[1] = S[1] + Math.tan(el) * dh;
  return p;
}

// When the rotating scanner reaches a point, remapped so most of the sweep is spent on the tree.
function scanTime(p) {
  const az = Math.atan2(p[2] - S[2], p[0] - S[0]);
  const t = ((((az - AZ0) % TAU) + TAU) % TAU) / TAU;
  if (t < 0.06) return t;
  if (t < 0.36) return 0.06 + ((t - 0.06) / 0.3) * 0.68;
  return 0.74 + ((t - 0.36) / 0.64) * 0.26;
}

/* ---------- the scanned tree ---------- */
function buildTree(n, rand) {
  const out = buckets();
  const H = 13.6;
  const trunkAt = y => [0.32 * Math.sin(y * 0.17), y, 0.2 * Math.sin(y * 0.13 + 1.2)];
  const trunkR = y => 0.05 + 0.3 * Math.pow(Math.max(1 - y / 18, 0), 1.4) + (y < 1.4 ? 0.16 * (1 - y / 1.4) ** 2 : 0);
  const segs = [], tips = [];

  for (let k = 0; k < 16; k++) {
    const y0 = (k / 16) * H, y1 = ((k + 1) / 16) * H;
    segs.push({ a: trunkAt(y0), b: trunkAt(y1), ra: trunkR(y0), rb: trunkR(y1), kind: STEM });
  }

  const bend = (d, angle) => {
    const u = norm(cross(d, unit(rand)));
    const nd = add(mul(d, Math.cos(angle)), mul(u, Math.sin(angle)));
    nd[1] += 0.14;
    return norm(nd);
  };
  const grow = (p, dir, length, r, depth) => {
    let cur = p, d = dir;
    const rEnd = r * 0.62;
    for (let k = 0; k < 3; k++) {
      d = norm([d[0] + (rand() - 0.5) * 0.35, d[1] + 0.08 - (depth === 0 ? 0.1 : 0), d[2] + (rand() - 0.5) * 0.35]);
      const next = add(cur, mul(d, length / 3));
      segs.push({ a: cur, b: next, ra: mix(r, rEnd, k / 3), rb: mix(r, rEnd, (k + 1) / 3), kind: WOOD });
      cur = next;
    }
    if (depth === 0) { tips.push({ c: cur, r: 0.6 + rand() * 0.55 }); return; }
    const kids = 2 + (rand() < 0.5 ? 1 : 0);
    for (let j = 0; j < kids; j++) {
      grow(cur, bend(d, 0.45 + rand() * 0.4), length * (0.6 + rand() * 0.15), rEnd * 0.78, depth - 1);
    }
    if (depth === 1) tips.push({ c: cur, r: 0.5 + rand() * 0.4 });
  };

  const primaries = 9;
  for (let k = 0; k < primaries; k++) {
    const t = k / (primaries - 1);
    const y = 4.8 + t * 7.8 + (rand() - 0.5) * 0.5;
    const az = k * 2.39996 + rand() * 0.5, el = 0.32 + t * 0.55 + rand() * 0.15;
    grow(trunkAt(y), [Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)],
      (6.4 - t * 3.2) * (0.85 + rand() * 0.3), trunkR(y) * 0.5, 3);
  }
  grow(trunkAt(H), [0.04, 1, 0.02], 3, trunkR(H), 2);

  // Neighbouring trees at the edge of the scan, only partly captured.
  for (const [x, z] of [[-16, -12], [13, -15], [-22, -4], [20, -3], [-9, -21], [6, -22], [24, -13]]) {
    const h = 16 + rand() * 4, r = 0.2 + rand() * 0.15, base = [x, terrain(x, z), z];
    segs.push({ a: base, b: [x + (rand() - 0.5) * 0.6, base[1] + h, z + (rand() - 0.5) * 0.6], ra: r * 1.3, rb: r * 0.6, kind: WOOD, bg: true });
    tips.push({ c: [x, base[1] + h + 0.5, z], r: 1.8 + rand(), bg: true });
  }

  const sampleSegment = (s, count) => {
    const axis = sub(s.b, s.a), an = norm(axis);
    const u = norm(cross(an, Math.abs(an[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), w = cross(an, u);
    for (let made = 0, guard = 0; made < count && guard < count * 8; guard++) {
      const t = rand(), th = rand() * TAU, r = mix(s.ra, s.rb, t) * (1 + (rand() - 0.5) * 0.1);
      const nrm = add(mul(u, Math.cos(th)), mul(w, Math.sin(th)));
      const p = add(add(s.a, mul(axis, t)), mul(nrm, r));
      const facing = dot(nrm, norm(sub(S, p)));
      if (facing < -0.05 && rand() > 0.12) continue; // self-occlusion; a few returns from other scan positions
      snapToScanLine(p);
      put(out, s.kind, p, (0.5 + 0.5 * Math.max(facing, 0)) * falloff(p) * (s.bg ? 0.5 : 1));
      made++;
    }
  };
  const woodWeight = s => len(sub(s.b, s.a)) * (Math.max(s.ra, s.rb) + 0.035) * (s.bg ? 0.7 : 1);
  distribute(segs.filter(s => s.kind === STEM), n * 0.075, woodWeight, sampleSegment);
  distribute(segs.filter(s => s.kind === WOOD), n * 0.17, woodWeight, sampleSegment);

  // Foliage: clumpy clusters, with the far side of the crown partly hidden from the scanner.
  const crownC = [0, 12, 0];
  distribute(tips, n * 0.51, t => t.r * t.r * (t.bg ? 0.3 : 1), (tip, count) => {
    const subs = Array.from({ length: 3 + ((rand() * 4) | 0) }, () => add(tip.c, mul(unit(rand), tip.r * 0.7)));
    const toS = norm(sub(S, tip.c));
    const keep = tip.bg ? 1 : dot(norm(sub(tip.c, crownC)), toS) < -0.25 ? 0.55 : 1;
    const tone = 0.75 + rand() * 0.5; // clusters differ slightly in reflectance
    for (let made = 0, guard = 0; made < count && guard < count * 8; guard++) {
      const sc = subs[(rand() * subs.length) | 0], d = unit(rand);
      const rr = tip.r * 0.42 * (0.35 + 0.65 * Math.cbrt(rand()));
      const p = [sc[0] + d[0] * rr, sc[1] + d[1] * rr * 0.7, sc[2] + d[2] * rr];
      const facing = dot(norm(sub(p, tip.c)), toS);
      if ((facing < 0 && rand() > 0.45) || rand() > keep) continue;
      put(out, LEAF, p, (0.34 + 0.3 * rand()) * tone * (0.6 + 0.4 * Math.max(facing, 0)) * falloff(p) * (tip.bg ? 0.5 : 1));
      made++;
    }
  });

  // Understory shrubs.
  distribute([[5, 4, 0.9], [-7, -3, 1.1], [8.5, -6, 0.8], [-3.5, -8, 1.2], [11, 2, 0.7], [-10, 4, 0.9]],
    n * 0.035, s => s[2] * s[2], ([x, z, r], count) => {
      for (let k = 0; k < count; k++) {
        const d = unit(rand), rr = r * Math.cbrt(rand());
        const p = [x + d[0] * rr * 1.2, terrain(x, z) + Math.abs(d[1]) * rr * 0.9, z + d[2] * rr * 1.2];
        put(out, LEAF, p, (0.28 + 0.25 * rand()) * falloff(p));
      }
    });

  // Ground: concentric rings around the scanner, one per elevation step, sparser with range,
  // with the shadow the stem casts from the scanner's point of view.
  const rMin = 1.7, rMax = 36, rings = 62;
  const phiHi = Math.atan(S[1] / rMin), phiLo = Math.atan(S[1] / rMax);
  const perRing = Math.round((n * 0.2) / rings * 1.3);
  for (let k = 0; k < rings; k++) {
    const r = S[1] / Math.tan(phiHi - ((k + 0.5) / rings) * (phiHi - phiLo)), off = rand() * TAU;
    for (let j = 0; j < perRing; j++) {
      const az = off + ((j + (rand() - 0.5) * 0.3) / perRing) * TAU;
      const x = S[0] + r * Math.cos(az), z = S[2] + r * Math.sin(az);
      if (Math.hypot(x, z) > 27) continue;
      const dx = x - S[0], dz = z - S[2], t = -(S[0] * dx + S[2] * dz) / (dx * dx + dz * dz);
      if (t > 0 && t < 1 && Math.hypot(S[0] + t * dx, S[2] + t * dz) < 0.42) continue;
      put(out, GROUND, [x, terrain(x, z), z], (0.22 + 0.16 * rand()) * clamp((9 / r) ** 0.5, 0.45, 1));
    }
  }

  // DBH annotation ring at breast height.
  const c = trunkAt(BREAST_HEIGHT), ringR = trunkR(BREAST_HEIGHT) + 0.08;
  for (let k = 0; k < 260; k++) {
    const a = (k / 260) * TAU;
    put(out, MARK, [c[0] + Math.cos(a) * ringR, BREAST_HEIGHT, c[2] + Math.sin(a) * ringR], 1);
  }

  let height = 0;
  const lp = out[LEAF].p;
  for (let k = 0; k < lp.length; k += 3) if (Math.hypot(lp[k], lp[k + 2]) < 10) height = Math.max(height, lp[k + 1]);

  return { out, dbh: 2 * trunkR(BREAST_HEIGHT), height, dbhAnchor: [c[0] + ringR, BREAST_HEIGHT, c[2]] };
}

/* ---------- the digital twin: an inventoried plot ---------- */
function buildTwin(counts, rand, heroHeight) {
  const out = buckets();
  const half = 20;
  const trees = [{ x: 0, z: 0, h: heroHeight, cr: 3.6, sr: 0.24 }];
  for (let tries = 0; trees.length < 44 && tries < 9000; tries++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    if (Math.hypot(x, z) < 6.5 || trees.some(t => (t.x - x) ** 2 + (t.z - z) ** 2 < 5.2 ** 2)) continue;
    trees.push({ x, z, h: 12 + rand() * 8, cr: 1.6 + rand() * 1.3, sr: 0.12 + rand() * 0.1 });
  }

  // Ground points become the inventory map: a dashed survey grid, each tree's crown
  // footprint, and a few sparse terrain returns.
  const nGround = counts[GROUND], onLines = Math.round(nGround * 0.55), onFoot = Math.round(nGround * 0.3);
  const lines = [], span = half * 2;
  for (let v = -half; v <= half; v += 10) lines.push([[v, -half], [v, half]], [[-half, v], [half, v]]);
  for (let k = 0; k < onLines; k++) {
    const [[x0, z0], [x1, z1]] = lines[(rand() * lines.length) | 0];
    const f = (Math.floor((rand() * span) / 1.2) * 1.2 + rand() * 0.7) / span;
    put(out, GROUND, [mix(x0, x1, f), 0, mix(z0, z1, f)], 0.3);
  }
  distribute(trees, onFoot, t => t.cr, (t, count) => {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU;
      put(out, GROUND, [t.x + Math.cos(a) * t.cr, 0, t.z + Math.sin(a) * t.cr], 0.22);
    }
  });
  for (let k = onLines + onFoot; k < nGround; k++) put(out, GROUND, [(rand() * 2 - 1) * half, 0, (rand() * 2 - 1) * half], 0.12);

  const stem = (kind, t, count, I) => {
    for (let k = 0; k < count; k++) {
      const a = rand() * TAU;
      put(out, kind, [t.x + Math.cos(a) * t.sr, rand() * t.h * 0.6, t.z + Math.sin(a) * t.sr], I);
    }
  };
  stem(STEM, trees[0], counts[STEM], 0.9);                                          // the scanned tree keeps its stem
  distribute(trees.slice(1), counts[WOOD], t => t.h, (t, c) => stem(WOOD, t, c, 0.55)); // branches become other stems

  // Crowns drawn as contour rings: a model of the tree rather than the raw scan.
  const levels = [[0.55, 0.78], [0.7, 1], [0.86, 0.62]];
  distribute(trees, counts[LEAF], t => t.cr * (t === trees[0] ? 1.5 : 1), (t, count) => {
    for (let k = 0; k < count; k++) {
      const [hf, rf] = levels[k % levels.length];
      const a = rand() * TAU, r = t.cr * rf * (1 + (rand() - 0.5) * 0.05);
      put(out, LEAF, [t.x + Math.cos(a) * r, t.h * hf, t.z + Math.sin(a) * r], t === trees[0] ? 0.75 : 0.5);
    }
  });

  for (let k = 0; k < counts[MARK]; k++) {
    const a = (k / counts[MARK]) * TAU;
    put(out, MARK, [Math.cos(a) * 1.6, BREAST_HEIGHT, Math.sin(a) * 1.6], 1);
  }
  return { out, trees: trees.length };
}

function assemble(tree, twin, rand) {
  const counts = tree.map(b => b.i.length);
  const n = counts.reduce((a, b) => a + b, 0);
  const A = new Float32Array(n * 3), B = new Float32Array(n * 4), D = new Float32Array(n * 4);
  // Shuffle the draw order so drawing only the first K points (low-power fallback) stays uniform.
  const order = new Uint32Array(n);
  for (let k = 0; k < n; k++) order[k] = k;
  for (let k = n - 1; k > 0; k--) { const j = (rand() * (k + 1)) | 0; [order[k], order[j]] = [order[j], order[k]]; }

  const times = [];
  let g = 0;
  for (let kind = 0; kind < KINDS; kind++) {
    const tp = tree[kind].p, ti = tree[kind].i, wp = twin[kind].p, wi = twin[kind].i;
    for (let j = 0; j < counts[kind]; j++, g++) {
      const o = order[g];
      A[o * 3] = tp[j * 3]; A[o * 3 + 1] = tp[j * 3 + 1]; A[o * 3 + 2] = tp[j * 3 + 2];
      B[o * 4] = wp[j * 3]; B[o * 4 + 1] = wp[j * 3 + 1]; B[o * 4 + 2] = wp[j * 3 + 2]; B[o * 4 + 3] = wi[j];
      const st = kind === MARK ? 0 : scanTime([tp[j * 3], tp[j * 3 + 1], tp[j * 3 + 2]]);
      D[o * 4] = kind; D[o * 4 + 1] = ti[j]; D[o * 4 + 2] = rand(); D[o * 4 + 3] = st;
      if (kind !== MARK) times.push(st);
    }
  }
  return { A, B, D, n, times: Float32Array.from(times).sort() };
}

export function buildCloud(budget, seed) {
  const rand = rng(seed);
  const tree = buildTree(budget, rand);
  const twin = buildTwin(tree.out.map(b => b.i.length), rand, tree.height);
  const data = assemble(tree.out, twin.out, rand);
  return { ...data, dbh: tree.dbh, height: tree.height, dbhAnchor: tree.dbhAnchor, trees: twin.trees };
}

// Loaded as a worker: build off the main thread and hand the buffers over without copying.
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = ({ data: { budget, seed } }) => {
    const cloud = buildCloud(budget, seed);
    self.postMessage(cloud, [cloud.A.buffer, cloud.B.buffer, cloud.D.buffer, cloud.times.buffer]);
  };
}
