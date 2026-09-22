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
 * @file `src/core/sceneObjs/opticalAxisDecoration.js` draws the reference marks of a lens or curved
 * mirror: its optical axis and its focal points.
 *
 * These are teaching aids rather than parts of the element, and are off by default. A scene turns
 * them on per element with the `showOpticalAxis` and `showFocalPoints` properties, which is what
 * lets an exercise show a fixed lens's focal points as a reference for where to place the rest.
 */

/**
 * Draw the optical axis of an element as a dashed line through its centre, long enough to cross the
 * whole viewport.
 * @param {CanvasRenderer} canvasRenderer - The renderer.
 * @param {Scene} scene - The scene, for the viewport extent and the theme.
 * @param {Point} center - The centre of the element.
 * @param {Point} direction - A unit vector along the axis.
 */
export function drawOpticalAxis(canvasRenderer, scene, center, direction) {
  if (!center || !direction) return;

  const ctx = canvasRenderer.ctx;
  const ls = canvasRenderer.lengthScale;
  const scale = scene.scale || 1;
  // Long enough to leave the viewport from any starting point inside it.
  const reach = (Math.abs(scene.width) + Math.abs(scene.height)) / scale;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = canvasRenderer.rgbaToCssColor(scene.theme.opticalAxis.color);
  ctx.lineWidth = scene.theme.opticalAxis.width * ls;
  ctx.setLineDash(scene.theme.opticalAxis.dash.map(v => v * ls));
  ctx.beginPath();
  ctx.moveTo(center.x - direction.x * reach, center.y - direction.y * reach);
  ctx.lineTo(center.x + direction.x * reach, center.y + direction.y * reach);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * Draw the focal points of an element as small square markers.
 * @param {CanvasRenderer} canvasRenderer - The renderer.
 * @param {Scene} scene - The scene, for the theme.
 * @param {Array<Point>} points - The focal points.
 */
export function drawFocalPoints(canvasRenderer, scene, points) {
  const ctx = canvasRenderer.ctx;
  const ls = canvasRenderer.lengthScale;
  const size = scene.theme.focalPoint.size * ls;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = canvasRenderer.rgbaToCssColor(scene.theme.focalPoint.color);
  for (const point of points) {
    if (!point || !isFinite(point.x) || !isFinite(point.y)) continue;
    ctx.fillRect(point.x - size / 2, point.y - size / 2, size, size);
  }
  ctx.restore();
}
