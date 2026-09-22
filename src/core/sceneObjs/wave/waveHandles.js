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
 * @file The on-canvas controls shared by the wave scene objects.
 *
 * Most of what these objects do is set by numbers that have an obvious place on
 * the canvas — a focal length is a distance along the axis, a grating pitch is a
 * spacing across the aperture — and typing them into the object bar while
 * watching the picture is a poor substitute for moving them.
 *
 * Two conventions hold throughout:
 *
 * - Controls appear only while the object is selected. Every wave object has
 *   several of them, and drawn all at once on every object they bury the field
 *   they are supposed to be explaining.
 * - A control is drawn as the thing it sets. A focal point is a cross on the
 *   axis where the light comes together; a pitch is a pair of ticks one period
 *   apart. Nothing here is a generic square that has to be learnt.
 */

/** Half the arm length of a focal cross, in screen pixels. */
const FOCAL_CROSS_SIZE = 5;

/** How far from a control the pointer still counts as being on it, in pixels. */
const HANDLE_GRAB_RADIUS = 10;

/**
 * Colour of the controls.
 *
 * Cyan, because the controls are drawn over the field and the two colormaps
 * that matter — magma and twilight — are built from oranges, purples and greys.
 * An orange handle disappears into the middle of a magma focus, which is
 * exactly where a focal mark is meant to be.
 */
const HANDLE_COLOR = 'rgb(120, 225, 255)';

/** Colour of the guide lines drawn alongside the controls. */
const GUIDE_COLOR = 'rgba(120, 225, 255, 0.55)';

/** Drawn behind the controls so they read against a bright field as well as a dark one. */
const HANDLE_OUTLINE = 'rgba(0, 0, 0, 0.75)';

/** Length of the axis stub drawn through a focal mark, in screen pixels. */
const FOCAL_GUIDE_LENGTH = 26;

/**
 * Whether the pointer is close enough to a control to grab it.
 *
 * The tolerance is in screen pixels rather than scene units, so a control stays
 * equally easy to hit at every zoom level.
 *
 * @param {Mouse} mouse
 * @param {{x: number, y: number}} point - The control's position, in scene units.
 * @returns {boolean}
 */
export function isOnHandle(mouse, point) {
  const scale = mouse.scene?.scale || 1;
  const reach = HANDLE_GRAB_RADIUS / scale * (mouse.scene?.lengthScale || 1);
  return Math.hypot(mouse.pos.x - point.x, mouse.pos.y - point.y) <= reach;
}

/**
 * Draw a small cross, the mark used for a point light converges to or appears
 * to come from.
 *
 * @param {CanvasRenderer} canvasRenderer
 * @param {{x: number, y: number}} point
 * @param {string} [color]
 * @param {number} [size]
 */
export function drawCross(canvasRenderer, point, color = HANDLE_COLOR, size = FOCAL_CROSS_SIZE) {
  const ctx = canvasRenderer.ctx;
  const arm = size * canvasRenderer.lengthScale;
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(point.x - arm, point.y - arm);
  ctx.lineTo(point.x + arm, point.y + arm);
  ctx.moveTo(point.x - arm, point.y + arm);
  ctx.lineTo(point.x + arm, point.y - arm);
  // Stroked twice: a dark, wider pass first, so the mark survives being drawn
  // over the bright core of a focus, which is exactly where it belongs.
  ctx.strokeStyle = HANDLE_OUTLINE;
  ctx.lineWidth = 3.5 * canvasRenderer.lengthScale;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * canvasRenderer.lengthScale;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a grabbable round control.
 *
 * @param {CanvasRenderer} canvasRenderer
 * @param {{x: number, y: number}} point
 * @param {string} [color]
 */
export function drawHandle(canvasRenderer, point, color = HANDLE_COLOR) {
  const ctx = canvasRenderer.ctx;
  const radius = 4 * canvasRenderer.lengthScale;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = HANDLE_OUTLINE;
  ctx.lineWidth = 1.5 * canvasRenderer.lengthScale;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a faint dashed guide between two points.
 *
 * @param {CanvasRenderer} canvasRenderer
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @param {string} [color]
 */
export function drawGuide(canvasRenderer, from, to, color = GUIDE_COLOR) {
  const ctx = canvasRenderer.ctx;
  const ls = canvasRenderer.lengthScale;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 * ls;
  ctx.setLineDash([4 * ls, 4 * ls]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a short text label beside a control.
 *
 * Placed to the left of the control rather than above it, because the controls
 * on an interface are stacked vertically and close together: a label above
 * would land on its neighbour.
 *
 * @param {CanvasRenderer} canvasRenderer
 * @param {string} text
 * @param {{x: number, y: number}} point
 * @param {string} [color]
 */
export function drawHandleLabel(canvasRenderer, text, point, color = HANDLE_COLOR) {
  const ctx = canvasRenderer.ctx;
  const ls = canvasRenderer.lengthScale;
  ctx.save();
  ctx.font = `${12 * ls}px Arial`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3 * ls;
  ctx.strokeStyle = HANDLE_OUTLINE;
  ctx.strokeText(text, point.x - 9 * ls, point.y);
  ctx.fillStyle = color;
  ctx.fillText(text, point.x - 9 * ls, point.y);
  ctx.restore();
}

/**
 * The two focal points of an element, as marks on the optical axis through its
 * centre.
 *
 * Both signs are shown because which one the light actually uses depends on
 * which way it is travelling, and because a negative focal length has to be
 * legible as such: for a diverging element the mark on the incoming side is the
 * one the light appears to come from.
 *
 * @param {{x: number, y: number}} center - The element's centre.
 * @param {number} focalLength - Signed, positive for converging.
 * @returns {{positive: {x: number, y: number}, negative: {x: number, y: number}}}
 */
export function focalPoints(center, focalLength) {
  return {
    positive: { x: center.x + focalLength, y: center.y },
    negative: { x: center.x - focalLength, y: center.y },
  };
}

/**
 * Draw the pair of focal marks and the axis they sit on.
 *
 * @param {CanvasRenderer} canvasRenderer
 * @param {{x: number, y: number}} center
 * @param {number} focalLength
 */
export function drawFocalMarks(canvasRenderer, center, focalLength) {
  if (!Number.isFinite(focalLength) || focalLength === 0) return;
  const { positive, negative } = focalPoints(center, focalLength);
  // A short stub of axis through each mark rather than a line joining them: the
  // two are a whole focal length apart, and a dashed line that long reads as
  // part of the scene instead of as an annotation on one object.
  const stub = FOCAL_GUIDE_LENGTH * canvasRenderer.lengthScale;
  for (const point of [positive, negative]) {
    drawGuide(
      canvasRenderer,
      { x: point.x - stub, y: point.y },
      { x: point.x + stub, y: point.y }
    );
    drawCross(canvasRenderer, point);
  }
  drawHandleLabel(canvasRenderer, 'f', positive);
  drawHandleLabel(canvasRenderer, '−f', negative);
}

/**
 * Which focal mark, if either, the pointer is on.
 *
 * @param {Mouse} mouse
 * @param {{x: number, y: number}} center
 * @param {number} focalLength
 * @returns {{sign: number, point: {x: number, y: number}}|null}
 */
export function focalHandleAt(mouse, center, focalLength) {
  if (!Number.isFinite(focalLength) || focalLength === 0) return null;
  const { positive, negative } = focalPoints(center, focalLength);
  if (isOnHandle(mouse, positive)) return { sign: 1, point: positive };
  if (isOnHandle(mouse, negative)) return { sign: -1, point: negative };
  return null;
}
