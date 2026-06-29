/**
 * Realistic volumetric-looking smoke, Canvas 2D.
 *
 * Technique: pre-rendered soft "puff" sprites (radial gradients) drawn many
 * times with low per-particle alpha. Heavy overlap + turbulence + growth +
 * smooth fade reads as billowing smoke without a fluid solver, and stays cheap
 * enough for 60 FPS. `erupt()` jets a full-width sheet of smoke down from the
 * top of the screen; with no further emission the cloud naturally dissipates.
 */

import { smokeCanvasDpr } from "./performance";

/** Common interface for swappable smoke implementations (Canvas2D / WebGL). */
export interface SmokeLike {
  start(): void;
  erupt(): void;
  puff(): void;
  destroy(): void;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  r0: number;
  r1: number;
  rot: number;
  vrot: number;
  alpha: number;
  sprite: HTMLCanvasElement;
  seed: number;
}

function makeSprite(rgb: [number, number, number]): HTMLCanvasElement {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const [r, g, b] = rgb;
  // A few overlapped offset radial blobs → slightly irregular soft edge.
  for (let i = 0; i < 3; i++) {
    const cx = s / 2 + (Math.random() - 0.5) * 18;
    const cy = s / 2 + (Math.random() - 0.5) * 18;
    const rad = s / 2;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grad.addColorStop(0, `rgba(${r},${g},${b},0.42)`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},0.16)`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

export class SmokeSystem implements SmokeLike {
  private ctx: CanvasRenderingContext2D;
  private dpr = smokeCanvasDpr();
  private raf = 0;
  private last = performance.now();
  private running = false;
  private puffs: Puff[] = [];
  private sprites: HTMLCanvasElement[];
  /** Sustain the jet until this timestamp (ms, performance.now clock). */
  private emitUntil = 0;
  private emitRate = 0; // particles/sec during sustain
  private time = 0;

  private get W() {
    return window.innerWidth;
  }
  private get H() {
    return window.innerHeight;
  }

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    this.sprites = [
      makeSprite([225, 227, 232]), // light
      makeSprite([175, 178, 186]), // mid
      makeSprite([120, 123, 132]), // dark core
    ];
    this.resize();
    window.addEventListener("resize", this.resize);
  }

  private resize = () => {
    this.dpr = smokeCanvasDpr();
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.canvas.style.width = this.W + "px";
    this.canvas.style.height = this.H + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private spawn(jet: boolean) {
    const x = Math.random() * this.W;
    // Fan outward toward the edges; centre shoots straighter & faster.
    const fan = (x / this.W - 0.5) * 2; // -1 … 1
    const speed = jet ? 260 + Math.random() * 360 : 120 + Math.random() * 160;
    const spriteIdx = Math.random() < 0.5 ? 0 : Math.random() < 0.7 ? 1 : 2;
    this.puffs.push({
      x,
      y: -20 + Math.random() * 60,
      vx: fan * (60 + Math.random() * 120) + (Math.random() - 0.5) * 60,
      vy: speed,
      age: 0,
      life: 2.6 + Math.random() * 1.7,
      r0: 36 + Math.random() * 70,
      r1: 160 + Math.random() * 220,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 0.7,
      alpha: 0.1 + Math.random() * 0.13,
      sprite: this.sprites[spriteIdx],
      seed: Math.random() * 1000,
    });
  }

  /** Big initial eruption: a full-width sheet of smoke jets from the top. */
  erupt() {
    for (let i = 0; i < 170; i++) this.spawn(true);
    this.emitUntil = performance.now() + 850; // sustain the jet briefly
    this.emitRate = 220;
  }

  /** A smaller secondary puff (used on the next digit to keep it billowing). */
  puff() {
    for (let i = 0; i < 45; i++) this.spawn(false);
  }

  private loop = (now: number) => {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.time += dt;

    // Sustained emission (decaying) right after an eruption.
    if (now < this.emitUntil) {
      const remain = (this.emitUntil - now) / 850; // 1 → 0
      const n = Math.round(this.emitRate * remain * dt);
      for (let i = 0; i < n; i++) this.spawn(true);
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.globalCompositeOperation = "source-over";

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.puffs.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;

      // Air drag, then buoyancy so it slows, billows and starts to rise.
      p.vx *= 0.95;
      p.vy = p.vy * 0.95 - 26 * dt; // gravity-free; gentle lift over time
      // Turbulence (cheap pseudo-curl).
      p.vx += Math.sin(p.y * 0.012 + p.seed + this.time * 0.8) * 26 * dt;
      p.vy += Math.cos(p.x * 0.012 + p.seed * 1.7 + this.time * 0.6) * 16 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;

      const r = p.r0 + (p.r1 - p.r0) * k;
      // Smooth fade in/out across the lifetime.
      const a = p.alpha * Math.sin(Math.PI * Math.min(1, k * 1.05));

      ctx.globalAlpha = Math.max(0, a);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.drawImage(p.sprite, -r, -r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    this.raf = requestAnimationFrame(this.loop);
  };

  /** True while any smoke remains on screen. */
  get active(): boolean {
    return this.puffs.length > 0;
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.puffs = [];
  }
}
