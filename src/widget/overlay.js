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
 * @file `src/widget/overlay.js` draws the goal targets, the affordance markers, the live feedback
 * marks and the completion celebration on a transparent canvas above the simulation, on its own
 * animation loop so that the feedback keeps moving without re-running the ray tracing.
 *
 * The affordance markers are what tells the student which parts of the scene they are allowed to
 * touch. A scene can restrict interaction down to individual properties, and without a positive
 * indication the only way to find out what is live is to hover over everything, so every handle the
 * permissions allow is marked directly.
 */

const TAU = Math.PI * 2;

/**
 * Linearly interpolate between two colors given as `[r, g, b]`.
 * @param {Array<number>} a - The first color.
 * @param {Array<number>} b - The second color.
 * @param {number} t - The interpolation parameter, clamped to [0, 1].
 * @returns {string} A CSS color string.
 */
function mix(a, b, t) {
  const u = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * u)},${Math.round(a[1] + (b[1] - a[1]) * u)},${Math.round(a[2] + (b[2] - a[2]) * u)})`;
}

const PENDING = [240, 180, 41];
const DONE = [52, 211, 153];
const FORBIDDEN = [248, 113, 113];
const AFFORDANCE = 'rgba(125, 211, 252, 0.95)';

/**
 * The animated overlay showing where the student has to send the light and how close they are.
 * @class
 */
class GoalOverlay {
  /**
   * @param {HTMLCanvasElement} canvas - The transparent canvas above the simulation.
   * @param {Scene} scene - The scene, used for the viewport transform.
   */
  constructor(canvas, scene) {
    /** @property {HTMLCanvasElement} canvas - The overlay canvas. */
    this.canvas = canvas;
    /** @property {CanvasRenderingContext2D} ctx - The drawing context of the overlay. */
    this.ctx = canvas.getContext('2d');
    /** @property {Scene} scene - The scene providing the viewport transform. */
    this.scene = scene;
    /** @property {number} dpr - The device pixel ratio of the overlay canvas. */
    this.dpr = 1;

    /** @property {Array<Object>} targets - The target shapes to draw. */
    this.targets = [];
    /**
     * @property {Array<Object>} affordances - The places the student is allowed to grab, as
     * `{ type: 'handle'|'move', x, y }` in scene coordinates.
     */
    this.affordances = [];
    /** @property {Array<Object>} goals - The last evaluated goal results, parallel to the task goals. */
    this.goals = [];
    /** @property {Array<Object>} bursts - The transient completion animations in flight. */
    this.bursts = [];
    /** @property {Array<Object>} confetti - The particles of the completion celebration. */
    this.confetti = [];
    /**
     * @property {Array<Object>} pictures - The object and image pictures to draw, each
     * `{ image, top, bottom, flipped, opacity }` with the points in scene coordinates.
     */
    this.pictures = [];

    this.running = false;
    this.frameId = null;
    this.lastTime = 0;
    this.time = 0;
  }

  /**
   * Replace the target shapes, e.g. after loading or resetting a scene.
   * @param {Array<Object>} targets - The target shapes in scene coordinates.
   */
  setTargets(targets) {
    this.targets = targets || [];
  }

  /**
   * Replace the pictures drawn at the object and at its image.
   * @param {Array<Object>} pictures - The pictures to draw.
   */
  setPictures(pictures) {
    this.pictures = pictures || [];
  }

  /**
   * Replace the markers showing where the scene can be grabbed.
   * @param {Array<Object>} affordances - The markers in scene coordinates.
   */
  setAffordances(affordances) {
    this.affordances = affordances || [];
  }

  /**
   * Update the evaluated goal state that drives the colors and the progress arcs.
   * @param {Array<Object>} goals - The goal results from the task evaluator.
   */
  setGoals(goals) {
    this.goals = goals || [];
  }

  /**
   * Start a ring-burst animation at a target, used when its goal has just been met.
   * @param {number} goalIndex - The index of the goal that was met.
   */
  burstAt(goalIndex) {
    for (const target of this.targets) {
      if (target.goalIndex === goalIndex) {
        this.bursts.push({ x: target.x, y: target.y, r: target.r, age: 0 });
      }
    }
  }

  /**
   * Launch the confetti celebration for completing the whole task.
   */
  celebrate() {
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    const colors = ['#34d399', '#4da3ff', '#f0b429', '#f472b6', '#a78bfa'];
    for (let i = 0; i < 140; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      const speed = 260 + Math.random() * 420;
      this.confetti.push({
        x: width / 2 + (Math.random() - 0.5) * width * 0.35,
        y: height * 0.62,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 4 + Math.random() * 6,
        spin: (Math.random() - 0.5) * 14,
        rotation: Math.random() * TAU,
        color: colors[(Math.random() * colors.length) | 0],
        life: 0,
        maxLife: 1.6 + Math.random() * 1.1,
      });
    }
  }

  /** Start the animation loop. */
  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const step = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.time += dt;
      this.update(dt);
      this.draw();
      this.frameId = requestAnimationFrame(step);
    };
    this.frameId = requestAnimationFrame(step);
  }

  /** Stop the animation loop. */
  stop() {
    this.running = false;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  /**
   * Advance the transient animations.
   * @param {number} dt - The elapsed time in seconds.
   */
  update(dt) {
    this.bursts = this.bursts.filter(burst => {
      burst.age += dt;
      return burst.age < 0.9;
    });

    const height = this.canvas.height / this.dpr;
    this.confetti = this.confetti.filter(p => {
      p.life += dt;
      p.vy += 900 * dt;
      p.vx *= 1 - 0.9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
      return p.life < p.maxLife && p.y < height + 40;
    });
  }

  /** Redraw the overlay. */
  draw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Scene-space drawing: the same transform the simulator uses.
    ctx.setTransform(
      this.scene.scale * this.dpr, 0, 0, this.scene.scale * this.dpr,
      this.scene.origin.x * this.dpr, this.scene.origin.y * this.dpr
    );

    for (const picture of this.pictures) {
      this.drawPicture(ctx, picture);
    }
    for (const affordance of this.affordances) {
      this.drawAffordance(ctx, affordance);
    }
    for (const target of this.targets) {
      this.drawTarget(ctx, target);
    }
    for (const burst of this.bursts) {
      this.drawBurst(ctx, burst);
    }
    for (const goal of this.goals) {
      for (const mark of goal.marks || []) {
        if (mark.type === 'point') this.drawFocusMark(ctx, mark, goal);
      }
    }

    // Screen-space drawing for the celebration, which should not scale with the scene.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const p of this.confetti) {
      this.drawConfetto(ctx, p);
    }
  }

  /**
   * Draw one picture spanning from its bottom point to its top point, upright on the page and
   * mirrored when the image it stands for is inverted.
   * @param {CanvasRenderingContext2D} ctx - The context, already in scene coordinates.
   * @param {Object} picture - The picture and where it goes.
   */
  drawPicture(ctx, picture) {
    const image = picture.image;
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight) return;

    const height = Math.abs(picture.top.y - picture.bottom.y);
    if (!(height > 0)) return;
    const width = height * (image.naturalWidth / image.naturalHeight);

    // The picture stands between the two points, centred on them horizontally.
    const centerX = (picture.top.x + picture.bottom.x) / 2;
    const topY = Math.min(picture.top.y, picture.bottom.y);

    ctx.save();
    ctx.globalAlpha = picture.opacity ?? 1;
    ctx.translate(centerX, topY + height / 2);
    if (picture.flipped) {
      // A real image is reversed both ways, so mirror it in both directions rather than only
      // turning it upside down.
      ctx.scale(-1, -1);
    }
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
  }

  /**
   * Draw a marker showing that something can be grabbed: a ring around a draggable control point, or
   * a four-way arrow at the centre of an object that can be moved as a whole.
   * @param {CanvasRenderingContext2D} ctx - The context, already in scene coordinates.
   * @param {Object} affordance - The marker.
   */
  drawAffordance(ctx, affordance) {
    const scale = this.scene.scale || 1;
    const breathe = 0.85 + 0.15 * Math.sin(this.time * 2);

    ctx.save();
    ctx.strokeStyle = AFFORDANCE;
    ctx.lineWidth = 1.5 / scale;
    ctx.globalAlpha = 0.9;

    if (affordance.type === 'handle') {
      const r = 7 / scale;
      ctx.beginPath();
      ctx.arc(affordance.x, affordance.y, r * breathe, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = AFFORDANCE;
      ctx.fill();
    } else {
      // A small four-way arrow, the conventional "drag me" glyph.
      const a = 7 / scale;
      const head = 2.6 / scale;
      ctx.beginPath();
      ctx.moveTo(affordance.x - a, affordance.y);
      ctx.lineTo(affordance.x + a, affordance.y);
      ctx.moveTo(affordance.x, affordance.y - a);
      ctx.lineTo(affordance.x, affordance.y + a);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const tipX = affordance.x + dx * a;
        const tipY = affordance.y + dy * a;
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - dx * head + dy * head, tipY - dy * head + dx * head);
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - dx * head - dy * head, tipY - dy * head - dx * head);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Draw one goal target: a ring whose color and progress arc track how close the student is.
   * @param {CanvasRenderingContext2D} ctx - The context, already in scene coordinates.
   * @param {Object} target - The target shape.
   */
  drawTarget(ctx, target) {
    const goal = this.goals[target.goalIndex];
    const progress = goal ? Math.max(0, Math.min(1, goal.progress)) : 0;
    const satisfied = goal ? goal.satisfied : false;
    const scale = this.scene.scale || 1;
    const lineWidth = 2 / scale;

    // Stay visibly amber until the goal is actually met, so a half-filled arc is never mistaken for
    // a solved target.
    const base = target.forbidden ? FORBIDDEN
      : satisfied ? mix(DONE, DONE, 1)
        : mix(PENDING, DONE, progress * 0.45);
    const pulse = satisfied ? 1 : 0.75 + 0.25 * Math.sin(this.time * 3.2);

    ctx.save();
    ctx.lineWidth = lineWidth;

    // A soft halo so the target stands out against the rays.
    ctx.globalAlpha = 0.16 * pulse;
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r, 0, TAU);
    ctx.fill();

    // The tolerance circle itself.
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = base;
    ctx.setLineDash(target.forbidden ? [6 / scale, 4 / scale] : []);
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // The progress arc, drawn just outside the tolerance circle.
    if (!target.forbidden) {
      const arcRadius = target.r + 6 / scale;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(target.x, target.y, arcRadius, 0, TAU);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.lineWidth = 3 / scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(target.x, target.y, arcRadius, -Math.PI / 2, -Math.PI / 2 + TAU * progress);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // A crosshair at the exact point being aimed at.
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = lineWidth;
    const tick = target.r * 0.35;
    ctx.beginPath();
    ctx.moveTo(target.x - tick, target.y);
    ctx.lineTo(target.x + tick, target.y);
    ctx.moveTo(target.x, target.y - tick);
    ctx.lineTo(target.x, target.y + tick);
    ctx.stroke();

    if (target.label) {
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = base;
      ctx.font = `${13 / scale}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(target.label, target.x, target.y - target.r - 10 / scale);
    }

    ctx.restore();
  }

  /**
   * Draw an expanding ring marking the moment a goal was met.
   * @param {CanvasRenderingContext2D} ctx - The context, already in scene coordinates.
   * @param {Object} burst - The burst state.
   */
  drawBurst(ctx, burst) {
    const t = burst.age / 0.9;
    const scale = this.scene.scale || 1;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = mix(DONE, [255, 255, 255], t * 0.5);
    ctx.lineWidth = (4 * (1 - t) + 0.5) / scale;
    ctx.beginPath();
    ctx.arc(burst.x, burst.y, burst.r * (1 + t * 3.5), 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw the measured focus of the rays, so the student can see where the light actually converges.
   * @param {CanvasRenderingContext2D} ctx - The context, already in scene coordinates.
   * @param {Object} mark - The mark to draw.
   * @param {Object} goal - The goal the mark belongs to.
   */
  drawFocusMark(ctx, mark, goal) {
    const scale = this.scene.scale || 1;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = goal.satisfied ? mix(DONE, DONE, 1) : '#ffffff';
    ctx.lineWidth = 1.5 / scale;
    const s = 6 / scale;
    ctx.beginPath();
    ctx.moveTo(mark.x - s, mark.y - s);
    ctx.lineTo(mark.x + s, mark.y + s);
    ctx.moveTo(mark.x + s, mark.y - s);
    ctx.lineTo(mark.x - s, mark.y + s);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw one confetti particle.
   * @param {CanvasRenderingContext2D} ctx - The context, in CSS pixels.
   * @param {Object} p - The particle state.
   */
  drawConfetto(ctx, p) {
    const fade = Math.max(0, 1 - p.life / p.maxLife);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    ctx.restore();
  }
}

export default GoalOverlay;
