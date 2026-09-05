// ZenKit group theming. Themes ComfyUI's primitive node groups (rounded with the
// --zen-radius token, token-driven colors). Purely cosmetic.
//
// Canvas-side only: groups are always canvas-drawn (even in Nodes 2.0), so we wrap
// LGraphCanvas.drawGroups (looked up live each frame → a prototype wrap is enough).
// We deliberately DON'T touch the pointer pipeline — group drag/resize stay 100%
// native (ComfyUI's own bottom-right resize + drag triggers), which is what users
// expect. Graceful no-op if litegraph isn't reachable.
import { zlog, zwarn } from './log'
import { theme } from './theme'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

const comfyApp = (): Any => (window as unknown as { app?: Any }).app

// ---- theme tokens (resolved off a sized probe so var()/rem chains compute to px/rgb) ----
interface Tokens {
  t: number
  radius: number
  text: string
  accent: string
}
let tokenCache: Tokens = { t: 0, radius: 10, text: '#e5e5ea', accent: '#3b82f6' }
let probe: HTMLDivElement | null = null
let loggedRadius = false
function tokens(): Tokens {
  const now = Date.now()
  if (now - tokenCache.t < 750) return tokenCache
  try {
    if (!probe) {
      probe = document.createElement('div')
      // Real (non-zero) box: border-radius resolves to 0px on a 0×0 element.
      probe.style.cssText =
        'position:absolute;left:-9999px;top:-9999px;width:80px;height:80px;border:8px solid;pointer-events:none'
      document.body.appendChild(probe)
    }
    probe.style.borderRadius = 'var(--zen-radius, 10px)'
    probe.style.color = 'var(--zen-text, #e5e5ea)'
    probe.style.borderColor = 'var(--zen-accent, #3b82f6)'
    const cs = getComputedStyle(probe)
    const radius = parseFloat(cs.borderTopLeftRadius)
    tokenCache = {
      t: now,
      radius: Number.isFinite(radius) ? radius : 10,
      text: cs.color || '#e5e5ea',
      accent: cs.borderTopColor || '#3b82f6',
    }
    if (!loggedRadius) {
      loggedRadius = true
      zlog(`groups: --zen-radius resolved to ${tokenCache.radius}px`)
    }
  } catch (err) {
    tokenCache.t = now
    zwarn('groups: token read failed', err)
  }
  return tokenCache
}

// ---- rounded-rect paths ----
function rrPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rad: number,
): void {
  const r = Math.max(0, Math.min(rad, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
function rrTopPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rad: number,
): void {
  const r = Math.max(0, Math.min(rad, w / 2, h))
  ctx.beginPath()
  ctx.moveTo(x, y + h)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h)
  ctx.closePath()
}

// ---- drawing ----
let litegraph: Any = null
function groupFont(): string {
  litegraph ??=
    (window as Any).LiteGraph ??
    (window as Any).comfyAPI?.litegraph?.LiteGraph ??
    comfyApp()?.canvas?.constructor?.LiteGraph ??
    null
  return litegraph?.GROUP_FONT || 'Arial'
}

function drawGroup(canvas: Any, ctx: CanvasRenderingContext2D, g: Any, tk: Tokens): void {
  const scale = canvas.ds?.scale ?? 1
  const ea = canvas.editor_alpha ?? 1
  const x = g._pos[0]
  const y = g._pos[1]
  const W = g._size[0]
  const H = g._size[1]
  const th = g.titleHeight ?? 30
  const color = g.color || '#445'
  const r = Math.max(0, Math.min(tk.radius, H / 2, W / 2))

  ctx.lineJoin = 'round'
  // body fill
  ctx.globalAlpha = 0.16 * ea
  ctx.fillStyle = color
  rrPath(ctx, x, y, W, H, r)
  ctx.fill()
  // title strip
  ctx.globalAlpha = 0.5 * ea
  rrTopPath(ctx, x, y, W, th, r)
  ctx.fill()
  // crisp border
  ctx.globalAlpha = 0.85 * ea
  ctx.lineWidth = 1.5 / scale
  ctx.strokeStyle = color
  rrPath(ctx, x, y, W, H, r)
  ctx.stroke()

  // title text
  const fs = g.font_size || 14
  ctx.globalAlpha = ea
  ctx.fillStyle = tk.text
  ctx.font = `${fs}px ${groupFont()}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, Math.max(0, W - fs), th)
  ctx.clip()
  ctx.fillText(g.title ?? 'Group', x + fs / 2, y + th / 2 + 1)
  ctx.restore()
  ctx.textBaseline = 'alphabetic'

  // selection highlight
  if (g.selected) {
    ctx.globalAlpha = ea
    ctx.strokeStyle = tk.accent
    ctx.lineWidth = 2 / scale
    rrPath(ctx, x - 1.5 / scale, y - 1.5 / scale, W + 3 / scale, H + 3 / scale, r + 1.5 / scale)
    ctx.stroke()
  }
  ctx.globalAlpha = ea
}

function overlap(a: Any, b: Any): boolean {
  return a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]
}

function drawAllGroups(canvas: Any, ctx: CanvasRenderingContext2D): void {
  const groups = canvas.graph?._groups
  if (!groups) return
  const tk = tokens()
  const va = canvas.visible_area
  ctx.save()
  for (const g of groups) {
    if (va && !overlap(va, g._bounding)) continue
    try {
      drawGroup(canvas, ctx, g, tk)
    } catch (err) {
      zwarn('groups: draw failed', err)
    }
  }
  ctx.restore()
}

// ---- install ----
let patched = false
function patch(): void {
  if (patched) return
  const canvas = comfyApp()?.canvas
  const proto = canvas?.constructor?.prototype
  if (!canvas || !proto || typeof proto.drawGroups !== 'function') return

  if (!proto.__zenGroupsDraw) {
    const origDraw = proto.drawGroups
    proto.drawGroups = function (this: Any, canvasEl: Any, ctx: Any) {
      try {
        drawAllGroups(this, ctx)
      } catch (err) {
        zwarn('groups: drawGroups hook failed; using default', err)
        origDraw.call(this, canvasEl, ctx)
      }
    }
    proto.__zenGroupsDraw = true
  }

  // Re-read tokens + redraw after the theme settles (the first paint can cache a stale
  // radius before --zen-radius is applied) and whenever the theme changes.
  const refresh = (): void => {
    tokenCache.t = 0
    canvas.setDirty?.(true, true)
  }
  ;[120, 350, 800, 1600].forEach((t) => window.setTimeout(refresh, t))
  try {
    theme.onChange(refresh)
  } catch {
    /* theme bridge optional */
  }

  patched = true
  zlog('groups: themed groups active (native drag/resize)')
  refresh()
}

export function startGroups(): void {
  if (patched) return
  let tries = 0
  const poll = (): void => {
    patch()
    if (!patched && tries++ < 40) window.setTimeout(poll, 250)
  }
  poll()
}
