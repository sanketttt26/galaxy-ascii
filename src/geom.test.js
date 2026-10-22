// node --test: the sun marker and clicks rely on project and unproject being inverses
import test from 'node:test';
import assert from 'node:assert/strict';
import { basis, project, unproject, SUN, R_SUN, DEG } from './geom.js';

test('unproject undoes project for any view', () => {
  for (const tilt of [5, 34, 60, 90]) for (const roll of [-0.6, 0, 0.4]) for (const spin of [0, 1.3, -4]) {
    const B = basis(tilt * DEG, roll);
    for (const [x, y] of [[0.2, -0.1], [-0.7, 0.5], SUN]) {
      const [qx, qy] = project(x, y, spin, B, 1.3);
      const back = unproject(qx, qy, spin, B, 1.3);
      assert.ok(Math.abs(back[0] - x) < 1e-9 && Math.abs(back[1] - y) < 1e-9, `tilt ${tilt} roll ${roll} spin ${spin}`);
    }
  }
});

test('face on, the sun lands R_SUN * FOV from the center', () => {
  const [qx, qy] = project(SUN[0], SUN[1], 0, basis(90 * DEG, 0), 1);
  assert.ok(Math.abs(Math.hypot(qx, qy) - R_SUN * 0.42) < 1e-9);
});
