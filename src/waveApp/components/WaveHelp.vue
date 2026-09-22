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
  <span class="wave-help">
    <button
      type="button"
      class="wave-help-button"
      :aria-label="label"
      :aria-expanded="open ? 'true' : 'false'"
      @click.stop="open = !open"
    >?</button>
    <span v-if="open" class="wave-help-popover" @click.stop>
      <slot></slot>
    </span>
  </span>
</template>

<script>
/**
 * @module WaveHelp
 * @description A question mark that opens an explanation.
 *
 * The explanations these replace were set permanently under their controls,
 * where a paragraph of text takes several times the space of the control it
 * belongs to. Folding them away keeps the settings readable as a list of
 * settings while leaving the reasoning one click from where it applies —
 * which matters here because most of these controls trade accuracy against
 * speed and the trade is not guessable from the label.
 */
import { ref, onMounted, onUnmounted } from 'vue';

export default {
  name: 'WaveHelp',
  props: {
    label: { type: String, default: 'Help' },
  },
  setup() {
    const open = ref(false);
    const close = () => { open.value = false; };
    onMounted(() => document.addEventListener('click', close));
    onUnmounted(() => document.removeEventListener('click', close));
    return { open };
  },
};
</script>

<style scoped>
.wave-help {
  position: relative;
  display: inline-block;
  line-height: 1;
}

.wave-help-button {
  width: 15px;
  height: 15px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
  line-height: 13px;
  cursor: help;
}

.wave-help-button:hover,
.wave-help-button[aria-expanded="true"] {
  border-color: rgba(255, 255, 255, 0.7);
  color: rgba(255, 255, 255, 0.95);
}

.wave-help-popover {
  position: absolute;
  top: calc(100% + 6px);
  /* Anchored to its right edge so it opens inwards: every one of these sits in
     a panel against the right edge of the window, and a popover anchored the
     other way would open off the screen. */
  right: -6px;
  z-index: 60;
  display: block;
  width: min(300px, calc(100vw - 32px));
  padding: 8px 10px;
  background-color: rgba(28, 31, 36, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
  color: rgba(255, 255, 255, 0.82);
  font-size: 11px;
  font-weight: normal;
  line-height: 1.45;
  white-space: normal;
  text-align: left;
}
</style>
