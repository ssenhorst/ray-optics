/*
 * Copyright 2025 The Wave Optics Simulation authors and contributors
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
 * @file Packs a task scene and the widget bundle into one self-contained HTML file.
 *
 * The result has no external references at all, so it can be uploaded to a learning platform (or
 * opened straight from disk) without any accompanying assets.
 *
 * Usage:
 *
 *   node scripts/buildTaskWidget.mjs                       # every scene in data/taskScenes
 *   node scripts/buildTaskWidget.mjs data/taskScenes/x.json # one scene
 *   node scripts/buildTaskWidget.mjs --out-dir dist/tasks   # choose the output directory
 *
 * Run `npm run build-widget-bundle` first, or use `npm run build-tasks`, which does both.
 */

import fs from 'fs';
import path from 'path';

const BUNDLE_PATH = 'dist-widget/wave-optics-widget.js';
const DEFAULT_SCENE_DIR = 'data/taskScenes';
const DEFAULT_OUT_DIR = 'dist/tasks';

/**
 * Make a block of text safe to place inside a `<script>` element.
 * @param {string} text - The text.
 * @returns {string} The escaped text.
 */
function escapeForScript(text) {
  return text.replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * Escape a string for use in HTML text.
 * @param {string} text - The text.
 * @returns {string} The escaped text.
 */
function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/**
 * Build the HTML page for one scene.
 * @param {string} bundle - The widget bundle source.
 * @param {string} sceneJson - The scene JSON.
 * @param {string} title - The page title.
 * @returns {string} The complete HTML document.
 */
function buildPage(bundle, sceneJson, title) {
  return `<!DOCTYPE html>
<html lang="en">

<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #0d1117; }
  #wave-optics-task { height: 100%; min-height: 420px; }
</style>
</head>

<body>
<div id="wave-optics-task" data-wave-optics><script type="application/json">
${escapeForScript(sceneJson)}
</script></div>
<script>
${escapeForScript(bundle)}
</script>
</body>

</html>
`;
}

function main() {
  const args = process.argv.slice(2);
  let outDir = DEFAULT_OUT_DIR;
  const scenes = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out-dir') {
      outDir = args[++i];
    } else {
      scenes.push(args[i]);
    }
  }

  if (!fs.existsSync(BUNDLE_PATH)) {
    console.error(`Missing ${BUNDLE_PATH}. Run "npm run build-widget-bundle" first.`);
    process.exit(1);
  }
  const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');

  if (scenes.length === 0) {
    for (const name of fs.readdirSync(DEFAULT_SCENE_DIR)) {
      if (name.endsWith('.json') && name !== 'index.json' && !name.startsWith('.')) {
        scenes.push(path.join(DEFAULT_SCENE_DIR, name));
      }
    }
  }

  fs.mkdirSync(outDir, { recursive: true });

  for (const scenePath of scenes) {
    const sceneJson = fs.readFileSync(scenePath, 'utf8');
    let title = path.basename(scenePath, '.json');
    try {
      const parsed = JSON.parse(sceneJson);
      title = parsed.task?.title || parsed.name || title;
    } catch (e) {
      console.error(`${scenePath} is not valid JSON: ${e.message}`);
      process.exit(1);
    }

    const outPath = path.join(outDir, path.basename(scenePath, '.json') + '.html');
    fs.writeFileSync(outPath, buildPage(bundle, sceneJson, title));
    const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
    console.log(`${outPath}  (${sizeMb} MB)`);
  }
}

main();
