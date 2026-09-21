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
 * @file Builds the task designer: the full web app, opened on a task scene with the scene's own
 * interaction and interface restrictions switched off.
 *
 * The designer is the ordinary editor, so everything it already does — creating objects, dragging
 * them, the object bar, undo, the JSON editor — works on a task scene as it does on any other. The
 * extra "Task" tab in the sidebar edits the parts of a task that are not objects: its text, its
 * goals, the illustration, and the interaction and interface settings the student will be held to.
 * Saving from the File menu writes an ordinary scene file, which `npm run build-tasks` consumes
 * unchanged.
 *
 * Usage:
 *
 *   npm run build-task-editor     # builds the app and this page
 *
 * then serve `dist/` and open `/task-editor/`. It has to be served over HTTP rather than opened from
 * disk, because the app fetches its translations at runtime.
 */

import fs from 'fs';
import path from 'path';

const SCENE_DIR = 'data/taskScenes';
const OUT_DIR = 'dist/task-editor';
const SCENE_OUT_DIR = 'dist/taskScenes';

function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/**
 * The task scenes available to edit, with whatever title each one gives itself.
 * @returns {Array<{file: string, name: string, title: string, goals: number}>} The scenes.
 */
function collectScenes() {
  if (!fs.existsSync(SCENE_DIR)) return [];
  return fs.readdirSync(SCENE_DIR)
    .filter(name => name.endsWith('.json') && name !== 'index.json' && !name.startsWith('.'))
    .map(file => {
      const name = path.basename(file, '.json');
      let title = name;
      let goals = 0;
      let wave = false;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SCENE_DIR, file), 'utf8'));
        title = data.task?.title || data.name || name;
        goals = data.task?.goals?.length || 0;
        // A scene holding wave-optics objects belongs in the wave app, which simulates it; the ray
        // app would load it happily and then show nothing.
        wave = (data.objs || []).some(obj => typeof obj?.type === 'string' && obj.type.startsWith('Wave'));
      } catch (e) {
        title = `${name} (not valid JSON)`;
      }
      return { file, name, title, goals, wave };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildPage(scenes) {
  const rows = scenes.map(scene => `
      <li>
        <a class="scene" href="../${scene.wave ? 'wave' : 'simulator'}/?design=1&amp;scene=../taskScenes/${encodeURIComponent(scene.file)}">
          <span class="scene-title">${escapeHtml(scene.title)}<span class="kind">${scene.wave ? 'wave' : 'rays'}</span></span>
          <span class="scene-file">${escapeHtml(scene.file)} &middot; ${scene.goals} goal${scene.goals === 1 ? '' : 's'}</span>
        </a>
      </li>`).join('');

  return `<!DOCTYPE html>
<html lang="en">

<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ray Optics task designer</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    padding: 32px 20px 64px;
    background: #f6f8fa;
    color: #1b1f24;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .page { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p { color: #57606a; font-size: 14px; line-height: 1.5; }
  ul { list-style: none; margin: 20px 0 0; padding: 0; }
  li { margin-bottom: 8px; }
  .scene, .new {
    display: block;
    padding: 12px 14px;
    border: 1px solid #d0d7de;
    border-radius: 8px;
    background: #fff;
    text-decoration: none;
    color: inherit;
  }
  .scene:hover, .new:hover { border-color: #0969da; }
  .scene-title { display: block; font-weight: 600; font-size: 14px; }
  .scene-file { display: block; margin-top: 2px; color: #57606a; font-size: 12px; font-family: monospace; }
  .new { margin-top: 20px; text-align: center; font-weight: 600; font-size: 14px; }
  .kind {
    float: right; font-weight: 400; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.06em; color: #57606a; background: #eaeef2;
    padding: 1px 7px; border-radius: 999px;
  }
  .steps { margin-top: 28px; font-size: 13px; color: #57606a; }
  .steps code { background: #eaeef2; padding: 1px 5px; border-radius: 4px; }
</style>
</head>

<body>
<div class="page">
  <h1>Ray Optics task designer</h1>
  <p>Opens a task scene in the full editor with its restrictions switched off, so every object can be
     reached. The <strong>Task</strong> tab in the sidebar edits the assignment itself: its text, its
     goals, the illustration, and what the student will be allowed to do.</p>

  <ul>${rows || '\n      <li><p>No task scenes in <code>data/taskScenes</code> yet.</p></li>'}
  </ul>

  <p style="display:flex; gap:10px;">
    <a class="new" style="flex:1; margin-top:0" href="../simulator/?design=1">New ray task</a>
    <a class="new" style="flex:1; margin-top:0" href="../wave/?design=1">New wave task</a>
  </p>

  <div class="steps">
    <p><strong>To save your work:</strong> File &rarr; Save in the editor writes a scene file. Put it in
       <code>data/taskScenes/</code>, add its name to <code>data/taskScenes/index.json</code>, and run
       <code>npm run build-tasks</code> to produce the page students get.</p>
    <p>Goal targets are the amber handles on the canvas: drag them to place them. Their tolerance is
       the dashed circle around them.</p>
  </div>
</div>
</body>

</html>
`;
}

function main() {
  const scenes = collectScenes();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(SCENE_OUT_DIR, { recursive: true });

  for (const scene of scenes) {
    fs.copyFileSync(path.join(SCENE_DIR, scene.file), path.join(SCENE_OUT_DIR, scene.file));
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildPage(scenes));

  if (!fs.existsSync('dist/simulator/index.html')) {
    console.warn('dist/simulator/index.html is missing: run "npm run build-app" so the designer has an app to open.');
  }

  console.log(`${OUT_DIR}/index.html  (${scenes.length} scene${scenes.length === 1 ? '' : 's'})`);
}

main();
