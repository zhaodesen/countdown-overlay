/**
 * Configurable Canvas 2D particle field for the center "energy burst".
 * Runs its own rAF loop; `burst()` emits a radial spray whose look is driven
 * by per-theme options (color, shape, gravity, drag, shockwave).
 *
 * Stable, dependency-free interface — can be swapped for a WebGL/Three.js
 * implementation later without touching the themes.
 */

export type ParticleShape = "circle" | "spark" | "rect" | "star" | "petal";

export interface BurstOptions {
  count?: number;
  speed?: number;
  /** Returns a CSS color for a particle, given a 0..1 random seed. */
  color?: (seed: number) => string;
  shape?: ParticleShape;
  gravity?: number; // px/s^2 (positive = downward)
  drag?: number; // velocity multiplier per frame (0.9..0.99)
  size?: [number, number];
  life?: [number, number];
  glow?: boolean;
  shockwave?: boolean;
  shockColor?: string;
  spread?: number; // angular spread in radians (default full circle)
  angle?: number; // center angle when spread < 2π
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  shape: ParticleShape;
  glow: boolean;
  gravity: number;
  drag: number;
}

interface Wave {
  x: number;
  y: number;
  t: number;
  color: string;
}

export class ParticleField {
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private waves: Wave[] = [];
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private raf = 0;
  private last = 0;
  private running = false;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  private resize = () => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.canvas.style.width = window.innerWidth + "px";
    this.canvas.style.height = window.innerHeight + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  burst(opts: BurstOptions = {}, atX?: number, atY?: number) {
    const cx = atX ?? window.innerWidth / 2;
    const cy = atY ?? window.innerHeight / 2;
    const count = opts.count ?? 160;
    const baseSpeed = opts.speed ?? 520;
    const color = opts.color ?? (() => "hsl(190,100%,60%)");
    const shape = opts.shape ?? "circle";
    const gravity = opts.gravity ?? 60;
    const drag = opts.drag ?? 0.96;
    const [smin, smax] = opts.size ?? [1.5, 5];
    const [lmin, lmax] = opts.life ?? [0.5, 1.1];
    const spread = opts.spread ?? Math.PI * 2;
    const center = opts.angle ?? 0;

    for (let i = 0; i < count; i++) {
      const angle = center + (Math.random() - 0.5) * spread;
      const speed = baseSpeed * (0.3 + Math.random() * 0.9);
      const maxLife = lmin + Math.random() * (lmax - lmin);
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 10,
        life: maxLife,
        maxLife,
        size: smin + Math.random() * (smax - smin),
        color: color(Math.random()),
        shape,
        glow: opts.glow ?? true,
        gravity,
        drag,
      });
    }

    if (opts.shockwave ?? true) {
      this.waves.push({ x: cx, y: cy, t: 0, color: opts.shockColor ?? color(0.5) });
    }
  }

  private drawShape(p: Particle, alpha: number) {
    const ctx = this.ctx;
    ctx.fillStyle = p.color;
    if (p.glow) {
      ctx.shadowBlur = 12;
      ctx.shadowColor = p.color;
    }
    const s = p.size * (0.4 + alpha * 0.6);
    switch (p.shape) {
      case "spark": {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(Math.atan2(p.vy, p.vx));
        ctx.fillRect(-s * 2, -s * 0.4, s * 4, s * 0.8);
        ctx.restore();
        break;
      }
      case "rect": {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-s, -s * 1.6, s * 2, s * 3.2);
        ctx.restore();
        break;
      }
      case "star": {
        this.star(p.x, p.y, 5, s * 1.6, s * 0.7);
        break;
      }
      case "petal": {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 1.8, s * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      default: {
        ctx.beginPath();
        ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private star(cx: number, cy: number, spikes: number, outer: number, inner: number) {
    const ctx = this.ctx;
    let rot = -Math.PI / 2;
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outer);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner);
      rot += step;
    }
    ctx.closePath();
    ctx.fill();
  }

  private loop = (now: number) => {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = "lighter";

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;

      const a = p.life / p.maxLife;
      ctx.globalAlpha = a;
      this.drawShape(p, a);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.t += dt;
      const dur = 0.7;
      if (w.t >= dur) {
        this.waves.splice(i, 1);
        continue;
      }
      const k = w.t / dur;
      const radius = k * Math.max(window.innerWidth, window.innerHeight) * 0.45;
      ctx.beginPath();
      ctx.strokeStyle = w.color;
      ctx.globalAlpha = (1 - k) * 0.6;
      ctx.lineWidth = 4 * (1 - k) + 0.5;
      ctx.arc(w.x, w.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    this.raf = requestAnimationFrame(this.loop);
  };

  destroy() {
    this.stop();
    this.particles = [];
    this.waves = [];
    window.removeEventListener("resize", this.resize);
  }
}
