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
import { clampCountdownSeconds, EVENT_FINISHED } from "../shared/types";

const numberEl = document.getElementById("number") as HTMLElement;
const ghostEls = [
  document.getElementById("ghostA") as HTMLElement,
  document.getElementById("ghostB") as HTMLElement,
];
const glowEl = document.getElementById("glow") as HTMLElement;
const shockwaveEl = document.getElementById("shockwave") as HTMLElement;
const flashEl = document.getElementById("flash") as HTMLElement;
const bannerEl = document.getElementById("banner") as HTMLElement;
const bgCanvas = document.getElementById("bg") as HTMLCanvasElement;
const fxCanvas = document.getElementById("fx") as HTMLCanvasElement;
const smokeCanvas = document.getElementById("smoke") as HTMLCanvasElement;
const fluidCanvas = document.getElementById("fluid") as HTMLCanvasElement;

const params = new URLSearchParams(window.location.search);
const queryTheme = params.get("theme");
const queryDigits = params.get("digits");
const querySecs = params.get("secs");
const cfg = queryTheme
  ? {
      themeId: queryTheme,
      soundOn: params.get("sound") !== "0",
      preview: params.get("preview") === "1",
      // Older native binaries omit these params — fall back to the config
      // written to localStorage right before the overlay opened.
      showDigits: queryDigits !== null ? queryDigits !== "0" : readOverlayConfig().showDigits,
      countdownSeconds:
        querySecs !== null
          ? clampCountdownSeconds(querySecs)
          : clampCountdownSeconds(readOverlayConfig().countdownSeconds),
    }
  : readOverlayConfig();
cfg.countdownSeconds = clampCountdownSeconds(cfg.countdownSeconds);
const theme = getTheme(cfg.themeId);

// In the browser (vite dev preview) there is no Tauri window; guard it.
const isTauri = "__TAURI_INTERNALS__" in window;

// Apply theme look.
document.body.classList.add(theme.bodyClass);
if (theme.banner) bannerEl.textContent = theme.banner;

// Digits disabled: hide the whole center stage (number, ghosts, glow,
// shockwave). Background/particles/smoke/sound still run. The inline head
// script already set this class pre-paint; keep it in sync with cfg here.
document.documentElement.classList.toggle("no-digits", !cfg.showDigits);

const field = new ParticleField(fxCanvas);
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
let timeline: gsap.core.Timeline | null = null;
let safetyTimer: number | null = null;

// Fade the overlay in.
gsap.fromTo(document.body, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power1.out" });
gsap.fromTo(".top-fx", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out", delay: 0.05 });

let finished = false;
async function finish() {
  if (finished) return;
  finished = true;
  window.removeEventListener("keydown", handleEscape, true);
  if (safetyTimer !== null) {
    window.clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  timeline?.kill();
  timeline = null;
  gsap.killTweensOf([document.body, ".top-fx"]);
  // Let video-smoke begin a graceful fade if it supports it.
  (smoke as { fadeOut?: () => void } | null)?.fadeOut?.();
  await gsap.to(document.body, { opacity: 0, duration: 0.16, ease: "power1.in" }).then();
  field.destroy();
  background.destroy();
  smoke?.destroy();
  if (isTauri) {
    void emit(EVENT_FINISHED);
    await getCurrentWindow().destroy();
  }
}

function handleEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void finish();
}

window.addEventListener("keydown", handleEscape, true);

async function run() {
  // Resolve the smoke source (may await a video load) before the timeline so
  // erupt() is in sync with digit "5".
  smoke = await createSmoke();
  if (finished) {
    smoke?.destroy();
    return;
  }
  smoke?.start();

  timeline = buildCountdown({
    numberEl,
    ghostEls,
    glowEl,
    shockwaveEl,
    flashEl,
    field,
    sound,
    theme,
    showDigits: cfg.showDigits,
    seconds: cfg.countdownSeconds,
    onComplete: () => void finish(),
    onDigit: (i) => {
      if (!smoke) return;
      if (i === 0) smoke.erupt(); // 5 appears → smoke gushes from the top
      else if (i === 1) smoke.puff(); // 4 → one more billow, then it clears
    },
  });

  timeline.play();

  // Safety net: force-close if anything stalls.
  safetyTimer = window.setTimeout(() => {
    if (timeline && timeline.progress() < 1) void finish();
  }, (cfg.countdownSeconds + 7) * 1000);
}

void run();
