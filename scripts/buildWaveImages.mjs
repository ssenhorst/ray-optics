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
 * @file Renders the wave-optics previews used by the home and gallery pages.
 *
 * Unlike the ray-optics gallery images, which are drawn by the node build of
 * the core library, these are screenshots of the real app driven in a headless
 * browser. The field is computed by a WebGL2 shader and coloured by another
 * one; reproducing both in node would mean a second implementation of the
 * display mapping that could drift from the one people actually see. Driving
 * the app instead means a preview is by construction what the app shows.
 *
 * The cost is that this needs a browser, so it is deliberately *not* part of
 * `npm run build`: the output is committed, and this is run by hand when the
 * examples or the rendering change.
 *
 *     npm run build-app          # or build-simulator, for a dist/ to serve
 *     node ./scripts/buildWaveImages.mjs
 *
 * Puppeteer is not a dependency of this project. Point NODE_PATH at an install
 * of it, or `npm i --no-save puppeteer` first.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { EXAMPLE_SCENES } from '../src/waveApp/exampleScenes.js';

// CommonJS resolution, which unlike `import()` honours NODE_PATH — the way an
// install of puppeteer outside this project is pointed at.
const require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'src/img/wave');

/** Grid resolution the previews are computed at, in place of the adaptive ladder. */
const PREVIEW_RESOLUTION = 512;

/** How long to let the field computation and the refinement settle, in ms. */
const SETTLE_MS = 6000;

/**
 * The previews the pages ask for.
 *
 * `wide` ones head the home page carousel, `view` ones show the same scene in
 * each of the three field views, `square` ones are gallery thumbnails and
 * category tiles.
 */
const CAROUSEL = ['twoPointSources', 'zonePlate', 'lens', 'grating', 'fiveSlits'];

/**
 * One scene, shown in each field view, for the "views" section.
 *
 * Plane-wave illuminated rather than one of the point-source examples: a point
 * source is orders of magnitude brighter than the pattern it forms, so it
 * saturates into a white disc that dominates all three mappings and shows off
 * none of them.
 */
const VIEW_SCENE = 'fiveSlits';
const VIEWS = ['intensity', 'field', 'amplitudePhase'];

/** The tile that heads each tool category on the home page. */
const CATEGORY_TILES = {
  sources: 'twoPointSources',
  interfaces: 'grating',
  measure: 'focusMeasurement',
};

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

/** Serve `dist/` so the app can be loaded by the browser. */
function serve() {
  const server = http.createServer((req, res) => {
    let file = path.join(DIST, decodeURIComponent(req.url.split('?')[0]));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html');
    }
    if (!file.startsWith(DIST) || !fs.existsSync(file)) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/**
 * Load one example, wait for the field, and return the page ready to shoot.
 * @param {Object} page - A puppeteer page.
 * @param {string} base - The server's base URL.
 * @param {string} exampleId
 */
async function loadExample(page, base, exampleId) {
  await page.goto(`${base}/wave/#${exampleId}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => Boolean(window.waveApp?.simulator), { timeout: 30000 });

  // The chrome is an overlay, so hiding it leaves the canvases untouched
  // underneath and the preview is the field alone.
  await page.addStyleTag({
    content: '.wave-chrome, .wave-status, #wave_obj_bar { display: none !important; }',
  });

  // A fixed resolution rather than the adaptive ladder, so a preview does not
  // depend on how fast the machine that rendered it happened to be.
  await page.evaluate((resolution) => {
    const app = window.waveApp;
    app.scene.waveOptics.autoResolution = false;
    app.scene.waveOptics.gridResolution = resolution;
    app.editor.selectObj(-1);
    app.simulator.updateSimulation(false, true);
  }, PREVIEW_RESOLUTION);

  await new Promise((r) => setTimeout(r, SETTLE_MS));
}

/** Set the field view and re-colour, without recomputing the field. */
async function setView(page, view) {
  await page.evaluate((v) => {
    window.waveApp.scene.waveOptics.view = v;
    window.waveApp.simulator.render();
  }, view);
  await new Promise((r) => setTimeout(r, 400));
}

/**
 * Shoot the viewport and write it out, cropped to the requested aspect ratio
 * about the centre of the picture.
 */
async function shoot(page, sharp, outPath, { width, height, crop }) {
  const buffer = await page.screenshot({ type: 'png' });
  const image = sharp(buffer);
  const meta = await image.metadata();

  // Cropping about the centre keeps the part of the scene the example was
  // composed around; the examples are built to fill the window they load into.
  const box = crop ?? { left: 0, top: 0, width: meta.width, height: meta.height };
  await image
    .extract(box)
    .resize(width, height, { fit: 'cover' })
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
    .toFile(outPath);
  console.log('  wrote', path.relative(ROOT, outPath));
}

/**
 * A crop of the given aspect ratio, as a sharp extract box.
 *
 * @param {{width: number, height: number}} viewport
 * @param {number} aspect
 * @param {number} [bias=0.5] - Where along the width to centre the crop. The
 *   examples put their optics in the left third and the pattern they form to
 *   the right of it, so a tight crop wants to sit downstream of centre.
 * @param {number} [zoom=1] - Fraction of the available size to take. A wide
 *   aspect already fills the viewport's width, so there is nothing for `bias`
 *   to move until the crop is made smaller than it needs to be.
 */
function centredCrop(viewport, aspect, bias = 0.5, zoom = 1) {
  let width = Math.round(viewport.width * zoom);
  let height = Math.round(width / aspect);
  if (height > viewport.height) {
    height = viewport.height;
    width = Math.round(height * aspect);
  }
  const free = viewport.width - width;
  return {
    left: Math.round(free * Math.min(1, Math.max(0, bias))),
    top: Math.round((viewport.height - height) / 2),
    width,
    height,
  };
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'wave', 'index.html'))) {
    console.error('dist/wave is missing. Run `npm run build-simulator` first.');
    process.exit(1);
  }

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    console.error(
      'puppeteer is not resolvable. It is not a dependency of this project;\n' +
      'either `npm i --no-save puppeteer` or set NODE_PATH to an install of it.'
    );
    process.exit(1);
  }
  const sharp = require('sharp');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { server, port } = await serve();
  const base = `http://127.0.0.1:${port}`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      // The field is computed on the GPU, so a software rasteriser has to be
      // available for this to run anywhere without one.
      '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    ],
  });

  // `--only=views,carousel` re-renders one section, which matters because a
  // full pass is several minutes of software rasterisation.
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',')) : null;
  const wanted = (section) => !only || only.has(section);

  try {
    const viewport = { width: 1440, height: 810 };
    const page = await browser.newPage();
    await page.setViewport(viewport);
    page.on('pageerror', (e) => console.warn('  [page error]', e.message));

    if (wanted('carousel')) {
    console.log('carousel');
    for (const id of CAROUSEL) {
      await loadExample(page, base, id);
      await shoot(page, sharp, path.join(OUT_DIR, `carousel-${id}.jpg`), {
        width: 1140, height: 534, crop: centredCrop(viewport, 1140 / 534),
      });
    }
    }

    if (wanted('views')) {
    console.log('field views');
    await loadExample(page, base, VIEW_SCENE);
    for (const view of VIEWS) {
      await setView(page, view);
      await shoot(page, sharp, path.join(OUT_DIR, `view-${view}.jpg`), {
        width: 680, height: 300, crop: centredCrop(viewport, 680 / 300, 0.92, 0.72),
      });
    }
    }

    if (wanted('categories')) {
    console.log('category tiles');
    for (const [category, id] of Object.entries(CATEGORY_TILES)) {
      await loadExample(page, base, id);
      await shoot(page, sharp, path.join(OUT_DIR, `category-${category}.jpg`), {
        width: 300, height: 300, crop: centredCrop(viewport, 1, 0.6),
      });
    }
    }

    if (wanted('thumbnails')) {
    console.log('gallery thumbnails');
    for (const example of EXAMPLE_SCENES) {
      await loadExample(page, base, example.id);
      await shoot(page, sharp, path.join(OUT_DIR, `thumbnail-${example.id}.jpg`), {
        width: 500, height: 500, crop: centredCrop(viewport, 1, 0.6),
      });
    }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
