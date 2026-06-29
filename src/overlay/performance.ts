const FOUR_K_PIXELS = 3840 * 2160;
const SMOKE_MAX_PIXELS = 2560 * 1440;

export function adaptiveCanvasDpr(options: {
  maxDpr?: number;
  minDpr?: number;
  maxPixels?: number;
} = {}): number {
  const maxDpr = options.maxDpr ?? 2;
  const minDpr = options.minDpr ?? 1;
  const maxPixels = options.maxPixels ?? FOUR_K_PIXELS;
  const cssPixels = Math.max(1, window.innerWidth * window.innerHeight);
  const pixelBudgetDpr = Math.sqrt(maxPixels / cssPixels);
  return Math.max(minDpr, Math.min(window.devicePixelRatio || 1, maxDpr, pixelBudgetDpr));
}

export function smokeCanvasDpr(): number {
  return adaptiveCanvasDpr({ maxDpr: 1.5, minDpr: 0.75, maxPixels: SMOKE_MAX_PIXELS });
}

export interface SmokeQuality {
  simulationResolution: number;
  dyeResolution: number;
  pressureIterations: number;
}

export function smokeQuality(): SmokeQuality {
  const cssPixels = window.innerWidth * window.innerHeight;
  const nativeDpr = Math.min(window.devicePixelRatio || 1, 2);
  const nativePixels = cssPixels * nativeDpr * nativeDpr;

  if (nativePixels >= 12_000_000) {
    return { simulationResolution: 96, dyeResolution: 384, pressureIterations: 12 };
  }
  if (nativePixels >= 7_000_000) {
    return { simulationResolution: 112, dyeResolution: 448, pressureIterations: 16 };
  }
  return { simulationResolution: 128, dyeResolution: 512, pressureIterations: 20 };
}
