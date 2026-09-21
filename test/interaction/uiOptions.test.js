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

import { UI_DEFAULTS, validateUiOptions, resolveUiOptions } from '../../src/core/uiOptions.js';

describe('validateUiOptions', () => {
  test('accepts a partial object', () => {
    expect(validateUiOptions({ toolbar: false, sidebar: false })).toBeNull();
  });

  test('rejects unknown keys and non-booleans', () => {
    expect(validateUiOptions({ toolbr: false })).toMatch(/unknown ui key/);
    expect(validateUiOptions({ toolbar: 'no' })).toMatch(/must be a boolean/);
  });
});

describe('resolveUiOptions', () => {
  test('fills in the defaults', () => {
    expect(resolveUiOptions({ ui: { toolbar: false } }))
      .toEqual({ ...UI_DEFAULTS, toolbar: false });
  });

  test('shows everything to a task designer', () => {
    const resolved = resolveUiOptions({ designMode: true, ui: { toolbar: false, sidebar: false } });
    expect(Object.values(resolved).every(v => v === true)).toBe(true);
    expect(Object.keys(resolved).sort()).toEqual(Object.keys(UI_DEFAULTS).sort());
  });

  test('copes with no scene at all', () => {
    expect(resolveUiOptions(null)).toEqual(UI_DEFAULTS);
  });
});
