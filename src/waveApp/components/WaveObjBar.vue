<!--
  Copyright 2026 The Wave Optics Simulation authors and contributors

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
  flex-wrap: wrap;
  gap: 10px;
  padding: 7px 12px;
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

<!--
  The controls inside #wave_obj_bar_main are created imperatively by the objBar
  service, so they never receive this component's scoped attribute and have to
  be styled globally. The ray app's equivalent rules live in its own ObjBar
  component, which this app does not load.
-->
<style>
#wave_obj_bar_main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 14px;
}

#wave_obj_bar_main .obj-bar-nobr {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.wave-obj-bar .obj-bar-editable {
  color: white;
  background-color: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 3px;
  text-align: center;
}

.wave-obj-bar .obj-bar-editable::selection {
  background-color: gray;
  color: white;
}

/* The equations are the main way these objects are configured, so they get
   room to read rather than the toolbar's compact size. */
.wave-obj-bar .mq-editable-field {
  font-size: 17px;
  min-width: 110px;
  padding: 4px 8px;
  line-height: 1.35;
}

.wave-obj-bar .mq-editable-field.mq-focused {
  box-shadow: none;
  border-color: rgba(120, 175, 255, 0.9);
  background-color: rgba(255, 255, 255, 0.22);
}

.wave-obj-bar .mq-cursor {
  border-color: white !important;
}

.wave-obj-bar .obj-bar-number {
  width: 62px;
  font-size: 15px;
  padding: 3px 2px;
}

.wave-obj-bar .info-icon {
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
}

.wave-obj-bar .info-icon:hover {
  color: rgba(255, 255, 255, 0.9);
}

/* The equation help lists worked examples, which need to be legible. Bootstrap
   popovers are light, so the code colour is chosen for contrast on white. */
.popover-body code {
  color: #0a4ea3;
  background-color: rgba(10, 78, 163, 0.08);
  padding: 0 3px;
  border-radius: 2px;
  font-size: 12px;
}

.popover-body ul {
  margin-bottom: 4px;
  padding-left: 18px;
}

.popover-body li {
  margin-bottom: 2px;
}
</style>
