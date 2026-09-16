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
 * @file The application service for the wave-optics app: the glue between the
 * core library ({@link Scene}, {@link Editor}, {@link WaveSimulator}) and the
 * Vue UI.
 *
 * This is a deliberately lean counterpart to `src/app/services/app.js` rather
 * than a refactor of it. The wave app was split off to stay clear of the ray
 * simulator's engine selection, colour modes and export paths, none of which
 * apply here; reusing that service would drag all of it back in. What *is*
 * reused is everything genuinely shared: the scene model, the editor, the
 * geometry helpers and the object bar.
 */

import 'bootstrap/scss/bootstrap.scss';
import { Scene, Editor, sceneObjs } from '../../core/index.js';
import WaveSimulator from '../../core/waveOptics/WaveSimulator.js';
import { createWaveRenderingContext } from '../../core/waveOptics/WaveFieldEngineWebGL2.js';
import { objBar } from '../../app/services/objBar.js';
import { saveAs } from 'file-saver';

/** Scene object types the wave app offers as tools. */
export const WAVE_TOOL_TYPES = ['WavePointSource'];

let scene = null;
let simulator = null;
let editor = null;
let canvasWave = null;
let canvasBelowLight = null;
let canvasAboveLight = null;
let canvasGrid = null;
let canvasInteraction = null;

const listeners = {};

/**
 * Subscribe to an app-level event ('statusChange', 'selectionChange',
 * 'sceneChange').
 * @param {string} name
 * @param {function} callback
 */
function on(name, callback) {
  (listeners[name] ??= []).push(callback);
}

/**
 * @param {string} name
 * @param {*} detail
 */
function emit(name, detail) {
  for (const callback of listeners[name] ?? []) callback(detail);
}

/** Create the scene. Must run before the Vue app mounts, since controls bind to it. */
function initScene() {
  scene = new Scene();
  scene.backgroundImage = null;
  app.scene = scene;
}

/** The canvas size last applied, so no-op resize events can be ignored. */
let lastCanvasWidth = -1;
let lastCanvasHeight = -1;

/** Wire up the canvases, simulator, editor and object bar. */
function initAppService() {
  canvasGrid = document.getElementById('waveCanvasGrid');
  canvasBelowLight = document.getElementById('waveCanvasBelow');
  canvasWave = document.getElementById('waveCanvasField');
  canvasAboveLight = document.getElementById('waveCanvasAbove');
  canvasInteraction = canvasAboveLight;

  app.canvasWave = canvasWave;

  let gl = null;
  try {
    gl = createWaveRenderingContext(canvasWave);
  } catch (e) {
    app.fatalError = e.message;
    emit('statusChange', { error: e.message });
    return;
  }

  simulator = new WaveSimulator({
    scene,
    gl,
    ctxBelowLight: canvasBelowLight.getContext('2d'),
    ctxAboveLight: canvasAboveLight.getContext('2d'),
    ctxGrid: canvasGrid.getContext('2d'),
  });
  simulator.dpr = window.devicePixelRatio || 1;
  app.simulator = simulator;

  editor = new Editor(scene, canvasInteraction, simulator);
  app.editor = editor;

  objBar.initialize(
    document.getElementById('wave_obj_bar_main'),
    document.getElementById('wave_obj_name')
  );
  app.objBar = objBar;

  bindEditorEvents();
  bindSimulatorEvents();
  bindObjBarEvents();

  window.addEventListener('resize', onResize);
  onResize();
}

/**
 * Resize every canvas layer and tell the scene about the new viewport.
 *
 * Resize events fire for reasons that leave the size unchanged (a device pixel
 * ratio change that rounds to the same pixels, mobile browser chrome sliding in
 * and out, devtools docking). Assigning to `canvas.width` clears the canvas
 * even when the value is identical, and recomputing the field is expensive, so
 * a resize that changes nothing is ignored.
 */
function onResize() {
  if (!scene) return;

  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(window.innerWidth * dpr);
  const height = Math.round(window.innerHeight * dpr);
  if (width === lastCanvasWidth && height === lastCanvasHeight) return;
  lastCanvasWidth = width;
  lastCanvasHeight = height;

  for (const canvas of [canvasGrid, canvasBelowLight, canvasWave, canvasAboveLight]) {
    if (!canvas) continue;
    canvas.width = width;
    canvas.height = height;
  }
  if (simulator) simulator.dpr = dpr;
  scene.setViewportSize(window.innerWidth, window.innerHeight);
  simulator?.updateSimulation(false, false);
}

function bindEditorEvents() {
  editor.on('selectionChange', (e) => {
    if (objBar.pendingEvent) {
      // Clearing the object bar would otherwise swallow an in-progress edit.
      objBar.pendingEvent();
      objBar.pendingEvent = null;
    }

    const bar = document.getElementById('wave_obj_bar');
    const main = document.getElementById('wave_obj_bar_main');
    if (e.newIndex >= 0 && scene.objs[e.newIndex]) {
      objBar.targetObj = scene.objs[e.newIndex];
      main.innerHTML = '';
      scene.objs[e.newIndex].populateObjBar(objBar);
      bar.style.display = '';
    } else {
      bar.style.display = 'none';
      objBar.shouldShowAdvanced = false;
    }
    emit('selectionChange', { index: e.newIndex });
  });

  editor.on('newAction', () => {
    emit('sceneChange', null);
  });

  editor.on('mouseCoordinateChange', (e) => {
    emit('statusChange', { mousePos: e.mousePos });
  });

  editor.on('positioningStart', (e) => {
    const box = document.getElementById('wave-xybox-container');
    const input = document.getElementById('wave-xybox');
    if (!box || !input) return;
    box.style.left = (e.dragContext.targetPoint.x * scene.scale + scene.origin.x) + 'px';
    box.style.top = (e.dragContext.targetPoint.y * scene.scale + scene.origin.y) + 'px';
    input.value = `(${e.dragContext.targetPoint.x},${e.dragContext.targetPoint.y})`;
    input.size = input.value.length;
    box.style.display = '';
    input.select();
  });

  editor.on('positioningEnd', () => {
    const box = document.getElementById('wave-xybox-container');
    if (box) box.style.display = 'none';
  });

  editor.on('requestPositioningComfirm', (e) => {
    const input = document.getElementById('wave-xybox');
    if (!input) return;
    const parsed = input.value.match(/^\(?\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)?$/);
    if (!parsed) return;
    editor.confirmPositioning(
      parseFloat(parsed[1]), parseFloat(parsed[2]), e.ctrl, e.shift
    );
  });
}

function bindSimulatorEvents() {
  simulator.on('fieldComputed', (e) => {
    emit('statusChange', {
      diagnostics: e.diagnostics,
      gridWidth: e.gridWidth,
      gridHeight: e.gridHeight,
      computeMs: e.computeMs,
      error: simulator.getError(),
    });
  });

  simulator.on('timeChange', (e) => emit('timeChange', e));
  simulator.on('animationChange', (e) => emit('animationChange', e));
  simulator.on('requestUpdateErrorAndWarning', () => {
    emit('statusChange', { error: simulator.getError() });
  });
}

function bindObjBarEvents() {
  objBar.on('edit', () => {
    simulator.updateSimulation(false, true);
  });
  objBar.on('editEnd', () => {
    editor.onActionComplete();
  });
  objBar.on('requestUpdate', () => {
    editor.selectObj(editor.selectedObjIndex);
  });
}

/**
 * Select the active tool.
 * @param {string} type - A scene object type, or '' for the move-view tool.
 */
function setTool(type) {
  if (!editor) return;
  editor.addingObjType = type;
  app.tool = type;
  emit('toolChange', { tool: type });
}

/** Re-run the simulation after a settings change. */
function refresh({ recomputeField = true } = {}) {
  if (!simulator) return;
  if (recomputeField) {
    simulator.updateSimulation(false, true);
  } else {
    simulator.render();
  }
}

/** Remove every object from the scene. */
function clearScene() {
  if (!scene || !editor) return;
  scene.objs = [];
  editor.selectObj(-1);
  simulator.updateSimulation(false, true);
  editor.onActionComplete();
  emit('sceneChange', null);
}

/** Download the scene as JSON. */
function saveScene() {
  const blob = new Blob([scene.toJSON()], { type: 'application/json;charset=utf-8' });
  saveAs(blob, (scene.name || 'wave-scene') + '.json');
}

/**
 * Load a scene from a JSON file.
 * @param {File} file
 */
function openScene(file) {
  const reader = new FileReader();
  reader.onload = () => {
    // Editor.loadJSON also resets the selection and drives the redraw.
    editor.loadJSON(String(reader.result));
    editor.onActionComplete();
    emit('sceneChange', null);
  };
  reader.readAsText(file);
}

/**
 * The wave-optics application service.
 * @namespace waveApp
 */
export const app = {
  scene: null,
  simulator: null,
  editor: null,
  objBar: null,
  tool: '',
  fatalError: null,
  initScene,
  initAppService,
  setTool,
  refresh,
  clearScene,
  saveScene,
  openScene,
  sceneObjs,
  on,
};

export default app;
