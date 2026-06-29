/**
 * Per-theme animated Canvas 2D backgrounds. Each factory returns a controller
 * with `destroy()`. They draw onto the dedicated background canvas behind the
 * number/particles. Kept parameterized (colors) so themes can reuse them.
 */

export interface BackgroundController {
  destroy(): void;
}

abstract class BaseBg implements BackgroundController {
  protected ctx: CanvasRenderingContext2D;
  protected dpr = Math.min(window.devicePixelRatio || 1, 2);
  protected raf = 0;
  protected last = performance.now();
  protected running = true;
  protected get W() {
    return window.innerWidth;
  }
  protected get H() {
    return window.innerHeight;
  }

  constructor(protected canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
    // Do not dispatch to a subclass override from the base constructor.
    // Derived fields (for example RainBg.fontSize) are initialized only after
    // super() returns, so calling onResize() here can produce invalid values.
    this.resizeCanvas();
    window.addEventListener("resize", this.resize);
    this.raf = requestAnimationFrame(this.tick);
  }

  private resizeCanvas() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.canvas.style.width = this.W + "px";
    this.canvas.style.height = this.H + "px";
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  protected resize = () => {
    this.resizeCanvas();
    this.onResize();
  };

  protected onResize() {}

  private tick = (now: number) => {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.draw(dt);
    this.raf = requestAnimationFrame(this.tick);
  };

  protected abstract draw(dt: number): void;

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.ctx.clearRect(0, 0, this.W, this.H);
  }
}

/* ---------- Digital rain (cyberpunk / retro) ---------- */
class RainBg extends BaseBg {
  private cols: number[] = [];
  private fontSize = 18;
  constructor(canvas: HTMLCanvasElement, private color: string, private head: string) {
    super(canvas);
    this.onResize();
  }
  protected override onResize() {
    if (!this.ctx) return;
    const n = Math.ceil(this.W / this.fontSize);
    this.cols = new Array(n).fill(0).map(() => Math.random() * -50);
  }
  protected draw() {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.font = `${this.fontSize}px monospace`;
    for (let i = 0; i < this.cols.length; i++) {
      const ch = String.fromCharCode(0x30a0 + Math.floor(Math.random() * 96));
      const x = i * this.fontSize;
      const y = this.cols[i] * this.fontSize;
      ctx.fillStyle = this.head;
      ctx.fillText(ch, x, y);
      ctx.fillStyle = this.color;
      ctx.fillText(ch, x, y - this.fontSize);
      if (y > this.H && Math.random() > 0.975) this.cols[i] = 0;
      this.cols[i] += 0.6;
    }
  }
}

/* ---------- Starfield warp (galaxy) ---------- */
class StarfieldBg extends BaseBg {
  private stars: { x: number; y: number; z: number }[] = [];
  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    for (let i = 0; i < 480; i++)
      this.stars.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() });
  }
  protected draw(dt: number) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(8,4,24,0.35)";
    ctx.fillRect(0, 0, this.W, this.H);
    const cx = this.W / 2;
    const cy = this.H / 2;
    for (const s of this.stars) {
      s.z -= dt * 0.35;
      if (s.z <= 0.02) {
        s.x = Math.random() * 2 - 1;
        s.y = Math.random() * 2 - 1;
        s.z = 1;
      }
      const sx = cx + (s.x / s.z) * cx;
      const sy = cy + (s.y / s.z) * cy;
      const r = (1 - s.z) * 2.4;
      const hue = 250 + s.x * 40;
      ctx.fillStyle = `hsla(${hue},90%,${70 + (1 - s.z) * 25}%,${1 - s.z})`;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ---------- Rising embers (flame) ---------- */
class EmbersBg extends BaseBg {
  private p: { x: number; y: number; vy: number; vx: number; r: number; life: number }[] = [];
  protected draw(dt: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    // ambient bottom glow
    const grad = ctx.createLinearGradient(0, this.H, 0, this.H * 0.5);
    grad.addColorStop(0, "rgba(255,80,0,0.22)");
    grad.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, this.H * 0.5, this.W, this.H * 0.5);

    if (this.p.length < 140 && Math.random() > 0.2) {
      this.p.push({
        x: Math.random() * this.W,
        y: this.H + 10,
        vy: -(40 + Math.random() * 120),
        vx: (Math.random() - 0.5) * 30,
        r: 1 + Math.random() * 3,
        life: 1,
      });
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = this.p.length - 1; i >= 0; i--) {
      const e = this.p[i];
      e.life -= dt * 0.4;
      if (e.life <= 0) {
        this.p.splice(i, 1);
        continue;
      }
      e.y += e.vy * dt;
      e.x += e.vx * dt + Math.sin(e.y * 0.05) * 0.4;
      ctx.fillStyle = `hsla(${20 + Math.random() * 25},100%,${55 + e.life * 20}%,${e.life})`;
      ctx.shadowBlur = 8;
      ctx.shadowColor = "rgba(255,120,0,0.9)";
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
  }
}

/* ---------- Falling snow / frost ---------- */
class SnowBg extends BaseBg {
  private p: { x: number; y: number; vy: number; r: number; sway: number }[] = [];
  constructor(canvas: HTMLCanvasElement) {
    super(canvas);
    for (let i = 0; i < 160; i++)
      this.p.push({
        x: Math.random() * this.W,
        y: Math.random() * this.H,
        vy: 20 + Math.random() * 50,
        r: 1 + Math.random() * 3,
        sway: Math.random() * Math.PI * 2,
      });
  }
  protected draw(dt: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    const grad = ctx.createRadialGradient(
      this.W / 2,
      this.H / 2,
      0,
      this.W / 2,
      this.H / 2,
      this.W * 0.7
    );
    grad.addColorStop(0, "rgba(180,225,255,0.06)");
    grad.addColorStop(1, "rgba(20,40,80,0.18)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = "rgba(230,245,255,0.9)";
    for (const s of this.p) {
      s.sway += dt;
      s.y += s.vy * dt;
      s.x += Math.sin(s.sway) * 0.4;
      if (s.y > this.H) {
        s.y = -5;
        s.x = Math.random() * this.W;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ---------- HUD rings (tech) ---------- */
class HudBg extends BaseBg {
  private a = 0;
  constructor(canvas: HTMLCanvasElement, private hue: number) {
    super(canvas);
  }
  protected draw(dt: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this.a += dt;
    const cx = this.W / 2;
    const cy = this.H / 2;
    // faint grid
    ctx.strokeStyle = `hsla(${this.hue},90%,60%,0.06)`;
    ctx.lineWidth = 1;
    const g = 60;
    for (let x = 0; x < this.W; x += g) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.H);
      ctx.stroke();
    }
    for (let y = 0; y < this.H; y += g) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.W, y);
      ctx.stroke();
    }
    // rotating arcs
    const base = Math.min(this.W, this.H);
    for (let i = 0; i < 4; i++) {
      const r = base * (0.18 + i * 0.08);
      const dir = i % 2 === 0 ? 1 : -1;
      const start = this.a * dir * (0.5 + i * 0.2);
      ctx.strokeStyle = `hsla(${this.hue},100%,65%,${0.18 + i * 0.05})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + Math.PI * (1.1 + i * 0.1));
      ctx.stroke();
    }
  }
}

/* ---------- Falling confetti (cartoon / gold) ---------- */
class ConfettiBg extends BaseBg {
  private p: {
    x: number;
    y: number;
    vy: number;
    vx: number;
    rot: number;
    vr: number;
    c: string;
    w: number;
    h: number;
  }[] = [];
  constructor(canvas: HTMLCanvasElement, private colors: string[]) {
    super(canvas);
  }
  protected draw(dt: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.p.length < 120 && Math.random() > 0.15) {
      this.p.push({
        x: Math.random() * this.W,
        y: -10,
        vy: 60 + Math.random() * 120,
        vx: (Math.random() - 0.5) * 60,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 8,
        c: this.colors[(Math.random() * this.colors.length) | 0],
        w: 6 + Math.random() * 8,
        h: 8 + Math.random() * 10,
      });
    }
    for (let i = this.p.length - 1; i >= 0; i--) {
      const c = this.p[i];
      c.y += c.vy * dt;
      c.x += c.vx * dt;
      c.rot += c.vr * dt;
      if (c.y > this.H + 20) {
        this.p.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.c;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
  }
}

/* ---------- Drifting ink clouds (ink / wuxia) ---------- */
class InkBg extends BaseBg {
  private blobs: { x: number; y: number; r: number; vx: number; vy: number; a: number }[] = [];
  constructor(canvas: HTMLCanvasElement, private tint: string) {
    super(canvas);
    for (let i = 0; i < 10; i++)
      this.blobs.push({
        x: Math.random() * this.W,
        y: Math.random() * this.H,
        r: 60 + Math.random() * 180,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.5) * 12,
        a: 0.04 + Math.random() * 0.06,
      });
  }
  protected draw(dt: number) {
    const ctx = this.ctx;
    // paper-ish fade
    ctx.fillStyle = "rgba(245,243,235,0.05)";
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.clearRect(0, 0, this.W, this.H);
    for (const b of this.blobs) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -b.r) b.x = this.W + b.r;
      if (b.x > this.W + b.r) b.x = -b.r;
      if (b.y < -b.r) b.y = this.H + b.r;
      if (b.y > this.H + b.r) b.y = -b.r;
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      g.addColorStop(0, this.tint.replace("ALPHA", String(b.a)));
      g.addColorStop(1, this.tint.replace("ALPHA", "0"));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export type BgKind =
  | { kind: "rain"; color: string; head: string }
  | { kind: "starfield" }
  | { kind: "embers" }
  | { kind: "snow" }
  | { kind: "hud"; hue: number }
  | { kind: "confetti"; colors: string[] }
  | { kind: "ink"; tint: string }
  | { kind: "none" };

export function createBackground(canvas: HTMLCanvasElement, spec: BgKind): BackgroundController {
  switch (spec.kind) {
    case "rain":
      return new RainBg(canvas, spec.color, spec.head);
    case "starfield":
      return new StarfieldBg(canvas);
    case "embers":
      return new EmbersBg(canvas);
    case "snow":
      return new SnowBg(canvas);
    case "hud":
      return new HudBg(canvas, spec.hue);
    case "confetti":
      return new ConfettiBg(canvas, spec.colors);
    case "ink":
      return new InkBg(canvas, spec.tint);
    default:
      return { destroy() {} };
  }
}
