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

import {
  resolveInteraction,
  objAllows,
  objAllowsProperty,
  sceneAllows,
  getDragPropertyKey,
  validateInteraction,
} from '../../src/core/interaction.js';

/**
 * A stand-in for a scene object, which only needs a scene reference, its own overrides and the
 * point properties the drag-to-property mapping looks at.
 */
function makeObj(sceneInteraction, objInteraction, props = {}) {
  return {
    scene: { interaction: sceneInteraction },
    interaction: objInteraction,
    constructor: { serializableDefaults: { p1: null, p2: null, focalLength: 100 } },
    ...props,
  };
}

describe('validateInteraction', () => {
  test('accepts a partial object', () => {
    expect(validateInteraction({ reshape: false, properties: { p2: true } }, false)).toBeNull();
  });

  test('rejects unknown keys', () => {
    expect(validateInteraction({ resahpe: false }, false)).toMatch(/unknown interaction key/);
  });

  test('rejects scene-only keys at the object level', () => {
    expect(validateInteraction({ pan: false }, false)).toMatch(/unknown interaction key/);
    expect(validateInteraction({ pan: false }, true)).toBeNull();
  });

  test('rejects non-boolean values', () => {
    expect(validateInteraction({ move: 'no' }, false)).toMatch(/must be a boolean/);
    expect(validateInteraction({ properties: { p1: 1 } }, false)).toMatch(/must be a boolean/);
  });
});

describe('resolveInteraction', () => {
  test('defaults to allowing everything', () => {
    const resolved = resolveInteraction(null, null);
    expect(resolved).toMatchObject({ enabled: true, select: true, move: true, reshape: true, edit: true, remove: true });
  });

  test('the scene freezes everything it does not mention', () => {
    const resolved = resolveInteraction({ enabled: false }, null);
    expect(resolved.move).toBe(false);
    expect(resolved.reshape).toBe(false);
    expect(resolved.edit).toBe(false);
  });

  test('an object category beats the scene wildcard', () => {
    const resolved = resolveInteraction({ enabled: false }, { reshape: true });
    expect(resolved.reshape).toBe(true);
    expect(resolved.move).toBe(false);
  });

  test('an object is selectable when it allows anything else', () => {
    expect(resolveInteraction({ enabled: false }, { reshape: true }).select).toBe(true);
    expect(resolveInteraction({ enabled: false }, null).select).toBe(false);
  });

  test('one open property is enough to make an object selectable', () => {
    const resolved = resolveInteraction({ enabled: false }, { edit: false, properties: { focalLength: true } });
    expect(resolved.edit).toBe(false);
    expect(resolved.select).toBe(true);
  });

  test('a property pinned shut does not make an object selectable', () => {
    expect(resolveInteraction({ enabled: false }, { properties: { focalLength: false } }).select).toBe(false);
  });

  test('an explicit select is respected even when other things are allowed', () => {
    expect(resolveInteraction({ select: false }, { reshape: true }).select).toBe(false);
  });
});

describe('objAllowsProperty', () => {
  test('a property override opens one control on a frozen scene', () => {
    const obj = makeObj({ enabled: false }, { properties: { focalLength: true } });
    expect(objAllowsProperty(obj, 'edit', 'focalLength')).toBe(true);
    expect(objAllowsProperty(obj, 'edit', 'brightness')).toBe(false);
  });

  test('a property override pins one control on an open scene', () => {
    const obj = makeObj(null, { properties: { focalLength: false } });
    expect(objAllowsProperty(obj, 'edit', 'focalLength')).toBe(false);
    expect(objAllowsProperty(obj, 'edit', 'brightness')).toBe(true);
  });

  test('only one endpoint can be made draggable', () => {
    const obj = makeObj({ reshape: false }, { properties: { p2: true } });
    expect(objAllowsProperty(obj, 'reshape', 'p1')).toBe(false);
    expect(objAllowsProperty(obj, 'reshape', 'p2')).toBe(true);
  });

  test('the object level wins over the scene level for the same property', () => {
    const obj = makeObj({ properties: { p1: false } }, { properties: { p1: true } });
    expect(objAllowsProperty(obj, 'reshape', 'p1')).toBe(true);
  });

  test('a null property falls back to the category', () => {
    const obj = makeObj({ enabled: false }, { move: true });
    expect(objAllowsProperty(obj, 'move', null)).toBe(true);
    expect(objAllows(obj, 'reshape')).toBe(false);
  });
});

describe('moveX and moveY', () => {
  test('default to following move', () => {
    const free = makeObj(null, null);
    expect(objAllows(free, 'moveX')).toBe(true);
    expect(objAllows(free, 'moveY')).toBe(true);

    const still = makeObj(null, { move: false });
    expect(objAllows(still, 'moveX')).toBe(false);
    expect(objAllows(still, 'moveY')).toBe(false);
  });

  test('confine an object to one axis', () => {
    const onAxis = makeObj({ enabled: false }, { move: true, moveY: false });
    expect(objAllows(onAxis, 'move')).toBe(true);
    expect(objAllows(onAxis, 'moveX')).toBe(true);
    expect(objAllows(onAxis, 'moveY')).toBe(false);
  });

  test('an object axis beats the scene move setting', () => {
    const obj = makeObj({ move: true, moveY: true }, { moveY: false });
    expect(objAllows(obj, 'moveY')).toBe(false);
  });

  test('a scene axis applies to objects that do not mention it', () => {
    const obj = makeObj({ moveY: false }, { move: true });
    expect(objAllows(obj, 'moveY')).toBe(true);
    expect(objAllows(makeObj({ moveY: false }, null), 'moveY')).toBe(false);
  });
});

describe('sceneAllows', () => {
  test('defaults to allowing everything', () => {
    expect(sceneAllows({}, 'pan')).toBe(true);
    expect(sceneAllows({ interaction: {} }, 'zoom')).toBe(true);
  });

  test('follows the enabled wildcard and explicit keys', () => {
    expect(sceneAllows({ interaction: { enabled: false } }, 'pan')).toBe(false);
    expect(sceneAllows({ interaction: { enabled: false, pan: true } }, 'pan')).toBe(true);
  });
});

describe('design mode', () => {
  test('lets the designer reach everything the scene forbids', () => {
    const frozen = makeObj({ enabled: false }, { enabled: false });
    expect(objAllows(frozen, 'move')).toBe(false);
    expect(objAllowsProperty(frozen, 'edit', 'focalLength')).toBe(false);
    expect(sceneAllows(frozen.scene, 'create')).toBe(false);

    frozen.scene.designMode = true;
    expect(objAllows(frozen, 'move')).toBe(true);
    expect(objAllows(frozen, 'moveY')).toBe(true);
    expect(objAllowsProperty(frozen, 'edit', 'focalLength')).toBe(true);
    expect(sceneAllows(frozen.scene, 'create')).toBe(true);
  });

  test('leaves the settings themselves untouched, so they are still saved', () => {
    const obj = makeObj({ enabled: false }, { move: false });
    obj.scene.designMode = true;
    expect(obj.scene.interaction).toEqual({ enabled: false });
    expect(obj.interaction).toEqual({ move: false });
    expect(resolveInteraction(obj.scene.interaction, obj.interaction).move).toBe(false);
  });
});

describe('getDragPropertyKey', () => {
  const obj = makeObj(null, null, { p1: { x: 10, y: 20 }, p2: { x: 30, y: 40 } });

  test('maps the whole object to no property', () => {
    expect(getDragPropertyKey(obj, { part: 0 })).toBeNull();
  });

  test('maps a dragged point to its named property', () => {
    expect(getDragPropertyKey(obj, { part: 1, targetPoint: { x: 10, y: 20 } })).toBe('p1');
    expect(getDragPropertyKey(obj, { part: 2, targetPoint: { x: 30, y: 40 } })).toBe('p2');
  });

  test('falls back to the part index for an unnamed point', () => {
    expect(getDragPropertyKey(obj, { part: 3, targetPoint: { x: 99, y: 99 } })).toBe('part3');
  });

  test('honours a property name the object states itself', () => {
    const context = { part: 3, targetPoint_: { x: 99, y: 99 }, propertyKey: 'focalLength' };
    expect(getDragPropertyKey(obj, context)).toBe('focalLength');
  });

  test('a handle that changes a scalar obeys the permission of that property', () => {
    const pinned = makeObj({ enabled: false }, { move: true }, { p1: { x: 0, y: 0 } });
    const live = makeObj({ enabled: false }, { move: true, properties: { focalLength: true } });
    expect(objAllowsProperty(pinned, 'reshape', 'focalLength')).toBe(false);
    expect(objAllowsProperty(live, 'reshape', 'focalLength')).toBe(true);
  });
});
