import { gl, initGL, program, makeTex, fboFor, fontsReady, buildAtlas, buildShapes } from './gl.js';
import { SCENE_FS, GLYPH_FS } from './shaders.js';
import { DEG, BAR, SUN, wind, basis, project, unproject } from './geom.js';

const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

// palettes from horizon
const THEMES = {
  stage: { bg: '#12110e', ink: '#f2f1ec', pink: '#ff2b8f' },
  paper: { bg: '#f7f7f4', ink: '#15140f', pink: '#f81a86' },
  pink: { bg: '#f81a86', ink: '#15140f', pink: '#f7f7f4' }
};
const VIEWS = [
  { tilt: 2, roll: 0.06, zoom: 1.5, name: 'Edge on' },
  { tilt: 34, roll: -0.3, zoom: 1, name: 'Tilted' },
  { tilt: 90, roll: 0, zoom: 1, name: 'Face on' }
];
const SPIN = 0.05;                     // rad/s; the picture turns once per galactic year
const MYR_PER_S = 230 / (2 * Math.PI / SPIN);
const LABEL = 'you are here';
const CELL = innerWidth < 640 ? 8 : 10;

const stage = $('#stage'), cv = $('#cv');
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
// S: what the user asked for, V: where the view is, easing toward it
const S = { view: 1, tilt: VIEWS[1].tilt, roll: VIEWS[1].roll, zoom: 1, theme: 'stage', shape: true, sun: true, paused: false };
const V = { tilt: S.tilt * DEG, roll: S.roll, zoom: 0.8 };
const G = { dpr: 1, cw: 8, ch: 13, cols: 1, rows: 1, gw: 1, gh: 1, offX: 0, offY: 0, unit: 1, W: 1, H: 1, atlas: null, perRow: 1, shape: null, tData: null, fbo: null };
const st = { t: 0, intro: still ? 99 : 0, spin: 0, sn: [], snN: 0 };
const perf = { ss: 6, slow: 0 };
let P1, P2, vao;

function layout() {
  const dpr = G.dpr;
  G.W = Math.max(1, Math.round(innerWidth * dpr)); G.H = Math.max(1, Math.round(innerHeight * dpr));
  if (cv.width !== G.W || cv.height !== G.H) { cv.width = G.W; cv.height = G.H; }
  G.cols = Math.max(1, Math.floor(G.W / G.cw)); G.rows = Math.max(1, Math.floor(G.H / G.ch));
  G.gw = G.cols * G.cw; G.gh = G.rows * G.ch;
  G.offX = Math.floor((G.W - G.gw) / 2); G.offY = Math.floor((G.H - G.gh) / 2);
  G.unit = Math.min(G.gw * (G.gh > G.gw ? 1.12 : 1), G.gh);
  if (G.tData) { gl.deleteTexture(G.tData); gl.deleteFramebuffer(G.fbo); }
  G.tData = makeTex(G.cols, G.rows); G.fbo = fboFor(G.tData);
}

function rebuildGlyphs() {
  const a = buildAtlas(CELL, G.dpr, G.atlas);
  Object.assign(G, { atlas: a.tex, cw: a.cw, ch: a.ch, perRow: a.perRow });
  G.shape = buildShapes(G.shape);
  layout();
}

/* ---------- actions, shared by keys and buttons ---------- */
let toastT = 0;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 1800);
}

// a supernova at x, y in the galaxy frame; it turns with the disk
function supernova(x, y) {
  st.sn[st.snN++ % 4] = { x, y, age: 0 };
}
// somewhere along an arm, for keyboard users
const randomSupernova = () => {
  const r = BAR + Math.random() * 0.6, th = wind(r) + Math.floor(Math.random() * 4) * Math.PI / 2 + (Math.random() - 0.5) * 0.15;
  supernova(r * Math.cos(th), r * Math.sin(th));
};

function view(i) {
  const v = VIEWS[i]; S.view = i; S.tilt = v.tilt; S.roll = v.roll; S.zoom = v.zoom;
  toast(`${v.name}.`);
}
const setZoom = (z) => { S.zoom = clamp(z, 0.5, 4); };
const rec = (on = !document.body.classList.contains('rec')) => {
  document.body.classList.toggle('rec', on);
  if (on) toast('Interface hidden. Press H to show it.');
};

const ACTIONS = {
  ' ': () => { S.paused = !S.paused; toast(S.paused ? 'Paused.' : 'Playing.'); },
  '1': () => view(0), '2': () => view(1), '3': () => view(2),
  v: () => view((S.view + 1) % VIEWS.length),
  ArrowUp: () => setZoom(S.zoom * 1.1), ArrowDown: () => setZoom(S.zoom / 1.1),
  t: () => {
    const k = Object.keys(THEMES); S.theme = k[(k.indexOf(S.theme) + 1) % k.length];
    document.documentElement.dataset.theme = S.theme; $('meta[name="theme-color"]').content = THEMES[S.theme].bg;
  },
  y: () => { S.sun = !S.sun; $('[data-k="y"]').setAttribute('aria-pressed', String(S.sun)); },
  g: () => { S.shape = !S.shape; toast(S.shape ? 'Glyphs follow shapes.' : 'Brightness ramp.'); },
  f: randomSupernova,
  a: () => { st.intro = 0; st.sn = []; },
  h: () => rec(),
  Escape: () => rec(false)
};

function initInput() {
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === ' ' && e.target.tagName === 'BUTTON') return;
    if (ACTIONS[k]) { e.preventDefault(); ACTIONS[k](); }
  });
  document.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => ACTIONS[b.dataset.k]()));

  // drag tilts and rolls, click sets off a supernova, wheel or pinch zooms (after horizon's pointer.js)
  const pts = new Map();
  let drag = null, pinch = null;
  const toQ = (e) => {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) * G.dpr - G.offX - G.gw / 2) / G.unit, -((e.clientY - r.top) * G.dpr - G.offY - G.gh / 2) / G.unit];
  };
  stage.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, e);
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.max(10, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), z: S.zoom }; drag = null; return; }
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, t0: performance.now() };
  });
  stage.addEventListener('pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, e);
    if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; setZoom(pinch.z * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d); return; }
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) { drag.moved = true; stage.classList.add('dragging'); $('#hint').classList.add('gone'); }
    if (drag.moved) {
      S.tilt = clamp(S.tilt - (e.clientY - drag.y) * 0.35, -90, 90);
      S.roll = clamp(S.roll - (e.clientX - drag.x) * 0.004, -1.6, 1.6);
    }
    drag.x = e.clientX; drag.y = e.clientY;
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; drag = null; return; }
    if (!drag) return;
    stage.classList.remove('dragging');
    if (!drag.moved && e.type === 'pointerup' && performance.now() - drag.t0 < 450) {
      // on touch there is no H key, so a tap brings the interface back
      if (document.body.classList.contains('rec') && e.pointerType === 'touch') rec(false);
      else {
        const [qx, qy] = toQ(e), hit = unproject(qx, qy, st.spin, basis(V.tilt, V.roll), V.zoom);
        if (hit && Math.hypot(hit[0], hit[1]) < 1) { supernova(hit[0], hit[1]); $('#hint').classList.add('gone'); }
      }
    }
    drag = null;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(S.zoom * Math.exp(-(e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * 0.0012)); }, { passive: false });
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
}

/* ---------- frame ---------- */
let lastMyr = -1;
function tick(dt) {
  // six rays per cell drop to one if frames run slow (from horizon)
  if (perf.ss === 6) { perf.slow = dt > 0.022 ? perf.slow + dt : Math.max(0, perf.slow - dt * 0.5); if (perf.slow > 1.5) perf.ss = 1; }
  const sdt = S.paused ? 0 : dt;
  st.t += sdt; st.intro += sdt;
  if (!still) st.spin -= sdt * SPIN;   // negative: the arms trail
  for (const s of st.sn) if (s) s.age += sdt;
  const e = 1 - Math.exp(-dt * 6);
  V.tilt += (S.tilt * DEG - V.tilt) * e; V.roll += (S.roll - V.roll) * e; V.zoom += (S.zoom - V.zoom) * e;
  const myr = Math.floor(st.t * MYR_PER_S);
  if (myr !== lastMyr) { lastMyr = myr; $('#spec').innerHTML = `<span class="n">Milky Way.</span> +${String(myr).padStart(4, '0')} Myr.`; }
}

function render() {
  const B = basis(V.tilt, V.roll);
  const col = { bg: hex(THEMES[S.theme].bg), ink: hex(THEMES[S.theme].ink), pink: hex(THEMES[S.theme].pink) };

  // pass 1: the galaxy, one cell per fragment
  gl.bindVertexArray(vao);
  gl.bindFramebuffer(gl.FRAMEBUFFER, G.fbo);
  gl.viewport(0, 0, G.cols, G.rows);
  gl.useProgram(P1.p);
  const u = P1.u;
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.shape); gl.uniform1i(u.uShape, 1);
  gl.uniform2f(u.uGrid, G.cols, G.rows); gl.uniform2f(u.uCell, G.cw, G.ch); gl.uniform2f(u.uGridPx, G.gw, G.gh);
  gl.uniform1f(u.uUnit, G.unit); gl.uniform1f(u.uTime, still ? 0 : st.t);
  gl.uniform1f(u.uZoom, V.zoom); gl.uniform1f(u.uSpin, st.spin);
  // the intro grows the disk from the bulge outward
  gl.uniform1f(u.uForm, 0.06 + 1.1 * ss(0.3, 3.4, st.intro)); gl.uniform1f(u.uBright, ss(0, 1.2, st.intro));
  gl.uniform3fv(u.uN, B.n); gl.uniform3fv(u.uU, B.u); gl.uniform3fv(u.uV, B.v);
  gl.uniform4fv(u.uSN, [0, 1, 2, 3].flatMap((i) => { const s = st.sn[i]; return s && s.age < 6 ? [s.x, s.y, s.age, 1] : [0, 0, 0, 0]; }));
  gl.uniform1i(u.uSS, perf.ss); gl.uniform1i(u.uShapeOn, S.shape ? 1 : 0);

  const [qx, qy] = project(SUN[0], SUN[1], st.spin, B, V.zoom);
  const sx = Math.floor((G.gw / 2 + qx * G.unit) / G.cw), sy = Math.floor((G.gh / 2 - qy * G.unit) / G.ch);
  // the label goes on whichever side of the marker has room
  const lx = sx + 2 + LABEL.length <= G.cols ? sx + 2 : sx - 1 - LABEL.length;
  gl.uniform1i(u.uSunOn, S.sun && st.intro > 3 ? 1 : 0);
  gl.uniform2i(u.uSun, sx, sy); gl.uniform1i(u.uLabelX, lx); gl.uniform1i(u.uLabelN, LABEL.length);
  gl.uniform1iv(u.uLabel, [...LABEL.padEnd(16)].map((c) => c.charCodeAt(0) - 32));
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // pass 2: glyphs to the screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, G.W, G.H);
  gl.useProgram(P2.p);
  const v = P2.u;
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.tData); gl.uniform1i(v.uData, 0);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, G.atlas); gl.uniform1i(v.uAtlas, 2);
  gl.uniform1i(v.uPerRow, G.perRow);
  gl.uniform3fv(v.uBg, col.bg); gl.uniform3fv(v.uInk, col.ink); gl.uniform3fv(v.uPink, col.pink);
  gl.uniform2f(v.uOff, G.offX, G.offY); gl.uniform2f(v.uCellD, G.cw, G.ch);
  gl.uniform2f(v.uGrid, G.cols, G.rows); gl.uniform2f(v.uCanvas, G.W, G.H);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function boot() {
  if (!initGL(cv)) {
    stage.insertAdjacentHTML('beforeend', '<p class="fallback">This needs WebGL 2. Try a current Chrome, Safari or Firefox.</p>');
    return;
  }
  P1 = program(SCENE_FS); P2 = program(GLYPH_FS); vao = gl.createVertexArray();
  initInput();
  if (matchMedia('(pointer: coarse)').matches) $('#hint').textContent = 'Drag to tilt. Pinch to zoom. Tap the disk for a supernova.';
  G.dpr = Math.min(2, devicePixelRatio || 1);
  rebuildGlyphs();
  addEventListener('resize', () => {
    const d = Math.min(2, devicePixelRatio || 1);
    if (d !== G.dpr) { G.dpr = d; rebuildGlyphs(); } else layout();
  });
  // hooks for scripted capture, e.g. __galaxy.view(2); __galaxy.seek(5)
  window.__galaxy = { view, supernova, seek(t) { st.intro = t; st.t = t; Object.assign(V, { tilt: S.tilt * DEG, roll: S.roll, zoom: S.zoom }); }, pause(p = true) { S.paused = p; }, get state() { return { ...S, cols: G.cols, rows: G.rows, ss: perf.ss }; } };

  let last = performance.now();
  const loop = (now) => {
    tick(Math.min(0.05, Math.max(0, (now - last) / 1000))); last = now;
    render();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
  fontsReady.then(rebuildGlyphs);
}

boot();
