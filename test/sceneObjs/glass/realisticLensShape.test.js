/*
 * Copyright 2026 The Ray Optics Simulation authors and contributors
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

import { getShapeRadii, getLensShape } from '../../../src/core/sceneObjs/realisticLensShape';
import IdealLens from '../../../src/core/sceneObjs/glass/IdealLens';
import Scene from '../../../src/core/Scene';

/** A lens standing upright, so the optical axis runs along x and "front" is the -x side. */
function upright(focalLength, halfAperture = 60) {
  return { p1: { x: 500, y: 400 - halfAperture }, p2: { x: 500, y: 400 + halfAperture }, focalLength };
}

describe('getShapeRadii', () => {
  test('splits the power evenly when both surfaces are curved', () => {
    const { r1, r2 } = getShapeRadii(100, 1.5, 'both');
    expect(r1).toBeCloseTo(100, 6);
    expect(r2).toBeCloseTo(-100, 6);
  });

  test('puts all the power on the curved surface of a plano lens', () => {
    expect(getShapeRadii(100, 1.5, 'front')).toEqual({ r1: 50, r2: Infinity });
    expect(getShapeRadii(100, 1.5, 'back')).toEqual({ r1: Infinity, r2: -50 });
  });

  test('a higher refractive index needs less curvature', () => {
    expect(Math.abs(getShapeRadii(100, 2.0, 'both').r1))
      .toBeGreaterThan(Math.abs(getShapeRadii(100, 1.5, 'both').r1));
  });

  test('a negative focal length flips the curvature', () => {
    expect(getShapeRadii(-100, 1.5, 'both').r1).toBeLessThan(0);
  });
});

describe('getLensShape', () => {
  test('a converging lens is thick in the middle and thin at the rim', () => {
    const shape = getLensShape(upright(200), 1.5, 'both', 1);
    const rimThickness = Math.abs(shape.backRim2.x - shape.frontRim.x);
    const centreThickness = Math.abs(shape.backVertex.x - shape.frontVertex.x);
    expect(centreThickness).toBeGreaterThan(rimThickness);
  });

  test('a diverging lens is thin in the middle and thick at the rim', () => {
    const shape = getLensShape(upright(-200), 1.5, 'both', 1);
    const rimThickness = Math.abs(shape.backRim2.x - shape.frontRim.x);
    const centreThickness = Math.abs(shape.backVertex.x - shape.frontVertex.x);
    expect(centreThickness).toBeLessThan(rimThickness);
  });

  test('a plano lens has one surface flat', () => {
    const shape = getLensShape(upright(200), 1.5, 'front', 1);
    // The flat surface's vertex lies on the line joining its rim points.
    expect(shape.backVertex.x).toBeCloseTo(shape.backRim.x, 6);
    expect(shape.frontVertex.x).not.toBeCloseTo(shape.frontRim.x, 3);
  });

  test('a shorter focal length gives a fatter lens', () => {
    const depth = f => Math.abs(getLensShape(upright(f), 1.5, 'both', 1).frontVertex.x - 500);
    expect(depth(100)).toBeGreaterThan(depth(400));
  });

  test('stays drawable when the focal length is far too short for the aperture', () => {
    const shape = getLensShape(upright(1, 200), 1.5, 'both', 1);
    for (const point of Object.values(shape)) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  test('has no shape for a degenerate lens', () => {
    expect(getLensShape(upright(0), 1.5, 'both', 1)).toBeNull();
    expect(getLensShape({ p1: { x: 1, y: 1 }, p2: { x: 1, y: 1 }, focalLength: 100 }, 1.5, 'both', 1)).toBeNull();
  });

  test('follows the orientation of the lens', () => {
    const tilted = getLensShape(
      { p1: { x: 0, y: 0 }, p2: { x: 100, y: 100 }, focalLength: 200 }, 1.5, 'both', 1);
    // The surfaces bulge along the normal, which for this lens is the (1, -1) direction.
    const along = (tilted.backVertex.x - tilted.frontVertex.x) - -(tilted.backVertex.y - tilted.frontVertex.y);
    expect(Math.abs(along)).toBeLessThan(1e-9);
  });
});

describe('IdealLens appearance', () => {
  let scene;

  beforeEach(() => {
    scene = new Scene();
    scene.editor = { selectedObjIndex: -1 };
  });

  test('defaults to the basic appearance and does not serialize it', () => {
    const lens = new IdealLens(scene, { p1: { x: 500, y: 340 }, p2: { x: 500, y: 460 }, focalLength: 200 });
    expect(lens.appearance).toBe('basic');
    expect(lens.serialize().appearance).toBeUndefined();
  });

  test('keeps the realistic settings through serialization', () => {
    const lens = new IdealLens(scene, {
      p1: { x: 500, y: 340 }, p2: { x: 500, y: 460 }, focalLength: 200,
      appearance: 'realistic', curvedSurfaces: 'front', refIndex: 1.8,
    });
    const json = lens.serialize();
    expect(json).toMatchObject({ appearance: 'realistic', curvedSurfaces: 'front', refIndex: 1.8 });
  });

  test('the appearance does not change the optics', () => {
    const basic = new IdealLens(scene, { p1: { x: 500, y: 340 }, p2: { x: 500, y: 460 }, focalLength: 200 });
    const realistic = new IdealLens(scene, {
      p1: { x: 500, y: 340 }, p2: { x: 500, y: 460 }, focalLength: 200, appearance: 'realistic',
    });
    expect(realistic.getPrimitives()).toEqual(basic.getPrimitives());
    expect(realistic.getFocalPoints()).toEqual(basic.getFocalPoints());
  });
});
