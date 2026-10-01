// The active theme's startup sequence, handed to ComfyUI's pre-boot splash.
//
// The splash is drawn before any extension loads, so it can't be drawn by ZenKit at startup:
// ComfyUI's boot script reads `comfy-splash-sequence` from localStorage instead, and this keeps
// that key in step with the theme. It takes effect from the next load.

import { getPack, resolveTokens } from '@nynxz/zenkit-theme'
import type { ThemePack } from '@nynxz/zenkit-types'
import { theme } from './theme'

const SEQUENCE_KEY = 'comfy-splash-sequence'

// Full lobes and a softened point — the text glyph ♥ is sharp and flattened in most fonts.
const HEART =
  'M12 21.2c-.4 0-.8-.13-1.1-.38C6.4 17.2 2 13.6 2 8.9 2 5.9 4.3 3.5 7.2 3.5c1.9 0 3.7 1 4.8 2.6 1.1-1.6 2.9-2.6 4.8-2.6 2.9 0 5.2 2.4 5.2 5.4 0 4.7-4.4 8.3-8.9 11.92-.3.25-.7.38-1.1.38z'
const heart = (cls: string) =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${HEART}"/></svg>`

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
}

/** A pack's startup markup and CSS, or none to keep ComfyUI's own logo. */
function sequenceOf(pack: ThemePack): { html?: string; css?: string } {
  const splash = pack.splash
  if (!splash) return {}
  if (splash.html) return { html: splash.html, css: splash.css }
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
        bg: tokens['--background'],
        fg: tokens['--foreground'],
        accent: tokens['--primary'] ?? tokens['--accent'],
        ...sequenceOf(pack),
      }),
    )
  } catch {
    /* storage unavailable: the splash keeps ComfyUI's palette */
  }
}
