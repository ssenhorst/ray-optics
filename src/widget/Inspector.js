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
 * @file `src/widget/Inspector.js` is the widget's minimal replacement for the object bar of the full
 * app: a small panel listing the properties of the selected object that the scene's interaction
 * permissions allow the student to change.
 *
 * It is driven by the same property schema the sidebar of the full app uses, so it needs no
 * knowledge of individual object types. Properties that are edited by dragging on the canvas
 * (points) and those that only make sense in the full editor (equations, styling) are left out.
 */

import { getByKeyPath, setByKeyPath } from '../core/propertyUtils/keyPath.js';
import { objAllowsProperty } from '../core/interaction.js';

/** The property types the widget knows how to present. */
const SUPPORTED_TYPES = ['number', 'boolean', 'dropdown'];

/**
 * Strip the HTML the schema labels carry (they may contain markup for units and subscripts).
 * @param {string} label - The label.
 * @returns {string} The plain text.
 */
function plainLabel(label) {
  const div = document.createElement('div');
  div.innerHTML = label ?? '';
  return div.textContent.trim();
}

/**
 * The property panel of the widget.
 * @class
 */
class Inspector {
  /**
   * @param {HTMLElement} root - The element the panel lives in.
   * @param {Scene} scene - The scene.
   * @param {Simulator} simulator - The simulator to refresh after an edit.
   * @param {Editor} editor - The editor, used to record undo points.
   */
  constructor(root, scene, simulator, editor) {
    this.root = root;
    this.scene = scene;
    this.simulator = simulator;
    this.editor = editor;
    this.root.style.display = 'none';
  }

  /**
   * Show the properties of an object, or hide the panel if there is nothing to show.
   * @param {number} index - The index of the selected object, or -1 for none.
   */
  show(index) {
    const obj = index >= 0 ? this.scene.objs[index] : null;
    this.root.innerHTML = '';

    if (!obj) {
      this.root.style.display = 'none';
      return;
    }

    const objData = obj.serialize();
    let schema = [];
    try {
      schema = obj.constructor.getPropertySchema(objData, this.scene) || [];
    } catch (e) {
      schema = [];
    }

    const editable = schema.filter(descriptor =>
      SUPPORTED_TYPES.includes(descriptor.type)
      && !descriptor.readOnly
      && objAllowsProperty(obj, 'edit', descriptor.key)
    );

    if (editable.length === 0) {
      this.root.style.display = 'none';
      return;
    }

    this.root.style.display = '';
    const title = document.createElement('div');
    title.className = 'ro-inspector-title';
    title.textContent = obj.name || obj.constructor.type;
    this.root.appendChild(title);

    for (const descriptor of editable) {
      this.root.appendChild(this.buildControl(obj, descriptor));
    }
  }

  /**
   * Build one labelled control.
   * @param {BaseSceneObj} obj - The object being edited.
   * @param {PropertyDescriptor} descriptor - The property.
   * @returns {HTMLElement} The control row.
   */
  buildControl(obj, descriptor) {
    const row = document.createElement('label');
    row.className = 'ro-inspector-row';

    const caption = document.createElement('span');
    caption.className = 'ro-inspector-label';
    caption.textContent = plainLabel(descriptor.label) || descriptor.key;
    row.appendChild(caption);

    const value = getByKeyPath(obj, descriptor.key);
    let input;

    if (descriptor.type === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!value;
      input.addEventListener('change', () => this.commit(obj, descriptor.key, input.checked));
    } else if (descriptor.type === 'dropdown') {
      input = document.createElement('select');
      for (const [optionValue, optionLabel] of Object.entries(descriptor.options || {})) {
        const option = document.createElement('option');
        option.value = optionValue;
        option.textContent = plainLabel(optionLabel);
        input.appendChild(option);
      }
      input.value = value;
      input.addEventListener('change', () => this.commit(obj, descriptor.key, input.value));
    } else {
      input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = typeof value === 'number' ? value : '';
      input.addEventListener('input', () => {
        const parsed = parseFloat(input.value);
        if (Number.isFinite(parsed)) this.commit(obj, descriptor.key, parsed, true);
      });
      input.addEventListener('change', () => this.editor.onActionComplete());
    }

    input.className = 'ro-inspector-input';
    row.appendChild(input);
    return row;
  }

  /**
   * Write a value back to the object and re-run the simulation.
   * @param {BaseSceneObj} obj - The object.
   * @param {string} key - The property path.
   * @param {*} value - The new value.
   * @param {boolean} [live] - Whether the edit is still in progress, so no undo point is recorded yet.
   */
  commit(obj, key, value, live) {
    setByKeyPath(obj, key, value);
    this.simulator.updateSimulation(!obj.constructor.isOptical, true);
    if (!live) this.editor.onActionComplete();
  }
}

export default Inspector;
