/*
 * Copyright 2026 The Wave Optics Simulation authors and contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import SphericalLens from '../../../src/core/sceneObjs/glass/SphericalLens';
import Scene from '../../../src/core/Scene';
import Mouse from '../../../src/core/Mouse';

/**
 * A lens defined by thickness and focal length, upright with its axis along x.
 */
function makeLens(scene, { d = 20, f = 150, halfAperture = 50, refIndex = 1.5 } = {}) {
  return new SphericalLens(scene, {
    defBy: 'DF',
    p1: { x: 300, y: 400 - halfAperture },
    p2: { x: 300, y: 400 + halfAperture },
    params: { d, f },
    refIndex,
  });
}

describe('SphericalLens defined by focal length', () => {
  let scene;

  beforeEach(() => {
    scene = new Scene();
    scene.editor = { selectedObjIndex: -1 };
  });

  test('builds a lens whose focal length is the one asked for', () => {
    for (const f of [80, 150, 300]) {
      const lens = makeLens(scene, { f });
      expect(lens.error).toBeNull();
      expect(lens.getFocalLength()).toBeCloseTo(f, 6);
    }
  });

  test('is symmetric, so the two radii are opposite', () => {
    const lens = makeLens(scene, { f: 150 });
    const { r1, r2 } = lens.getDR1R2();
    expect(r1).toBeCloseTo(-r2, 6);
    expect(r1).toBeGreaterThan(0);
  });

  test('tends to the thin-lens radius as the thickness goes to zero', () => {
    const lens = makeLens(scene, { d: 0.01, f: 150, refIndex: 1.5 });
    // R = 2(n - 1)f for a thin symmetric lens.
    expect(lens.getDR1R2().r1).toBeCloseTo(150, 0);
  });

  test('a negative focal length gives a diverging lens', () => {
    const lens = makeLens(scene, { f: -150, halfAperture: 40 });
    expect(lens.error).toBeNull();
    expect(lens.getFocalLength()).toBeCloseTo(-150, 6);
    expect(lens.getDR1R2().r1).toBeLessThan(0);
  });

  test('the thickness is accounted for, not ignored', () => {
    const thin = makeLens(scene, { d: 1, f: 150 });
    const thick = makeLens(scene, { d: 40, f: 150 });
    expect(thick.getDR1R2().r1).not.toBeCloseTo(thin.getDR1R2().r1, 1);
    expect(thick.getFocalLength()).toBeCloseTo(150, 6);
  });

  test('warns when the lens is too thin for the focal length and aperture', () => {
    const degenerate = makeLens(scene, { d: 2, f: 150, halfAperture: 70 });
    expect(degenerate.warning).toBeTruthy();
    expect(makeLens(scene, { d: 30, f: 150, halfAperture: 40 }).warning).toBeNull();
  });

  test('reports an error when no lens can have that focal length', () => {
    const impossible = makeLens(scene, { d: 200, f: 20, halfAperture: 50 });
    expect(impossible.error).toBeTruthy();
  });

  test('places the focal points at the focal distances from the vertices', () => {
    const lens = makeLens(scene, { d: 20, f: 150 });
    const { ffd, bfd } = lens.getDFfdBfd();
    const points = lens.getFocalPoints();
    expect(points).toHaveLength(2);
    // The axis runs along x, so the focal points sit on it either side of the lens.
    expect(points[0].y).toBeCloseTo(400, 6);
    expect(points[1].y).toBeCloseTo(400, 6);
    expect(points[0].x - lens.path[2].x).toBeCloseTo(bfd, 6);
    expect(lens.path[5].x - points[1].x).toBeCloseTo(ffd, 6);
  });

  test('offers the focal points as handles named focalLength', () => {
    const lens = makeLens(scene, { f: 150 });
    const handles = lens.getInteractionHandles().filter(h => h.propertyKey === 'focalLength');
    expect(handles).toHaveLength(2);
  });

  test('does not offer focal handles when the lens is defined by its radii', () => {
    const lens = makeLens(scene, { f: 150 });
    lens.defBy = 'DR1R2';
    expect(lens.getInteractionHandles().some(h => h.propertyKey === 'focalLength')).toBe(false);
  });

  test('dragging a focal point sets the focal length', () => {
    const lens = makeLens(scene, { d: 20, f: 150 });
    const before = lens.getFocalPoints()[0];
    const { bfd } = lens.getDFfdBfd();

    const dragContext = lens.checkMouseOver(new Mouse(before, scene, false, 2));
    expect(dragContext.propertyKey).toBe('focalLength');
    lens.onDrag(new Mouse({ x: before.x + 60, y: before.y }, scene, false, 2), dragContext, false, false);

    // The handle sits a focal distance from the vertex, so moving it 60 further out lengthens the
    // focal distance by about that much, and the focal length follows through the same relation.
    expect(lens.getDFfdBfd().bfd).toBeCloseTo(bfd + 60, 0);
    expect(lens.getFocalLength()).toBeGreaterThan(150);
  });

  test('dragging the other focal point works the same way', () => {
    const lens = makeLens(scene, { d: 20, f: 150 });
    const before = lens.getFocalPoints()[1];
    const { ffd } = lens.getDFfdBfd();

    const dragContext = lens.checkMouseOver(new Mouse(before, scene, false, 2));
    lens.onDrag(new Mouse({ x: before.x - 60, y: before.y }, scene, false, 2), dragContext, false, false);

    expect(lens.getDFfdBfd().ffd).toBeCloseTo(ffd + 60, 0);
  });

  test('the endpoints are still draggable through the inherited behaviour', () => {
    const lens = makeLens(scene, { d: 20, f: 150 });
    const dragContext = lens.checkMouseOver(new Mouse({ x: lens.path[0].x, y: lens.path[0].y }, scene, false, 2));
    expect(dragContext.propertyKey).toBeUndefined();
  });

  test('setting focalLength rebuilds the lens at the same thickness', () => {
    const lens = makeLens(scene, { d: 20, f: 150 });
    lens.focalLength = 250;
    expect(lens.getFocalLength()).toBeCloseTo(250, 6);
    expect(lens.getDF().d).toBeCloseTo(20, 6);
  });

  test('survives dragging the focal point through the lens', () => {
    const lens = makeLens(scene, { d: 20, f: -150, halfAperture: 40 });
    expect(lens.error).toBeNull();
    const start = lens.getFocalPoints()[0];
    const dragContext = lens.checkMouseOver(new Mouse(start, scene, false, 2));
    const vertexX = lens.path[2].x;

    // Walk the handle across the lens, through the region where no lens of this aperture exists.
    const seen = [];
    for (const x of [vertexX + 120, vertexX + 40, vertexX, vertexX - 40, vertexX - 200]) {
      lens.onDrag(new Mouse({ x, y: start.y }, scene, false, 2), dragContext, false, false);
      // The lens must never be left in a state that cannot be drawn or grabbed again.
      expect(lens.path).not.toBeNull();
      expect(lens.getDefaultCenter()).not.toBeNull();
      expect(lens.getFocalPoints()).toHaveLength(2);
      seen.push(lens.getFocalLength());
    }

    // It should have flipped from diverging to converging and back.
    expect(Math.max(...seen)).toBeGreaterThan(0);
    expect(Math.min(...seen)).toBeLessThan(0);
  });

  test('has a usable centre even while its parameters do not build', () => {
    const impossible = makeLens(scene, { d: 200, f: 20, halfAperture: 50 });
    expect(impossible.path).toBeNull();
    expect(impossible.getDefaultCenter()).not.toBeNull();
  });

  test('round-trips through serialization', () => {
    const lens = makeLens(scene, { d: 20, f: 150 });
    const json = lens.serialize();
    expect(json.defBy).toBe('DF');
    const restored = new SphericalLens(scene, json);
    expect(restored.getFocalLength()).toBeCloseTo(150, 6);
  });
});
