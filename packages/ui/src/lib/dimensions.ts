// Pure dimension math for ZenDimensions and any width/height UI — no DOM/Vue, easy to test.

export interface DimensionsValue {
  width: number
  height: number
}

export const MIN_DIMENSION = 64
export const MAX_DIMENSION = 8192

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

export function clampDimension(value: number, lo = MIN_DIMENSION, hi = MAX_DIMENSION): number {
  return clamp(Math.round(value), lo, hi)
}

export function snap(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 1) return Math.round(value)
  return Math.round(value / step) * step
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y > 0) {
    const r = x % y
    x = y
    y = r
  }
  return x || 1
}

export function aspectRatio(width: number, height: number): string {
  if (!width || !height) return '—'
  const g = gcd(Math.round(width), Math.round(height))
  const aw = Math.round(width / g)
  const ah = Math.round(height / g)
  if (aw <= 32 && ah <= 32) return `${aw}:${ah}`
  return `${(width / height).toFixed(2)} : 1`
}

export function megapixels(width: number, height: number): number {
  return (width * height) / 1_000_000
}

export function formatMegapixels(value: number): string {
  if (value < 1) return `${(value * 1000).toFixed(0)}K px`
  return `${value.toFixed(value >= 10 ? 0 : 2)} MP`
}

/** Scale width/height to hit a target megapixel count while keeping the aspect ratio,
 *  then snap to `step` and clamp to the valid dimension range. */
export function scaleToMegapixels(
  width: number,
  height: number,
  targetMp: number,
  step = 1,
): DimensionsValue {
  const cur = width * height
  if (cur <= 0 || targetMp <= 0) return { width, height }
  const factor = Math.sqrt((targetMp * 1_000_000) / cur)
  return {
    width: clampDimension(snap(width * factor, step)),
    height: clampDimension(snap(height * factor, step)),
  }
}

/** Find the preset closest to the given dimensions, ranking by aspect-ratio difference
 *  first (what people care about) then log-pixel difference. Returns null for an empty list. */
export function findClosestPreset<T extends { width: number; height: number }>(
  width: number,
  height: number,
  presets: readonly T[],
): T | null {
  if (!presets.length || width <= 0 || height <= 0) return null
  const ar = width / height
  const lp = Math.log(width * height)
  let best: T | null = null
  let bestScore = Infinity
  for (const p of presets) {
    const aspectDiff = Math.abs(p.width / p.height - ar)
    const pixelDiff = Math.abs(Math.log(p.width * p.height) - lp)
    const score = aspectDiff * 4 + pixelDiff // aspect dominates
    if (score < bestScore) {
      bestScore = score
      best = p
    }
  }
  return best
}
