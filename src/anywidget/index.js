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
 * @file `src/anywidget/index.js` is the entry point of the anywidget bundle.
 *
 * It exposes {@link https://anywidget.dev|anywidget}'s front-end contract — a default export with
 * a `render({ model, el })` function — over the same embeddable applet the standalone task pages
 * use, {@link TaskWidget}. A host that speaks the anywidget protocol (Jupyter, MyST, or a plain
 * page driving the model object itself) therefore gets the ray tracer, the wave field solver, the
 * interaction permissions and the task scoring without any of them knowing anywidget exists.
 *
 * One bundle serves all three widgets. Which engine runs is decided from the scene itself, and
 * whether an assignment panel appears is decided by whether the scene carries a `task`, so the ray
 * viewer, the wave viewer and the task applet differ only in what they are handed. The `variant`
 * trait is carried through for the sake of error messages and of defaults, not to select code.
 *
 * The model's traits are documented in `python/ray_optics_widgets/widgets.py`, which is the other
 * half of this file.
 */

import i18next from 'i18next';
import simulatorEn from '../../locales/en/simulator.json';
import mainEn from '../../locales/en/main.json';
import TaskWidget from '../widget/TaskWidget.js';
import '../widget/styles.css';
import './anywidget.css';

i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { simulator: simulatorEn, main: mainEn } },
  interpolation: { escapeValue: false },
});

/** The traits that describe what to show. A change to any of them rebuilds the applet. */
const SCENE_TRAITS = ['scene', 'interaction', 'ui', 'task', 'variant'];

/**
 * Read a trait, tolerating both an anywidget model and a plain object standing in for one, which is
 * what a page embedding this bundle without a kernel is likely to pass.
 * @param {Object} model - The model.
 * @param {string} name - The trait name.
 * @param {*} [fallback] - Returned when the trait is absent.
 * @returns {*} The value.
 */
function getValue(model, name, fallback) {
  const value = typeof model?.get === 'function' ? model.get(name) : model?.[name];
  return value === undefined || value === null ? fallback : value;
}

/**
 * Whether a value is a plain object worth merging into rather than replacing.
 * @param {*} value - The value.
 * @returns {boolean} Whether it is a plain object.
 */
function isPlainObject(value) {
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
function mergeDeep(base, overrides) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    out[key] = isPlainObject(value) && isPlainObject(base?.[key])
      ? mergeDeep(base[key], value)
      : value;
  }
  return out;
}

/**
 * Build the scene the applet is given: the scene from the model, with the separately supplied
 * interaction permissions, interface options and task laid over it.
 *
 * Keeping them separate is what makes one scene file reusable. The same scene can be shown as a
 * free exploration in one place and as a graded assignment in another, with the difference living
 * in the notebook or the Markdown rather than in a second copy of the scene.
 *
 * @param {Object} model - The model.
 * @returns {Object} The scene to load.
 */
function composeScene(model) {
  const scene = getValue(model, 'scene', {});
  const parsed = typeof scene === 'string' ? JSON.parse(scene) : scene;
  const overrides = {};
  for (const key of ['interaction', 'ui', 'task']) {
    const value = getValue(model, key, null);
    // An empty dict is how a Python trait says "not set", so it must not clear the scene's own.
    if (value && Object.keys(value).length > 0) overrides[key] = value;
  }
  return mergeDeep(parsed, overrides);
}

/**
 * Report a status back to the model, so a notebook can read how far the student got. Silently does
 * nothing where there is no kernel to report to, which is the case for a published page.
 * @param {Object} model - The model.
 * @param {TaskStatus} status - The status from the evaluator.
 */
function publishStatus(model, status) {
  if (typeof model?.set !== 'function') return;
  try {
    model.set('progress', Number(status.progress) || 0);
    model.set('solved', !!status.complete);
    model.set('goal_status', (status.goals || []).map((goal) => ({
      id: goal.id,
      title: goal.title,
      detail: goal.detail,
      progress: Number(goal.progress) || 0,
      satisfied: !!goal.satisfied,
    })));
    model.save_changes?.();
  } catch (e) {
    // A read-only or kernel-less model is a normal way to run; it is not an error worth surfacing.
  }
}

/**
 * Show a message in place of the applet, for the cases the applet itself cannot report because it
 * was never built.
 * @param {HTMLElement} host - The element to fill.
 * @param {string} message - The message.
 */
function showMessage(host, message) {
  host.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'ro-widget-message';
  box.textContent = message;
  host.appendChild(box);
}

/**
 * The anywidget entry point, called once per view.
 * @param {Object} params
 * @param {Object} params.model - The anywidget model.
 * @param {HTMLElement} params.el - The element to render into.
 * @returns {function} The cleanup function anywidget calls when the view goes away.
 */
function render({ model, el }) {
  const host = document.createElement('div');
  host.className = 'ro-anywidget';
  el.appendChild(host);

  let widget = null;

  const applyHeight = () => {
    const height = Number(getValue(model, 'height', 420));
    host.style.height = height > 0 ? `${height}px` : '';
  };

  const build = () => {
    if (widget) {
      widget.destroy();
      widget = null;
    }
    host.innerHTML = '';
    applyHeight();

    let composed;
    try {
      composed = composeScene(model);
    } catch (e) {
      showMessage(host, `Could not read the scene: ${e.message}`);
      return;
    }
    if (!composed || !Array.isArray(composed.objs)) {
      showMessage(host, 'No scene to show. Pass one as the widget\'s `scene`.');
      return;
    }

    widget = new TaskWidget(host, composed, {
      allowKeyboard: getValue(model, 'allow_keyboard', true),
      onTaskStatus: (status) => publishStatus(model, status),
    });
  };

  const rebuild = () => build();
  for (const trait of SCENE_TRAITS) model.on?.(`change:${trait}`, rebuild);
  model.on?.('change:height', () => {
    applyHeight();
    widget?.resize();
  });

  // The applet measures its host, so it has to be built once the host has a size. In a notebook the
  // output area is laid out after render returns, hence the extra measure on the next frame.
  build();
  requestAnimationFrame(() => widget?.resize());

  const observer = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => widget?.resize())
    : null;
  observer?.observe(host);

  return () => {
    observer?.disconnect();
    for (const trait of SCENE_TRAITS) model.off?.(`change:${trait}`, rebuild);
    widget?.destroy();
    widget = null;
    el.innerHTML = '';
  };
}

export default { render };
