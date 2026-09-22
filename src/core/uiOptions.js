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
 * @file `src/core/uiOptions.js` defines the scene-level `ui` property, which controls which parts of
 * the user interface are shown. It lets a scene be authored as a minimal embeddable widget (for
 * example an assignment in an online course) rather than as the full editor.
 *
 * The full web app honours `toolbar`, `objectBar`, `sidebar`, `statusBar`, `footer` and
 * `welcomeMessage`; the standalone task widget honours the rest.
 */

/**
 * The default values of the scene-level `ui` property.
 * @const {Object<string, boolean>}
 */
export const UI_DEFAULTS = {
  /** The top toolbar of the full web app (File / Tools / Settings / View). */
  toolbar: true,
  /** The bar showing the properties of the selected object. */
  objectBar: true,
  /** The sidebar of the full web app. */
  sidebar: true,
  /** The status area showing the mouse coordinates and simulation statistics. */
  statusBar: true,
  /** The footer of the full web app. */
  footer: true,
  /** The welcome message shown on an empty scene. */
  welcomeMessage: true,
  /** The task panel of the widget, showing the goals and the progress towards them. */
  taskPanel: true,
  /** The "reset" button of the widget. */
  resetButton: true,
  /** The zoom buttons of the widget. */
  zoomButtons: true,
  /** The widget's play/pause button, which runs the clock of a wave scene's instantaneous views. */
  playButton: true,
  /** The widget's field-view selector, which switches between intensity, field and amplitude+phase. */
  viewSelector: true,
  /** Whether goal targets are drawn on the canvas. */
  showTargets: true,
  /** Whether the places the student may grab are marked on the canvas. */
  showAffordances: true,
  /** Whether completing the task plays a celebration animation. */
  celebrate: true,
};

const UI_KEYS = Object.keys(UI_DEFAULTS);

/**
 * Validate a raw `ui` object coming from JSON.
 * @param {Object} raw - The raw value.
 * @returns {string|null} An error message, or null if the value is valid.
 */
export function validateUiOptions(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return 'ui must be an object';
  }
  for (const key in raw) {
    if (!UI_KEYS.includes(key)) {
      return `unknown ui key '${key}'`;
    }
    if (typeof raw[key] !== 'boolean') {
      return `ui.${key} must be a boolean`;
    }
  }
  return null;
}

/**
 * Resolve the `ui` property of a scene against the defaults.
 * @param {Scene} scene - The scene.
 * @returns {Object<string, boolean>} The resolved options, with every key present.
 */
export function resolveUiOptions(scene) {
  // A task designer needs every part of the interface, whatever the scene will show the student.
  if (scene?.designMode) {
    return Object.fromEntries(UI_KEYS.map(key => [key, true]));
  }
  return { ...UI_DEFAULTS, ...(scene?.ui || {}) };
}
