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

/**
 * Editing interfaces on the canvas.
 *
 * Hit testing is the one part of a scene object that has no visible effect
 * until someone tries to click it, so it is worth exercising directly rather
 * than leaving to be discovered in the browser.
 */

import Scene from '../../src/core/Scene.js';
import Mouse from '../../src/core/Mouse.js';
import WaveInterface from '../../src/core/sceneObjs/wave/WaveInterface.js';
import WaveZonePlate from '../../src/core/sceneObjs/wave/WaveZonePlate.js';
import geometry from '../../src/core/geometry.js';

function makeScene() {
  const scene = new Scene();
  scene.waveOptics.wavelength = 20;
  scene.setViewportSize(1500, 900);
  return scene;
}

function addInterface(scene, Type = WaveInterface, extra = {}) {
  const surface = new Type(scene);
  surface.p1 = { x: 400, y: 200 };
  surface.p2 = { x: 400, y: 700 };
  Object.assign(surface, extra);
  scene.objs.push(surface);
  return surface;
}

/**
 * A mouse positioned at a scene coordinate.
 *
 * The last argument is `overrideGrid`, not a scale: passing 1 would invert the
 * scene's snap-to-grid setting and quietly round every coordinate here.
 */
const mouseAt = (scene, x, y) =>
  new Mouse(geometry.point(x, y), scene, false, 0);

describe('grabbing an interface', () => {
  test('its endpoints are draggable handles', () => {
    const scene = makeScene();
    const surface = addInterface(scene);

    expect(surface.checkMouseOver(mouseAt(scene, 400, 200))).toMatchObject({ part: 1 });
    expect(surface.checkMouseOver(mouseAt(scene, 400, 700))).toMatchObject({ part: 2 });
  });

  test('dragging an endpoint moves only that end', () => {
    const scene = makeScene();
    const surface = addInterface(scene);

    const dragContext = surface.checkMouseOver(mouseAt(scene, 400, 200));
    dragContext.originalObj = { p1: { ...surface.p1 }, p2: { ...surface.p2 } };
    surface.onDrag(mouseAt(scene, 430, 120), dragContext, false, false);

    expect(surface.p1).toEqual({ x: 430, y: 120 });
    expect(surface.p2).toEqual({ x: 400, y: 700 });
  });

  test('the body can be grabbed along the curve, not just the chord', () => {
    const scene = makeScene();
    // A surface bowed well away from the straight line between its endpoints.
    const surface = addInterface(scene, WaveInterface, { eqnSag: '-0.002\\cdot y^2' });

    // The sag is a function of the position measured from the centre, so the
    // vertex stays on the chord at y = 450 and the curve bows away towards the
    // ends: at y = 600 it has moved 45 units off the chord.
    expect(surface.zAt(450)).toBeCloseTo(400, 6);
    expect(surface.zAt(600)).toBeCloseTo(400 - 0.002 * 150 * 150, 6);

    expect(surface.checkMouseOver(mouseAt(scene, 355, 600))).toMatchObject({ part: 0 });
    // The chord itself is no longer where the interface is, so it is not a hit.
    expect(surface.checkMouseOver(mouseAt(scene, 400, 600))).toBeUndefined();
  });

  test('the patterned types are grabbable in the same way', () => {
    const scene = makeScene();
    const plate = addInterface(scene, WaveZonePlate, { focalLength: 500 });
    expect(plate.checkMouseOver(mouseAt(scene, 400, 200))).toMatchObject({ part: 1 });
    expect(plate.checkMouseOver(mouseAt(scene, 400, 450))).toMatchObject({ part: 0 });
  });

  test('a degenerate interface falls back to the straight-line behaviour', () => {
    const scene = makeScene();
    const surface = addInterface(scene, WaveInterface, { p2: { x: 400, y: 200 } });
    expect(surface.isValid()).toBe(false);
    // No throw, and still grabbable at its point.
    expect(() => surface.checkMouseOver(mouseAt(scene, 400, 200))).not.toThrow();
  });
});
