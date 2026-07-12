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
  ghostEls: HTMLElement[];
  glowEl: HTMLElement;
  shockwaveEl: HTMLElement;
  flashEl: HTMLElement;
  field: ParticleField;
  sound: SoundEngine;
  theme: Theme;
  onComplete: () => void;
  /** Optional per-digit hook (index 0..4 → digits 5..1), for extra FX. */
  onDigit?: (index: number) => void;
  /**
   * When false, skip all center-stage visuals (digit tweens, particle bursts,
   * shockwave, glow, flash). Timing, sound and onDigit hooks still run.
   * Defaults to true.
   */
  showDigits?: boolean;
  /** Countdown duration in seconds (counts N → 1). Defaults to 5. */
  seconds?: number;
}

export function buildCountdown(refs: EngineRefs): gsap.core.Timeline {
  const { numberEl, ghostEls, glowEl, shockwaveEl, flashEl, field, sound, theme, onComplete, onDigit } = refs;
  const showDigits = refs.showDigits ?? true;
  const seconds = Math.max(1, Math.floor(refs.seconds ?? 5));
  const digits = Array.from({ length: seconds }, (_, k) => seconds - k);

  const master = gsap.timeline({ onComplete, defaults: { ease: "power3.out" } });

  digits.forEach((digit, i) => {
    const hue = theme.hueFor(i);
    const tl = gsap.timeline();

    // Start-of-second: set the digit, theme hue, fire burst + sound.
    tl.call(() => {
      if (showDigits) {
        numberEl.textContent = String(digit);
        ghostEls.forEach((element) => {
          element.textContent = String(digit);
        });
        field.burst(theme.burst(i));
      }
      document.body.style.setProperty("--hue", String(hue));
      theme.sound.digit(sound, i);
      onDigit?.(i);
    });

    if (showDigits) {
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

      // Independent compositor layers avoid repainting the main glyph's text-shadow.
      tl.fromTo(
        ghostEls[0],
        { x: 0, scale: 1, opacity: 0.28 },
        { x: 18, scale: 1.05, opacity: 0, duration: 0.5, ease: "power2.out" },
        0.05
      );
      tl.fromTo(
        ghostEls[1],
        { x: 0, scale: 1, opacity: 0.2 },
        { x: -18, scale: 1.08, opacity: 0, duration: 0.55, ease: "power2.out" },
        0.07
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
    } else {
      // Keep each per-digit segment 1s long so master timing stays identical.
      tl.to({}, { duration: 1 });
    }

    master.add(tl, i * 1.0);
  });

  // Finale sound near the climax (just as "1" fades).
  master.call(() => theme.sound.finish(sound), undefined, seconds - 1 + 0.65);

  // Brief settle so the last burst can fade out before close.
  master.to({}, { duration: 0.3 });

  return master;
}
