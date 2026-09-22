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

import { isSceneLink, mergeDeep, resolveSceneSource, sceneLinkPayload }
  from '../../src/widget/sceneSource.js';

// The shape of a hash the simulator writes; its contents are only decompressed in a browser.
const PAYLOAD = 'XQAAgAD'.repeat(12);
const LINK = `https://phydemo.app/ray-optics/simulator/#${PAYLOAD}`;

describe('sceneLinkPayload', () => {
  test('reads the hash of a shared link, whichever way it was copied', () => {
    expect(sceneLinkPayload(LINK)).toBe(PAYLOAD);
    expect(sceneLinkPayload(`#${PAYLOAD}`)).toBe(PAYLOAD);
    expect(sceneLinkPayload(`  ${LINK}  `)).toBe(PAYLOAD);
    // The address bar hands back a percent-encoded hash in some browsers.
    expect(sceneLinkPayload(`#${encodeURIComponent(PAYLOAD)}`)).toBe(PAYLOAD);
  });

  test('leaves everything that is not a scene alone', () => {
    // A gallery link names a scene rather than carrying one.
    expect(isSceneLink('https://phydemo.app/ray-optics/simulator/#zone_plate')).toBe(false);
    expect(isSceneLink('wave_zone_plate')).toBe(false);
    expect(isSceneLink('data/taskScenes/thing.json')).toBe(false);
    expect(isSceneLink('{"version":5,"objs":[]}')).toBe(false);
    expect(isSceneLink(null)).toBe(false);
  });
});

describe('resolveSceneSource', () => {
  test('passes a scene through, as an object or as JSON', async () => {
    await expect(resolveSceneSource({ version: 5, objs: [] }))
      .resolves.toBe('{"version":5,"objs":[]}');
    await expect(resolveSceneSource('{"version":5,"objs":[]}'))
      .resolves.toBe('{"version":5,"objs":[]}');
  });

  test('lays the overrides over the scene key by key', async () => {
    const scene = { objs: [], ui: { toolbar: false, taskPanel: true }, interaction: { enabled: false } };
    const json = await resolveSceneSource(scene, { ui: { playButton: false } });
    // Naming one option must leave the scene's other settings as they were.
    expect(JSON.parse(json).ui).toEqual({ toolbar: false, taskPanel: true, playButton: false });
    expect(JSON.parse(json).interaction).toEqual({ enabled: false });
  });
});

describe('mergeDeep', () => {
  test('recurses into objects but replaces arrays outright', () => {
    expect(mergeDeep({ a: { x: 1, y: 2 }, list: [1, 2] }, { a: { y: 3 }, list: [9] }))
      .toEqual({ a: { x: 1, y: 3 }, list: [9] });
  });
});
