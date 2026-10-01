// The `image` background: a picture behind the node graph, scaled like CSS `background-size`.
//
// It is a plain 2D canvas pass, which buys two things over a CSS `background-image` on a div:
// it shares the exact layer + device-pixel sizing the shader background already uses (so the
// finish and effect layers stack over it identically), and letterbox bars in `contain` mode are
// painted in the live theme colour instead of whatever sits behind the canvas.
//
// Cost is ~zero per frame: the draw is cached and only repeats when something it depends on
// actually changes (source, fit, opacity, layer size, or the theme colour behind it).
import type {
  BackgroundContext,
  BackgroundFit,
  BackgroundImageOptions,
  ZenBackground,
} from '@nynxz/zenkit-types'

/** How often (in frames) to re-resolve the theme colour behind the picture. Reading a computed
 *  style forces a style flush, so we sample it about twice a second rather than every frame. */
const THEME_POLL_FRAMES = 30

const opts: Required<BackgroundImageOptions> = { url: '', fit: 'cover', opacity: 1 }

/** Bumped on every settings change so an active renderer knows its cached draw is stale. */
let rev = 0

/** Update the image background's settings. Safe before the background is active — the values
 *  are read when it next renders. Only the keys you pass change. */
export function setImageOptions(next: BackgroundImageOptions): void {
  const url = typeof next.url === 'string' ? next.url.trim() : opts.url
  const fit = next.fit ?? opts.fit
  const opacity = next.opacity === undefined ? opts.opacity : Math.max(0, Math.min(1, next.opacity))
  if (url === opts.url && fit === opts.fit && opacity === opts.opacity) return
  opts.url = url
  opts.fit = fit
  opts.opacity = opacity
  rev++
}

/** The image background's current settings (a copy). */
export function imageOptions(): Required<BackgroundImageOptions> {
  return { ...opts }
}

interface ImageState {
  ctx2d: CanvasRenderingContext2D | null
  img: HTMLImageElement | null
  /** The url `img` was created for — lets us drop a stale load that resolves late. */
  loadedUrl: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Everything the last painted frame depended on; a mismatch means repaint. */
  drawn: { rev: number; w: number; h: number; bg: string } | null
  themeTick: number
  bg: string
}

function load(state: ImageState, url: string) {
  state.loadedUrl = url
  state.img = null
  if (!url) {
    state.status = 'idle'
    return
  }
  state.status = 'loading'
  const img = new Image()
  // No crossOrigin: we only ever draw, never read pixels back, and requesting CORS would break
  // plain image hosts that do not send the header.
  img.decoding = 'async'
  img.onload = () => {
    if (state.loadedUrl !== url) return // a newer url won the race
    state.img = img
    state.status = 'ready'
    state.drawn = null
  }
  img.onerror = () => {
    if (state.loadedUrl !== url) return
    state.status = 'error'
    state.drawn = null
    console.warn('[ZenKit] background image failed to load:', url)
  }
  img.src = url
}

/** Destination rect for `img` inside a w×h layer under the given fit. */
function fitRect(
  fit: BackgroundFit,
  iw: number,
  ih: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  if (fit === 'stretch') return { x: 0, y: 0, w, h }
  if (fit === 'center') return { x: (w - iw) / 2, y: (h - ih) / 2, w: iw, h: ih }
  const k = fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)
  const dw = iw * k
  const dh = ih * k
  return { x: (w - dw) / 2, y: (h - dh) / 2, w: dw, h: dh }
}

function paint(host: BackgroundContext, state: ImageState) {
  const ctx = state.ctx2d
  if (!ctx) return
  const { w, h } = host
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  // The theme colour is the floor: it shows through a translucent picture, and fills the
  // letterbox in `contain` / `center`.
  ctx.fillStyle = state.bg
  ctx.fillRect(0, 0, w, h)

  const img = state.img
  if (!img || state.status !== 'ready') return

  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return

  ctx.globalAlpha = opts.opacity
  if (opts.fit === 'tile') {
    const pattern = ctx.createPattern(img, 'repeat')
    if (pattern) {
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, w, h)
    }
  } else {
    // Device pixels: `center` keeps the picture at its natural size, everything else scales.
    const r = fitRect(opts.fit, iw, ih, w, h)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, r.x, r.y, r.w, r.h)
  }
  ctx.globalAlpha = 1
}

export const imageBackground: ZenBackground = {
  id: 'image',
  label: 'Image',
  init(host) {
    const state: ImageState = {
      ctx2d: host.layer.getContext('2d'),
      img: null,
      loadedUrl: '',
      status: 'idle',
      drawn: null,
      themeTick: 0,
      bg: host.color('--zen-bg', '#121212'),
    }
    load(state, opts.url)
    return state
  },
  frame(host, s) {
    const state = s as ImageState
    if (state.loadedUrl !== opts.url) load(state, opts.url)

    // Re-resolve the theme colour occasionally; a theme switch should repaint the letterbox.
    if (state.themeTick++ % THEME_POLL_FRAMES === 0) state.bg = host.color('--zen-bg', '#121212')

    const d = state.drawn
    if (d && d.rev === rev && d.w === host.w && d.h === host.h && d.bg === state.bg) return
    paint(host, state)
    state.drawn = { rev, w: host.w, h: host.h, bg: state.bg }
  },
  dispose(s) {
    const state = s as ImageState
    state.img = null
    state.ctx2d = null
  },
}
