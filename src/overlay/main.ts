import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { gsap } from "gsap";
import { ParticleField } from "./particles";
import { createBackground } from "./backgrounds";
import { SmokeSystem, type SmokeLike } from "./smoke";
import { FluidSmoke } from "./fluid";
import { VideoSmoke } from "./video-smoke";
import { buildCountdown } from "./engine";
import { getTheme } from "./themes";
import { SoundEngine } from "./sound";
import { readOverlayConfig } from "../shared/storage";
import { EVENT_FINISHED } from "../shared/types";

const numberEl = document.getElementById("number") as HTMLElement;
const glowEl = document.getElementById("glow") as HTMLElement;
const shockwaveEl = document.getElementById("shockwave") as HTMLElement;
const flashEl = document.getElementById("flash") as HTMLElement;
const bannerEl = document.getElementById("banner") as HTMLElement;
const bgCanvas = document.getElementById("bg") as HTMLCanvasElement;
const fxCanvas = document.getElementById("fx") as HTMLCanvasElement;
const smokeCanvas = document.getElementById("smoke") as HTMLCanvasElement;
const fluidCanvas = document.getElementById("fluid") as HTMLCanvasElement;

const cfg = readOverlayConfig();
const theme = getTheme(cfg.themeId);

// In the browser (vite dev preview) there is no Tauri window; guard it.
const isTauri = "__TAURI_INTERNALS__" in window;

// Apply theme look.
document.body.classList.add(theme.bodyClass);
if (theme.banner) bannerEl.textContent = theme.banner;

const field = new ParticleField(fxCanvas);
field.start();
const background = createBackground(bgCanvas, theme.bg);

const sound = new SoundEngine(cfg.soundOn);
sound.resume();

/**
 * Realistic-smoke layer (only the "smoke" theme). Priority, most→least real:
 *   1. real footage  (public/smoke/smoke.webm|mov|mp4, luma-keyed)
 *   2. GPU fluid sim  (WebGL2 Navier–Stokes)
 *   3. Canvas 2D      (sprite particles)
 */
async function createSmoke(): Promise<SmokeLike | null> {
  if (!theme.smoke) return null;
  const video = await VideoSmoke.load();
  if (video) return video;
  try {
    return new FluidSmoke(fluidCanvas);
  } catch (e) {
    console.warn("Fluid smoke unavailable, falling back to Canvas 2D:", e);
    return new SmokeSystem(smokeCanvas);
  }
}

let smoke: SmokeLike | null = null;

// Fade the overlay in.
gsap.fromTo(document.body, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power1.out" });
gsap.fromTo(".top-fx", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out", delay: 0.05 });

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  // Let video-smoke begin a graceful fade if it supports it.
  (smoke as { fadeOut?: () => void } | null)?.fadeOut?.();
  await gsap.to(document.body, { opacity: 0, duration: 0.3, ease: "power1.in" }).then();
  field.destroy();
  background.destroy();
  smoke?.destroy();
  if (isTauri) {
    void emit(EVENT_FINISHED);
    await getCurrentWindow().close();
  }
}

async function run() {
  // Resolve the smoke source (may await a video load) before the timeline so
  // erupt() is in sync with digit "5".
  smoke = await createSmoke();
  smoke?.start();

  const timeline = buildCountdown({
    numberEl,
    glowEl,
    shockwaveEl,
    flashEl,
    field,
    sound,
    theme,
    onComplete: () => void finish(),
    onDigit: (i) => {
      if (!smoke) return;
      if (i === 0) smoke.erupt(); // 5 appears → smoke gushes from the top
      else if (i === 1) smoke.puff(); // 4 → one more billow, then it clears
    },
  });

  timeline.play();

  // Safety net: force-close if anything stalls.
  window.setTimeout(() => {
    if (timeline.progress() < 1) void finish();
  }, 12_000);
}

void run();
