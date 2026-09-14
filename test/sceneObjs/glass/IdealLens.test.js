/*
 * Copyright 2024 The Ray Optics Simulation authors and contributors
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

import IdealLens from '../../../src/core/sceneObjs/glass/IdealLens';
import Scene from '../../../src/core/Scene';
import { testLineObj } from '../helpers/lineObjTests';
import { MockUser } from '../helpers/test-utils';

describe('IdealLens', () => {
  let scene;
  let obj;
  let user;

  beforeEach(() => {
    scene = new Scene();
    obj = new IdealLens(scene);
    user = new MockUser(obj);
  });

  testLineObj(() => ({ obj, user }));

  it('rotates 90 degrees around default center (midpoint)', () => {
    user.click(100, 100);
    user.click(200, 300);
    user.set("{{simulator:sceneObjs.common.focalLength}}", 50);

    user.rotate(Math.PI / 2); // 90 degrees counter-clockwise
    const result = obj.serialize();
    expect(result.p1.x).toBeCloseTo(250, 5);
    expect(result.p1.y).toBeCloseTo(150, 5);
    expect(result.p2.x).toBeCloseTo(50, 5);
    expect(result.p2.y).toBeCloseTo(250, 5);
    expect(result.focalLength).toBeCloseTo(50, 5); // focalLength unchanged by rotation
    expect(result.type).toBe('IdealLens');
  });

  it('scales to 50% around default center (midpoint)', () => {
    user.click(100, 100);
    user.click(200, 300);
    user.set("{{simulator:sceneObjs.common.focalLength}}", 50);

    user.scale(0.5); // Scale to 50%
    const result = obj.serialize();
    expect(result.p1.x).toBeCloseTo(125, 5);
    expect(result.p1.y).toBeCloseTo(150, 5);
    expect(result.p2.x).toBeCloseTo(175, 5);
    expect(result.p2.y).toBeCloseTo(250, 5);
    expect(result.focalLength).toBeCloseTo(25, 5); // focalLength scaled by 0.5
    expect(result.type).toBe('IdealLens');
  });

  describe('focal length handles', () => {
    /** The unit normal of a lens from (100, 100) to (200, 300). */
    const normal = { x: 200 / Math.sqrt(50000), y: -100 / Math.sqrt(50000) };
    const mid = { x: 150, y: 200 };

    beforeEach(() => {
      user.click(100, 100);
      user.click(200, 300);
      user.set("{{simulator:sceneObjs.common.focalLength}}", 50);
    });

    it('reports the focal points as control points either side of the centre', () => {
      const points = obj.getFocalPoints();
      expect(points).toHaveLength(2);
      expect(points[0].x).toBeCloseTo(mid.x + 50 * normal.x, 6);
      expect(points[0].y).toBeCloseTo(mid.y + 50 * normal.y, 6);
      expect(points[1].x).toBeCloseTo(mid.x - 50 * normal.x, 6);
      expect(points[1].y).toBeCloseTo(mid.y - 50 * normal.y, 6);
    });

    it('offers the focal points as handles named after the property they change', () => {
      const handles = obj.getInteractionHandles();
      const focal = handles.filter(h => h.propertyKey === 'focalLength');
      expect(focal).toHaveLength(2);
      expect(handles.some(h => h.propertyKey === 'p1')).toBe(true);
    });

    it('sets the focal length by dragging a focal point', () => {
      const from = obj.getFocalPoints()[0];
      user.drag(from.x, from.y, mid.x + 100 * normal.x, mid.y + 100 * normal.y);
      expect(obj.focalLength).toBeCloseTo(100, 6);
    });

    it('sets the same focal length from the handle on the other side', () => {
      const from = obj.getFocalPoints()[1];
      user.drag(from.x, from.y, mid.x - 120 * normal.x, mid.y - 120 * normal.y);
      expect(obj.focalLength).toBeCloseTo(120, 6);
    });

    it('measures only the distance along the normal, ignoring sideways movement', () => {
      const from = obj.getFocalPoints()[0];
      const along = { x: 100 / Math.sqrt(50000), y: 200 / Math.sqrt(50000) };
      user.drag(
        from.x, from.y,
        mid.x + 80 * normal.x + 60 * along.x,
        mid.y + 80 * normal.y + 60 * along.y
      );
      expect(obj.focalLength).toBeCloseTo(80, 6);
    });

    it('still drags the endpoints', () => {
      user.drag(100, 100, 120, 140);
      expect(obj.p1).toEqual({ x: 120, y: 140 });
      expect(obj.focalLength).toBeCloseTo(50, 6);
    });
  });

  it('sets properties', () => {
    user.click(100, 100);
    user.click(200, 300);
    user.set("{{simulator:sceneObjs.common.focalLength}}", 50);

    expect(obj.serialize()).toEqual({
      type: "IdealLens",
      p1: { x: 100, y: 100 },
      p2: { x: 200, y: 300 },
      focalLength: 50
    });
  });
}); 