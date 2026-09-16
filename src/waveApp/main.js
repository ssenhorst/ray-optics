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
 * @file Entry point for the wave-optics web app, built as a separate bundle
 * from the ray simulator (`dist/wave/` alongside `dist/simulator/`).
 *
 * It shares the core library — {@link Scene}, {@link Editor}, the geometry
 * helpers and the object bar — so editing, dragging, zooming, undo and the
 * scene file format behave exactly as in the ray app, while the simulation
 * core is replaced by {@link WaveSimulator}.
 */

import { createApp } from 'vue';
import i18next from 'i18next';
import App from './components/App.vue';
import { app } from './services/waveApp.js';

const isDevelopment = process.env.NODE_ENV === 'development';

const i18nPlugin = {
  install: (vueApp) => {
    vueApp.config.globalProperties.$t = (key, options) => i18next.t(key, options);
  },
};

async function initApp() {
  // The scene objects reach for i18next while populating the object bar, so it
  // has to be initialised even though this app's own chrome is not translated
  // yet. Strings are bundled rather than fetched, since there is only one
  // namespace in play here.
  await i18next.init({
    lng: 'en',
    debug: isDevelopment,
    fallbackLng: 'en',
    resources: {
      en: {
        main: require('../../locales/en/main.json'),
        simulator: require('../../locales/en/simulator.json'),
      },
    },
    ns: ['main', 'simulator'],
    interpolation: { escapeValue: false },
  });

  // The scene must exist before the Vue app mounts: the controls bind to it.
  app.initScene();

  const vueApp = createApp(App);
  vueApp.use(i18nPlugin);
  vueApp.mount('#vue-root');

  // Needs the mounted DOM, so it runs after mount.
  app.initAppService();
}

initApp();
