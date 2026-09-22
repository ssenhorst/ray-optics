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
 * The build of the standalone task widget. It produces a single JavaScript file with every
 * dependency (including the translations and the stylesheet) compiled in, which
 * `scripts/buildTaskWidget.mjs` then inlines into a self-contained HTML page. Nothing is fetched at
 * runtime, which is what platforms that only accept a static HTML block require.
 */

import path from 'path';

export default () => ({
  entry: {
    widget: {
      import: './src/widget/main.js',
      library: { name: 'RayOptics', type: 'umd', export: 'default' },
    },
  },
  output: {
    filename: 'ray-optics-widget.js',
    path: path.resolve('dist-widget'),
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        // Inlined as a data URI rather than emitted as a file, so that the built page needs nothing
        // alongside it.
        test: /\.(svg|png|jpe?g|gif)$/i,
        type: 'asset/inline',
      },
    ],
  },
  resolve: {
    alias: {
      mathjs: path.resolve('node_modules/mathjs'),
    },
    extensions: ['.js'],
  },
  optimization: {
    minimize: true,
    runtimeChunk: false,
    splitChunks: false,
  },
  performance: { hints: false },
  mode: 'production',
  devtool: false,
});
