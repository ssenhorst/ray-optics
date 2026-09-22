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

/**
 * @file `src/widget/sceneSource.js` turns whatever an embedder hands the widget into scene JSON.
 *
 * Besides a scene object or a JSON string, that may be a *shared link*: the URL the simulator's
 * "copy link" button and its "auto sync URL" setting produce, whose hash is the whole scene
 * compressed with LZMA. Accepting it means a scene can be moved from the simulator into a widget
 * by pasting the address bar, with no file and no export step in between.
 *
 * Both spellings of the link are accepted, the full URL and the bare hash, since which of the two
 * is at hand depends on whether the link was copied from the button or from the address bar.
 */

/**
 * Whether a value is a plain object worth merging into rather than replacing.
 * @param {*} value - The value.
 * @returns {boolean} Whether it is a plain object.
 */
export function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merge `overrides` into `base`, recursing into plain objects so that, say, an override naming only
 * `ui.toolbar` leaves the rest of `ui` as the scene had it. Arrays are replaced outright: a list of
 * goals or of objects is a single value, not something to merge element by element.
 * @param {Object} base - The value merged into. Not modified.
 * @param {Object} overrides - The value taking precedence.
 * @returns {Object} The merged value.
 */
export function mergeDeep(base, overrides) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    out[key] = isPlainObject(value) && isPlainObject(base?.[key])
      ? mergeDeep(base[key], value)
      : value;
  }
  return out;
}

/**
 * The compressed part of a shared link, if the string is one.
 *
 * A link is recognised by shape rather than by host, so a scene shared from a local build, from the
 * project's own site or from the original phydemo one all work. What is rejected is anything that
 * could equally be a scene name or a file path: the hash has to be long enough that it cannot be
 * the gallery's `#example-name` form of link, which names a scene rather than carrying one.
 *
 * @param {string} text - The candidate.
 * @returns {string|null} The hash payload, or null if this is not a shared link.
 */
export function sceneLinkPayload(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('{')) return null;

  const hashIndex = trimmed.indexOf('#');
  // A bare payload is allowed only when it was written as a hash; without the `#` a plain word is
  // far more likely to be the name of a bundled scene.
  if (hashIndex === -1) return null;

  const payload = decodeURIComponent(trimmed.slice(hashIndex + 1)).trim();
  // 70 is the length the simulator itself uses to tell a compressed scene from a gallery name.
  if (payload.length < 70 || /\s/.test(payload)) return null;
  return payload;
}

/**
 * Whether a value is a shared link rather than a scene.
 * @param {*} value - The candidate.
 * @returns {boolean} Whether it is a link.
 */
export function isSceneLink(value) {
  return sceneLinkPayload(value) !== null;
}

/**
 * Decompress a shared link into scene JSON.
 * @param {string} link - The link, as a full URL or as a bare hash.
 * @returns {Promise<string>} The scene JSON.
 */
export function decodeSceneLink(link) {
  const payload = sceneLinkPayload(link);
  if (payload === null) return Promise.reject(new Error('Not a shared scene link'));
  try {
    // Required rather than imported so that the LZMA codec is pulled into the bundle only where it
    // is reachable, and named exactly as the simulator names it so both speak the same format.
    return jsonUrl().decompress(payload).then((data) => JSON.stringify(data));
  } catch (e) {
    return Promise.reject(e);
  }
}

/**
 * The LZMA codec, loaded on first use.
 *
 * `json-url`'s prebuilt browser build derives a public path from the last `<script>` on the page as
 * it is evaluated, and throws outright where there is none. That path is never used, because this
 * build carries every codec inline and fetches nothing — but a page that loads the applet purely as
 * a module may genuinely have no script element, and the applet must not fall over on it. Giving it
 * an empty one to find costs nothing and keeps the dependency unpatched.
 *
 * @returns {Object} The json-url client for the `lzma` algorithm.
 */
function jsonUrl() {
  if (typeof document !== 'undefined' && document.getElementsByTagName('script').length === 0) {
    document.head?.appendChild(document.createElement('script'));
  }
  return require('json-url')('lzma');
}

/**
 * Resolve anything an embedder may pass as a scene into scene JSON.
 * @param {Object|string} source - A scene object, scene JSON, or a shared link.
 * @param {Object} [overrides] - Properties merged over the resolved scene, taking precedence.
 * @returns {Promise<string>} The scene JSON.
 */
export function resolveSceneSource(source, overrides) {
  const asJson = isSceneLink(source)
    ? decodeSceneLink(source)
    : Promise.resolve(typeof source === 'string' ? source : JSON.stringify(source));

  if (!overrides || Object.keys(overrides).length === 0) return asJson;
  return asJson.then((json) => JSON.stringify(mergeDeep(JSON.parse(json), overrides)));
}
