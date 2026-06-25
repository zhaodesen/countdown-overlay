/**
 * Real smoke-footage player with luma keying (WebGL).
 *
 * Plays a real smoke clip (the photoreal route). Designed for the common
 * "white smoke on black background" footage: a tiny fragment shader keys out
 * the black by luminance, so NO alpha channel is needed — works for both
 * black-bg clips and clips that already carry alpha (smoke stays bright).
 * Output is premultiplied so it composites correctly over the transparent
 * overlay window, above the number (obscure → reveal as the smoke clears).
 *
 * Drop a clip at  public/smoke/smoke.webm  (or .mov / .mp4) — see the README
 * in that folder. If none is found, `load()` resolves null and the caller
 * falls back to the GPU fluid sim / Canvas 2D.
 */

import type { SmokeLike } from "./smoke";

/* ---- keying / look (tweak to taste) ---- */
const KEY_LOW = 0.05; // luminance below this → fully transparent
const KEY_HIGH = 0.5; // luminance above this → fully opaque
const ALPHA_BOOST = 1.15;
const TINT: [number, number, number] = [0.93, 0.95, 0.99]; // subtle cool white
const FADE_OUT_S = 0.6;

const DEFAULT_SOURCES = ["/smoke/smoke.webm", "/smoke/smoke.mov", "/smoke/smoke.mp4"];

const VERT = `attribute vec2 aPos;varying vec2 vUv;uniform vec2 uScale;uniform vec2 uOffset;
void main(){vec2 uv=aPos*0.5+0.5;vUv=uv*uScale+uOffset;gl_Position=vec4(aPos,0.0,1.0);}`;

const FRAG = `precision highp float;varying vec2 vUv;uniform sampler2D uTex;
uniform float uLo;uniform float uHi;uniform float uBoost;uniform vec3 uTint;uniform float uOpacity;
void main(){
  if(vUv.x<0.0||vUv.x>1.0||vUv.y<0.0||vUv.y>1.0){gl_FragColor=vec4(0.0);return;}
  vec3 c=texture2D(uTex,vUv).rgb;
  float l=dot(c,vec3(0.299,0.587,0.114));
  float a=clamp(smoothstep(uLo,uHi,l)*uBoost,0.0,1.0)*uOpacity;
  vec3 col=mix(uTint,vec3(1.0),l);
  gl_FragColor=vec4(col*a,a);
}`;

export class VideoSmoke implements SmokeLike {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private tex: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private running = false;
  private opacity = 1;
  private fading = false;
  private dpr = Math.min(window.devicePixelRatio || 1, 1.5);

  private constructor(private video: HTMLVideoElement) {
    const c = document.createElement("canvas");
    c.className = "smoke-canvas";
    c.style.zIndex = "4";
    document.body.appendChild(c);
    this.canvas = c;

    const gl =
      c.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false }) ||
      (c.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;

    const vs = this.compile(gl.VERTEX_SHADER, VERT);
    const fs = this.compile(gl.FRAGMENT_SHADER, FRAG);
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error("link failed: " + gl.getProgramInfoLog(p));
    }
    this.prog = p;
    gl.useProgram(p);
    for (const name of ["uTex", "uLo", "uHi", "uBoost", "uTint", "uOpacity", "uScale", "uOffset"]) {
      this.u[name] = gl.getUniformLocation(p, name);
    }

    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

    gl.useProgram(p);
    gl.uniform1f(this.u.uLo, KEY_LOW);
    gl.uniform1f(this.u.uHi, KEY_HIGH);
    gl.uniform1f(this.u.uBoost, ALPHA_BOOST);
    gl.uniform3f(this.u.uTint, TINT[0], TINT[1], TINT[2]);

    this.resize();
    window.addEventListener("resize", this.resize);
  }

  private compile(type: number, src: string): WebGLShader {
    const s = this.gl.createShader(type)!;
    this.gl.shaderSource(s, src);
    this.gl.compileShader(s);
    if (!this.gl.getShaderParameter(s, this.gl.COMPILE_STATUS)) {
      throw new Error("shader compile failed: " + this.gl.getShaderInfoLog(s));
    }
    return s;
  }

  private resize = () => {
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
    this.canvas.style.width = window.innerWidth + "px";
    this.canvas.style.height = window.innerHeight + "px";
  };

  /** Compute cover-fit UV transform (fill screen, crop overflow). */
  private coverUV() {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const vw = this.video.videoWidth || cw;
    const vh = this.video.videoHeight || ch;
    const ca = cw / ch;
    const va = vw / vh;
    if (ca > va) {
      const s = va / ca;
      return { scale: [1, s], offset: [0, (1 - s) / 2] };
    }
    const s = ca / va;
    return { scale: [s, 1], offset: [(1 - s) / 2, 0] };
  }

  static load(sources: string[] = DEFAULT_SOURCES, timeoutMs = 2500): Promise<VideoSmoke | null> {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.loop = false;
      let i = 0;
      let done = false;
      const finish = (v: VideoSmoke | null) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        resolve(v);
      };
      const to = setTimeout(() => finish(null), timeoutMs);
      const tryNext = () => {
        if (i >= sources.length) return finish(null);
        video.src = sources[i++];
        video.load();
      };
      video.addEventListener("loadeddata", () => {
        try {
          finish(new VideoSmoke(video));
        } catch {
          finish(null);
        }
      });
      video.addEventListener("error", tryNext);
      tryNext();
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.loop);
  }

  erupt() {
    this.opacity = 1;
    this.fading = false;
    try {
      this.video.currentTime = 0;
    } catch {
      /* ignore */
    }
    void this.video.play();
  }

  puff() {
    /* The clip already contains the full motion; nothing to add. */
  }

  private loop = () => {
    if (!this.running) return;
    const gl = this.gl;
    if (this.fading) this.opacity = Math.max(0, this.opacity - 1 / (FADE_OUT_S * 60));

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.video.readyState >= 2) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
      const cov = this.coverUV();
      gl.useProgram(this.prog);
      gl.uniform2f(this.u.uScale, cov.scale[0], cov.scale[1]);
      gl.uniform2f(this.u.uOffset, cov.offset[0], cov.offset[1]);
      gl.uniform1f(this.u.uOpacity, this.opacity);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Begin a smooth fade-out (called as the countdown ends). */
  fadeOut() {
    this.fading = true;
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    try {
      this.video.pause();
    } catch {
      /* ignore */
    }
    this.canvas.remove();
  }
}
