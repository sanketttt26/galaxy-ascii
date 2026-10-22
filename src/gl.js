// WebGL 2 setup, the font atlas and the glyph shape vectors.
// Adapted from ascii/horizon by Siddharth Meena (MIT), https://github.com/SiddDevZ/horizon
// (src/gl/context.js and src/gl/glyphs.js)
import { FULLSCREEN_VS } from './shaders.js';

export let gl = null;

export function initGL(canvas) {
  gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  return gl;
}

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(log); throw new Error(log); }
  return s;
}

// links a program and collects every active uniform location by name
export function program(fs, vs = FULLSCREEN_VS) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

export function makeTex(w, h, data) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (data instanceof Uint8Array || !data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data || null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return t;
}

export function fboFor(tex) {
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return f;
}

/* ---------- glyphs ---------- */
export const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
// six sampling points per cell, shared with the scene shader
export const SAMPLE_POINTS = [[0.28, 0.2], [0.72, 0.2], [0.28, 0.5], [0.72, 0.5], [0.28, 0.8], [0.72, 0.8]];

export const fontsReady = Promise.race([document.fonts.load('400 22px "Martian Mono"'), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
const fontAt = (px) => `400 ${px}px "Martian Mono", ui-monospace, Menlo, monospace`;

function drawGlyphs(x, cw, ch, fpx, perRow) {
  x.font = fontAt(fpx); x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillStyle = '#fff';
  ASCII.forEach((g, i) => { x.fillText(g, (i % perRow) * cw + cw / 2, Math.floor(i / perRow) * ch + ch / 2 + fpx * 0.04); });
}

// ink coverage of every printable glyph at the six sampling points, as a 95 x 2 texture
export function buildShapes(old) {
  const fpx = 48, c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
  x.font = fontAt(fpx);
  const cw = Math.round(x.measureText('M').width), ch = Math.round(fpx * 13 / 11);
  c.width = cw * 95; c.height = ch;
  drawGlyphs(x, cw, ch, fpx, 95);
  const img = x.getImageData(0, 0, c.width, c.height).data;
  const R = 0.21 * cw;
  const vec = ASCII.map((_, g) => SAMPLE_POINTS.map(([fx, fy]) => {
    const cx = g * cw + fx * cw, cy = fy * ch; let sum = 0, n = 0;
    for (let yy = Math.floor(cy - R); yy <= Math.ceil(cy + R); yy++) for (let xx = Math.floor(cx - R); xx <= Math.ceil(cx + R); xx++) {
      if ((xx - cx) ** 2 + (yy - cy) ** 2 > R * R) continue;
      sum += img[(yy * c.width + xx) * 4 + 3] / 255; n++;
    }
    return sum / n;
  }));
  const mx = [0, 1, 2, 3, 4, 5].map((k) => Math.max(1e-3, ...vec.map((v) => v[k])));
  const data = new Uint8Array(95 * 2 * 4);
  vec.forEach((v, g) => {
    for (let k = 0; k < 6; k++) data[((k < 4 ? 0 : 95) + g) * 4 + (k < 4 ? k : k - 4)] = Math.round(Math.min(1, v[k] / mx[k]) * 255);
  });
  if (old) gl.deleteTexture(old);
  return makeTex(95, 2, data);
}

// every printable glyph at the current cell size, packed into one texture
export function buildAtlas(cell, dpr, old) {
  const fpx = cell * dpr, c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = fontAt(fpx);
  const cw = Math.max(2, Math.round(x.measureText('M').width)), ch = Math.max(3, Math.round(cell * (13 / 11) * dpr));
  const perRow = Math.max(1, Math.floor(Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE)) / cw));
  c.width = Math.min(95, perRow) * cw; c.height = Math.ceil(95 / perRow) * ch;
  drawGlyphs(x, cw, ch, fpx, perRow);
  if (old) gl.deleteTexture(old);
  return { tex: makeTex(c.width, c.height, c), cw, ch, perRow };
}
