/**
 * Theme-agnostic countdown engine. Builds one GSAP master timeline that drives
 * 5→1, delegating the *look* to the active Theme (entrance style, particle
 * burst, hue, sound). Only transform-family props are animated on the number
 * (scale / rotation / opacity / filter / x) plus CSS-var driven afterimage, so
 * the compositor can hold 60 FPS.
 */

import { gsap } from "gsap";
import type { ParticleField } from "./particles";
import type { SoundEngine } from "./sound";
import type { Theme } from "./themes";

export interface EngineRefs {
  numberEl: HTMLElement;
  glowEl: HTMLElement;
  shockwaveEl: HTMLElement;
  flashEl: HTMLElement;
  field: ParticleField;
  sound: SoundEngine;
  theme: Theme;
  onComplete: () => void;
  /** Optional per-digit hook (index 0..4 → digits 5..1), for extra FX. */
  onDigit?: (index: number) => void;
}

const DIGITS = [5, 4, 3, 2, 1];

export function buildCountdown(refs: EngineRefs): gsap.core.Timeline {
  const { numberEl, glowEl, shockwaveEl, flashEl, field, sound, theme, onComplete, onDigit } = refs;

  const master = gsap.timeline({ onComplete, defaults: { ease: "power3.out" } });

  DIGITS.forEach((digit, i) => {
    const hue = theme.hueFor(i);
    const tl = gsap.timeline();

    // Start-of-second: set the digit, theme hue, fire burst + sound.
    tl.call(() => {
      numberEl.textContent = String(digit);
      document.body.style.setProperty("--hue", String(hue));
      field.burst(theme.burst(i));
      theme.sound.digit(sound, i);
      onDigit?.(i);
    });

    // Number entrance — style provided by the theme.
    const ent = theme.entrance(i);
    tl.fromTo(numberEl, { ...ent.from }, { ...ent.to }, 0);

    // White impact flash (separate element → no property conflict).
    tl.fromTo(
      flashEl,
      { opacity: 0 },
      { opacity: 0.55, duration: 0.06, ease: "power1.out" },
      0.02
    ).to(flashEl, { opacity: 0, duration: 0.35, ease: "power2.out" }, 0.08);

    // Afterimage / residual ghost (CSS var drives layered text-shadow).
    tl.fromTo(
      numberEl,
      { ["--ghost" as string]: 0 },
      { ["--ghost" as string]: 1, duration: 0.5, ease: "power2.out" },
      0.05
    );

    // Center shockwave ring.
    tl.fromTo(
      shockwaveEl,
      { scale: 0.1, opacity: 0.9 },
      { scale: 3.4, opacity: 0, duration: 0.7, ease: "power2.out" },
      0
    );

    // Glow halo pulse.
    tl.fromTo(
      glowEl,
      { scale: 0.6, opacity: 0 },
      { scale: 1.25, opacity: 0.55, duration: 0.25, ease: "power2.out" },
      0
    ).to(glowEl, { opacity: 0.18, scale: 1, duration: 0.5 }, 0.25);

    // Exit before the next digit.
    tl.to(
      numberEl,
      { scale: 0.82, opacity: 0, filter: "blur(10px) brightness(0.8)", duration: 0.22, ease: "power2.in" },
      0.82
    );

    master.add(tl, i * 1.0);
  });

  // Finale sound near the climax (just as "1" fades).
  master.call(() => theme.sound.finish(sound), undefined, 4.65);

  // Brief settle so the last burst can fade out before close.
  master.to({}, { duration: 0.5 });

  return master;
}
