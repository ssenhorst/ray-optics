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
 * The build of the anywidget bundle, `npm run build-anywidget`.
 *
 * It produces the pair of files the anywidget spec asks for — an ES module whose default export has
 * a `render` function, and a stylesheet — written straight into the Python package at
 * `python/ray_optics_widgets/static/`, which is where `RayOpticsWidget._esm` and `._css` read them
 * from. The wheel therefore carries the built bundle and the installed package needs no Node.
 *
 * Two builds are made of each, as the release assets offer both: `widget.js` and `widget.css` are
 * readable, for anyone embedding the module by hand or debugging what it does, and `widget.min.js`
 * and `widget.min.css` are what the Python package serves. The example scenes are copied in beside
 * them, so that `load_scene("wave_zone_plate")` works from an installed package without the scenes
 * being authored twice.
 *
 * Every dependency is compiled in and every image is inlined as a data URI, for the same reason the
 * standalone task pages do it: the module is served as a single file by JupyterLab, by MyST and by
 * a learning platform that allows no outside requests, and nothing may be fetched at runtime.
 */

import path from 'path';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import CopyWebpackPlugin from 'copy-webpack-plugin';

const OUT_DIR = path.resolve('python/ray_optics_widgets/static');

/**
 * @param {Object} options
 * @param {boolean} options.minimize - Whether this is the minified build.
 * @param {Array} [options.extraPlugins] - Plugins only one of the two builds needs.
 * @returns {Object} A webpack configuration.
 */
const config = ({ minimize, extraPlugins = [] }) => ({
  name: minimize ? 'min' : 'readable',
  // The two builds share an output directory, so only the first may clean it. Naming the other as a
  // dependency is also what keeps them from running at the same time and racing over that.
  dependencies: minimize ? ['readable'] : [],
  entry: {
    widget: './src/anywidget/index.js',
  },
  output: {
    filename: minimize ? 'widget.min.js' : 'widget.js',
    path: OUT_DIR,
    clean: !minimize,
    // The anywidget front-end contract is an ES module, so the bundle keeps its `export default`
    // rather than being wrapped in a UMD factory the way the standalone widget is.
    module: true,
    library: { type: 'module' },
    environment: { module: true, dynamicImport: true },
  },
  experiments: {
    outputModule: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
      {
        // Inlined rather than emitted, so the module is the only file the host has to serve.
        test: /\.(svg|png|jpe?g|gif)$/i,
        type: 'asset/inline',
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: minimize ? 'widget.min.css' : 'widget.css' }),
    ...extraPlugins,
  ],
  resolve: {
    alias: {
      mathjs: path.resolve('node_modules/mathjs'),
    },
    extensions: ['.js'],
  },
  optimization: {
    minimize,
    runtimeChunk: false,
    splitChunks: false,
  },
  performance: { hints: false },
  mode: minimize ? 'production' : 'development',
  devtool: false,
});

export default () => [
  config({
    minimize: false,
    extraPlugins: [
      new CopyWebpackPlugin({
        patterns: [{
          from: 'data/taskScenes',
          to: path.resolve('python/ray_optics_widgets/scenes'),
          // The stray metadata files some file systems leave beside the real ones are not scenes.
          globOptions: { ignore: ['**/._*'] },
        }],
      }),
    ],
  }),
  config({ minimize: true }),
];
