import { CAM_D, FOV, PITCH, BAR, R_SUN } from './geom.js';

const g = (c) => c.charCodeAt(0) - 32;
const f = (x) => x.toFixed(5);
export const RAMP = ' .:-=+*#%@';

// one oversized triangle that covers the viewport (from horizon)
export const FULLSCREEN_VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

// pass 1, one fragment per glyph cell: march rays through the galaxy and pick the letter.
// the six-ray shape matcher and the cell plumbing come from horizon's scene.frag.js
export const SCENE_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 o0;
uniform vec2 uGrid, uCell, uGridPx;
uniform float uUnit, uTime, uZoom, uSpin, uForm, uBright;
uniform vec3 uN, uU, uV;
uniform vec4 uSN[4];
uniform sampler2D uShape;
uniform int uSS, uShapeOn, uSunOn, uLabelX, uLabelN;
uniform ivec2 uSun;
uniform int uLabel[16];

const float PI = 3.14159265, TAU = 6.2831853;
const float D = ${f(CAM_D)}, FOV = ${f(FOV)}, PITCH = ${f(PITCH)}, BAR = ${f(BAR)}, RSUN = ${f(R_SUN)};
// half thickness of the slab rays march through, steps per ray
const float SLAB = 0.2; const int STEPS = 36;
const vec2 SP[6] = vec2[6](vec2(0.28, 0.2), vec2(0.72, 0.2), vec2(0.28, 0.5), vec2(0.72, 0.5), vec2(0.28, 0.8), vec2(0.72, 0.8));
const int RAMP[${RAMP.length}] = int[${RAMP.length}](${[...RAMP].map(g).join(', ')});
const int STAR[5] = int[5](${[...".'.+*"].map(g).join(', ')});

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 x){
  vec2 i = floor(x), u = fract(x); u = u * u * (3.0 - 2.0 * u);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 x){ return vn(x) * 0.5 + vn(x * 2.03 + 7.1) * 0.3 + vn(x * 4.11 + 13.7) * 0.2; }

// log spiral arms wound out from the bar ends. x: how much arm is here, y: the dust lane on its inner edge
vec2 arms(float r, float th){
  float wind = log(max(r, 0.02) / BAR) / tan(PITCH), sp = sin(PITCH);
  float w = 0.025 + 0.03 * r;
  vec2 s = vec2(0.0);
  // k = 0 Perseus, 1 Sagittarius, 2 Scutum-Centaurus, 3 Norma; the two major arms start at the bar ends
  for (int k = 0; k < 4; k++) {
    float d = r * sp * (mod(th - wind - float(k) * PI * 0.5 + PI, TAU) - PI);
    s += (k % 2 == 0 ? 1.0 : 0.4) * vec2(exp(-d * d / (w * w)), exp(-pow((d - 0.6 * w) / (0.45 * w), 2.0)));
  }
  // the Orion spur, a short arm between Sagittarius and Perseus, where the Sun lives
  float d = r * sp * (mod(th - wind - PI * 0.25 + PI, TAU) - PI);
  s += 0.4 * exp(-pow((r - RSUN) / 0.12, 2.0)) * vec2(exp(-d * d / 0.0004), exp(-pow((d - 0.012) / 0.01, 2.0)));
  return s * smoothstep(BAR * 0.7, BAR * 1.25, r);
}

// light, pink light (HII regions, supernovae) and dust at p in the galaxy frame, z out of the plane.
// ponytail: vertical scales are ~2x the real ones so the dust lane survives at grid resolution
void galaxy(vec3 p, out float em, out float hot, out float dust){
  float r = length(p.xy), z2 = p.z * p.z;
  float grow = 1.0 - smoothstep(uForm * 0.8, uForm, r);
  vec2 a = arms(r, atan(p.y, p.x));
  float disk = exp(-r / 0.24) * exp(-z2 / 0.0016);
  float n = fbm(p.xy * 7.0 + 3.0);
  float spiral = a.x * (0.1 + 1.6 * n * n) * exp(-r / 0.6) * exp(-z2 / 0.0009);
  float grain = pow(vn(p.xy * 90.0), 10.0);
  // old stars: the boxy bulge and the long bar along x
  float bulge = exp(-length(vec3(p.xy, p.z * 1.3)) / 0.07);
  float bar = exp(-2.5 * length(vec3(p.x / 0.3, p.y / 0.085, p.z / 0.07)));
  em = ((5.0 * disk + 75.0 * spiral) * (0.6 + 3.0 * grain)) * grow + 16.0 * bulge + 22.0 * bar;
  hot = spiral > 0.004 ? 2500.0 * spiral * pow(fbm(p.xy * 16.0 + 11.0), 9.0) * grow : 0.0;
  dust = 120.0 * (0.3 * exp(-r / 0.4) + 1.2 * a.y * exp(-r / 0.6)) * exp(-z2 / 0.0006) * (0.4 + 1.2 * fbm(p.xy * 12.0 + 5.0)) * grow * smoothstep(0.03, 0.12, r);
  for (int i = 0; i < 4; i++) {
    vec4 s = uSN[i];
    if (s.w <= 0.0) continue;
    float d = length(p.xy - s.xy);
    float b = s.w * exp(-s.z * 0.8) * (30.0 * exp(-s.z * 1.5 - d * d / 0.0006) + 10.0 * exp(-pow((d - 0.02 - s.z * 0.05) / 0.012, 2.0))) * exp(-z2 / 0.0016);
    em += b; hot += b;
  }
}

// one ray from the camera, front to back through the disk slab. L: light, P: its pink share
void trace(vec2 q, float jit, out float L, out float P){
  L = 0.0; P = 0.0;
  vec3 ro = vec3(0.0, 0.0, -D), rd = normalize(vec3(q / (uZoom * FOV), D));
  float b = dot(ro, rd), c = dot(ro, ro) - 1.21, disc = b * b - c;
  if (disc < 0.0) return;
  float t0 = -b - sqrt(disc), t1 = -b + sqrt(disc);
  float hn = dot(ro, uN), dn = dot(rd, uN);
  if (abs(dn) > 1e-5) { float ta = (-SLAB - hn) / dn, tb = (SLAB - hn) / dn; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  else if (abs(hn) > SLAB) return;
  if (t1 <= t0) return;
  float dt = (t1 - t0) / float(STEPS), tr = 1.0;
  float cs = cos(uSpin), sn = sin(uSpin);
  for (int i = 0; i < STEPS; i++) {
    vec3 w = ro + rd * (t0 + (float(i) + jit) * dt);
    vec3 l = vec3(dot(w, uU), dot(w, uV), dot(w, uN));
    vec3 p = vec3(l.x * cs + l.y * sn, -l.x * sn + l.y * cs, l.z);
    float e, h, k;
    galaxy(p, e, h, k);
    L += tr * e * dt; P += tr * h * dt;
    tr *= exp(-k * dt);
    if (tr < 0.02) break;
  }
  // Sgr A* and the nuclear cluster: too small to march, so use the ray's closest approach to the center
  float bc = length(cross(-ro, rd));
  L += 1.4 * tr * exp(-bc / 0.01);
  L *= uBright;
}
float lumOf(float L){ return 1.0 - exp(-1.05 * L); }

void main(){
  ivec2 fc = ivec2(gl_FragCoord.xy);
  float row = uGrid.y - 1.0 - float(fc.y);
  vec2 cid = vec2(float(fc.x), row);
  vec2 cellTL = cid * uCell;
  float hc = hash(cid + 17.0);
  vec2 qc = (cellTL + uCell * 0.5 - uGridPx * 0.5) / uUnit; qc.y = -qc.y;
  float L, P;
  trace(qc, hc, L, P);
  float lc = lumOf(L);
  bool full = uSS == 6 && length(qc) < uZoom * FOV * 1.4;
  float s[6];
  float m = lc, tone = lc;
  if (full) {
    m = 0.0; tone = 0.0;
    for (int i = 0; i < 6; i++) {
      vec2 q = (cellTL + uCell * SP[i] - uGridPx * 0.5) / uUnit; q.y = -q.y;
      float l2, p2;
      trace(q, fract(hc + float(i) * 0.618), l2, p2);
      s[i] = lumOf(l2); m = max(m, s[i]); tone += s[i]; L += l2; P += p2;
    }
    tone /= 6.0;
  } else {
    for (int i = 0; i < 6; i++) s[i] = lc;
  }

  int gi = 0; float outT = 0.0, pink = 0.0, kind = 0.0;
  if (m > 0.07 && tone > 0.04) {
    if (uShapeOn == 1 && full && tone > 0.1) {
      vec4 v0 = vec4(s[0], s[1], s[2], s[3]); vec2 v1 = vec2(s[4], s[5]);
      v0 = pow(v0 / m, vec4(2.1)) * m; v1 = pow(v1 / m, vec2(2.1)) * m;
      vec4 dz = vec4(hash(cid + 3.1), hash(cid + 7.7), hash(cid + 11.3), hash(cid + 19.9)) - 0.5;
      vec2 dz2 = vec2(hash(cid + 23.5), hash(cid + 29.1)) - 0.5;
      v0 = max(v0 + dz * 0.2 * step(0.001, v0), 0.0); v1 = max(v1 + dz2 * 0.2 * step(0.001, v1), 0.0);
      float best = 1e9;
      for (int k = 1; k < 95; k++) {
        vec4 a = texelFetch(uShape, ivec2(k, 0), 0); vec2 b2 = texelFetch(uShape, ivec2(k, 1), 0).xy;
        vec4 da = a - v0; vec2 db = b2 - v1;
        float dd = dot(da, da) + dot(db, db);
        if (dd < best) { best = dd; gi = k; }
      }
      if (dot(v0, v0) + dot(v1, v1) < best) gi = 0;
    } else {
      gi = RAMP[int(clamp(floor(tone * ${RAMP.length - 1}.0 + 0.5 + (hc - 0.5) * 0.3), 0.0, ${RAMP.length - 1}.0))];
    }
    outT = tone;
    pink = P > 0.45 * L && tone > 0.2 && hc > 0.2 ? 1.0 : 0.0;
  }
  // background stars, fixed on the sky, twinkling
  if (gi == 0 && lc < 0.05 && hash(cid * 1.37 + 91.0) < 0.007) {
    gi = STAR[int(hash(cid + 2.0) * 4.99)];
    outT = (0.25 + 0.6 * hash(cid + 8.0)) * (0.7 + 0.3 * sin(uTime * (0.8 + 2.5 * hash(cid + 5.0)) + hc * 40.0));
    kind = 1.0;
  }
  if (uSunOn == 1 && int(row) == uSun.y) {
    if (fc.x == uSun.x) { gi = ${g('@')}; pink = 1.0; outT = 1.0; kind = 1.0; }
    else if (fc.x >= uLabelX && fc.x < uLabelX + uLabelN) { gi = uLabel[fc.x - uLabelX]; pink = 0.0; outT = 0.9; kind = 1.0; }
  }
  o0 = vec4(float(gi) / 255.0, clamp(outT, 0.0, 1.0), pink, kind);
}`;

// pass 2: expand each cell of the data texture into its glyph from the atlas (horizon's glyph.frag.js)
export const GLYPH_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
uniform sampler2D uData, uAtlas;
uniform int uPerRow;
uniform vec3 uBg, uInk, uPink;
uniform vec2 uOff, uCellD, uGrid, uCanvas;
void main(){
  vec2 px = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y) - uOff;
  vec2 cf = floor(px / uCellD);
  if (cf.x < 0.0 || cf.y < 0.0 || cf.x >= uGrid.x || cf.y >= uGrid.y) { o = vec4(uBg, 1.0); return; }
  vec4 d = texelFetch(uData, ivec2(int(cf.x), int(uGrid.y) - 1 - int(cf.y)), 0);
  int gi = int(floor(d.r * 255.0 + 0.5));
  if (gi == 0) { o = vec4(uBg, 1.0); return; }
  float tone = d.g, k;
  vec3 col = uInk;
  if (d.b > 0.5) { col = uPink; k = max(tone, 0.6); }
  else if (d.a > 0.5) k = tone;
  else k = 0.3 + 0.7 * smoothstep(0.0, 0.85, tone);
  vec2 lp = px - cf * uCellD;
  ivec2 ap = ivec2((gi % uPerRow) * int(uCellD.x) + int(lp.x), (gi / uPerRow) * int(uCellD.y) + int(lp.y));
  o = vec4(mix(uBg, col, texelFetch(uAtlas, ap, 0).a * k), 1.0);
}`;
