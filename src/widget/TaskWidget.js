/*
 * Copyright 2025 The Ray Optics Simulation authors and contributors
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
 * @file `src/widget/TaskWidget.js` is the embeddable, self-contained interactive applet.
 *
 * It uses the same {@link Scene}, {@link Simulator} and {@link Editor} as the full web app, but
 * builds a deliberately minimal interface around them: a canvas, an optional task panel, and
 * nothing else. What the student may do with the scene is decided entirely by the scene's own
 * `interaction` and `ui` properties, so an assignment is described by one JSON file and needs no
 * code of its own.
 */

import Scene from '../core/Scene.js';
import Simulator from '../core/Simulator.js';
import Editor from '../core/Editor.js';
import TaskEvaluator from '../core/goals/TaskEvaluator.js';
import { resolveUiOptions } from '../core/uiOptions.js';
import { getObjectPlacement, getImagePlacement } from '../core/illustration.js';
import churchPicture from '../img/delft_new_church.svg';
import { sceneAllows, objAllows, objAllowsProperty } from '../core/interaction.js';
import GoalOverlay from './overlay.js';
import Inspector from './Inspector.js';
import './styles.css';

/**
 * Escape a string for safe interpolation into HTML.
 * @param {string} text - The text to escape.
 * @returns {string} The escaped text.
 */
function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/**
 * An embeddable ray optics applet showing one scene and, optionally, one assignment.
 * @class
 */
class TaskWidget {
  /**
   * @param {HTMLElement} container - The element the widget is built into. Its contents are replaced.
   * @param {Object|string} sceneData - The scene, either as a JSON string or as a parsed object.
   * @param {Object} [options] - Overrides applied on top of the scene's own settings.
   * @param {boolean} [options.allowKeyboard=true] - Whether keyboard shortcuts are handled.
   * @param {function} [options.onTaskStatus] - Called with the {@link TaskStatus} after each run.
   * @param {function} [options.onComplete] - Called once each time the task becomes complete.
   */
  constructor(container, sceneData, options = {}) {
    /** @property {HTMLElement} container - The host element. */
    this.container = container;
    /** @property {Object} options - The options passed by the embedder. */
    this.options = options;
    /** @property {string} initialJson - The scene as loaded, used by the "restart" button. */
    this.initialJson = typeof sceneData === 'string' ? sceneData : JSON.stringify(sceneData);

    /** @property {Scene} scene - The scene being simulated. */
    this.scene = new Scene();
    /** @property {TaskEvaluator} taskEvaluator - The evaluator scoring the scene's goals. */
    this.taskEvaluator = new TaskEvaluator(this.scene);

    /** @property {Set<string>} satisfiedGoalIds - The goals already met, to detect the moment one is. */
    this.satisfiedGoalIds = new Set();
    /** @property {boolean} wasComplete - Whether the task was complete at the last evaluation. */
    this.wasComplete = false;
    /** @property {Object<string, HTMLImageElement>} pictures - The loaded illustration pictures. */
    this.pictures = {};
    /** @property {TaskStatus|null} lastStatus - The last evaluated task status. */
    this.lastStatus = null;

    this.buildDom();
    this.initEngine();
    this.load(this.initialJson);
  }

  /** Build the DOM of the widget. */
  buildDom() {
    this.container.innerHTML = '';
    this.container.classList.add('ro-widget');

    this.stage = el('div', 'ro-stage');

    // The canvas layers expected by the simulator, bottom to top. The last one receives the pointer
    // events and is the one the editor is attached to; the overlay above it is click-through.
    this.canvasGrid = el('canvas');
    this.canvasBelowLight = el('canvas');
    this.canvasLight = el('canvas');
    this.canvasAboveLight = el('canvas', 'ro-interaction');
    this.canvasOverlay = el('canvas', 'ro-overlay');
    this.canvasAboveLight.tabIndex = 0;

    for (const canvas of [this.canvasGrid, this.canvasBelowLight, this.canvasLight, this.canvasAboveLight, this.canvasOverlay]) {
      this.stage.appendChild(canvas);
    }

    this.controls = el('div', 'ro-controls');
    this.stage.appendChild(this.controls);

    this.inspectorNode = el('div', 'ro-inspector');
    this.stage.appendChild(this.inspectorNode);

    this.panel = el('aside', 'ro-panel');

    this.container.appendChild(this.stage);
    this.container.appendChild(this.panel);
  }

  /** Create the simulator, the editor and the overlay, and wire up their events. */
  initEngine() {
    this.simulator = new Simulator(
      this.scene,
      this.canvasLight.getContext('2d'),
      this.canvasBelowLight.getContext('2d'),
      this.canvasAboveLight.getContext('2d'),
      this.canvasGrid.getContext('2d'),
      document.createElement('canvas').getContext('2d'),
      true
    );
    this.simulator.dpr = window.devicePixelRatio || 1;

    this.editor = new Editor(this.scene, this.canvasAboveLight, this.simulator);
    this.overlay = new GoalOverlay(this.canvasOverlay, this.scene);
    this.overlay.dpr = this.simulator.dpr;

    this.inspector = new Inspector(this.inspectorNode, this.scene, this.simulator, this.editor);
    this.editor.on('selectionChange', (e) => {
      this.inspector.show(this.ui && this.ui.objectBar ? e.newIndex : -1);
    });

    this.simulator.on('simulationComplete', () => this.evaluateTask());
    this.simulator.on('simulationStop', () => this.evaluateTask());
    this.simulator.on('update', () => {
      this.refreshAffordances();
      this.refreshPictures();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);

    this.onKeyDown = (e) => this.handleKeyDown(e);
    this.canvasAboveLight.addEventListener('keydown', this.onKeyDown);
  }

  /**
   * Load a scene, replacing whatever is currently shown.
   * @param {string} json - The scene JSON.
   */
  load(json) {
    this.resize(true);
    this.scene.loadJSON(json, (needFullUpdate, completed) => {
      if (this.scene.error) {
        this.showError(this.scene.error);
        return;
      }
      if (!completed) return;
      this.applySceneSettings();
      this.simulator.updateSimulation();
    });

    if (this.scene.error) {
      this.showError(this.scene.error);
      return;
    }
    this.applySceneSettings();
    this.simulator.updateSimulation();
  }

  /** Apply the scene's `ui` options and rebuild the panel and the controls for the current scene. */
  applySceneSettings() {
    this.ui = resolveUiOptions(this.scene);
    this.simulator.recordRaySegments = this.taskEvaluator.task !== null;

    this.canvasBelowLight.style.backgroundColor =
      `rgb(${Math.round(this.scene.theme.background.color.r * 255)},` +
      `${Math.round(this.scene.theme.background.color.g * 255)},` +
      `${Math.round(this.scene.theme.background.color.b * 255)})`;

    this.satisfiedGoalIds.clear();
    this.wasComplete = false;
    this.lastStatus = null;
    this.loadIllustration();

    this.overlay.setTargets(this.ui.showTargets ? this.taskEvaluator.getTargets() : []);
    this.overlay.setGoals([]);
    this.refreshAffordances();
    this.refreshPictures();
    this.overlay.start();

    this.buildPanel();
    this.buildControls();
    this.inspector.show(-1);
  }

  /**
   * Build the restart and zoom buttons. They go into the task panel when there is one, so that they
   * never cover part of the optical scene; only a widget without a panel floats them over the canvas.
   */
  buildControls() {
    this.controls.innerHTML = '';

    const inPanel = this.panel.style.display !== 'none';
    const host = inPanel ? el('div', 'ro-panel-controls') : this.controls;
    this.controls.style.display = inPanel ? 'none' : '';
    if (inPanel) this.panel.insertBefore(host, this.panel.firstChild);

    if (this.ui.resetButton) {
      const reset = el('button', 'ro-btn', 'Restart');
      reset.title = 'Put every object back where it started';
      reset.addEventListener('click', () => this.reset());
      host.appendChild(reset);
    }

    if (this.ui.zoomButtons && sceneAllows(this.scene, 'zoom')) {
      const zoomOut = el('button', 'ro-btn', '&minus;');
      zoomOut.title = 'Zoom out';
      zoomOut.addEventListener('click', () => this.zoomBy(1 / 1.25));
      const zoomIn = el('button', 'ro-btn', '+');
      zoomIn.title = 'Zoom in';
      zoomIn.addEventListener('click', () => this.zoomBy(1.25));
      host.appendChild(zoomOut);
      host.appendChild(zoomIn);
    }
  }

  /**
   * Zoom about the centre of the canvas.
   * @param {number} factor - The factor to multiply the scale by.
   */
  zoomBy(factor) {
    const scale = Math.max(0.25, Math.min(5, this.scene.scale * factor));
    this.editor.setScaleWithCenter(
      scale,
      this.scene.width / 2 / this.scene.scale,
      this.scene.height / 2 / this.scene.scale
    );
  }

  /** Build the task panel for the current scene. */
  buildPanel() {
    const task = this.taskEvaluator.task;
    if (!task || !this.ui.taskPanel) {
      this.panel.style.display = 'none';
      return;
    }
    this.panel.style.display = '';
    this.panel.innerHTML = '';
    this.panel.classList.remove('ro-complete');

    if (task.title) this.panel.appendChild(el('h3', null, escapeHtml(task.title)));
    if (task.description) this.panel.appendChild(el('p', 'ro-description', escapeHtml(task.description)));

    const overall = el('div', 'ro-overall');
    overall.innerHTML =
      '<div class="ro-overall-label"><span>Progress</span><span class="ro-overall-value">0%</span></div>' +
      '<div class="ro-bar"><div class="ro-bar-fill"></div></div>';
    this.panel.appendChild(overall);
    this.overallFill = overall.querySelector('.ro-bar-fill');
    this.overallValue = overall.querySelector('.ro-overall-value');

    this.goalList = el('ul', 'ro-goals');
    this.goalNodes = task.goals.map(() => {
      const item = el('li', 'ro-goal');
      item.innerHTML =
        '<div class="ro-goal-head"><span class="ro-check"></span><span class="ro-goal-title"></span></div>' +
        '<div class="ro-goal-detail"></div>' +
        '<div class="ro-bar"><div class="ro-bar-fill"></div></div>';
      this.goalList.appendChild(item);
      return {
        item,
        title: item.querySelector('.ro-goal-title'),
        detail: item.querySelector('.ro-goal-detail'),
        fill: item.querySelector('.ro-bar-fill'),
      };
    });
    this.panel.appendChild(this.goalList);

    if (task.hint) {
      const hint = el('div', 'ro-hint');
      const button = el('button', 'ro-btn', 'Show a hint');
      const text = el('div', 'ro-hint-text', escapeHtml(task.hint));
      text.style.display = 'none';
      button.addEventListener('click', () => {
        const shown = text.style.display !== 'none';
        text.style.display = shown ? 'none' : '';
        button.textContent = shown ? 'Show a hint' : 'Hide the hint';
      });
      hint.appendChild(button);
      hint.appendChild(text);
      this.panel.appendChild(hint);
    }

    this.successNode = null;
  }

  /**
   * Load the picture the scene's `illustration` asks for, once per widget. The picture is compiled
   * into the bundle, so nothing is fetched over the network.
   */
  loadIllustration() {
    const name = this.scene.illustration?.picture;
    if (!name || this.pictures[name]) return;

    const sources = { church: churchPicture };
    if (!sources[name]) return;

    const image = new Image();
    image.onload = () => this.refreshPictures();
    image.src = sources[name];
    this.pictures[name] = image;
  }

  /**
   * Place the object and image pictures for the current state of the scene.
   */
  refreshPictures() {
    if (!this.overlay) return;
    const config = this.scene.illustration;
    const image = config && this.pictures[config.picture];
    if (!config || !image) {
      this.overlay.setPictures([]);
      return;
    }

    const pictures = [];
    const object = getObjectPlacement(this.scene);
    if (object) pictures.push({ image, ...object, opacity: config.opacity ?? 1 });

    const formed = getImagePlacement(this.scene, this.lastStatus);
    if (formed) pictures.push({ image, ...formed, opacity: (config.opacity ?? 1) * 0.85 });

    this.overlay.setPictures(pictures);
  }

  /**
   * Work out where the scene may be grabbed and hand it to the overlay, so the student can see what
   * is interactive instead of having to hover over everything to find out.
   */
  refreshAffordances() {
    if (!this.ui || !this.ui.showAffordances || !this.overlay) {
      this.overlay.setAffordances([]);
      return;
    }

    const affordances = [];
    for (const obj of this.scene.objs) {
      // An object in a state it cannot describe (a lens whose parameters do not build, say) must not
      // take the rest of the scene down with it, so anything it reports is treated as best-effort.
      try {
        for (const handle of obj.getInteractionHandles() || []) {
          if (objAllowsProperty(obj, 'reshape', handle.propertyKey)) {
            affordances.push({ type: 'handle', x: handle.point.x, y: handle.point.y });
          }
        }

        if (objAllows(obj, 'move')) {
          // Mark where to grab the object as a whole. Objects that are a single point are already
          // marked by their own handle, so a second marker on top of it would only add clutter.
          const center = obj.getDefaultCenter?.();
          const marked = center && !affordances.some(a =>
            a.type === 'handle' && Math.hypot(a.x - center.x, a.y - center.y) < 1e-6);
          if (marked) {
            affordances.push({ type: 'move', x: center.x, y: center.y });
          }
        }
      } catch (e) {
        continue;
      }
    }

    this.overlay.setAffordances(affordances);
  }

  /** Re-measure the canvases after the host element changed size. */
  resize(skipUpdate) {
    const rect = this.stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;

    for (const canvas of [this.canvasGrid, this.canvasBelowLight, this.canvasLight, this.canvasAboveLight, this.canvasOverlay]) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    this.simulator.dpr = dpr;
    this.overlay.dpr = dpr;
    this.scene.setViewportSize(width, height);

    if (!skipUpdate) this.simulator.updateSimulation();
  }

  /** Score the task against the last simulation run and refresh the feedback. */
  evaluateTask() {
    const task = this.taskEvaluator.task;
    if (!task) return;

    const status = this.taskEvaluator.evaluate(this.simulator.raySegments, this.countSourceRays());
    this.lastStatus = status;
    this.overlay.setGoals(status.goals);
    this.refreshPictures();
    this.renderStatus(status);

    for (const goal of status.goals) {
      if (goal.satisfied && !this.satisfiedGoalIds.has(goal.id)) {
        this.satisfiedGoalIds.add(goal.id);
        this.overlay.burstAt(goal.index);
      } else if (!goal.satisfied) {
        this.satisfiedGoalIds.delete(goal.id);
      }
    }

    if (status.complete && !this.wasComplete) {
      if (this.ui.celebrate) this.overlay.celebrate();
      if (this.options.onComplete) this.options.onComplete(status);
    }
    this.wasComplete = status.complete;

    if (this.options.onTaskStatus) this.options.onTaskStatus(status);
  }

  /**
   * The number of distinct rays the sources emitted, used as the default "all rays" count in goals.
   * @returns {number} The number of distinct rays recorded.
   */
  countSourceRays() {
    const ids = new Set();
    for (const seg of this.simulator.raySegments) {
      if (seg.depth === 0) ids.add(seg.id);
    }
    return ids.size;
  }

  /**
   * Update the panel from a task status.
   * @param {TaskStatus} status - The evaluated status.
   */
  renderStatus(status) {
    if (!this.goalNodes) return;

    const percent = Math.round(status.progress * 100);
    if (this.overallFill) {
      this.overallFill.style.width = percent + '%';
      this.overallFill.classList.toggle('ro-done', status.complete);
    }
    if (this.overallValue) this.overallValue.textContent = percent + '%';

    status.goals.forEach((goal, i) => {
      const node = this.goalNodes[i];
      if (!node) return;
      node.title.textContent = goal.title;
      node.detail.textContent = goal.detail;
      node.fill.style.width = Math.round(goal.progress * 100) + '%';
      node.fill.classList.toggle('ro-done', goal.satisfied);
      node.item.classList.toggle('ro-satisfied', goal.satisfied);
    });

    this.panel.classList.toggle('ro-complete', status.complete);

    const task = this.taskEvaluator.task;
    if (status.complete && !this.successNode) {
      this.successNode = el('div', 'ro-success',
        escapeHtml(task.successMessage || 'Solved. Every goal is met.'));
      this.panel.appendChild(this.successNode);
    } else if (!status.complete && this.successNode) {
      this.successNode.remove();
      this.successNode = null;
    }
  }

  /** Put the scene back to the state it was loaded in. */
  reset() {
    this.editor.loadJSON(this.initialJson);
    this.applySceneSettings();
    this.simulator.updateSimulation();
  }

  /**
   * Handle the few keyboard shortcuts the widget supports, all of them gated by the scene's
   * interaction permissions.
   * @param {KeyboardEvent} e - The event.
   */
  handleKeyDown(e) {
    if (this.options.allowKeyboard === false) return;
    if (!sceneAllows(this.scene, 'keyboard')) return;

    const index = this.editor.selectedObjIndex;
    const obj = index >= 0 ? this.scene.objs[index] : null;

    const step = e.shiftKey ? this.scene.gridSize : 1;
    const moves = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };

    if (moves[e.key] && obj && objAllows(obj, 'move')) {
      const [dx, dy] = moves[e.key];
      if ((dx !== 0 && !objAllows(obj, 'moveX')) || (dy !== 0 && !objAllows(obj, 'moveY'))) return;
      obj.move(dx, dy);
      this.simulator.updateSimulation(!obj.constructor.isOptical, true);
      this.editor.onActionComplete();
      e.preventDefault();
      return;
    }

    if ((e.key === 'Delete' || e.key === 'Backspace') && obj && objAllows(obj, 'remove')) {
      const wasOptical = obj.constructor.isOptical;
      this.editor.removeObj(index);
      this.simulator.updateSimulation(!wasOptical, true);
      this.editor.onActionComplete();
      e.preventDefault();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      this.editor.undo();
      e.preventDefault();
    }
  }

  /**
   * Replace the widget with an error message, e.g. when the scene JSON is invalid.
   * @param {string} message - The message to show.
   */
  showError(message) {
    this.container.innerHTML = '';
    this.container.appendChild(el('div', 'ro-error', escapeHtml(message)));
  }

  /** Release the observers and animation loop of the widget. */
  destroy() {
    this.overlay.stop();
    this.resizeObserver.disconnect();
    this.canvasAboveLight.removeEventListener('keydown', this.onKeyDown);
  }
}

export default TaskWidget;
