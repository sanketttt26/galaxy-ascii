// galaxy layout and camera, shared by the shader and the cpu (sun marker, click to supernova)
// units: the stellar disk has radius 1, about 15 kpc

export const DEG = Math.PI / 180;
export const CAM_D = 4, FOV = 0.42;          // camera distance; at zoom 1 the disk spans 0.42 screen units
export const PITCH = 14 * DEG;               // pitch angle of the spiral arms, measured at ~12 to 14
export const BAR = 0.3;                      // bar half-length, ~4.5 kpc; the arms start at its ends
export const R_SUN = 0.55;                   // ~8.2 kpc from the center

// log spiral: how far an arm has wound by radius r
export const wind = (r) => Math.log(Math.max(r, 0.02) / BAR) / Math.tan(PITCH);
// the Sun sits on the Orion spur, a quarter of the way from Sagittarius to Perseus
export const SUN = [R_SUN * Math.cos(wind(R_SUN) + Math.PI / 4), R_SUN * Math.sin(wind(R_SUN) + Math.PI / 4)];

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// disk normal n and in-plane axes u, v from tilt and roll (after horizon's diskBasis)
export function basis(tilt, roll) {
  const n0 = [0, Math.cos(tilt), -Math.sin(tilt)];
  const rz = (v) => [v[0] * Math.cos(roll) - v[1] * Math.sin(roll), v[0] * Math.sin(roll) + v[1] * Math.cos(roll), v[2]];
  const n = rz(n0), u = rz([1, 0, 0]);
  const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { n, u, v };
}

// a point on the disk, in the rotating galaxy frame, to screen units
export function project(x, y, spin, B, zoom) {
  const c = Math.cos(spin), s = Math.sin(spin);
  const lx = x * c - y * s, ly = x * s + y * c;
  const p = [0, 1, 2].map((i) => lx * B.u[i] + ly * B.v[i]);
  const k = zoom * FOV * CAM_D / (p[2] + CAM_D);
  return [p[0] * k, p[1] * k];
}

// screen units back onto the disk plane, in the rotating galaxy frame; null if the ray misses it
export function unproject(qx, qy, spin, B, zoom) {
  const ro = [0, 0, -CAM_D], rd = [qx / (zoom * FOV), qy / (zoom * FOV), CAM_D];
  const dn = dot(rd, B.n);
  if (Math.abs(dn) < 1e-6) return null;
  const t = -dot(ro, B.n) / dn;
  if (t <= 0) return null;
  const p = [0, 1, 2].map((i) => ro[i] + rd[i] * t);
  const lx = dot(p, B.u), ly = dot(p, B.v), c = Math.cos(spin), s = Math.sin(spin);
  return [lx * c + ly * s, -lx * s + ly * c];
}
