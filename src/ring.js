import { moodColor, toCSS, lerpColor, MOOD_COLORS, MOODS } from './mood.js';

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// Ring zone radii as fraction of available radius
const ZONES = {
  glowMax:       0.26,
  innerMin:      0.33,
  innerMax:      0.58,
  outerMin:      0.63,
  outerMax:      0.83,
};

const GAP = 0.012 * TWO_PI; // small gap between outer ring segments

export class RingRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'proportional'; // 'proportional' | 'chronological'

    this._currentColor = MOOD_COLORS.neutral.slice();
    this._targetColor  = MOOD_COLORS.neutral.slice();
    this._intensity    = 0.5;
    this._targetIntensity = 0.5;
    this._animFrame    = null;
    this._t            = 0;

    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width  = window.innerWidth  * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.ctx.scale(dpr, dpr);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.cx = this.W / 2;
    this.cy = this.H / 2;
    this.R  = Math.min(this.W, this.H) / 2 * 0.95;
  }

  setMode(mode) {
    this.mode = mode;
  }

  setCurrentMood(mood, intensity) {
    this._targetColor     = moodColor(mood).slice();
    this._targetIntensity = intensity;
  }

  start(history) {
    this._history = history;
    this._loop();
  }

  stop() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
  }

  _loop() {
    this._animFrame = requestAnimationFrame(() => {
      this._t = Date.now() / 1000;
      this._lerp();
      this._draw();
      this._loop();
    });
  }

  _lerp() {
    const speed = 0.04;
    this._currentColor = this._currentColor.map((v, i) =>
      v + (this._targetColor[i] - v) * speed
    );
    this._intensity += (this._targetIntensity - this._intensity) * speed;
  }

  _draw() {
    const { ctx, cx, cy, R, _t } = this;
    ctx.clearRect(0, 0, this.W, this.H);

    // Background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.W, this.H);

    if (!this._history || this._history.isEmpty) {
      this._drawIdle();
      return;
    }

    this._drawOuterRing();
    this._drawInnerRing();
    this._drawCenterGlow();
  }

  _drawIdle() {
    const { ctx, cx, cy, R, _t } = this;
    const pulse = 0.6 + 0.4 * Math.sin(_t * 0.8);
    const r = R * ZONES.glowMax * pulse;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, `rgba(80,80,80,0.15)`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.fill();
  }

  _drawCenterGlow() {
    const { ctx, cx, cy, R, _t, _intensity } = this;
    const pulse  = 1 + 0.12 * _intensity * Math.sin(_t * (2 + _intensity * 3));
    const radius = R * ZONES.glowMax * pulse;
    const color  = this._currentColor;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0,   toCSS(color, 0.9));
    grad.addColorStop(0.4, toCSS(color, 0.4));
    grad.addColorStop(1,   toCSS(color, 0));

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TWO_PI);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  _drawInnerRing() {
    const { ctx, cx, cy, R } = this;
    const recent = this._history.recent;
    if (!recent.length) return;

    const rMid   = R * (ZONES.innerMin + ZONES.innerMax) / 2;
    const rWidth = R * (ZONES.innerMax - ZONES.innerMin);
    const segAngle = TWO_PI / Math.max(recent.length, 1);
    const gapAngle = 0.008 * TWO_PI;

    recent.forEach(({ mood, intensity }, i) => {
      const start = -HALF_PI + i * segAngle + gapAngle / 2;
      const end   = -HALF_PI + (i + 1) * segAngle - gapAngle / 2;
      const color = moodColor(mood);
      const alpha = 0.55 + 0.45 * intensity;

      ctx.save();
      ctx.shadowBlur  = 18 * intensity;
      ctx.shadowColor = toCSS(color, 0.7);
      ctx.beginPath();
      ctx.arc(cx, cy, rMid, start, end);
      ctx.lineWidth   = rWidth;
      ctx.strokeStyle = toCSS(color, alpha);
      ctx.lineCap     = 'butt';
      ctx.stroke();
      ctx.restore();
    });
  }

  _drawOuterRing() {
    if (this.mode === 'proportional') {
      this._drawOuterProportional();
    } else {
      this._drawOuterChronological();
    }
  }

  _drawOuterProportional() {
    const { ctx, cx, cy, R } = this;
    const proportions = this._history.proportions;
    const rMid   = R * (ZONES.outerMin + ZONES.outerMax) / 2;
    const rWidth = R * (ZONES.outerMax - ZONES.outerMin);

    let angle = -HALF_PI;

    for (const [mood, fraction] of Object.entries(proportions)) {
      if (fraction === 0) continue;
      const span  = fraction * TWO_PI;
      const start = angle + GAP / 2;
      const end   = angle + span - GAP / 2;
      angle += span;

      if (end <= start) continue;

      const color = moodColor(mood);
      ctx.save();
      ctx.shadowBlur  = 10;
      ctx.shadowColor = toCSS(color, 0.5);
      ctx.beginPath();
      ctx.arc(cx, cy, rMid, start, end);
      ctx.lineWidth   = rWidth;
      ctx.strokeStyle = toCSS(color, 0.65);
      ctx.lineCap     = 'butt';
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawOuterChronological() {
    const { ctx, cx, cy, R } = this;
    const all = this._history.all;
    if (!all.length) return;

    const rMid    = R * (ZONES.outerMin + ZONES.outerMax) / 2;
    const rWidth  = R * (ZONES.outerMax - ZONES.outerMin);
    const segAngle = TWO_PI / all.length;
    const gapAngle = Math.min(GAP, segAngle * 0.15);

    all.forEach(({ mood, intensity }, i) => {
      const start = -HALF_PI + i * segAngle + gapAngle / 2;
      const end   = -HALF_PI + (i + 1) * segAngle - gapAngle / 2;
      if (end <= start) return;

      const color = moodColor(mood);
      const alpha = 0.4 + 0.3 * intensity;

      ctx.save();
      ctx.shadowBlur  = 8;
      ctx.shadowColor = toCSS(color, 0.4);
      ctx.beginPath();
      ctx.arc(cx, cy, rMid, start, end);
      ctx.lineWidth   = rWidth;
      ctx.strokeStyle = toCSS(color, alpha);
      ctx.lineCap     = 'butt';
      ctx.stroke();
      ctx.restore();
    });
  }
}
