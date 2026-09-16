<!--
  Copyright 2026 The Ray Optics Simulation authors and contributors

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
-->

<template>
  <div id="wave_obj_bar" class="wave-obj-bar" style="display:none">
    <span id="wave_obj_name" class="wave-obj-name"></span>
    <span id="wave_obj_bar_main"></span>
    <span class="wave-obj-bar-actions">
      <button class="btn btn-sm btn-outline-light" @click="onDuplicate" title="Duplicate">Duplicate</button>
      <button class="btn btn-sm btn-outline-light" @click="onDelete" title="Delete">Delete</button>
      <button class="btn btn-sm btn-outline-light" @click="onUnselect" title="Deselect">&times;</button>
    </span>
  </div>
</template>

<script>
/**
 * @module WaveObjBar
 * @description The property bar for the selected scene object.
 *
 * The controls inside `#wave_obj_bar_main` are built imperatively by the shared
 * `objBar` service (which the ray app also uses), driven by each scene object's
 * `populateObjBar`. That service is UI-framework agnostic, so it is reused here
 * as-is; only the surrounding chrome is specific to this app.
 */
import { app } from '../services/waveApp.js';

export default {
  name: 'WaveObjBar',
  methods: {
    onDuplicate() {
      const index = app.editor?.selectedObjIndex;
      if (index === undefined || index < 0) return;
      app.scene.cloneObj(index);
      app.simulator.updateSimulation(false, true);
      app.editor.onActionComplete();
    },
    onDelete() {
      const index = app.editor?.selectedObjIndex;
      if (index === undefined || index < 0) return;
      app.editor.removeObj(index);
      app.simulator.updateSimulation(false, true);
      app.editor.onActionComplete();
    },
    onUnselect() {
      app.editor?.selectObj(-1);
      app.simulator.updateSimulation(true, true);
    },
  },
};
</script>

<style scoped>
.wave-obj-bar {
  flex: 0 0 auto;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 12px;
  background-color: rgba(30, 33, 38, 0.92);
  backdrop-filter: blur(4px);
  color: white;
  font-size: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.wave-obj-name {
  font-weight: 600;
  white-space: nowrap;
}

.wave-obj-bar-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.btn-sm {
  --bs-btn-padding-y: 0.15rem;
  --bs-btn-padding-x: 0.45rem;
  --bs-btn-font-size: 0.75rem;
}
</style>
