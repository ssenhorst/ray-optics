<!--
  Copyright 2025 The Ray Optics Simulation authors and contributors

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
  <div class="task-tab">
    <p class="task-hint">
      Everything here is saved with the scene. Interaction and interface settings are not enforced
      while designing, so you can always reach every object.
    </p>

    <!-- ------------------------------------------------------------------ Task -->
    <section class="task-section">
      <h4>Task</h4>
      <template v-if="task">
        <label class="task-field">
          <span>Title</span>
          <input type="text" :value="task.title || ''" @input="setTask('title', $event.target.value)">
        </label>
        <label class="task-field task-field-wide">
          <span>Description</span>
          <textarea rows="3" :value="task.description || ''" @input="setTask('description', $event.target.value)"></textarea>
        </label>
        <label class="task-field task-field-wide">
          <span>Hint</span>
          <textarea rows="2" :value="task.hint || ''" @input="setTask('hint', $event.target.value)"></textarea>
        </label>
        <label class="task-field task-field-wide">
          <span>Success message</span>
          <textarea rows="2" :value="task.successMessage || ''" @input="setTask('successMessage', $event.target.value)"></textarea>
        </label>
        <label class="task-field">
          <span>Require all goals</span>
          <input type="checkbox" :checked="task.requireAll !== false" @change="setTask('requireAll', $event.target.checked)">
        </label>
        <button class="task-button task-button-danger" @click="removeTask">Remove task</button>
      </template>
      <template v-else>
        <p class="task-empty">This scene has no task.</p>
        <button class="task-button" @click="createTask">Add a task</button>
      </template>
    </section>

    <!-- ----------------------------------------------------------------- Goals -->
    <section class="task-section" v-if="task">
      <h4>Goals</h4>
      <p class="task-empty" v-if="goals.length === 0">No goals yet.</p>

      <div class="task-goal" v-for="(goal, index) in goals" :key="index">
        <div class="task-goal-head">
          <span class="task-goal-index">{{ index + 1 }}</span>
          <select :value="goal.type" @change="setGoal(index, 'type', $event.target.value)">
            <option v-for="type in goalTypes" :key="type" :value="type">{{ type }}</option>
          </select>
          <button class="task-icon-button" title="Remove" @click="removeGoal(index)">&times;</button>
        </div>

        <label class="task-field">
          <span>id</span>
          <input type="text" :value="goal.id || ''" @input="setGoal(index, 'id', $event.target.value)">
        </label>
        <label class="task-field task-field-wide">
          <span>Title</span>
          <input type="text" :value="goal.title || ''" @input="setGoal(index, 'title', $event.target.value)">
        </label>

        <label class="task-field" v-for="field in fieldsOf(goal)" :key="field.key">
          <span>{{ field.key }}</span>
          <input
            v-if="field.type === 'number'"
            type="number" step="any"
            :value="goal[field.key] ?? ''"
            @input="setGoalNumber(index, field.key, $event.target.value)">
          <input
            v-else
            type="text"
            :value="goal[field.key] ?? ''"
            @input="setGoal(index, field.key, $event.target.value)">
        </label>

        <div class="task-field task-field-wide" v-if="hasPoint(goal)">
          <span>point</span>
          <div class="task-point">
            <input type="number" step="any" :value="goal.point ? goal.point.x : 0"
                   @input="setGoalPoint(index, 'x', $event.target.value)">
            <input type="number" step="any" :value="goal.point ? goal.point.y : 0"
                   @input="setGoalPoint(index, 'y', $event.target.value)">
            <span class="task-point-note">drag on the canvas</span>
          </div>
        </div>
      </div>

      <button class="task-button" @click="addGoal">Add a goal</button>
    </section>

    <!-- ----------------------------------------------------------- Illustration -->
    <section class="task-section" v-if="task">
      <h4>Illustration</h4>
      <template v-if="illustration">
        <label class="task-field">
          <span>picture</span>
          <select :value="illustration.picture" @change="setIllustration('picture', $event.target.value)">
            <option v-for="name in pictures" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label class="task-field" v-for="key in ['top', 'bottom']" :key="key">
          <span>{{ key }}</span>
          <select :value="illustration[key] || ''" @change="setIllustration(key, $event.target.value)">
            <option value="">(none)</option>
            <option v-for="name in sourceNames" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <label class="task-field">
          <span>image goals</span>
          <input type="text" :value="(illustration.imageGoals || []).join(', ')"
                 @input="setImageGoals($event.target.value)">
        </label>
        <button class="task-button task-button-danger" @click="removeIllustration">Remove illustration</button>
      </template>
      <template v-else>
        <button class="task-button" @click="createIllustration">Add an illustration</button>
      </template>
    </section>

    <!-- ----------------------------------------------------- Scene interaction -->
    <section class="task-section">
      <h4>Interaction (whole scene)</h4>
      <p class="task-empty">Unticked keys are left out of the scene, which means "allowed".</p>
      <div class="task-tristate" v-for="key in interactionKeys" :key="key">
        <span>{{ key }}</span>
        <select :value="tristate(sceneInteraction[key])" @change="setSceneInteraction(key, $event.target.value)">
          <option value="unset">default</option>
          <option value="true">allowed</option>
          <option value="false">blocked</option>
        </select>
      </div>
    </section>

    <!-- ------------------------------------------------- Selected object rules -->
    <section class="task-section">
      <h4>Interaction (selected object)</h4>
      <p class="task-empty" v-if="!selectedObj">Select an object on the canvas.</p>
      <template v-else>
        <p class="task-empty">{{ selectedObjLabel }}</p>
        <div class="task-tristate" v-for="key in objectInteractionKeys" :key="key">
          <span>{{ key }}</span>
          <select :value="tristate(objInteraction[key])" @change="setObjInteraction(key, $event.target.value)">
            <option value="unset">inherit</option>
            <option value="true">allowed</option>
            <option value="false">blocked</option>
          </select>
        </div>
        <label class="task-field task-field-wide">
          <span>properties</span>
          <input type="text" :value="objPropertyOverrides"
                 placeholder="focalLength:true, p1:false"
                 @change="setObjProperties($event.target.value)">
        </label>
      </template>
    </section>

    <!-- ------------------------------------------------------------- Interface -->
    <section class="task-section">
      <h4>Interface shown to the student</h4>
      <div class="task-tristate" v-for="key in uiKeys" :key="key">
        <span>{{ key }}</span>
        <select :value="tristate(sceneUi[key])" @change="setSceneUi(key, $event.target.value)">
          <option value="unset">default</option>
          <option value="true">shown</option>
          <option value="false">hidden</option>
        </select>
      </div>
    </section>
  </div>
</template>

<script>
/**
 * @module TaskTab
 * @description The sidebar tab for authoring the assignment a scene poses: its text, its goals, the
 * picture drawn at the object and its image, and the interaction and interface settings the student
 * will be held to. Everything it edits is an ordinary scene property, so saving the scene from the
 * File menu produces a task file the regular build can use unchanged.
 *
 * Only shown when the app is opened as a task designer (`?design=1`).
 */
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useSceneStore } from '../../store/scene'
import { app } from '../../services/app'
import { GOAL_TYPES } from '../../../core/goals/goalTypes.js'
import { OBJECT_INTERACTION_DEFAULTS, SCENE_INTERACTION_DEFAULTS } from '../../../core/interaction.js'
import { UI_DEFAULTS } from '../../../core/uiOptions.js'
import { ILLUSTRATION_PICTURES } from '../../../core/illustration.js'

/** The fields each goal type takes, beyond the ones every goal has. */
const GOAL_FIELDS = {
  raysThroughPoint: [
    { key: 'radius', type: 'number' }, { key: 'count', type: 'number' },
    { key: 'minDepth', type: 'number' }, { key: 'source', type: 'text' },
    { key: 'targetLabel', type: 'text' },
  ],
  raysAvoidPoint: [
    { key: 'radius', type: 'number' }, { key: 'minDepth', type: 'number' },
    { key: 'source', type: 'text' }, { key: 'targetLabel', type: 'text' },
  ],
  raysConverge: [
    { key: 'radius', type: 'number' }, { key: 'minDepth', type: 'number' },
    { key: 'source', type: 'text' }, { key: 'targetLabel', type: 'text' },
  ],
  collimated: [
    { key: 'angle', type: 'number' }, { key: 'tolerance', type: 'number' },
    { key: 'count', type: 'number' }, { key: 'minDepth', type: 'number' },
    { key: 'source', type: 'text' },
  ],
  detectorPower: [
    { key: 'detector', type: 'text' }, { key: 'min', type: 'number' },
    { key: 'target', type: 'number' }, { key: 'tolerance', type: 'number' },
  ],
  objectProperty: [
    { key: 'object', type: 'text' }, { key: 'property', type: 'text' },
    { key: 'target', type: 'number' }, { key: 'tolerance', type: 'number' },
  ],
}

/** The goal types whose target is a point on the canvas. */
const POINT_GOALS = ['raysThroughPoint', 'raysAvoidPoint', 'raysConverge']

export default {
  name: 'TaskTab',
  setup() {
    const sceneStore = useSceneStore()
    const selectionTick = ref(0)

    const task = computed(() => sceneStore.task.value)
    const goals = computed(() => (task.value && task.value.goals) || [])
    const illustration = computed(() => sceneStore.illustration.value)
    const sceneInteraction = computed(() => sceneStore.interaction.value || {})
    const sceneUi = computed(() => sceneStore.ui.value || {})

    const goalTypes = Object.keys(GOAL_TYPES)
    const pictures = ILLUSTRATION_PICTURES
    const interactionKeys = Object.keys(SCENE_INTERACTION_DEFAULTS).filter(k => k !== 'properties')
    const objectInteractionKeys = Object.keys(OBJECT_INTERACTION_DEFAULTS)
    const uiKeys = Object.keys(UI_DEFAULTS)

    /** Write a whole scene property through the store, which records an undo point. */
    const commit = (key, value) => {
      sceneStore[key].value = value
      document.dispatchEvent(new Event('sceneChanged'))
    }

    const setTask = (key, value) => {
      const next = { ...(task.value || {}) }
      if (value === '' || value === undefined) delete next[key]
      else next[key] = value
      commit('task', next)
    }

    const createTask = () => commit('task', { title: 'New task', goals: [] })
    const removeTask = () => commit('task', null)

    const commitGoals = (list) => commit('task', { ...(task.value || {}), goals: list })

    const addGoal = () => {
      const list = goals.value.slice()
      list.push({ id: `goal${list.length + 1}`, type: 'raysThroughPoint', point: { x: 0, y: 0 }, radius: 20 })
      commitGoals(list)
    }

    const removeGoal = (index) => {
      const list = goals.value.slice()
      list.splice(index, 1)
      commitGoals(list)
    }

    const setGoal = (index, key, value) => {
      const list = goals.value.map(g => ({ ...g }))
      if (value === '' || value === undefined) delete list[index][key]
      else list[index][key] = value
      if (key === 'type' && POINT_GOALS.includes(value) && !list[index].point) {
        list[index].point = { x: 0, y: 0 }
      }
      commitGoals(list)
    }

    const setGoalNumber = (index, key, value) => {
      const parsed = parseFloat(value)
      setGoal(index, key, Number.isFinite(parsed) ? parsed : undefined)
    }

    const setGoalPoint = (index, axis, value) => {
      const parsed = parseFloat(value)
      if (!Number.isFinite(parsed)) return
      const list = goals.value.map(g => ({ ...g, point: g.point ? { ...g.point } : { x: 0, y: 0 } }))
      list[index].point[axis] = parsed
      commitGoals(list)
    }

    const fieldsOf = (goal) => GOAL_FIELDS[goal.type] || []
    const hasPoint = (goal) => POINT_GOALS.includes(goal.type)

    // ---- illustration ----
    const createIllustration = () => commit('illustration', { picture: pictures[0], top: '', bottom: '' })
    const removeIllustration = () => commit('illustration', null)
    const setIllustration = (key, value) => {
      const next = { ...(illustration.value || {}) }
      if (value === '') delete next[key]
      else next[key] = value
      commit('illustration', next)
    }
    const setImageGoals = (text) => {
      const ids = text.split(',').map(s => s.trim()).filter(Boolean)
      const next = { ...(illustration.value || {}) }
      if (ids.length === 2) next.imageGoals = ids
      else delete next.imageGoals
      commit('illustration', next)
    }

    const sourceNames = computed(() => (app.scene ? app.scene.objs : [])
      .filter(o => o && o.name)
      .map(o => o.name))

    // ---- interaction and interface ----
    const tristate = (value) => (typeof value === 'boolean' ? String(value) : 'unset')

    const applyTristate = (source, key, choice) => {
      const next = { ...(source || {}) }
      if (choice === 'unset') delete next[key]
      else next[key] = choice === 'true'
      return next
    }

    const setSceneInteraction = (key, choice) =>
      commit('interaction', applyTristate(sceneInteraction.value, key, choice))
    const setSceneUi = (key, choice) =>
      commit('ui', applyTristate(sceneUi.value, key, choice))

    // ---- the selected object's own rules ----
    const selectedObj = computed(() => {
      selectionTick.value // re-read whenever the selection changes
      const index = app.editor ? app.editor.selectedObjIndex : -1
      return index >= 0 && app.scene ? app.scene.objs[index] : null
    })

    const selectedObjLabel = computed(() => {
      const obj = selectedObj.value
      if (!obj) return ''
      return obj.name ? `${obj.constructor.type} "${obj.name}"` : obj.constructor.type
    })

    const objInteraction = computed(() => (selectedObj.value && selectedObj.value.interaction) || {})

    const objPropertyOverrides = computed(() => {
      const props = objInteraction.value.properties || {}
      return Object.entries(props).map(([k, v]) => `${k}:${v}`).join(', ')
    })

    const commitObjInteraction = (next) => {
      const obj = selectedObj.value
      if (!obj) return
      obj.interaction = Object.keys(next).length > 0 ? next : null
      selectionTick.value++
      app.simulator?.updateSimulation(true, true)
      app.editor?.onActionComplete()
      document.dispatchEvent(new Event('sceneChanged'))
    }

    const setObjInteraction = (key, choice) =>
      commitObjInteraction(applyTristate(objInteraction.value, key, choice))

    const setObjProperties = (text) => {
      const properties = {}
      for (const entry of text.split(',')) {
        const [name, value] = entry.split(':').map(s => s && s.trim())
        if (name && (value === 'true' || value === 'false')) properties[name] = value === 'true'
      }
      const next = { ...objInteraction.value }
      if (Object.keys(properties).length > 0) next.properties = properties
      else delete next.properties
      commitObjInteraction(next)
    }

    const onSceneChanged = () => { selectionTick.value++ }
    onMounted(() => {
      document.addEventListener('sceneChanged', onSceneChanged)
      document.addEventListener('selectionChanged', onSceneChanged)
    })
    onUnmounted(() => {
      document.removeEventListener('sceneChanged', onSceneChanged)
      document.removeEventListener('selectionChanged', onSceneChanged)
    })

    return {
      task, goals, illustration, sceneInteraction, sceneUi,
      goalTypes, pictures, interactionKeys, objectInteractionKeys, uiKeys, sourceNames,
      setTask, createTask, removeTask,
      addGoal, removeGoal, setGoal, setGoalNumber, setGoalPoint, fieldsOf, hasPoint,
      createIllustration, removeIllustration, setIllustration, setImageGoals,
      tristate, setSceneInteraction, setSceneUi,
      selectedObj, selectedObjLabel, objInteraction, objPropertyOverrides,
      setObjInteraction, setObjProperties,
    }
  },
}
</script>

<style scoped>
.task-tab {
  padding: 8px 10px 40px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  overflow-y: auto;
  height: 100%;
}

.task-hint {
  margin: 0 0 10px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  line-height: 1.4;
}

.task-section {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  padding-top: 10px;
  margin-top: 10px;
}

.task-section h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.65);
}

.task-empty {
  margin: 0 0 8px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
}

.task-field,
.task-tristate {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.task-field > span,
.task-tristate > span {
  flex: 0 0 35%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: rgba(255, 255, 255, 0.7);
  font-family: monospace;
  font-size: 11px;
}

.task-field-wide {
  align-items: flex-start;
  flex-wrap: wrap;
}

.task-field input[type="text"],
.task-field input[type="number"],
.task-field textarea,
.task-field select,
.task-tristate select {
  flex: 1 1 0;
  min-width: 0;
  font-size: 11px;
  font-family: monospace;
  padding: 3px 6px;
  color: rgba(255, 255, 255, 0.9);
  background-color: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  resize: vertical;
}

.task-field input:focus,
.task-field textarea:focus,
.task-field select:focus,
.task-tristate select:focus {
  outline: none;
  border-color: rgba(120, 198, 255, 0.6);
}

.task-field select option,
.task-tristate select option {
  color: black;
}

.task-field input[type="checkbox"] {
  flex: 0 0 auto;
  accent-color: rgb(120, 198, 255);
}

.task-goal {
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.03);
}

.task-goal-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.task-goal-index {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  text-align: center;
  line-height: 18px;
  font-size: 11px;
}

.task-goal-head select {
  flex: 1 1 0;
  min-width: 0;
  font-size: 11px;
  font-family: monospace;
  padding: 3px 6px;
  color: rgba(255, 255, 255, 0.9);
  background-color: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.task-goal-head select option { color: black; }

.task-point {
  flex: 1 1 100%;
  display: flex;
  align-items: center;
  gap: 6px;
}

.task-point input {
  flex: 1 1 0;
  min-width: 0;
  font-size: 11px;
  font-family: monospace;
  padding: 3px 6px;
  color: rgba(255, 255, 255, 0.9);
  background-color: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
}

.task-point-note {
  flex: 0 0 auto;
  color: rgba(255, 255, 255, 0.4);
  font-size: 10px;
}

.task-button,
.task-icon-button {
  font-size: 11px;
  padding: 4px 10px;
  color: rgba(255, 255, 255, 0.9);
  background-color: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  cursor: pointer;
}

.task-button:hover,
.task-icon-button:hover {
  background-color: rgba(255, 255, 255, 0.18);
}

.task-button-danger {
  margin-top: 4px;
  border-color: rgba(248, 113, 113, 0.5);
}

.task-icon-button {
  flex: 0 0 auto;
  padding: 2px 8px;
}
</style>
