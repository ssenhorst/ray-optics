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
 * @file The help text shown beside the amplitude, phase and sag equations.
 *
 * The equations are the main way these objects are configured, and what to type
 * into them is not guessable from an empty field, so each one gets a worked
 * example of the optics it is normally used for along with the syntax it
 * accepts.
 *
 * The examples are written the way they are *typed* rather than as LaTeX: the
 * fields are MathQuill editors, where `*` becomes a multiplication dot and `^`
 * starts a superscript, so showing the underlying LaTeX would be showing
 * something the user never enters.
 */

import i18next from 'i18next';

/**
 * Format a list of worked examples.
 * @param {Array<{expression: string, meaning: string}>} examples
 * @returns {string}
 */
function exampleList(examples) {
  const items = examples
    .map(({ expression, meaning }) => `<li><code>${expression}</code> &mdash; ${meaning}</li>`)
    .join('');
  return `<p>${i18next.t('simulator:waveSceneObjs.eqnInfo.examples')}</p><ul>${items}</ul>`
    + `<p>${i18next.t('simulator:waveSceneObjs.eqnInfo.typingNote')}</p>`;
}

/** The operators and functions the equation parser accepts. */
function syntaxHelp() {
  return '<ul>'
    + `<li>${i18next.t('simulator:sceneObjs.common.eqnInfo.constants')}`
    + '<br><code>pi e</code></li>'
    + `<li>${i18next.t('simulator:sceneObjs.common.eqnInfo.operators')}`
    + '<br><code>+ - * / ^</code></li>'
    + `<li>${i18next.t('simulator:sceneObjs.common.eqnInfo.functions')}`
    + '<br><code>sqrt sin cos tan sinh cosh tanh log</code> ('
    + `${i18next.t('simulator:sceneObjs.common.eqnInfo.naturalLog')}) `
    + '<code>exp arcsin arccos arctan abs floor round ceil sign max min</code></li>'
    + '</ul>';
}

/**
 * Build the popover content for one equation field.
 *
 * @param {Object} options
 * @param {string} options.variable - Description of the equation's variable.
 * @param {string} [options.role] - What the equation controls.
 * @param {Array<{expression: string, meaning: string}>} options.examples
 * @returns {string} HTML.
 */
export function equationInfo({ variable, role, examples }) {
  return (role ? `<p>${role}</p>` : '')
    + `<p>${variable}</p>`
    + `<p>${i18next.t('simulator:waveSceneObjs.eqnInfo.lambdaInfo')}</p>`
    + exampleList(examples)
    + syntaxHelp();
}

/**
 * Examples for an amplitude profile.
 * @param {string} variable - 'u' or 'y'.
 * @returns {Array<{expression: string, meaning: string}>}
 */
export function amplitudeExamples(variable) {
  return [
    { expression: '1', meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.uniform') },
    {
      expression: `exp(-${variable}^2/5000)`,
      meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.gaussian'),
    },
    {
      expression: `0.5+0.5*cos(0.05*${variable})`,
      meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.grating'),
    },
    {
      expression: `max(0,sign(30-abs(${variable})))`,
      meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.aperture', { half: 30 }),
    },
  ];
}

/**
 * Examples for a phase profile.
 * @param {string} variable - 'u' or 'y'.
 * @returns {Array<{expression: string, meaning: string}>}
 */
export function phaseExamples(variable) {
  return [
    { expression: '0', meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.flat') },
    // Written in terms of lambda rather than with the wavenumber evaluated, so
    // that copying one in gives a profile that stays a 20 degree tilt (or a
    // focus at 500) when the scene's wavelength is changed. `2*pi/lambda` is
    // the wavenumber; `sin(20 degrees)` is 0.342.
    {
      expression: `0.342*2*pi/λ*${variable}`,
      meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.tilt', { degrees: 20 }),
    },
    {
      expression: `-pi/λ/500*${variable}^2`,
      meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.focus', { distance: 500 }),
    },
  ];
}

/**
 * Examples for an interface's sag.
 * @returns {Array<{expression: string, meaning: string}>}
 */
export function sagExamples() {
  return [
    { expression: '0', meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.planar') },
    {
      expression: 'y^2/600',
      meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.spherical', { radius: 300 }),
    },
    {
      expression: '0.3*y',
      meaning: i18next.t('simulator:waveSceneObjs.eqnInfo.tilted'),
    },
  ];
}
