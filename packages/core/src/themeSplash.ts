// The active theme's startup sequence, handed to ComfyUI's pre-boot splash.
//
// The splash is drawn before any extension loads, so it can't be drawn by ZenKit at startup:
// ComfyUI's boot script reads `comfy-splash-sequence` from localStorage instead, and this keeps
// that key in step with the theme. It takes effect from the next load.
//
// That boot script puts the sequence's html into innerHTML and its css into a <style>, so a
// pack's own splash is sanitised first (splashSanitize.ts); the built-in presets are ours and
// are stored as written.

import { getPack, resolveTokens } from '@nynxz/zenkit-theme'
import type { ThemePack } from '@nynxz/zenkit-client'
import { sanitizeSplashColor, sanitizeSplashCss, sanitizeSplashHtml } from './splashSanitize'
import { theme } from './theme'

const SEQUENCE_KEY = 'comfy-splash-sequence'

// Full lobes and a softened point — the text glyph ♥ is sharp and flattened in most fonts.
const HEART =
  'M12 21.2c-.4 0-.8-.13-1.1-.38C6.4 17.2 2 13.6 2 8.9 2 5.9 4.3 3.5 7.2 3.5c1.9 0 3.7 1 4.8 2.6 1.1-1.6 2.9-2.6 4.8-2.6 2.9 0 5.2 2.4 5.2 5.4 0 4.7-4.4 8.3-8.9 11.92-.3.25-.7.38-1.1.38z'
const heart = (cls: string) =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART}"/></svg>`

// ZenKit's lotus (docs/assets/render/brand.mjs): a petal points up from (0,0). Petals are
// [height, width, angle, opacity, delay] — the back pair opens first, the front one last.
const petal = (h: number, w: number) =>
  `M0,0 C${w},${-h * 0.3} ${w * 0.7},${-h * 0.78} 0,${-h} C${-w * 0.7},${-h * 0.78} ${-w},${-h * 0.3} 0,0Z`
const LOTUS_PETALS: [number, number, number, number, number][] = [
  [54, 24, -70, 0.55, 0.59],
  [54, 24, 70, 0.55, 0.59],
  [66, 26, -36, 0.8, 0.37],
  [66, 26, 36, 0.8, 0.37],
  [78, 28, 0, 1, 0.15],
]
// Fixed glyph columns for the rain behind it; the splash is static HTML, so no runtime random.
const KANA = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789'
const RAIN = Array.from({ length: 14 }, (_, c) =>
  Array.from({ length: 22 }, (_, r) => KANA[(c * 7 + r * 13 + c * r) % KANA.length]).join(''),
)

const PRESETS: Record<string, { html: string; css: string }> = {
  hearts: {
    html:
      `<div class="zs-drift">${[0, 1, 2, 3, 4, 5, 6].map(() => heart('zs-float')).join('')}</div>` +
      heart('zs-beat'),
    css: `
#splash-loader .zs-drift { position: absolute; inset: 0; overflow: hidden; }
#splash-loader svg { fill: var(--splash-accent); }
#splash-loader .zs-beat { width: min(96px, 24vw); animation: zs-beat 1.1s ease-in-out infinite; }
#splash-loader .zs-float { position: absolute; bottom: -48px; width: 26px; opacity: 0; animation: zs-rise 4.2s ease-in infinite; }
#splash-loader .zs-float:nth-child(1) { left: 10%; animation-delay: 0s; width: 22px; }
#splash-loader .zs-float:nth-child(2) { left: 24%; animation-delay: 1.4s; width: 16px; }
#splash-loader .zs-float:nth-child(3) { left: 38%; animation-delay: 0.6s; width: 30px; }
#splash-loader .zs-float:nth-child(4) { left: 56%; animation-delay: 2.1s; width: 20px; }
#splash-loader .zs-float:nth-child(5) { left: 68%; animation-delay: 0.9s; width: 26px; }
#splash-loader .zs-float:nth-child(6) { left: 82%; animation-delay: 1.8s; width: 18px; }
#splash-loader .zs-float:nth-child(7) { left: 92%; animation-delay: 3s; width: 24px; }
@keyframes zs-beat { 0%, 100% { transform: scale(1); } 20% { transform: scale(1.14); } 40% { transform: scale(0.98); } 60% { transform: scale(1.08); } }
@keyframes zs-rise {
  0% { transform: translateY(0) rotate(-8deg); opacity: 0; }
  15% { opacity: 0.75; }
  50% { transform: translateY(-50vh) rotate(8deg); }
  100% { transform: translateY(-110vh) rotate(-6deg); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  #splash-loader .zs-beat, #splash-loader .zs-float { animation: none; }
  #splash-loader .zs-float { display: none; }
}`,
  },
  lotus: {
    html:
      `<div class="zs-rain">${RAIN.map((col) => `<span>${col}</span>`).join('')}</div>` +
      `<svg class="zs-lotus" viewBox="0 0 120 106" aria-hidden="true">` +
      `<ellipse class="zs-ripple" cx="60" cy="98" rx="46" ry="6"/>` +
      `<ellipse class="zs-ripple" cx="60" cy="98" rx="46" ry="6" style="animation-delay:2.2s"/>` +
      LOTUS_PETALS.map(
        ([h, w, r, o, delay], i) =>
          `<path class="zs-petal${i === LOTUS_PETALS.length - 1 ? ' zs-front' : ''}" d="${petal(h, w)}" style="--r:${r}deg;--o:${o};animation-delay:${delay}s"/>`,
      ).join('') +
      `</svg>`,
    css: `
#splash-loader .zs-rain { position: absolute; inset: 0; display: flex; justify-content: space-around; overflow: hidden; mask-image: linear-gradient(transparent, #000 25%, #000 70%, transparent); }
#splash-loader .zs-rain span { font: 500 13px/1.15 ui-monospace, monospace; color: var(--splash-accent); writing-mode: vertical-rl; text-orientation: upright; opacity: 0.3; animation: zs-fall 3.6s linear infinite; }
#splash-loader .zs-rain span:nth-child(odd) { animation-duration: 4.6s; }
#splash-loader .zs-rain span:nth-child(3n) { animation-delay: -1.7s; }
#splash-loader .zs-rain span:nth-child(4n+1) { animation-delay: -0.6s; }
#splash-loader .zs-rain span:nth-child(5n) { animation-delay: -2.6s; }
#splash-loader .zs-lotus { position: relative; width: min(150px, 40vw); overflow: visible; }
#splash-loader .zs-petal { fill: var(--splash-accent); transform-box: view-box; transform-origin: 0 0; opacity: 0; animation: zs-open 1.2s cubic-bezier(.2,.8,.2,1) forwards; }
#splash-loader .zs-front { fill: color-mix(in srgb, var(--splash-accent) 65%, #fff); }
#splash-loader .zs-ripple { fill: none; stroke: var(--splash-accent); stroke-width: 1.5; transform-box: fill-box; transform-origin: center; opacity: 0; animation: zs-ripple 2.4s ease-out 1s infinite; }
@keyframes zs-fall { from { transform: translateY(-60%); } to { transform: translateY(60%); } }
@keyframes zs-open {
  from { opacity: 0; transform: translate(60px, 88px) rotate(var(--r)) scale(0.15); }
  to { opacity: var(--o); transform: translate(60px, 88px) rotate(var(--r)) scale(1); }
}
@keyframes zs-ripple { from { opacity: 0.7; transform: scale(0.6); } to { opacity: 0; transform: scale(1.6); } }
@media (prefers-reduced-motion: reduce) {
  #splash-loader .zs-rain span, #splash-loader .zs-ripple { animation: none; }
  #splash-loader .zs-petal { animation: none; opacity: var(--o); transform: translate(60px, 88px) rotate(var(--r)); }
}`,
  },
}

/** A pack's startup markup and CSS, or none to keep ComfyUI's own logo. A pack's own html and
 *  css are sanitised; if nothing of its html survives, its preset (if any) is used instead. */
function sequenceOf(pack: ThemePack): { html?: string; css?: string } {
  const splash = pack.splash
  if (!splash) return {}
  const html = splash.html ? sanitizeSplashHtml(splash.html) : ''
  if (html) {
    const css = splash.css ? sanitizeSplashCss(splash.css) : ''
    return css ? { html, css } : { html }
  }
  return (splash.preset && PRESETS[splash.preset]) || {}
}

/** Write the active theme's sequence for the next load, or clear it (ComfyUI's own theme, or
 *  themed startup switched off) so the splash falls back to ComfyUI's palette. */
export function syncThemeSplash(enabled: boolean): void {
  const id = theme.current()
  const pack = id === 'comfy' ? undefined : getPack(id)
  try {
    if (!enabled || !pack) {
      localStorage.removeItem(SEQUENCE_KEY)
      return
    }
    const tokens = resolveTokens(pack, theme.currentMode())
    localStorage.setItem(
      SEQUENCE_KEY,
      JSON.stringify({
        bg: sanitizeSplashColor(tokens['--background']),
        fg: sanitizeSplashColor(tokens['--foreground']),
        accent: sanitizeSplashColor(tokens['--primary'] ?? tokens['--accent']),
        ...sequenceOf(pack),
      }),
    )
  } catch {
    /* storage unavailable: the splash keeps ComfyUI's palette */
  }
}
