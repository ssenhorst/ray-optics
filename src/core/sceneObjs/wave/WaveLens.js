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

import WaveInterface from './WaveInterface.js';
import geometry from '../../geometry.js';
import i18next from 'i18next';
import {
  drawFocalMarks, focalHandleAt, isOnHandle, drawHandle, drawHandleLabel
} from './waveHandles.js';

/** The thinnest a lens may be made by dragging, in scene length units. */
const MIN_THICKNESS = 1;

/** The shortest focal length a drag may set, in scene length units. */
const MIN_FOCAL_LENGTH = 1;

/**
 * A real lens: two spherical surfaces with glass between them.
 *
 * The scene already has a way to bring light to a focus — an interface carrying
 * the phase `-k y^2 / (2 f)` — but that is an ideal thin lens by construction,
 * and it focuses perfectly however it is set up. This is the other thing, the
 * one that shows why real lenses do not: light is refracted twice, by curvature
 * alone, so the focus it produces carries the spherical aberration of the
 * geometry and shifts as the glass is made thicker. Comparing the two in the
 * same scene is the point of having both.
 *
 * The curvature follows from the focal length by the lensmaker's equation for
 * a symmetric biconvex lens, `1/f = 2 (n/n0 - 1) / R`, so the focal length
 * control is the parameter and the shape is derived. That is the way round a
 * user wants it, and it stays honest because nothing else is adjusted to make
 * the focus land where the label says: at a large aperture or a short focal
 * length it will not, and that is the lens being a lens.
 *
 * The chord from `p1` to `p2` is the aperture, as for every other interface;
 * the two surfaces are placed symmetrically about it.
 *
 * Tools -> Interfaces -> Lens
 * @class
 * @extends WaveInterface
 * @memberof sceneObjs
 * @property {Point} p1 - One end of the aperture.
 * @property {Point} p2 - The other end of the aperture.
 * @property {number} focalLength - Signed focal length; positive converges.
 * @property {number} refractiveIndex - Index of the glass between the surfaces.
 * @property {number} refractiveIndexAfter - Index of the subspace after the lens.
 * @property {number} thickness - Thickness of the glass at its thinnest, in scene length units.
 */
class WaveLens extends WaveInterface {
  static type = 'WaveLens';
  static isOptical = true;
  static serializableDefaults = {
    p1: null,
    p2: null,
    focalLength: 300,
    refractiveIndex: 1.5,
    refractiveIndexAfter: 1,
    thickness: 8
  };

  static getDescription(objData, scene, detailed = false) {
    return i18next.t('main:waveTools.WaveLens.title');
  }

  static getPropertySchema(objData, scene) {
    return [
      { key: 'p1', type: 'point', label: i18next.t('simulator:sceneObjs.LineObjMixin.endpoint1') },
      { key: 'p2', type: 'point', label: i18next.t('simulator:sceneObjs.LineObjMixin.endpoint2') },
      { key: 'focalLength', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.focalLength') },
      { key: 'refractiveIndex', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.glassIndex') },
      { key: 'thickness', type: 'number', label: i18next.t('simulator:waveSceneObjs.common.lensThickness') },
      {
        key: 'refractiveIndexAfter', type: 'number',
        label: i18next.t('simulator:waveSceneObjs.common.refractiveIndexAfter')
      },
    ];
  }

  populateObjBar(objBar) {
    objBar.setTitle(i18next.t('main:waveTools.WaveLens.title'));
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.focalLength'), -2000, 2000, 5, this.focalLength,
      function (obj, value) { obj.focalLength = value; },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.lensFocalLengthInfo') + '</p>'
    );
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.glassIndex'), 1.05, 4, 0.01, this.refractiveIndex,
      function (obj, value) { obj.refractiveIndex = value; },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.glassIndexInfo') + '</p>'
    );
    objBar.createNumber(
      i18next.t('simulator:waveSceneObjs.common.lensThickness'), MIN_THICKNESS, 200, 1, this.thickness,
      function (obj, value) { obj.thickness = Math.max(MIN_THICKNESS, value); },
      '<p>' + i18next.t('simulator:waveSceneObjs.common.lensThicknessInfo') + '</p>'
    );
    if (objBar.showAdvanced(!this.arePropertiesDefault(['refractiveIndexAfter']))) {
      objBar.createNumber(
        i18next.t('simulator:waveSceneObjs.common.refractiveIndexAfter'),
        0.1, 5, 0.01, this.refractiveIndexAfter,
        function (obj, value) { obj.refractiveIndexAfter = value; },
        '<p>' + i18next.t('simulator:waveSceneObjs.common.refractiveIndexAfterInfo') + '</p>'
      );
    }
  }

  /** The index of the medium the lens is taken to sit in. */
  ambientIndex() {
    return this.refractiveIndexAfter > 0 ? this.refractiveIndexAfter : 1;
  }

  /**
   * The radius of curvature of each surface, from the lensmaker's equation.
   *
   * Symmetric and biconvex, so the two surfaces have radii `R` and `-R` and the
   * equation collapses to `1/f = 2 (n/n0 - 1) / R`. A negative focal length
   * gives a negative radius, which is the same formula describing a biconcave
   * lens; no separate case is needed.
   *
   * @returns {number} Infinite when the glass matches its surroundings, which
   *   is a lens that does nothing rather than an error.
   */
  radiusOfCurvature() {
    const contrast = this.refractiveIndex / this.ambientIndex() - 1;
    if (!(Math.abs(contrast) > 1e-6)) return Infinity;
    return 2 * this.focalLength * contrast;
  }

  /**
   * The sag of one surface at a transverse offset from the centre: how far the
   * glass reaches beyond the vertex.
   *
   * Spherical, not parabolic. The difference between the two *is* the spherical
   * aberration, which is most of the reason for preferring a modelled lens to a
   * quadratic phase in the first place.
   *
   * @param {number} y - Offset from the centre of the aperture.
   * @returns {number} Positive for a converging lens, negative for a diverging one.
   */
  sagAt(y) {
    const radius = this.radiusOfCurvature();
    if (!Number.isFinite(radius)) return 0;
    const ratio = y / radius;
    // Beyond the radius the sphere has turned back on itself and there is no
    // surface left; the edge is held there rather than returning NaN.
    if (Math.abs(ratio) >= 1) return radius;
    return radius * (1 - Math.sqrt(1 - ratio * ratio));
  }

  /** Half the aperture, as an offset from the centre. */
  halfAperture() {
    if (!this.p1 || !this.p2) return 0;
    return Math.abs(this.p2.y - this.p1.y) / 2;
  }

  /**
   * The thickness of the glass on the axis.
   *
   * `thickness` is the thinnest part, which is the edge of a converging lens
   * and the centre of a diverging one. Stating it that way means the control
   * has the same meaning for both signs and can never be set to a value that
   * would make the glass vanish somewhere.
   *
   * @returns {number}
   */
  centerThickness() {
    const edgeSag = this.sagAt(this.halfAperture());
    return Math.max(MIN_THICKNESS, this.thickness) + 2 * Math.max(0, edgeSag);
  }

  /** The centre of the aperture. */
  center() {
    if (!this.p1 || !this.p2) return { x: 0, y: 0 };
    return { x: (this.p1.x + this.p2.x) / 2, y: (this.p1.y + this.p2.y) / 2 };
  }

  /**
   * The two refracting surfaces, in order along the optical axis.
   *
   * They are rebuilt on each call rather than cached, so that no parameter can
   * be changed without the surfaces following. Building them is a few object
   * allocations; the sampling they then drive is what actually costs anything.
   *
   * @returns {Array<WaveLensSurface>}
   */
  getSurfaces() {
    if (!this.isValid()) return [];
    const half = this.centerThickness() / 2;
    this._surfaces = [
      new WaveLensSurface(this, -1, half),
      new WaveLensSurface(this, 1, half),
    ];
    return this._surfaces;
  }

  /** @returns {boolean} Whether the aperture spans a usable transverse range. */
  isValid() {
    return Boolean(this.p1) && Boolean(this.p2) && this.p1.y !== this.p2.y;
  }

  /**
   * The lens as a whole is not a surface — it is two — so the single-valued
   * profile the base class expects is taken to be the plane between them. That
   * is only ever used for ordering and for the object bar; the optics all go
   * through {@link WaveLens#getSurfaces}.
   */
  zAt() {
    return this.isValid() ? this.center().x : NaN;
  }

  meanZ() {
    return this.zAt();
  }

  /**
   * The outline of the glass, as one closed path.
   * @returns {Array<{x: number, y: number}>}
   */
  outlinePoints(count = 48) {
    if (!this.isValid()) return [];
    const center = this.center();
    const half = this.centerThickness() / 2;
    const halfAperture = this.halfAperture();
    const front = [];
    const back = [];
    for (let i = 0; i <= count; i++) {
      const y = -halfAperture + 2 * halfAperture * i / count;
      const sag = this.sagAt(y);
      front.push({ x: center.x - half + sag, y: center.y + y });
      back.push({ x: center.x + half - sag, y: center.y + y });
    }
    return [...front, ...back.reverse()];
  }

  checkMouseOver(mouse) {
    if (!this.isValid()) return;

    // The controls are only drawn while the lens is selected, so they are only
    // grabbable then too: an invisible handle that steals a click is worse than
    // no handle at all.
    if (this.isSelected()) {
      const focal = focalHandleAt(mouse, this.center(), this.focalLength);
      if (focal) {
        return {
          part: 3,
          targetPoint: geometry.point(focal.point.x, focal.point.y),
          focalSign: focal.sign,
        };
      }
      const thicknessHandle = this.thicknessHandlePoint();
      if (isOnHandle(mouse, thicknessHandle)) {
        return {
          part: 4,
          targetPoint: geometry.point(thicknessHandle.x, thicknessHandle.y),
        };
      }
    }

    if (mouse.isOnPoint(this.p1) &&
      geometry.distanceSquared(mouse.pos, this.p1) <= geometry.distanceSquared(mouse.pos, this.p2)) {
      return { part: 1, targetPoint: geometry.point(this.p1.x, this.p1.y) };
    }
    if (mouse.isOnPoint(this.p2)) {
      return { part: 2, targetPoint: geometry.point(this.p2.x, this.p2.y) };
    }

    const outline = this.outlinePoints();
    for (let i = 0; i < outline.length; i++) {
      const next = outline[(i + 1) % outline.length];
      if (mouse.isOnSegment(geometry.line(outline[i], next))) {
        const mousePos = mouse.getPosSnappedToGrid();
        return { part: 0, mousePos0: mousePos, mousePos1: mousePos, snapContext: {} };
      }
    }
  }

  /**
   * Where the control that sets the thickness sits: the back vertex, on the
   * axis. Putting it on the rim instead would land it on the aperture endpoint,
   * which is a different control.
   */
  thicknessHandlePoint() {
    const center = this.center();
    return { x: center.x + this.centerThickness() / 2, y: center.y };
  }

  onDrag(mouse, dragContext, ctrl, shift) {
    if (dragContext.part === 3) {
      // Dragging a focal mark sets the focal length to its distance from the
      // centre. Dragging it through the centre and out the other side flips the
      // sign, which is what actually happens to a focus when a lens turns from
      // converging to diverging, so it needs no separate control.
      const center = this.center();
      const signed = (mouse.pos.x - center.x) * dragContext.focalSign;
      this.focalLength = Math.sign(signed) * Math.max(MIN_FOCAL_LENGTH, Math.abs(signed));
      return;
    }
    if (dragContext.part === 4) {
      // The handle is the back vertex, so its distance from the centre plane is
      // half the thickness on the axis. `thickness` is the thinnest part, which
      // for a converging lens is the rim, a sag further in on each side.
      const halfAxis = Math.abs(mouse.pos.x - this.center().x);
      const edgeSag = this.sagAt(this.halfAperture());
      this.thickness = Math.max(MIN_THICKNESS, 2 * (halfAxis - Math.max(0, edgeSag)));
      return;
    }
    super.onDrag(mouse, dragContext, ctrl, shift);
  }

  draw(canvasRenderer, isAboveLight, isHovered) {
    if (!isAboveLight) return;

    const ctx = canvasRenderer.ctx;
    const ls = canvasRenderer.lengthScale;

    if (!this.isValid()) {
      ctx.fillStyle = 'rgb(128,128,128)';
      ctx.fillRect(this.p1.x - 1.5 * ls, this.p1.y - 1.5 * ls, 3 * ls, 3 * ls);
      return;
    }

    const color = isHovered
      ? this.scene.highlightColorCss
      : canvasRenderer.rgbaToCssColor(this.scene.theme.mirror.color);

    const outline = this.outlinePoints();
    ctx.save();
    ctx.beginPath();
    outline.forEach((point, i) => {
      if (i === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    // A translucent fill so the glass reads as a body with an index rather than
    // as a pair of unrelated curves, without hiding the field inside it.
    ctx.fillStyle = 'rgba(160, 200, 255, 0.14)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 * ls;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.restore();

    // Past the aperture the lens is an opaque screen, like any other interface.
    const center = this.center();
    const halfAperture = this.halfAperture();
    const stub = Math.min(halfAperture * 0.3, 40 * ls);
    const edgeX = center.x + this.centerThickness() / 2 - this.sagAt(halfAperture);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash([3 * ls, 3 * ls]);
    ctx.lineWidth = 1 * ls;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(edgeX, center.y + halfAperture);
    ctx.lineTo(edgeX, center.y + halfAperture + stub);
    ctx.moveTo(edgeX, center.y - halfAperture);
    ctx.lineTo(edgeX, center.y - halfAperture - stub);
    ctx.stroke();
    ctx.restore();

    if (isHovered || this.isSelected()) {
      for (const end of [this.p1, this.p2]) {
        canvasRenderer.drawPoint(
          end,
          isHovered ? this.scene.highlightColor : this.scene.theme.sourcePoint.color,
          this.scene.theme.sourcePoint.size
        );
      }
    }
    if (this.isSelected()) {
      drawFocalMarks(canvasRenderer, center, this.focalLength);
      const thicknessHandle = this.thicknessHandlePoint();
      drawHandle(canvasRenderer, thicknessHandle);
      drawHandleLabel(canvasRenderer, 't', thicknessHandle);
    }
  }

  getWarning() {
    if (!this.isValid()) return null;
    const radius = this.radiusOfCurvature();
    if (Number.isFinite(radius) && this.halfAperture() >= Math.abs(radius)) {
      return i18next.t('simulator:waveSceneObjs.common.lensApertureWarning');
    }
    if (this._surfaces) {
      for (const surface of this._surfaces) {
        if (surface.error) return surface.error;
      }
    }
    return super.getWarning();
  }

  /** The lens contributes its surfaces, not itself. */
  getSurfaceSamples() {
    return [];
  }

  /** Wave objects take no part in ray tracing. */
  checkRayIntersects(ray) {
    return null;
  }
}

/**
 * One of a lens's two refracting surfaces.
 *
 * It is a {@link WaveInterface} so that all the sampling, the arc-length
 * weighting and the lookup-table machinery apply unchanged; only where the
 * surface sits and what it transmits are taken from the lens instead of from
 * equations. These are never part of `scene.objs` and are never serialized —
 * the lens is what the scene holds, and it rebuilds them on demand.
 *
 * @class
 * @extends WaveInterface
 * @memberof sceneObjs
 */
class WaveLensSurface extends WaveInterface {
  static type = 'WaveLensSurface';

  /**
   * @param {WaveLens} lens
   * @param {number} side - -1 for the surface light reaches first, +1 for the second.
   * @param {number} halfThickness - Half the glass thickness on the axis.
   */
  constructor(lens, side, halfThickness) {
    const center = lens.center();
    const halfAperture = lens.halfAperture();
    super(lens.scene, {
      p1: { x: center.x + side * halfThickness, y: center.y - halfAperture },
      p2: { x: center.x + side * halfThickness, y: center.y + halfAperture },
      refractiveIndexAfter: side < 0 ? lens.refractiveIndex : lens.refractiveIndexAfter,
    });
    this.lens = lens;
    this.side = side;
    this.halfThickness = halfThickness;
  }

  zAt(y) {
    if (!this.isValid()) return NaN;
    const center = this.lens.center();
    const halfAperture = this.lens.halfAperture();
    const local = Math.min(halfAperture, Math.max(-halfAperture, y - center.y));
    // The two surfaces bulge away from each other by the same sag, so the glass
    // is thickest on the axis for a converging lens and thinnest for a
    // diverging one.
    return center.x + this.side * (this.halfThickness - this.lens.sagAt(local));
  }

  /** The surfaces refract by shape alone; there is nothing else on them. */
  transmissionAt() {
    return { amplitude: 1, phase: 0 };
  }

  minimumFeatureSize() {
    return null;
  }
}

export { WaveLensSurface };
export default WaveLens;
