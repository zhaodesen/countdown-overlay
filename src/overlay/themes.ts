/**
 * The 10 built-in countdown themes. Each theme declares:
 *  - bodyClass : CSS class on <body> controlling number font/color/decorations
 *  - bg        : which animated canvas background to run
 *  - hueFor    : hue used for glow/shockwave per digit
 *  - burst     : particle burst options per digit
 *  - entrance  : GSAP from/to for the number (style of how it appears)
 *  - sound     : synthesized tick per digit + finale
 *  - banner    : optional top banner text
 *
 * Adding a theme = add one entry here + matching CSS in style.css + meta in
 * shared/themes-meta.ts. (3D/WebGL themes can implement `bg` as a Three.js
 * controller exposing the same { destroy() } interface.)
 */

import type { BgKind } from "./backgrounds";
import type { BurstOptions } from "./particles";
import type { SoundEngine } from "./sound";

/** GSAP tween vars (kept loose to avoid a hard type dependency). */
type TweenVars = Record<string, unknown>;

export interface Entrance {
  from: TweenVars;
  to: TweenVars;
}

export interface Theme {
  id: string;
  bodyClass: string;
  bg: BgKind;
  banner?: string;
  /** If true, main.ts spins up the SmokeSystem and drives it per-digit. */
  smoke?: boolean;
  hueFor(index: number): number;
  burst(index: number): BurstOptions;
  entrance(index: number): Entrance;
  sound: {
    digit(s: SoundEngine, index: number): void;
    finish(s: SoundEngine): void;
  };
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/* ---- shared entrance presets ---- */
const ENTRANCE = {
  impact: (): Entrance => ({
    from: { scale: 2.6, opacity: 0, filter: "blur(28px) brightness(2.2)", rotation: rnd(-8, 8) },
    to: { scale: 1, opacity: 1, filter: "blur(0px) brightness(1)", rotation: 0, duration: 0.28, ease: "power4.out" },
  }),
  glitch: (): Entrance => ({
    from: { scale: 1.4, opacity: 0, x: rnd(-40, 40), filter: "blur(6px)" },
    to: { scale: 1, opacity: 1, x: 0, filter: "blur(0px)", duration: 0.2, ease: "steps(4)" },
  }),
  bounce: (): Entrance => ({
    from: { scale: 0, opacity: 0, rotation: rnd(-25, 25) },
    to: { scale: 1, opacity: 1, rotation: 0, duration: 0.75, ease: "elastic.out(1,0.45)" },
  }),
  brush: (): Entrance => ({
    from: { scale: 1.35, opacity: 0, filter: "blur(16px)", rotation: rnd(-6, 6) },
    to: { scale: 1, opacity: 1, filter: "blur(0px)", rotation: 0, duration: 0.42, ease: "power2.out" },
  }),
  warp: (): Entrance => ({
    from: { scale: 0.15, opacity: 0, rotation: 200, filter: "blur(20px)" },
    to: { scale: 1, opacity: 1, rotation: 0, filter: "blur(0px)", duration: 0.5, ease: "power3.out" },
  }),
  drift: (): Entrance => ({
    from: { scale: 1.5, opacity: 0, filter: "blur(22px)" },
    to: { scale: 1, opacity: 1, filter: "blur(0px)", duration: 0.5, ease: "power1.out" },
  }),
};

/* ---- color helpers ---- */
const hsl = (h: number, s = 100, l = 60) => (seed: number) =>
  `hsl(${h + (seed * 40 - 20)}, ${s}%, ${l}%)`;
const pick = (cols: string[]) => (seed: number) => cols[Math.floor(seed * cols.length) % cols.length];

export const THEMES: Record<string, Theme> = {
  cyberpunk: {
    id: "cyberpunk",
    bodyClass: "t-cyberpunk",
    bg: { kind: "rain", color: "rgba(255,46,154,0.85)", head: "#aefcff" },
    banner: "⚠ SYSTEM COUNTDOWN ENGAGED ⚠",
    hueFor: (i) => (i % 2 ? 320 : 190),
    burst: (i) => ({
      count: 150 + i * 30,
      speed: 500 + i * 90,
      shape: "spark",
      color: pick(["#ff2e9a", "#15e1ff", "#ffffff", "#b46bff"]),
      shockColor: "#ff2e9a",
    }),
    entrance: () => ENTRANCE.glitch(),
    sound: {
      digit: (s, i) => {
        s.tone({ freq: 760 - i * 70, type: "square", dur: 0.12, gain: 0.16, glideTo: 200 });
        s.noise({ dur: 0.12, filter: "bandpass", freq: 3000, sweepTo: 300, gain: 0.14 });
      },
      finish: (s) => {
        s.arp([520, 360, 240], 0.06, { type: "square", dur: 0.12, gain: 0.16 });
        s.tone({ freq: 70, type: "sawtooth", dur: 0.6, gain: 0.25, glideTo: 40, delay: 0.18 });
      },
    },
  },

  tech: {
    id: "tech",
    bodyClass: "t-tech",
    bg: { kind: "hud", hue: 200 },
    banner: "◈ TARGET LOCK ◈",
    hueFor: () => 200,
    burst: (i) => ({
      count: 120 + i * 20,
      speed: 460 + i * 70,
      shape: "circle",
      color: hsl(200, 100, 65),
      shockColor: "hsl(200,100%,65%)",
    }),
    entrance: () => ENTRANCE.impact(),
    sound: {
      digit: (s, i) => {
        s.tone({ freq: 620 + i * 45, type: "sine", dur: 0.12, gain: 0.22 });
        s.tone({ freq: 1700, type: "sine", dur: 0.05, gain: 0.07 });
      },
      finish: (s) => s.chord([523, 659, 784], { type: "sine", dur: 0.7, gain: 0.16, release: 0.3 }),
    },
  },

  wuxia: {
    id: "wuxia",
    bodyClass: "t-wuxia",
    bg: { kind: "ink", tint: "rgba(60,20,15,ALPHA)" },
    banner: "侠 · 倒 · 计 · 时",
    hueFor: () => 40,
    burst: (i) => ({
      count: 100 + i * 24,
      speed: 540 + i * 80,
      shape: "spark",
      gravity: 120,
      color: pick(["#e8b84b", "#ffd97a", "#b3151b", "#fff3d0"]),
      shockColor: "#e8b84b",
    }),
    entrance: () => ENTRANCE.brush(),
    sound: {
      digit: (s) => {
        s.noise({ dur: 0.22, filter: "bandpass", freq: 1800, sweepTo: 350, gain: 0.18 });
        s.tone({ freq: 190, type: "sine", dur: 0.5, gain: 0.18, release: 0.35 });
      },
      finish: (s) => {
        s.tone({ freq: 150, type: "sine", dur: 1.0, gain: 0.28, release: 0.6 });
        s.tone({ freq: 300, type: "triangle", dur: 0.9, gain: 0.12, release: 0.5 });
      },
    },
  },

  ink: {
    id: "ink",
    bodyClass: "t-ink",
    bg: { kind: "ink", tint: "rgba(20,20,20,ALPHA)" },
    hueFor: () => 0,
    burst: (i) => ({
      count: 70 + i * 18,
      speed: 360 + i * 60,
      shape: "petal",
      gravity: 90,
      drag: 0.94,
      color: pick(["#1a1a1a", "#3a3a3a", "#6b6b6b", "#111111"]),
      glow: false,
      shockColor: "rgba(20,20,20,0.6)",
    }),
    entrance: () => ENTRANCE.drift(),
    sound: {
      digit: (s, i) => s.tone({ freq: 300 + i * 18, type: "sine", dur: 0.18, gain: 0.16, glideTo: 170 }),
      finish: (s) => s.tone({ freq: 140, type: "sine", dur: 0.9, gain: 0.2, release: 0.6 }),
    },
  },

  cartoon: {
    id: "cartoon",
    bodyClass: "t-cartoon",
    bg: { kind: "confetti", colors: ["#ff5d8f", "#ffd23f", "#3ad6ff", "#7af96b", "#b48bff"] },
    banner: "★ READY? ★",
    hueFor: (i) => [330, 50, 195, 110, 270][i % 5],
    burst: (i) => ({
      count: 120 + i * 26,
      speed: 480 + i * 70,
      shape: "star",
      gravity: 220,
      color: pick(["#ff5d8f", "#ffd23f", "#3ad6ff", "#7af96b", "#ffffff"]),
      shockColor: "#ffd23f",
    }),
    entrance: () => ENTRANCE.bounce(),
    sound: {
      digit: (s) => {
        s.tone({ freq: 300, type: "sine", dur: 0.18, gain: 0.2, glideTo: 720 });
        s.tone({ freq: 900, type: "triangle", dur: 0.07, gain: 0.1, delay: 0.16 });
      },
      finish: (s) => s.arp([523, 659, 784, 1047], 0.09, { type: "triangle", dur: 0.18, gain: 0.18 }),
    },
  },

  flame: {
    id: "flame",
    bodyClass: "t-flame",
    bg: { kind: "embers" },
    banner: "🔥 IGNITION 🔥",
    hueFor: (i) => 30 - i * 6,
    burst: (i) => ({
      count: 150 + i * 30,
      speed: 520 + i * 90,
      shape: "spark",
      gravity: -40,
      color: pick(["#ff7b00", "#ff3d00", "#ffcf3a", "#ff5e00"]),
      shockColor: "#ff6a00",
    }),
    entrance: () => ENTRANCE.impact(),
    sound: {
      digit: (s) => s.noise({ dur: 0.3, filter: "lowpass", freq: 1900, sweepTo: 220, gain: 0.22 }),
      finish: (s) => {
        s.noise({ dur: 0.7, filter: "lowpass", freq: 1200, sweepTo: 80, gain: 0.3 });
        s.tone({ freq: 60, type: "sawtooth", dur: 0.7, gain: 0.28, glideTo: 35 });
      },
    },
  },

  frost: {
    id: "frost",
    bodyClass: "t-frost",
    bg: { kind: "snow" },
    banner: "❄ FROZEN ❄",
    hueFor: () => 200,
    burst: (i) => ({
      count: 120 + i * 24,
      speed: 460 + i * 70,
      shape: "star",
      gravity: 60,
      color: pick(["#dff4ff", "#9ad6ff", "#5ab0ff", "#ffffff"]),
      shockColor: "#bfeaff",
    }),
    entrance: () => ENTRANCE.warp(),
    sound: {
      digit: (s) => {
        s.tone({ freq: 1250, type: "sine", dur: 0.4, gain: 0.12, release: 0.3 });
        s.tone({ freq: 1875, type: "sine", dur: 0.3, gain: 0.05 });
      },
      finish: (s) => s.chord([1047, 1319, 1568, 2093], { type: "sine", dur: 0.8, gain: 0.1, release: 0.5 }),
    },
  },

  galaxy: {
    id: "galaxy",
    bodyClass: "t-galaxy",
    bg: { kind: "starfield" },
    banner: "✦ HYPERSPACE ✦",
    hueFor: (i) => 255 + i * 6,
    burst: (i) => ({
      count: 150 + i * 30,
      speed: 520 + i * 90,
      shape: "star",
      gravity: 0,
      color: pick(["#b48bff", "#7b5cff", "#5ad6ff", "#ffffff", "#ff8bd6"]),
      shockColor: "#9a7bff",
    }),
    entrance: () => ENTRANCE.warp(),
    sound: {
      digit: (s, i) => {
        s.tone({ freq: 400 + i * 30, type: "triangle", dur: 0.4, gain: 0.12, glideTo: 620 });
        s.tone({ freq: 2000, type: "sine", dur: 0.2, gain: 0.05 });
      },
      finish: (s) => s.tone({ freq: 200, type: "triangle", dur: 1.0, gain: 0.2, glideTo: 1200, release: 0.4 }),
    },
  },

  retro: {
    id: "retro",
    bodyClass: "t-retro",
    bg: { kind: "rain", color: "rgba(57,255,20,0.85)", head: "#d6ffd0" },
    banner: "INSERT COIN",
    hueFor: () => 110,
    burst: (i) => ({
      count: 90 + i * 16,
      speed: 420 + i * 60,
      shape: "rect",
      gravity: 200,
      color: pick(["#39ff14", "#b6ff7a", "#ffffff", "#1aff8c"]),
      glow: false,
      shockColor: "#39ff14",
    }),
    entrance: () => ENTRANCE.glitch(),
    sound: {
      digit: (s, i) => s.tone({ freq: 300 + (4 - i) * 90, type: "square", dur: 0.1, gain: 0.18 }),
      finish: (s) => s.arp([392, 523, 659, 784, 1047], 0.07, { type: "square", dur: 0.1, gain: 0.16 }),
    },
  },

  gold: {
    id: "gold",
    bodyClass: "t-gold",
    bg: { kind: "confetti", colors: ["#ffd700", "#ffec8b", "#ff8c00", "#fff4c2"] },
    banner: "✸ CELEBRATION ✸",
    hueFor: () => 45,
    burst: (i) => ({
      count: 160 + i * 30,
      speed: 520 + i * 90,
      shape: "star",
      gravity: 240,
      color: pick(["#ffd700", "#ffec8b", "#ff8c00", "#ffffff"]),
      shockColor: "#ffd700",
    }),
    entrance: () => ENTRANCE.impact(),
    sound: {
      digit: (s, i) => {
        s.tone({ freq: 760 + (4 - i) * 80, type: "triangle", dur: 0.2, gain: 0.16 });
        s.tone({ freq: 2400, type: "sine", dur: 0.1, gain: 0.06 });
      },
      finish: (s) => {
        s.arp([523, 659, 784, 1047, 1319], 0.08, { type: "triangle", dur: 0.22, gain: 0.18 });
        s.noise({ dur: 0.5, filter: "highpass", freq: 4000, gain: 0.1, delay: 0.1 });
      },
    },
  },

  smoke: {
    id: "smoke",
    bodyClass: "t-smoke",
    bg: { kind: "none" },
    smoke: true,
    hueFor: () => 210,
    burst: () => ({
      count: 40,
      speed: 240,
      shape: "circle",
      gravity: 30,
      drag: 0.93,
      color: pick(["rgba(235,238,244,0.9)", "rgba(200,205,214,0.85)", "rgba(170,176,188,0.8)"]),
      glow: false,
      shockwave: false,
    }),
    entrance: () => ENTRANCE.drift(),
    sound: {
      digit: (s, i) => {
        if (i === 0) {
          // The eruption: a pressurised gas/steam jet whoosh.
          s.noise({ dur: 0.9, filter: "lowpass", freq: 2600, sweepTo: 280, gain: 0.26 });
          s.noise({ dur: 0.5, filter: "highpass", freq: 5000, gain: 0.08 });
        } else {
          // Soft airy hiss as the smoke drifts.
          s.noise({ dur: 0.3, filter: "lowpass", freq: 1400, sweepTo: 500, gain: 0.1 });
        }
      },
      finish: (s) => s.noise({ dur: 0.8, filter: "lowpass", freq: 900, sweepTo: 200, gain: 0.12 }),
    },
  },
};

export function getTheme(id: string): Theme {
  return THEMES[id] ?? THEMES.cyberpunk;
}
