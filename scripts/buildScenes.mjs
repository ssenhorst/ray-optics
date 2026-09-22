/*
 * Copyright 2024 The Ray Optics Simulation authors and contributors
 * Modified in the Wave Optics Simulation, a fork of https://github.com/ricktu288/ray-optics
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

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';


// Convert import.meta.url to a file path and determine the directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Copy the module scenes from /data/moduleScenes to /dist/modules.
// The gallery scenes this script also used to build were ray-optics examples,
// removed with the rest of that gallery; the wave-optics examples are built by
// the app from the viewport they are loaded into and have no scene files.

// Create the /dist/modules folder if it doesn't exist.
const modulesFolder = path.join(__dirname, '../dist/modules');
if (!fs.existsSync(modulesFolder)) {
  fs.mkdirSync(modulesFolder, { recursive: true });
}

// Copy the files from /data/moduleScenes to /dist/modules
const moduleFiles = fs.readdirSync(path.join(__dirname, '../data/moduleScenes'));
moduleFiles.forEach((file) => {
  fs.copyFileSync(path.join(__dirname, `../data/moduleScenes/${file}`), path.join(__dirname, `../dist/modules/${file}`));
});

console.log('All Module scenes built successfully.');
