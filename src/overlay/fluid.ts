/**
 * GPU fluid-simulation smoke (WebGL2).
 *
 * A real-time incompressible Navier–Stokes solver on the GPU (Jos Stam's
 * "Stable Fluids" scheme), giving physically-plausible billowing/curling smoke:
 *   advect velocity → vorticity confinement → divergence → Jacobi pressure
 *   solve → subtract pressure gradient → advect dye → render (lit).
 *
 * `erupt()` injects a downward velocity jet + white dye along the TOP edge for
 * a short while; with no further injection the dye dissipates and the cloud
 * clears — matching "smoke gushes from the top, then disperses".
 *
 * Requires WebGL2 + EXT_color_buffer_float; the constructor throws otherwise so
 * the caller can fall back to the Canvas 2D SmokeSystem.
 */

import type { SmokeLike } from "./smoke";

/* ---- tunable constants ---- */
const SIM_RES = 128; // velocity/pressure grid resolution (perf knob)
const DYE_RES = 512; // dye (smoke density) resolution (visual quality)
const PRESSURE_ITERATIONS = 20;
const VELOCITY_DISSIPATION = 0.4;
const DYE_DISSIPATION = 0.9; // higher → smoke clears sooner
const PRESSURE_DECAY = 0.8;
const CURL = 26; // vorticity confinement strength (swirly detail)
const JET_VELOCITY = 46; // downward jet speed
const JET_DYE = 0.28; // dye added per splat
const ERUPT_DURATION = 1.0; // seconds the jet sustains

const BASE_VERT = `#version 300 es
precision highp float;
in vec2 aPos;
out vec2 vUv;
out vec2 vL; out vec2 vR; out vec2 vT; out vec2 vB;
uniform vec2 texelSize;
void main(){
  vUv = aPos * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const ADVECT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
out vec4 outColor;
void main(){
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
  vec4 result = texture(uSource, coord);
  float decay = 1.0 + dissipation * dt;
  outColor = result / decay;
}`;

const DIVERGENCE = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
uniform sampler2D uVelocity;
out vec4 outColor;
void main(){
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  float div = 0.5 * (R - L + T - B);
  outColor = vec4(div, 0.0, 0.0, 1.0);
}`;

const CURL_PROG = `#version 300 es
precision highp float;
in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
uniform sampler2D uVelocity;
out vec4 outColor;
void main(){
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  float vorticity = R - L - T + B;
  outColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}`;

const VORTICITY = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
out vec4 outColor;
void main(){
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 vel = texture(uVelocity, vUv).xy;
  vel += force * dt;
  vel = clamp(vel, -1000.0, 1000.0);
  outColor = vec4(vel, 0.0, 1.0);
}`;

const PRESSURE = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
out vec4 outColor;
void main(){
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float divergence = texture(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;
  outColor = vec4(pressure, 0.0, 0.0, 1.0);
}`;

const GRADIENT = `#version 300 es
precision highp float;
in vec2 vUv; in vec2 vL; in vec2 vR; in vec2 vT; in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
out vec4 outColor;
void main(){
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 velocity = texture(uVelocity, vUv).xy;
  velocity -= vec2(R - L, T - B);
  outColor = vec4(velocity, 0.0, 1.0);
}`;

const CLEAR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
out vec4 outColor;
void main(){
  outColor = value * texture(uTexture, vUv);
}`;

const SPLAT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
out vec4 outColor;
void main(){
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture(uTarget, vUv).xyz;
  outColor = vec4(base + splat, 1.0);
}`;

const DISPLAY = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uDye;
uniform vec2 texelSize;
out vec4 outColor;
void main(){
  float d = texture(uDye, vUv).r;
  // Fake self-shadowing: if denser smoke sits above this texel, darken it.
  float above = texture(uDye, vUv + vec2(0.0, texelSize.y * 3.0)).r;
  float shade = clamp(1.0 - max(0.0, above - d) * 1.6, 0.5, 1.0);
  vec3 col = mix(vec3(0.46, 0.49, 0.55), vec3(0.93, 0.95, 0.99), shade);
  float a = clamp(d * 1.25, 0.0, 1.0);
  a = smoothstep(0.0, 0.55, a);
  outColor = vec4(col * a, a); // premultiplied alpha
}`;

interface FBO {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  texelX: number;
  texelY: number;
  attach(id: number): number;
}

interface DoubleFBO {
  width: number;
  height: number;
  texelX: number;
  texelY: number;
  read: FBO;
  write: FBO;
  swap(): void;
}

class Program {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null> = {};
  constructor(private gl: WebGL2RenderingContext, vert: WebGLShader, fragSrc: string) {
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    const p = gl.createProgram()!;
    gl.attachShader(p, vert);
    gl.attachShader(p, frag);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error("Program link failed: " + gl.getProgramInfoLog(p));
    }
    this.program = p;
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(p, i)!.name;
      this.uniforms[name] = gl.getUniformLocation(p, name);
    }
  }
  bind() {
    this.gl.useProgram(this.program);
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error("Shader compile failed: " + gl.getShaderInfoLog(s));
  }
  return s;
}

export class FluidSmoke implements SmokeLike {
  private gl: WebGL2RenderingContext;
  private programs: Record<string, Program>;
  private vao: WebGLVertexArrayObject;
  private velocity!: DoubleFBO;
  private dye!: DoubleFBO;
  private divergence!: FBO;
  private curl!: FBO;
  private pressure!: DoubleFBO;
  private raf = 0;
  private last = performance.now();
  private running = false;
  private emitUntil = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 1.5);

  private get W() {
    return window.innerWidth;
  }
  private get H() {
    return window.innerHeight;
  }

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    if (!gl.getExtension("EXT_color_buffer_float")) {
      throw new Error("EXT_color_buffer_float unavailable");
    }
    gl.getExtension("OES_texture_float_linear");
    this.gl = gl;

    this.resize();
    window.addEventListener("resize", this.resize);

    const vert = compileShader(gl, gl.VERTEX_SHADER, BASE_VERT);
    this.programs = {
      advect: new Program(gl, vert, ADVECT),
      divergence: new Program(gl, vert, DIVERGENCE),
      curl: new Program(gl, vert, CURL_PROG),
      vorticity: new Program(gl, vert, VORTICITY),
      pressure: new Program(gl, vert, PRESSURE),
      gradient: new Program(gl, vert, GRADIENT),
      clear: new Program(gl, vert, CLEAR),
      splat: new Program(gl, vert, SPLAT),
      display: new Program(gl, vert, DISPLAY),
    };

    // Full-screen quad.
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    this.initFramebuffers();
  }

  private resize = () => {
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.canvas.style.width = this.W + "px";
    this.canvas.style.height = this.H + "px";
  };

  private simSize() {
    const aspect = this.W / this.H;
    return aspect >= 1
      ? { w: Math.round(SIM_RES * aspect), h: SIM_RES }
      : { w: SIM_RES, h: Math.round(SIM_RES / aspect) };
  }
  private dyeSize() {
    const aspect = this.W / this.H;
    return aspect >= 1
      ? { w: Math.round(DYE_RES * aspect), h: DYE_RES }
      : { w: DYE_RES, h: Math.round(DYE_RES / aspect) };
  }

  private makeFBO(w: number, h: number, internal: number, format: number, type: number, filter: number): FBO {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    return {
      texture,
      fbo,
      width: w,
      height: h,
      texelX: 1 / w,
      texelY: 1 / h,
      attach: (id: number) => {
        gl.activeTexture(gl.TEXTURE0 + id);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        return id;
      },
    };
  }

  private makeDouble(w: number, h: number, internal: number, format: number, type: number, filter: number): DoubleFBO {
    let a = this.makeFBO(w, h, internal, format, type, filter);
    let b = this.makeFBO(w, h, internal, format, type, filter);
    return {
      width: w,
      height: h,
      texelX: 1 / w,
      texelY: 1 / h,
      get read() {
        return a;
      },
      get write() {
        return b;
      },
      swap() {
        const t = a;
        a = b;
        b = t;
      },
    };
  }

  private initFramebuffers() {
    const gl = this.gl;
    const s = this.simSize();
    const d = this.dyeSize();
    const rgba = gl.RGBA16F;
    const rg = gl.RG16F;
    const r = gl.R16F;
    const ht = gl.HALF_FLOAT;
    const lin = gl.LINEAR;
    const near = gl.NEAREST;
    this.dye = this.makeDouble(d.w, d.h, rgba, gl.RGBA, ht, lin);
    this.velocity = this.makeDouble(s.w, s.h, rg, gl.RG, ht, lin);
    this.divergence = this.makeFBO(s.w, s.h, r, gl.RED, ht, near);
    this.curl = this.makeFBO(s.w, s.h, r, gl.RED, ht, near);
    this.pressure = this.makeDouble(s.w, s.h, r, gl.RED, ht, near);
  }

  private blit(target: FBO | null) {
    const gl = this.gl;
    if (target) {
      gl.viewport(0, 0, target.width, target.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    } else {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** Inject one Gaussian splat into a (double) field. */
  private splat(target: DoubleFBO, x: number, y: number, color: [number, number, number], radius: number) {
    const gl = this.gl;
    const p = this.programs.splat;
    p.bind();
    gl.uniform1i(p.uniforms.uTarget, target.read.attach(0));
    gl.uniform1f(p.uniforms.aspectRatio, this.W / this.H);
    gl.uniform2f(p.uniforms.point, x, y);
    gl.uniform3f(p.uniforms.color, color[0], color[1], color[2]);
    gl.uniform1f(p.uniforms.radius, radius);
    this.blit(target.write);
    target.swap();
  }

  /** Emit a band of jet splats across the top edge. */
  private injectJet(strength: number) {
    const cols = 9;
    for (let i = 0; i < cols; i++) {
      const x = (i + 0.5) / cols + (Math.random() - 0.5) * 0.04;
      const y = 0.97;
      const fan = (x - 0.5) * 2;
      const vx = fan * 10 + (Math.random() - 0.5) * 14;
      const vy = -JET_VELOCITY * strength * (0.7 + Math.random() * 0.6);
      this.splat(this.velocity, x, y, [vx, vy, 0], 0.0004);
      this.splat(this.dye, x, y, [JET_DYE, JET_DYE, JET_DYE], 0.0006);
    }
  }

  erupt() {
    this.emitUntil = performance.now() + ERUPT_DURATION * 1000;
    this.injectJet(1.2); // strong initial burst
  }

  puff() {
    this.injectJet(0.6);
  }

  private step(dt: number) {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    const vel = this.velocity;
    const P = this.programs;

    // Curl + vorticity confinement.
    P.curl.bind();
    gl.uniform2f(P.curl.uniforms.texelSize, vel.texelX, vel.texelY);
    gl.uniform1i(P.curl.uniforms.uVelocity, vel.read.attach(0));
    this.blit(this.curl);

    P.vorticity.bind();
    gl.uniform2f(P.vorticity.uniforms.texelSize, vel.texelX, vel.texelY);
    gl.uniform1i(P.vorticity.uniforms.uVelocity, vel.read.attach(0));
    gl.uniform1i(P.vorticity.uniforms.uCurl, this.curl.attach(1));
    gl.uniform1f(P.vorticity.uniforms.curl, CURL);
    gl.uniform1f(P.vorticity.uniforms.dt, dt);
    this.blit(vel.write);
    vel.swap();

    // Divergence.
    P.divergence.bind();
    gl.uniform2f(P.divergence.uniforms.texelSize, vel.texelX, vel.texelY);
    gl.uniform1i(P.divergence.uniforms.uVelocity, vel.read.attach(0));
    this.blit(this.divergence);

    // Decay pressure then Jacobi-solve.
    P.clear.bind();
    gl.uniform1i(P.clear.uniforms.uTexture, this.pressure.read.attach(0));
    gl.uniform1f(P.clear.uniforms.value, PRESSURE_DECAY);
    this.blit(this.pressure.write);
    this.pressure.swap();

    P.pressure.bind();
    gl.uniform2f(P.pressure.uniforms.texelSize, vel.texelX, vel.texelY);
    gl.uniform1i(P.pressure.uniforms.uDivergence, this.divergence.attach(0));
    for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(P.pressure.uniforms.uPressure, this.pressure.read.attach(1));
      this.blit(this.pressure.write);
      this.pressure.swap();
    }

    // Subtract pressure gradient → divergence-free velocity.
    P.gradient.bind();
    gl.uniform2f(P.gradient.uniforms.texelSize, vel.texelX, vel.texelY);
    gl.uniform1i(P.gradient.uniforms.uPressure, this.pressure.read.attach(0));
    gl.uniform1i(P.gradient.uniforms.uVelocity, vel.read.attach(1));
    this.blit(vel.write);
    vel.swap();

    // Advect velocity.
    P.advect.bind();
    gl.uniform2f(P.advect.uniforms.texelSize, vel.texelX, vel.texelY);
    gl.uniform1i(P.advect.uniforms.uVelocity, vel.read.attach(0));
    gl.uniform1i(P.advect.uniforms.uSource, vel.read.attach(0));
    gl.uniform1f(P.advect.uniforms.dt, dt);
    gl.uniform1f(P.advect.uniforms.dissipation, VELOCITY_DISSIPATION);
    this.blit(vel.write);
    vel.swap();

    // Advect dye through the velocity field.
    P.advect.bind();
    gl.uniform2f(P.advect.uniforms.texelSize, this.dye.texelX, this.dye.texelY);
    gl.uniform1i(P.advect.uniforms.uVelocity, vel.read.attach(0));
    gl.uniform1i(P.advect.uniforms.uSource, this.dye.read.attach(1));
    gl.uniform1f(P.advect.uniforms.dt, dt);
    gl.uniform1f(P.advect.uniforms.dissipation, DYE_DISSIPATION);
    this.blit(this.dye.write);
    this.dye.swap();
  }

  private render() {
    const gl = this.gl;
    const p = this.programs.display;
    p.bind();
    gl.uniform2f(p.uniforms.texelSize, this.dye.texelX, this.dye.texelY);
    gl.uniform1i(p.uniforms.uDye, this.dye.read.attach(0));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private loop = (now: number) => {
    if (!this.running) return;
    const dt = Math.min((now - this.last) / 1000, 0.033);
    this.last = now;
    if (now < this.emitUntil) {
      const strength = (this.emitUntil - now) / (ERUPT_DURATION * 1000);
      this.injectJet(0.5 * strength + 0.2);
    }
    this.step(dt);
    this.render();
    this.raf = requestAnimationFrame(this.loop);
  };

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}
