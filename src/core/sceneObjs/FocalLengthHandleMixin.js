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

import geometry from '../geometry.js';

/**
 * The mixin for line-shaped ideal elements whose focal length can be dragged directly on the canvas.
 *
 * The two focal points either side of the element are control points: dragging one sets the focal
 * length to its distance from the centre. This makes the focal length a direct manipulation rather
 * than only a number to type, which matters when the element is presented to a student in a
 * restricted scene with no property controls. The handles report `focalLength` as their property
 * name, so a scene's `interaction.properties.focalLength` governs the drag and the number control
 * together.
 * @template {typeof BaseSceneObj} T
 * @param {T} Base
 * @returns {T}
 */
const FocalLengthHandleMixin = Base => class extends Base {

  /** The index of the first focal-point part, after the two endpoints handled by `LineObjMixin`. */
  static FOCAL_PART_FIRST = 3;

  /**
   * The unit normal of the element, along which the focal points lie.
   * @returns {Point|null} The normal, or null if the element is degenerate.
   */
  getFocalNormal() {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) return null;
    return geometry.point(dy / len, -dx / len);
  }

  /**
   * The two focal points, which are both the markers drawn on the canvas and the drag handles.
   * @returns {Array<Point>} The focal points, or an empty array if the element is degenerate.
   */
  getFocalPoints() {
    const normal = this.getFocalNormal();
    if (!normal) return [];
    const mid = geometry.segmentMidpoint(this);
    return [
      geometry.point(mid.x + this.focalLength * normal.x, mid.y + this.focalLength * normal.y),
      geometry.point(mid.x - this.focalLength * normal.x, mid.y - this.focalLength * normal.y),
    ];
  }

  getInteractionHandles() {
    const handles = super.getInteractionHandles();
    this.getFocalPoints().forEach((point, i) => {
      handles.push({
        point,
        propertyKey: 'focalLength',
        part: this.constructor.FOCAL_PART_FIRST + i,
      });
    });
    return handles;
  }

  checkMouseOver(mouse) {
    const focalPoints = this.getFocalPoints();
    for (let i = 0; i < focalPoints.length; i++) {
      if (mouse.isOnPoint(focalPoints[i])) {
        return {
          part: this.constructor.FOCAL_PART_FIRST + i,
          // `targetPoint_` rather than `targetPoint`: the editor should recognise the handle, but the
          // coordinate box and the handle binding are about positions, and this one sets a length.
          targetPoint_: geometry.point(focalPoints[i].x, focalPoints[i].y),
          propertyKey: 'focalLength',
          requiresObjBarUpdate: true,
          cursor: 'pointer',
        };
      }
    }
    return super.checkMouseOver(mouse);
  }

  onDrag(mouse, dragContext, ctrl, shift) {
    const focalPart = dragContext.part - this.constructor.FOCAL_PART_FIRST;
    if (focalPart === 0 || focalPart === 1) {
      const normal = this.getFocalNormal();
      if (!normal) return;
      const mid = geometry.segmentMidpoint(this);
      const pos = mouse.getPosSnappedToGrid();
      const sign = focalPart === 0 ? 1 : -1;
      this.focalLength = sign * ((pos.x - mid.x) * normal.x + (pos.y - mid.y) * normal.y);
      return;
    }
    super.onDrag(mouse, dragContext, ctrl, shift);
  }

  /**
   * Draw the focal points as small square markers.
   * @param {CanvasRenderer} canvasRenderer - The renderer.
   */
  drawFocalHandles(canvasRenderer) {
    const ctx = canvasRenderer.ctx;
    const ls = canvasRenderer.lengthScale;
    ctx.fillStyle = 'rgb(255,0,255)';
    for (const point of this.getFocalPoints()) {
      ctx.fillRect(point.x - 1.5 * ls, point.y - 1.5 * ls, 3 * ls, 3 * ls);
    }
  }
};

export default FocalLengthHandleMixin;
