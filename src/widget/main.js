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
 * @file `src/widget/main.js` is the entry point of the standalone task widget bundle.
 *
 * The bundle is fully self-contained: the translations are compiled in and nothing is fetched at
 * runtime, so the built file can be pasted into a learning platform that only accepts static HTML
 * with no external dependencies.
 *
 * Markup that uses it looks like:
 *
 * ```html
 * <div data-ray-optics style="height: 420px">
 *   <script type="application/json">{ "version": 5, "objs": [] }</script>
 * </div>
 * ```
 *
 * or, programmatically, `RayOptics.createWidget(element, sceneJson, options)`.
 */

import i18next from 'i18next';
import simulatorEn from '../../locales/en/simulator.json';
import mainEn from '../../locales/en/main.json';
import TaskWidget from './TaskWidget.js';

i18next.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { simulator: simulatorEn, main: mainEn } },
  interpolation: { escapeValue: false },
});

/**
 * Create a widget in the given element.
 * @param {HTMLElement|string} target - The element or its id.
 * @param {Object|string} sceneData - The scene JSON.
 * @param {Object} [options] - Options forwarded to {@link TaskWidget}.
 * @returns {TaskWidget} The widget.
 */
export function createWidget(target, sceneData, options) {
  const element = typeof target === 'string' ? document.getElementById(target) : target;
  if (!element) throw new Error('RayOptics.createWidget: no such element');
  return new TaskWidget(element, sceneData, options);
}

/**
 * Build a widget for every element carrying a `data-ray-optics` attribute that has not been
 * initialised yet. The scene is read from an inline `<script type="application/json">` child, or
 * from the attribute itself if it holds the JSON directly.
 * @returns {Array<TaskWidget>} The widgets created.
 */
export function autoInit() {
  const widgets = [];
  for (const element of document.querySelectorAll('[data-ray-optics]')) {
    if (element.dataset.rayOpticsReady === 'true') continue;

    const inline = element.querySelector('script[type="application/json"]');
    const raw = inline ? inline.textContent : element.getAttribute('data-ray-optics');
    if (!raw || !raw.trim()) continue;

    element.dataset.rayOpticsReady = 'true';
    widgets.push(new TaskWidget(element, raw));
  }
  return widgets;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
}

export { TaskWidget };
export default { createWidget, autoInit, TaskWidget };
