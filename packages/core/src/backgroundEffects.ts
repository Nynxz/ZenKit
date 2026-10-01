// Overlay passes drawn above the background + finish and below the nodes.
//
// An effect is the same contract as a background, with two differences: several can run at once,
// and each gets its OWN transparent canvas. That separation is what makes the stack composable —
// the grid background owns a WebGL2 context on its layer, and a canvas can only ever have one
// context type, so a 2D overlay could never share it.
//
// Effects render in GRAPH space, so they pan and zoom with the nodes rather than sitting flat on
// the viewport like the finish does.
import type { BackgroundContext, ZenBackgroundEffect } from '@nynxz/zenkit-types'

const registry = new Map<string, ZenBackgroundEffect>()

export function registerEffect(fx: ZenBackgroundEffect): void {
  if (fx && fx.id) registry.set(fx.id, fx)
}
export function getEffect(id: string): ZenBackgroundEffect | undefined {
  return registry.get(id)
}
export function listEffects(): { id: string; label: string }[] {
  return [...registry.values()].map((f) => ({ id: f.id, label: f.label }))
}
/** Resolve ids to definitions, dropping unknowns, sorted into paint order. */
export function resolveEffects(ids: string[]): ZenBackgroundEffect[] {
  const seen = new Set<string>()
  const out: ZenBackgroundEffect[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const fx = registry.get(id)
    if (fx) out.push(fx)
  }
  return out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/* ── built-in: mecha grid ──────────────────────────────────────────────────── */

const G = {
  spacing: 120, // graph units between minor lines
  major: 4, // every Nth line is a major one
  tick: 7, // arm length (graph units) of the cross at a major intersection
  // Tuned to read over a photograph at full intensity; the layer-opacity knob
  // (`setBackgroundEffectIntensity`) is what dials it back, so the art here stays confident.
  minorAlpha: 0.16,
  majorAlpha: 0.34,
  glowRadius: 420, // graph units — how far the cursor lifts a line
  glowGain: 0.45,
}

interface LinesState {
  ctx2d: CanvasRenderingContext2D | null
}

/** Alpha boost for a line at `v` on an axis, given the cursor's coordinate on that axis. */
function proximity(v: number, at: number, over: boolean): number {
  if (!over) return 0
  const d = Math.abs(v - at)
  return d >= G.glowRadius ? 0 : (1 - d / G.glowRadius) * G.glowGain
}

function rgbaOf(color: string, alpha: number): string {
  // `color()` hands back '#rrggbb' or 'rgb(r, g, b)'; both need an alpha channel bolted on.
  const s = color.trim()
  if (s.startsWith('#') && s.length === 7) {
    const n = parseInt(s.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }
  const m = s.match(/rgba?\(([^)]+)\)/i)
  if (m) {
    const p = m[1]!.split(/[\s,/]+/).filter(Boolean)
    return `rgba(${p[0]}, ${p[1]}, ${p[2]}, ${alpha})`
  }
  return `rgba(140, 160, 200, ${alpha})`
}

const mechaGrid: ZenBackgroundEffect = {
  id: 'gridlines',
  label: 'Mecha grid',
  order: 10,
  init(host: BackgroundContext) {
    return { ctx2d: host.layer.getContext('2d') } as LinesState
  },
  frame(host, s) {
    const ctx = (s as LinesState).ctx2d
    if (!ctx) return
    const k = host.dpr * host.scale
    if (!(k > 0)) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, host.w, host.h)
    ctx.setTransform(k, 0, 0, k, k * host.offset.x, k * host.offset.y)

    // Visible rect in graph units.
    const ax = -host.offset.x
    const ay = -host.offset.y
    const aw = host.w / k
    const ah = host.h / k

    const accent = rgbaOf(host.color('--zen-accent', '#6366f1'), 1)
    const base = accent.slice(0, accent.lastIndexOf(',')) // 'rgba(r, g, b'
    const at = (a: number) => `${base}, ${Math.min(1, a).toFixed(3)})`

    ctx.lineWidth = 1 / k // hairline on screen at any zoom
    const { spacing, major } = G
    const i0 = Math.floor(ax / spacing) - 1
    const i1 = Math.ceil((ax + aw) / spacing) + 1
    const j0 = Math.floor(ay / spacing) - 1
    const j1 = Math.ceil((ay + ah) / spacing) + 1
    const mouse = host.mouse

    for (let i = i0; i <= i1; i++) {
      const x = i * spacing
      const isMajor = i % major === 0
      const a = (isMajor ? G.majorAlpha : G.minorAlpha) + proximity(x, mouse.x, mouse.over)
      ctx.strokeStyle = at(a)
      ctx.beginPath()
      ctx.moveTo(x, ay)
      ctx.lineTo(x, ay + ah)
      ctx.stroke()
    }
    for (let j = j0; j <= j1; j++) {
      const y = j * spacing
      const isMajor = j % major === 0
      const a = (isMajor ? G.majorAlpha : G.minorAlpha) + proximity(y, mouse.y, mouse.over)
      ctx.strokeStyle = at(a)
      ctx.beginPath()
      ctx.moveTo(ax, y)
      ctx.lineTo(ax + aw, y)
      ctx.stroke()
    }

    // Crosses at major intersections — the detail that reads as "panel", not "graph paper".
    ctx.lineWidth = 1.5 / k
    const arm = G.tick
    for (let j = Math.ceil(j0 / major) * major; j <= j1; j += major) {
      for (let i = Math.ceil(i0 / major) * major; i <= i1; i += major) {
        const x = i * spacing
        const y = j * spacing
        const prox = mouse.over
          ? Math.max(0, 1 - Math.hypot(x - mouse.x, y - mouse.y) / G.glowRadius)
          : 0
        ctx.strokeStyle = at(G.majorAlpha * 1.5 + prox * 0.5)
        ctx.beginPath()
        ctx.moveTo(x - arm, y)
        ctx.lineTo(x + arm, y)
        ctx.moveTo(x, y - arm)
        ctx.lineTo(x, y + arm)
        ctx.stroke()
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  },
  dispose(s) {
    ;(s as LinesState).ctx2d = null
  },
}

registerEffect(mechaGrid)
