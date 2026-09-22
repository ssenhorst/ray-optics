/*
 * Copyright 2025 The Wave Optics Simulation authors and contributors
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
 * @file `src/core/interaction.js` implements the fine-grained interaction permission system.
 *
 * Permissions are declared at two levels:
 *
 * - Scene level, via the `interaction` property of the scene JSON.
 * - Object level, via the `interaction` property of an individual object in `objs`.
 *
 * A setting is looked up along this chain, most specific first:
 *
 * 1. the object's `properties[<name>]`,
 * 2. the object's own category key,
 * 3. the object's `enabled`,
 * 4. the scene's `properties[<name>]`,
 * 5. the scene's category key,
 * 6. the scene's `enabled`,
 * 7. the default, which is to allow everything.
 *
 * `enabled` is therefore a wildcard standing for every key its level does not mention, not a gate
 * that overrules more specific settings. That is what makes the common authoring pattern work:
 * freeze the whole scene with `"interaction": {"enabled": false}`, then give the two or three objects
 * the student is meant to manipulate an `"interaction"` of their own that opens up exactly what they
 * may change.
 *
 * The categories are:
 *
 * | Key         | Level        | Meaning                                                            |
 * |-------------|--------------|--------------------------------------------------------------------|
 * | `enabled`   | scene+object | Master switch. When false, none of the other categories apply.      |
 * | `select`    | scene+object | Whether the object can be selected/highlighted.                     |
 * | `move`      | scene+object | Whether the object can be dragged as a whole.                       |
 * | `moveX`     | scene+object | Whether that movement may change the x coordinate.                  |
 * | `moveY`     | scene+object | Whether that movement may change the y coordinate.                  |
 * | `reshape`   | scene+object | Whether the defining points (endpoints, vertices, ...) can be dragged. |
 * | `edit`      | scene+object | Whether numeric/boolean properties can be edited in the UI.         |
 * | `remove`    | scene+object | Whether the object can be deleted.                                  |
 * | `properties`| scene+object | Per-property overrides, see below.                                  |
 * | `create`    | scene        | Whether new objects can be added.                                   |
 * | `pan`       | scene        | Whether the view can be panned.                                     |
 * | `zoom`      | scene        | Whether the view can be zoomed.                                     |
 * | `keyboard`  | scene        | Whether keyboard editing shortcuts are active.                      |
 *
 * `properties` is a map from a property name to a boolean, and gives the finest level of control.
 * The name is either a serialized property of the object (`'focalLength'`, `'p1'`, `'brightness'`, ...)
 * or, for a draggable part that does not correspond to a named point, `'part<n>'` where `<n>` is the
 * part index reported by `checkMouseOver`. So `{"reshape": false, "properties": {"p2": true}}` means
 * "only the second endpoint may be dragged".
 *
 * A scene opened in a task designer sets `scene.designMode`, and then nothing here is enforced: the
 * settings are still read, written and saved, but the designer can reach everything.
 *
 * `select` is special: when no level states it, an object is selectable if it allows anything else,
 * since selecting is how the user reaches an object's controls.
 *
 * `moveX` and `moveY` refine `move` rather than replacing it: an object that may be moved but has
 * `"moveY": false` slides along one axis only, which is how an element is confined to an optical
 * axis. Each falls back to `move` at the same level before the chain continues to the scene.
 */

/**
 * The interaction categories that exist at both the scene and the object level.
 * @const {Object<string, boolean>}
 */
export const OBJECT_INTERACTION_DEFAULTS = {
  enabled: true,
  select: true,
  move: true,
  moveX: true,
  moveY: true,
  reshape: true,
  edit: true,
  remove: true,
};

/**
 * The keys tried at each level for a category, most specific first. A category not listed here falls
 * back only to the `enabled` wildcard.
 * @const {Object<string, Array<string>>}
 */
const CATEGORY_FALLBACKS = {
  moveX: ['moveX', 'move', 'enabled'],
  moveY: ['moveY', 'move', 'enabled'],
};

/**
 * The interaction categories that only exist at the scene level.
 * @const {Object<string, boolean>}
 */
export const SCENE_ONLY_INTERACTION_DEFAULTS = {
  create: true,
  pan: true,
  zoom: true,
  keyboard: true,
};

/**
 * The full set of defaults for the scene-level `interaction` property.
 * @const {Object}
 */
export const SCENE_INTERACTION_DEFAULTS = {
  ...OBJECT_INTERACTION_DEFAULTS,
  ...SCENE_ONLY_INTERACTION_DEFAULTS,
  properties: {},
};

const OBJECT_INTERACTION_KEYS = Object.keys(OBJECT_INTERACTION_DEFAULTS);
const SCENE_INTERACTION_KEYS = [...Object.keys(SCENE_INTERACTION_DEFAULTS), 'properties'];

/**
 * Validate a raw `interaction` object coming from JSON.
 * @param {Object} raw - The raw value.
 * @param {boolean} isScene - Whether this is the scene-level interaction object.
 * @returns {string|null} An error message, or null if the value is valid.
 */
export function validateInteraction(raw, isScene) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return 'interaction must be an object';
  }
  const allowedKeys = isScene ? SCENE_INTERACTION_KEYS : [...OBJECT_INTERACTION_KEYS, 'properties'];
  for (const key in raw) {
    if (!allowedKeys.includes(key)) {
      return `unknown interaction key '${key}'`;
    }
    if (key === 'properties') {
      const props = raw[key];
      if (typeof props !== 'object' || props === null || Array.isArray(props)) {
        return 'interaction.properties must be an object';
      }
      for (const propKey in props) {
        if (typeof props[propKey] !== 'boolean') {
          return `interaction.properties.${propKey} must be a boolean`;
        }
      }
    } else if (typeof raw[key] !== 'boolean') {
      return `interaction.${key} must be a boolean`;
    }
  }
  return null;
}

/**
 * Look a key up along the precedence chain: an explicit setting on the object wins over `enabled` on
 * the object, which wins over an explicit setting on the scene, which wins over `enabled` on the
 * scene. `enabled` is therefore a wildcard default for everything the level does not mention, which
 * is what makes "freeze the scene, then re-enable these few things" work.
 * @param {Object|null} sceneInteraction - The scene-level settings.
 * @param {Object|null} objInteraction - The object-level settings.
 * @param {string} category - The category to look up.
 * @param {string|null} [propertyKey] - A property name, which takes precedence over the category at
 * the same level.
 * @returns {boolean|undefined} The setting, or undefined if no level mentions it.
 */
function lookup(sceneInteraction, objInteraction, category, propertyKey) {
  const keys = CATEGORY_FALLBACKS[category] || [category, 'enabled'];
  for (const level of [objInteraction, sceneInteraction]) {
    if (!level) continue;
    if (propertyKey != null && typeof level.properties?.[propertyKey] === 'boolean') {
      return level.properties[propertyKey];
    }
    for (const key of keys) {
      if (typeof level[key] === 'boolean') return level[key];
    }
  }
  return undefined;
}

/**
 * Resolve the effective interaction settings of an object against those of its scene.
 * @param {Object|null} sceneInteraction - The scene-level `interaction` object (raw, possibly partial).
 * @param {Object|null} objInteraction - The object-level `interaction` object (raw, possibly partial).
 * @returns {Object} The resolved settings, with every category key present as a boolean.
 */
export function resolveInteraction(sceneInteraction, objInteraction) {
  const resolved = {};
  for (const key of OBJECT_INTERACTION_KEYS) {
    resolved[key] = lookup(sceneInteraction, objInteraction, key) ?? OBJECT_INTERACTION_DEFAULTS[key];
  }

  resolved.properties = {
    ...(sceneInteraction?.properties || {}),
    ...(objInteraction?.properties || {}),
  };

  // Selecting an object is a precondition for inspecting and editing it, so unless the scene says
  // otherwise it follows from whatever else the object allows. Without this, freezing a scene and
  // then re-enabling one thing would leave that one thing unreachable — including when the thing is
  // a single property, which is the usual way to expose one control and nothing else.
  const selectStated = [objInteraction, sceneInteraction].some(
    level => level && typeof level.select === 'boolean'
  );
  if (!selectStated) {
    const anyProperty = Object.values(resolved.properties).some(value => value === true);
    resolved.select = resolved.select || anyProperty
      || resolved.move || resolved.reshape || resolved.edit || resolved.remove;
  }

  return resolved;
}

/**
 * Whether a whole category is allowed for an object.
 * @param {BaseSceneObj} obj - The object.
 * @param {'select'|'move'|'reshape'|'edit'|'remove'} category - The category.
 * @returns {boolean}
 */
export function objAllows(obj, category) {
  if (!obj) return false;
  if (obj.scene?.designMode) return true;
  return resolveInteraction(obj.scene?.interaction, obj.interaction)[category];
}

/**
 * Whether a specific named property of an object may be changed by the user. A property setting
 * overrides its category at the same level, so a frozen object can still expose one live control and
 * a fully interactive one can have a single property pinned.
 * @param {BaseSceneObj} obj - The object.
 * @param {'move'|'reshape'|'edit'} category - The category the property belongs to.
 * @param {string|null} propertyKey - The property name, or null if the action has no named property.
 * @returns {boolean}
 */
export function objAllowsProperty(obj, category, propertyKey) {
  if (!obj) return false;
  if (obj.scene?.designMode) return true;
  if (propertyKey == null) return objAllows(obj, category);
  const value = lookup(obj.scene?.interaction, obj.interaction, category, propertyKey);
  return value ?? OBJECT_INTERACTION_DEFAULTS[category];
}

/**
 * Whether a scene-level-only capability is allowed.
 * @param {Scene} scene - The scene.
 * @param {'create'|'pan'|'zoom'|'keyboard'} category - The capability.
 * @returns {boolean}
 */
export function sceneAllows(scene, category) {
  if (scene?.designMode) return true;
  const raw = scene?.interaction;
  if (!raw) return SCENE_INTERACTION_DEFAULTS[category];
  if (typeof raw[category] === 'boolean') return raw[category];
  if (typeof raw.enabled === 'boolean') return raw.enabled;
  return SCENE_INTERACTION_DEFAULTS[category];
}

/**
 * Find the name of the property that a drag would modify, so that per-property permissions can be
 * applied to canvas dragging as well as to the property controls.
 *
 * Objects report the part being dragged as `dragContext.part` (0 for the whole object) together with
 * the point being dragged. Rather than requiring every object type to declare a mapping, the point is
 * matched against the object's own point-valued properties, which covers the `p1`/`p2`/`p3`
 * convention used throughout `sceneObjs` without any per-type code.
 * @param {BaseSceneObj} obj - The object being dragged.
 * @param {DragContext} dragContext - The drag context reported by `checkMouseOver`.
 * @returns {string|null} The property name, or null when the whole object is being dragged.
 */
export function getDragPropertyKey(obj, dragContext) {
  if (!dragContext || !dragContext.part) return null;

  // An object may name the property itself, which is how handles that change a scalar rather than a
  // point (such as the focal length markers of an ideal lens) are governed by the same permission as
  // the property control of the same name.
  if (typeof dragContext.propertyKey === 'string') return dragContext.propertyKey;

  const target = dragContext.targetPoint || dragContext.targetPoint_;
  const part = dragContext.part;

  if (target) {
    const isSamePoint = (p) => p && typeof p.x === 'number' && typeof p.y === 'number'
      && Math.abs(p.x - target.x) < 1e-9 && Math.abs(p.y - target.y) < 1e-9;

    // The overwhelmingly common convention: part n is the point property `p<n>`.
    if (isSamePoint(obj['p' + part])) return 'p' + part;

    for (const key of Object.keys(obj.constructor.serializableDefaults || {})) {
      if (isSamePoint(obj[key])) return key;
    }
  }

  return 'part' + part;
}
