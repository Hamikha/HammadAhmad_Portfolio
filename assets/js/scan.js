// Renders the point cloud from cloud.js with raw WebGL2 (no libraries) and drives it from
// scroll and pointer input: scan on load, cursor probe, segmentation, then the digital twin.

import { add, sub, mul, dot, cross, norm, mix, mix3, clamp, smooth } from './cloud.js';

const SCAN_SECONDS = 2.4;
const SEED = 20260821;

// Build the cloud in a module worker; fall back to the main thread if workers are unavailable.
async function loadCloud(budget) {
  try {
    const worker = new Worker(new URL('./cloud.js', import.meta.url), { type: 'module' });
    return await new Promise((resolve, reject) => {
      worker.onmessage = e => { resolve(e.data); worker.terminate(); };
      worker.onerror = e => { worker.terminate(); reject(e); };
      worker.postMessage({ budget, seed: SEED });
    });
  } catch {
    const { buildCloud } = await import('./cloud.js');
    return buildCloud(budget, SEED);
  }
}

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aTree;
layout(location = 1) in vec4 aTwin;   // xyz + intensity in the twin
layout(location = 2) in vec4 aData;   // kind, intensity, seed, scan time
uniform mat4 uView, uProj;
uniform float uTime, uScan, uSeg, uMorph, uRot, uProbe, uAspect, uDpr, uFade, uSize;
uniform vec2 uMouse;
uniform vec3 uInk, uAccent;
out vec3 vColor;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

void main() {
  float kind = aData.x, seed = aData.z;
  float isGround = step(kind, 0.5);
  float isStem = step(0.5, kind) * step(kind, 1.5);
  float isWood = step(1.5, kind) * step(kind, 2.5);
  float isLeaf = step(2.5, kind) * step(kind, 3.5);
  float isMark = step(3.5, kind);

  float since = uScan - aData.w;
  float seen = step(0.0, since);
  float flash = seen * exp(-since * 26.0) * (1.0 - isMark);

  vec3 p = aTree;
  float sway = isLeaf * max(p.y - 3.0, 0.0) * 0.018;
  p.x += sin(uTime * 1.3 + p.y * 0.35 + seed * 6.2831) * sway;
  p.z += cos(uTime * 1.1 + p.x * 0.3 + seed * 3.1) * sway * 0.7;

  // The tree dissolves as a wave from the crown down to the roots.
  float delay = clamp(1.0 - aTree.y / 22.0, 0.0, 1.0) * 0.42 + seed * 0.08;
  float m = clamp((uMorph - delay) / 0.5, 0.0, 1.0);
  m = m * m * (3.0 - 2.0 * m);
  float arc = sin(m * 3.14159265);
  p = mix(p, aTwin.xyz, m);
  p.y += arc * (1.5 + seed * 2.0);
  p.xz = rot(uRot) * p.xz;

  vec4 view = uView * vec4(p, 1.0);
  vec4 clip = uProj * view;

  // Cursor probe: part the points and light them up.
  vec2 ndc = clip.xy / clip.w;
  vec2 d = (ndc - uMouse) * vec2(uAspect, 1.0);
  float dist = length(d);
  float probe = uProbe * (1.0 - smoothstep(0.0, 0.2, dist)) * (1.0 - m) * seen;
  ndc += d / max(dist, 1e-4) * probe * probe * 0.045 / vec2(uAspect, 1.0);
  clip.xy = ndc * clip.w;
  gl_Position = clip;

  float wood = isStem + isWood * (1.0 - m);
  float accent = clamp(wood * uSeg + isMark + flash + probe * 0.85, 0.0, 1.0);

  float I = mix(aData.y, aTwin.w, m);
  I *= 1.0 - isLeaf * uSeg * 0.6 * (1.0 - m);
  I *= 1.0 - isGround * (1.0 - m) * (uSeg * 0.4 + smoothstep(14.0, 27.0, length(aTree.xz)));
  I *= mix(1.0, smoothstep(0.55, 0.95, uSeg), isMark);
  float alpha = max(seen * I, flash * 0.9) * uFade;
  vColor = mix(uInk, uAccent, accent) * alpha;

  float size = uSize * uDpr * (40.0 / max(-view.z, 1.0))
    * (1.0 + flash * 1.6 + probe * 1.4 + isStem * 0.25 + isMark * 0.6) * mix(1.0, 1.25, m);
  gl_PointSize = clamp(size, 1.0, 7.0 * uDpr);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  outColor = vec4(vColor * (1.0 - smoothstep(0.1, 0.25, dot(c, c))), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s); // status is checked once, after linking, so compilation doesn't stall the page
  return s;
}

function perspective(fovy, aspect, near, far, offX, offY) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, -offX, -offY, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function lookAt(e, t) {
  const z = norm(sub(e, t)), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
  return { m: new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]), x, y, z, e };
}

const apply = (m, v) => [0, 1, 2, 3].map(r => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r]);

// Camera framing per aspect ratio: on wide screens the subject sits right of the copy,
// on tall screens it sits above it.
function framing(aspect) {
  if (aspect >= 1.05) {
    const off = clamp((aspect - 1) * 0.6, 0.22, 0.4);
    return { eye: [0, 11, 50], target: [0, 9.4, 0], off: [off, -0.04], twinEye: [-4, 88, 50], twinTarget: [0, 0, 0], twinOff: [off + 0.1, -0.04], size: 1.6 };
  }
  const k = clamp(0.95 / aspect, 1, 2.1);
  return { eye: [0, 11, 50 * k * 1.05], target: [0, 9.4, 0], off: [0, 0.6], twinEye: [-4, 82 * k * 0.74, 46 * k * 0.74], twinTarget: [0, 0, 0], twinOff: [0, 0.52], size: 1.6 * Math.sqrt(k) };
}

export async function createScan({ canvas, hero, stage, reduced, ui }) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'default' });
  if (!gl) return null;

  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700 || coarse;
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const budget = Math.round((small ? 22000 : 44000) * (weak ? 0.7 : 1));

  // Shaders compile while the worker builds the cloud.
  const prog = gl.createProgram();
  const shaders = [compile(gl, gl.VERTEX_SHADER, VERT), compile(gl, gl.FRAGMENT_SHADER, FRAG)];
  shaders.forEach(s => gl.attachShader(prog, s));
  gl.linkProgram(prog);
  const data = await loadCloud(budget);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(shaders.map(s => gl.getShaderInfoLog(s)).join(' ') || gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  [[data.A, 3], [data.B, 4], [data.D, 4]].forEach(([arr, size], loc) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  });

  const U = {};
  for (const name of ['uView', 'uProj', 'uTime', 'uScan', 'uSeg', 'uMorph', 'uRot', 'uProbe', 'uAspect', 'uDpr', 'uFade', 'uSize', 'uMouse', 'uInk', 'uAccent']) {
    U[name] = gl.getUniformLocation(prog, name);
  }
  gl.uniform3f(U.uInk, 0.929, 0.929, 0.914);
  gl.uniform3f(U.uAccent, 1.0, 0.416, 0.102);
  gl.disable(gl.DEPTH_TEST);
  // MAX blending: order-independent, and overlapping orange stays orange (additive would drift to yellow).
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.MAX);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(10 / 255, 10 / 255, 10 / 255, 1);

  ui.setMeasure?.({ dbh: data.dbh, height: data.height, trees: data.trees });

  /* ----- state ----- */
  let dpr = 1, w = 1, h = 1, cssW = 1, cssH = 1, drawCount = data.n, hidden = false;
  let raf = 0, last = performance.now(), clock = 0;
  let scan = reduced.matches ? 1.1 : 0;
  let rot = 0, rotVel = 0, dragging = false, lastX = 0, lastT = 0;
  let probe = 0, probeTarget = 0, mouse = [0, 0], mouseCss = [0, 0];
  let pS = 0, heroH = 1, stageBottom = 1;
  let morphShown = 0, dip = 1;
  let frames = 0, slowFrames = 0, lastSig = '', step = 0, hudText = '';

  function measure() {
    heroH = hero.offsetHeight;
    stageBottom = stage.getBoundingClientRect().bottom + scrollY;
  }

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75) * (frames < 0 ? 0.75 : 1);
    cssW = canvas.clientWidth; cssH = canvas.clientHeight;
    w = Math.max(1, Math.round(cssW * dpr));
    h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    measure();
    lastSig = '';
    kick();
  }

  function countSeen(s) {
    let lo = 0, hi = data.times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (data.times[mid] <= s) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function scrollState() {
    const vh = innerHeight, end = Math.max(stageBottom - vh, 1), y = scrollY;
    return { p: clamp(y / end), fade: 1 - clamp((y - end) / (vh * 0.5)), pp: clamp(heroH / end, 0.1, 0.9) };
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const still = reduced.matches;
    const { p, fade, pp } = scrollState();

    pS = still ? p : pS + (p - pS) * (1 - Math.exp(-dt * 9));
    if (Math.abs(p - pS) < 1e-4) pS = p;
    if (!still) clock += dt;
    scan = still ? 1.1 : Math.min(scan + dt / SCAN_SECONDS, 1.1);

    const seg = smooth(pp - 0.07, pp + 0.08, pS);
    let morph = clamp((pS - (pp + 0.1)) / (0.97 - (pp + 0.1)));
    if (still) { // reduced motion: swap states with a short fade instead of moving points
      const target = morph > 0.5 ? 1 : 0;
      if (target !== morphShown) { morphShown = target; dip = 0; }
      dip = Math.min(dip + dt / 0.35, 1);
      morph = morphShown;
    }

    const spin = still || scan < 1 ? 0 : 0.06 * smooth(1, 1.1, scan);
    if (!dragging) rotVel += (spin - rotVel) * (1 - Math.exp(-dt * 1.6));
    if (!dragging) rot += rotVel * dt;
    probe += (probeTarget * (1 - seg) - probe) * (1 - Math.exp(-dt * 10));
    if (probe < 0.002) probe = 0;

    const aspect = w / h, fr = framing(aspect);
    const cam = smooth(0, 1, morph);
    const dolly = smooth(0, pp, pS);
    const heroEye = add(fr.eye, [0, dolly * 1.5, -dolly * 5]);
    const eye = mix3(heroEye, fr.twinEye, cam), target = mix3(fr.target, fr.twinTarget, cam);
    const off = [mix(fr.off[0], fr.twinOff[0], cam), mix(fr.off[1], fr.twinOff[1], cam)];
    const view = lookAt(eye, target);
    const proj = perspective(0.6, aspect, 0.5, 400, off[0], off[1]);
    const fadeAll = fade * dip * smooth(0, 0.06, scan + (still ? 1 : 0));

    const sig = [pS, fade, rot, probe, scan, dip, w, h, mouse[0], mouse[1], clock].map(v => v.toFixed(4)).join();
    if (sig !== lastSig && fade > 0) {
      lastSig = sig;
      gl.uniformMatrix4fv(U.uView, false, view.m);
      gl.uniformMatrix4fv(U.uProj, false, proj);
      gl.uniform1f(U.uTime, clock);
      gl.uniform1f(U.uScan, scan);
      gl.uniform1f(U.uSeg, seg);
      gl.uniform1f(U.uMorph, morph);
      gl.uniform1f(U.uRot, rot);
      gl.uniform1f(U.uProbe, probe);
      gl.uniform1f(U.uAspect, aspect);
      gl.uniform1f(U.uDpr, dpr);
      gl.uniform1f(U.uFade, fadeAll);
      gl.uniform1f(U.uSize, fr.size);
      gl.uniform2f(U.uMouse, mouse[0], mouse[1]);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, drawCount);
    }
    if (hidden !== fade <= 0) { hidden = fade <= 0; canvas.style.visibility = hidden ? 'hidden' : ''; }

    // HUD: real revealed-point count while scanning.
    const text = scan < 1 ? `Scanning ${Math.round(scan * 100)}%` : 'Scan complete';
    const shown = countSeen(Math.min(scan, 1));
    const hud = text + shown;
    if (hud !== hudText) { hudText = hud; ui.setHud?.(text, shown, scan >= 1); }

    const nextStep = seg < 0.5 ? 1 : morph < 0.35 ? 2 : 3;
    if (nextStep !== step) { step = nextStep; ui.setStep?.(step); }

    // Screen position of the DBH annotation, and the probe readout.
    const toScreen = pt => {
      const c = Math.cos(rot), s = Math.sin(rot);
      const q = [c * pt[0] - s * pt[2], pt[1], s * pt[0] + c * pt[2]];
      const v = apply(proj, apply(view.m, q));
      return [((v[0] / v[3]) * 0.5 + 0.5) * cssW, (0.5 - (v[1] / v[3]) * 0.5) * cssH];
    };
    const dbhOn = seg * (1 - smooth(0, 0.2, morph)) * fade;
    ui.setDbh?.(dbhOn > 0.01 ? toScreen(data.dbhAnchor) : null, dbhOn);

    if (probe > 0.01) ui.setProbe?.(mouseCss, probe, readout(view, aspect, off));
    else ui.setProbe?.(null, 0);

    // Adaptive quality: if the first frames are slow, draw fewer points at lower resolution.
    if (fade > 0 && !still && frames >= 0 && frames < 100) {
      frames++;
      if (frames > 10 && dt > 1 / 40) slowFrames++;
      if (frames === 100 && slowFrames > 45) { drawCount = Math.floor(data.n * 0.55); frames = -1; resize(); }
    }

    const idle = still && sig === lastSig && !dragging && dip >= 1 && probe === 0;
    if (fade > 0 && !document.hidden && !(idle && Math.abs(p - pS) < 1e-4)) raf = requestAnimationFrame(frame);
  }

  // What the probe is pointing at, in the tree's own coordinates (metres).
  function readout(view, aspect, off) {
    const f = 1 / Math.tan(0.3);
    const dv = [(mouse[0] - off[0]) * aspect / f, (mouse[1] - off[1]) / f, -1];
    const dir = norm(add(add(mul(view.x, dv[0]), mul(view.y, dv[1])), mul(view.z, dv[2])));
    const eye = view.e;
    // Intersect with the vertical plane through the stem that faces the camera.
    const n = norm([view.z[0], 0, view.z[2]]);
    const t = -dot(eye, n) / (dot(dir, n) || 1e-6);
    const hit = add(eye, mul(dir, t));
    if (hit[1] < 0 && dir[1] < 0) {
      const g = add(eye, mul(dir, -eye[1] / dir[1]));
      return `ground  d ${Math.hypot(g[0], g[2]).toFixed(2)} m`;
    }
    const right = norm([view.x[0], 0, view.x[2]]);
    return `h ${hit[1].toFixed(2)} m  r ${dot(hit, right).toFixed(2)} m`;
  }

  function kick() {
    if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  /* ----- input ----- */
  const setMouse = e => {
    mouseCss = [e.clientX, e.clientY];
    mouse = [(e.clientX / cssW) * 2 - 1, 1 - (e.clientY / cssH) * 2];
  };
  const onCopy = e => e.target.closest('a, button, .hero-inner > *');
  hero.addEventListener('pointermove', e => {
    if (e.pointerType === 'mouse') { setMouse(e); probeTarget = onCopy(e) ? 0 : 1; kick(); }
    if (!dragging) return;
    const dx = e.clientX - lastX, dt = Math.max((e.timeStamp - lastT) / 1000, 1 / 240);
    lastX = e.clientX; lastT = e.timeStamp;
    rot += dx * 0.006;
    rotVel = clamp((dx * 0.006) / dt, -3, 3);
    kick();
  });
  hero.addEventListener('pointerdown', e => {
    if (e.button !== 0 || onCopy(e)) return;
    dragging = true; lastX = e.clientX; lastT = e.timeStamp;
    hero.setPointerCapture?.(e.pointerId);
    hero.classList.add('is-dragging');
  });
  const release = () => { dragging = false; hero.classList.remove('is-dragging'); kick(); };
  hero.addEventListener('pointerup', release);
  hero.addEventListener('pointercancel', release);
  hero.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') { probeTarget = 0; kick(); } });

  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', kick);
  reduced.addEventListener?.('change', () => { lastSig = ''; kick(); });
  new ResizeObserver(() => { measure(); kick(); }).observe(document.body);
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; ui.onLost?.(); });

  resize();
  return { points: data.n };
}
