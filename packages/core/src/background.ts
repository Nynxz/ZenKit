// Interactive WebGL2 grid behind the node graph. A <canvas> is inserted behind LiteGraph's
// (whose own background is suppressed); a RAF loop drives it, synced to the graph's pan/zoom,
// with colors pulled from the active theme tokens. Toggled by a ComfyUI setting (see register.ts).
//
// Ships the interactive WebGL2 grid; register your own via `backgrounds.register`.
//
// The cursor-follow modes (snap / follow / blob) and the tapered blob trail came back from
// ComfyUI-NynxzExperimental, which had forked this module to add them. Its copy is gone; this is
// the one implementation again.
import { app } from '@comfy/app'
import type { BackgroundContext, ZenBackground, ZenBackgrounds } from '@nynxz/zenkit-types'

// The LiteGraph canvas bits this touches. `app.canvas` is strictly typed as LGraphCanvas, but we
// reach a couple of internal fields (_pattern/_bg_img) too, so go through this loose view.
interface LGCanvas {
  canvas: HTMLCanvasElement
  ds?: { scale?: number; offset?: number[] }
  background_image?: unknown
  clear_background_color?: unknown
  _pattern?: unknown
  _bg_img?: unknown
  setDirty?: (a: boolean, b?: boolean) => void
}
function lgCanvas(): LGCanvas | null {
  return (app.canvas as unknown as LGCanvas | null) ?? null
}

/* ── color resolution (packs emit oklch, which canvas can't parse) ──────────── */
function oklToRgb(str: string): [number, number, number] | null {
  const num = (t: string) => (t && t.indexOf('%') >= 0 ? parseFloat(t) / 100 : parseFloat(t))
  let L: number, a: number, b: number
  let m = /oklch\(\s*([^)]+)\)/i.exec(str)
  if (m) {
    const p = m[1]!
      .split('/')[0]!
      .trim()
      .split(/[\s,]+/)
    L = num(p[0]!)
    const C = parseFloat(p[1]!)
    const H = ((parseFloat(p[2]!) || 0) * Math.PI) / 180
    a = C * Math.cos(H)
    b = C * Math.sin(H)
  } else if ((m = /oklab\(\s*([^)]+)\)/i.exec(str))) {
    const p = m[1]!
      .split('/')[0]!
      .trim()
      .split(/[\s,]+/)
    L = num(p[0]!)
    a = parseFloat(p[1]!)
    b = parseFloat(p[2]!)
  } else {
    return null
  }
  if ([L, a, b].some(Number.isNaN)) return null
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3,
    mm = m_ ** 3,
    s = s_ ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ]
  const g = (x: number) => {
    const c = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, Math.round(c * 255)))
  }
  return [g(lin[0]!), g(lin[1]!), g(lin[2]!)]
}

const probe2d = (() => {
  try {
    return document.createElement('canvas').getContext('2d')
  } catch {
    return null
  }
})()

function normalizeColor(value: string): string {
  const v = (value || '').trim()
  if (!v) return ''
  if (v[0] === '#' || v.startsWith('rgb')) return v
  if (v.startsWith('okl')) {
    const rgb = oklToRgb(v)
    if (rgb) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
  }
  if (probe2d) {
    probe2d.fillStyle = '#000000'
    probe2d.fillStyle = v
    const a = probe2d.fillStyle
    probe2d.fillStyle = '#ffffff'
    probe2d.fillStyle = v
    if (a === probe2d.fillStyle) return a as string
  }
  return ''
}

function cssColor(name: string, fallback: string): string {
  const el = document.querySelector('.comfyui-body-top') || document.body
  const raw = getComputedStyle(el as Element).getPropertyValue(name)
  return normalizeColor(raw) || fallback
}

function hexToRgb(color: string): [number, number, number] | null {
  if (!color) return null
  const s = String(color).trim()
  if (s[0] === '#') {
    let h = s.slice(1)
    if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!
    if (h.length !== 6) return null
    const n = parseInt(h, 16)
    if (Number.isNaN(n)) return null
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = s.match(/rgba?\(([^)]+)\)/i)
  if (m) {
    const p = m[1]!
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(parseFloat)
    if (p.length >= 3 && p.slice(0, 3).every((x) => !Number.isNaN(x)))
      return [Math.round(p[0]!), Math.round(p[1]!), Math.round(p[2]!)]
  }
  return null
}

/* ── the interactive grid (WebGL2 shader; baked-in defaults) ────────────────── */
const S = {
  rainbow: 1, // drifting full-field spectrum (the original look)
  colorSpeed: 45, // °/sec
  dotSpacing: 32, // graph units
  dotRadius: 1.4,
  restAlpha: 0.22,
  glowSize: 8,
  mouseRadius: 200,
  baseBrightness: 0.25,
  saturation: 0.7,
  lightness: 0.55,
  vignette: 1,
  // Blob trail: the droplet is a tapered poly-line of recent positions, so it curves along the
  // actual path (a comet/teardrop) instead of a rigid ellipse. These are the fixed knobs; tail
  // length + pointiness come from the "Blob flow" slider (see flowParams).
  trailSample: 5, // CSS px — min spacing between stored trail points
  trailMax: 20, // hard cap on stored points (must be ≤ MAX_TRAIL in the shader)
  headRadius: 200, // graph units — influence radius at the head (matches mouseRadius)
  tailFade: 0.55, // brightness multiplier at the tail tip (thinning/fading water)
}

/* ── cursor-follow ("zen flow") ─────────────────────────────────────────────── */
type FollowMode = 'snap' | 'follow' | 'blob'

// Follow speed → the smoothing time-constant τ (seconds): higher slider = snappier = smaller τ.
function speedToTau(v: number): number {
  const s = Math.min(100, Math.max(1, v))
  return 0.34 * (1 - s / 110) // ≈0.31s (very slow trail) … ≈0.03s (near-instant)
}
// Blob flow → how the droplet tail behaves. ttl = how long (ms) a trail point lives, so tail
// length ∝ speed × ttl; tailRadius = influence at the tip (smaller ⇒ pointier, more water-like).
function flowParams(v: number): { ttl: number; tailRadius: number } {
  const n = Math.min(100, Math.max(0, v)) / 100
  return { ttl: 140 + n * 300, tailRadius: 60 - n * 42 } // 140–440ms; tip 60→18 graph units
}

const VERT = `#version 300 es
const vec2 V[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main(){ gl_Position = vec4(V[gl_VertexID], 0.0, 1.0); }
`

const FRAG = `#version 300 es
precision highp float;
#define MAX_TRAIL 20
out vec4 fragColor;
uniform vec2  u_res;
uniform float u_dpr;
uniform float u_scale;
uniform vec2  u_offset;
uniform vec2  u_mouse;
uniform float u_over;
uniform float u_time;
uniform float u_spacing;
uniform float u_dotRadius;
uniform float u_restAlpha;
uniform float u_glow;
uniform float u_mouseRadius;
uniform float u_sat;
uniform float u_lit;
uniform float u_base;
uniform float u_speed;
uniform float u_rainbow;
uniform vec3  u_dotColor;
uniform vec3  u_bgColor;
uniform float u_vignette;
uniform float u_tailFade;         // brightness at the tail tip (< 1 ⇒ fades out)
uniform int   u_trailN;           // number of active trail points (0/1 ⇒ plain circle at u_mouse)
uniform vec2  u_trail[MAX_TRAIL];  // recent cursor path, head→tail, graph space
uniform float u_trailR[MAX_TRAIL]; // per-point influence radius, tapering head→tail
vec3 hsl2rgb(float h, float s, float l){
  h = mod(h, 360.0) / 60.0;
  float c = (1.0 - abs(2.0*l - 1.0)) * s;
  float x = c * (1.0 - abs(mod(h, 2.0) - 1.0));
  vec3 rgb;
  if (h < 1.0)      rgb = vec3(c, x, 0.0);
  else if (h < 2.0) rgb = vec3(x, c, 0.0);
  else if (h < 3.0) rgb = vec3(0.0, c, x);
  else if (h < 4.0) rgb = vec3(0.0, x, c);
  else if (h < 5.0) rgb = vec3(x, 0.0, c);
  else              rgb = vec3(c, 0.0, x);
  return rgb + (l - c/2.0);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Distance from p to segment a→b; returns the clamped projection param in t.
float segDist(vec2 p, vec2 a, vec2 b, out float t){
  vec2 ab = b - a;
  t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  return length(p - (a + t * ab));
}
void main(){
  vec2 dev = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 g = dev / (u_dpr * u_scale) - u_offset;
  vec3 col = u_bgColor;
  vec2 baseCell = floor(g / u_spacing + 0.5);
  float aa = max(fwidth(g.x), fwidth(g.y)) + 0.001;
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      vec2 cell = baseCell + vec2(float(ox), float(oy));
      vec2 dotPos = cell * u_spacing;
      float dist = length(g - dotPos);
      // Cursor proximity. With a trail (blob), light dots by distance to the tapered poly-line of
      // recent cursor positions: a tube that is fat + bright at the head and thins + fades toward
      // the tail, and — crucially — curves along the path actually travelled. Otherwise (snap/
      // follow, u_trailN < 2) it's a plain circle around the single follow point u_mouse.
      float prox = 0.0;
      if (u_over > 0.5) {
        if (u_trailN >= 2) {
          for (int i = 0; i < MAX_TRAIL - 1; i++) {
            if (i >= u_trailN - 1) break;
            float t;
            float d = segDist(dotPos, u_trail[i], u_trail[i + 1], t);
            float rr = mix(u_trailR[i], u_trailR[i + 1], t);       // radius along the segment
            float f = (float(i) + t) / float(u_trailN - 1);         // 0 head → 1 tail
            float p = (1.0 - d / max(rr, 1e-3)) * mix(1.0, u_tailFade, f);
            prox = max(prox, p);
          }
        } else {
          prox = 1.0 - length(dotPos - u_mouse) / u_mouseRadius;
        }
        prox = max(0.0, prox);
      }
      float h = hash(cell);
      float pulse = sin(u_time * (0.2 + h * 0.4) + h * 6.2831) * 0.5 + 0.5;
      float baseAlpha = u_restAlpha + h * 0.08;
      float alpha = baseAlpha + prox * 0.75 + pulse * 0.06;
      vec3 dotc;
      if (u_rainbow > 0.5) {
        float flow = (dotPos.x + dotPos.y) * 0.12
                   + 30.0 * sin(dotPos.x * 0.008 + u_time * 0.4)
                   + 30.0 * sin(dotPos.y * 0.010 - u_time * 0.3)
                   + u_time * u_speed;
        float hue = flow + prox * 50.0;
        float sat = u_base * 0.3 + prox * u_sat;
        float lit = u_base + prox * (u_lit - u_base);
        dotc = hsl2rgb(hue, sat, lit);
      } else {
        dotc = min(vec3(1.0), u_dotColor * (1.0 + prox * 0.7));
      }
      float coreR = u_dotRadius + prox * u_dotRadius * 1.8;
      float core = (1.0 - smoothstep(coreR - aa, coreR + aa, dist)) * alpha;
      float glowR = u_dotRadius + prox * u_glow;
      float glow = prox > 0.05 ? (1.0 - smoothstep(0.0, glowR, dist)) * prox * 0.4 * alpha : 0.0;
      col = mix(col, dotc, clamp(core + glow, 0.0, 1.0));
    }
  }
  if (u_vignette > 0.5) {
    vec2 uv = dev / u_res;
    float d = distance(uv, vec2(0.5, 0.4));
    col = mix(col, u_bgColor, smoothstep(0.55, 1.05, d));
  }
  fragColor = vec4(col, 1.0);
}
`

const UNIFORMS = [
  'u_res',
  'u_dpr',
  'u_scale',
  'u_offset',
  'u_mouse',
  'u_over',
  'u_time',
  'u_spacing',
  'u_dotRadius',
  'u_restAlpha',
  'u_glow',
  'u_mouseRadius',
  'u_sat',
  'u_lit',
  'u_base',
  'u_speed',
  'u_rainbow',
  'u_dotColor',
  'u_bgColor',
  'u_vignette',
  'u_tailFade',
  'u_trailN',
  'u_trail',
  'u_trailR',
] as const

type GLState = {
  gl: WebGL2RenderingContext
  prog: WebGLProgram
  u: Record<string, WebGLUniformLocation | null>
}
type GridState = { gl: GLState | null; ctx2d: CanvasRenderingContext2D | null }

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('[ZenKit] bg shader compile failed:', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

function createGL(canvas: HTMLCanvasElement): GLState | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    premultipliedAlpha: false,
    antialias: false,
  })
  if (!gl) return null
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return null
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[ZenKit] bg program link failed:', gl.getProgramInfoLog(prog))
    return null
  }
  gl.useProgram(prog)
  const u: Record<string, WebGLUniformLocation | null> = {}
  for (const name of UNIFORMS) u[name] = gl.getUniformLocation(prog, name)
  return { gl, prog, u }
}

function renderGL(host: BackgroundContext, st: GLState) {
  const vw = host.w | 0
  const vh = host.h | 0
  if (vw <= 0 || vh <= 0) return
  const { gl, u } = st
  gl.useProgram(st.prog)
  gl.viewport(0, 0, vw, vh)
  const bg = (hexToRgb(host.color('--zen-bg', '#121212')) ?? [18, 18, 18]).map((v) => v / 255)
  const dot = (hexToRgb(host.color('--zen-text', '#cccccc')) ?? [200, 200, 200]).map((v) => v / 255)
  gl.uniform2f(u.u_res!, vw, vh)
  gl.uniform1f(u.u_dpr!, host.dpr)
  gl.uniform1f(u.u_scale!, host.scale)
  gl.uniform2f(u.u_offset!, host.offset.x, host.offset.y)
  gl.uniform2f(u.u_mouse!, host.mouse.x, host.mouse.y)
  gl.uniform1f(u.u_over!, host.mouse.over ? 1 : 0)
  gl.uniform1f(u.u_time!, host.time * 0.001)
  gl.uniform1f(u.u_spacing!, S.dotSpacing)
  gl.uniform1f(u.u_dotRadius!, S.dotRadius)
  gl.uniform1f(u.u_restAlpha!, S.restAlpha)
  gl.uniform1f(u.u_glow!, S.glowSize)
  gl.uniform1f(u.u_mouseRadius!, S.mouseRadius)
  gl.uniform1f(u.u_sat!, S.saturation)
  gl.uniform1f(u.u_lit!, S.lightness)
  gl.uniform1f(u.u_base!, S.baseBrightness)
  gl.uniform1f(u.u_speed!, S.colorSpeed)
  gl.uniform1f(u.u_rainbow!, S.rainbow)
  gl.uniform3f(u.u_dotColor!, dot[0]!, dot[1]!, dot[2]!)
  gl.uniform3f(u.u_bgColor!, bg[0]!, bg[1]!, bg[2]!)
  gl.uniform1f(u.u_vignette!, S.vignette)
  gl.uniform1f(u.u_tailFade!, S.tailFade)
  gl.uniform1i(u.u_trailN!, host.trail.n)
  if (host.trail.n > 0) {
    gl.uniform2fv(u.u_trail!, host.trail.pts)
    gl.uniform1fv(u.u_trailR!, host.trail.radii)
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

function render2D(host: BackgroundContext, st: GridState) {
  const ctx = st.ctx2d || (st.ctx2d = host.layer.getContext('2d'))
  if (!ctx) return
  const W = host.w,
    H = host.h
  if (W <= 0 || H <= 0) return
  const k = host.dpr * host.scale
  const ox = host.offset.x,
    oy = host.offset.y
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, W, H)
  ctx.setTransform(k, 0, 0, k, k * ox, k * oy)
  const ax = -ox,
    ay = -oy,
    aw = W / k,
    ah = H / k
  ctx.fillStyle = host.color('--zen-bg', '#121212')
  ctx.fillRect(ax, ay, aw, ah)
  const dotCol = hexToRgb(host.color('--zen-text', '#cccccc')) ?? [200, 200, 200]
  const t = host.time * 0.001
  const i0 = Math.floor(ax / S.dotSpacing) - 1,
    i1 = Math.ceil((ax + aw) / S.dotSpacing) + 1
  const j0 = Math.floor(ay / S.dotSpacing) - 1,
    j1 = Math.ceil((ay + ah) / S.dotSpacing) + 1
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = i * S.dotSpacing,
        y = j * S.dotSpacing
      // 2D fallback: a plain circle at the follow point. The tapered blob trail is WebGL-only;
      // here it degrades to the same lagging glow as 'follow' mode.
      const prox = host.mouse.over
        ? Math.max(0, 1 - Math.hypot(x - host.mouse.x, y - host.mouse.y) / S.mouseRadius)
        : 0
      const r = dotCol[0] * (1 + prox * 0.7),
        g = dotCol[1] * (1 + prox * 0.7),
        b = dotCol[2] * (1 + prox * 0.7)
      const alpha = S.restAlpha + prox * 0.75
      ctx.beginPath()
      ctx.arc(x, y, S.dotRadius + prox * S.dotRadius * 1.8, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${Math.min(255, r) | 0}, ${Math.min(255, g) | 0}, ${Math.min(255, b) | 0}, ${Math.min(1, alpha)})`
      ctx.fill()
    }
  }
  void t
}

const grid: ZenBackground = {
  id: 'grid',
  label: 'Interactive Grid',
  init(host) {
    const gl = createGL(host.layer)
    if (!gl) console.warn('[ZenKit] WebGL2 unavailable — 2D fallback grid.')
    return { gl, ctx2d: null } as GridState
  },
  frame(host, state) {
    const st = state as GridState
    if (st.gl) renderGL(host, st.gl)
    else render2D(host, st)
  },
  dispose(state) {
    const st = state as GridState
    st.gl?.gl.getExtension('WEBGL_lose_context')?.loseContext()
  },
}

/* ── registry + host ───────────────────────────────────────────────────────── */
const registry = new Map<string, ZenBackground>()
registry.set(grid.id, grid)
let desiredId: string | null = 'grid'

class Host {
  private layer: HTMLCanvasElement | null = null
  private raf = 0
  private last = 0
  private active: ZenBackground | null = null
  private state: unknown = null
  private started = false
  private ptr = { x: 0, y: 0, over: false }
  private saved: { bg?: unknown; clear?: unknown } = {}
  // Cursor-follow state (see setBackgroundFollow* below). Defaults keep the classic snap look;
  // flow params are pre-seeded so 'blob' works even before the sliders are first touched.
  private followMode: FollowMode = 'snap'
  private followTau = speedToTau(45) // smoothing time-constant, seconds
  private trailTtl = flowParams(55).ttl // ms a trail point survives ⇒ tail length ∝ speed × ttl
  private tailRadius = flowParams(55).tailRadius // graph-unit influence at the tail tip
  private follow = { x: 0, y: 0, has: false } // eased pointer, canvas-local CSS px
  private trail: { x: number; y: number; t: number }[] = [] // recent path, head first, CSS px + ms

  setFollowMode(m: string) {
    this.followMode = m === 'follow' || m === 'blob' ? m : 'snap'
    this.follow.has = false // reset easing so a live mode switch doesn't lurch from a stale point
    this.trail.length = 0
  }
  setFollowSpeed(v: number) {
    this.followTau = speedToTau(v)
  }
  setBlobFlow(v: number) {
    const p = flowParams(v)
    this.trailTtl = p.ttl
    this.tailRadius = p.tailRadius
  }

  mount() {
    if (this.started) return
    this.started = true
    const move = (e: PointerEvent) => {
      this.ptr.x = e.clientX
      this.ptr.y = e.clientY
      this.ptr.over = true
    }
    window.addEventListener('pointermove', move, { capture: true, passive: true })
    window.addEventListener('pointerleave', () => (this.ptr.over = false), true)
    window.addEventListener('resize', () => this.resize())
    this.whenReady()
  }

  private whenReady(tries = 0) {
    if (lgCanvas()?.canvas) return this.setActive(desiredId)
    if (tries > 120) return
    requestAnimationFrame(() => this.whenReady(tries + 1))
  }

  private makeLayer(lg: { canvas: HTMLCanvasElement }) {
    const el = lg.canvas
    const c = document.createElement('canvas')
    c.setAttribute('aria-hidden', 'true')
    c.dataset.zenkitBg = ''
    Object.assign(c.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    })
    el.parentElement?.insertBefore(c, el)
    this.layer = c
    this.resize()
  }

  private resize() {
    const el = lgCanvas()?.canvas
    const c = this.layer
    if (!el || !c) return
    if (c.width !== el.width || c.height !== el.height) {
      c.width = el.width
      c.height = el.height
    }
  }

  private suppress(lg: LGCanvas) {
    if (this.saved.clear === undefined) {
      this.saved.bg = lg.background_image
      this.saved.clear = lg.clear_background_color
    }
    lg.background_image = ''
    lg.clear_background_color = ''
    lg._pattern = undefined
    lg._bg_img = undefined
  }

  private restore(lg: LGCanvas) {
    if (this.saved.clear === undefined) return
    lg.background_image = this.saved.bg
    lg.clear_background_color = this.saved.clear
    lg._pattern = undefined
    lg._bg_img = undefined
    this.saved = {}
  }

  private buildCtx(
    lg: { canvas: HTMLCanvasElement; ds?: { scale?: number; offset?: number[] } },
    now: number,
  ): BackgroundContext {
    const c = this.layer!
    const off = lg.ds?.offset || [0, 0]
    const scale = lg.ds?.scale ?? 1
    const r = lg.canvas.getBoundingClientRect()
    // Device pixels per CSS pixel for the graph canvas. We derive this from the canvas itself
    // (backing-store width ÷ CSS width) rather than reading window.devicePixelRatio, because
    // browser page zoom shifts devicePixelRatio independently of LiteGraph's backing store — so
    // trusting it drifts the grid out of scale/alignment with the nodes on zoom. c.width tracks
    // el.width (see resize()), so this is exactly the ratio LiteGraph rendered at, and it keeps
    // the shader's g = dev/(dpr*scale) - offset consistent with the CSS-space cursor mapping below.
    const dpr = r.width > 0 ? c.width / r.width : window.devicePixelRatio || 1
    const dt = this.last ? now - this.last : 16
    let mx = -1e6,
      my = -1e6,
      over = false
    const inside =
      this.ptr.over &&
      this.ptr.x >= r.left &&
      this.ptr.x <= r.right &&
      this.ptr.y >= r.top &&
      this.ptr.y <= r.bottom
    if (inside) {
      over = true
      const tx = this.ptr.x - r.left // pointer target, canvas-local CSS px
      const ty = this.ptr.y - r.top
      if (this.followMode === 'snap' || !this.follow.has) {
        this.follow.x = tx
        this.follow.y = ty
        this.follow.has = true
      }
      // Frame-rate-independent exponential smoothing toward the pointer (snap ⇒ a = 1, no lag).
      const a =
        this.followMode === 'snap' ? 1 : 1 - Math.exp(-(dt / 1000) / Math.max(1e-3, this.followTau))
      this.follow.x += (tx - this.follow.x) * a
      this.follow.y += (ty - this.follow.y) * a
      // graph-space follow point (matches the shader's g = dev/(dpr*scale) - offset)
      mx = this.follow.x / scale - off[0]!
      my = this.follow.y / scale - off[1]!
      if (this.followMode === 'blob') this.updateTrail(now)
      else this.trail.length = 0
    } else {
      this.follow.has = false // re-entry snaps in rather than sliding from a stale point
      this.trail.length = 0
    }
    // Project the trail into graph space, tapering the influence radius from head to tail.
    const pts: number[] = []
    const radii: number[] = []
    const n = this.trail.length
    for (let i = 0; i < n; i++) {
      const p = this.trail[i]!
      pts.push(p.x / scale - off[0]!, p.y / scale - off[1]!)
      radii.push(S.headRadius + (this.tailRadius - S.headRadius) * (n > 1 ? i / (n - 1) : 0))
    }
    return {
      layer: c,
      w: c.width,
      h: c.height,
      dpr,
      scale,
      offset: { x: off[0]!, y: off[1]! },
      mouse: { x: mx, y: my, over },
      trail: { pts, radii, n },
      time: now,
      dt,
      color: (v, fb = '#888888') => cssColor(v, fb),
    }
  }

  // Append the current follow point to the head of the trail (or nudge the head if barely moved),
  // then expire points older than the tail lifetime so the tail retracts as the cursor slows.
  private updateTrail(now: number) {
    const head = this.trail[0]
    if (!head || Math.hypot(this.follow.x - head.x, this.follow.y - head.y) >= S.trailSample) {
      this.trail.unshift({ x: this.follow.x, y: this.follow.y, t: now })
    } else {
      head.x = this.follow.x
      head.y = this.follow.y
      head.t = now
    }
    while (this.trail.length > 1 && now - this.trail[this.trail.length - 1]!.t > this.trailTtl)
      this.trail.pop()
    if (this.trail.length > S.trailMax) this.trail.length = S.trailMax
  }

  /** The id of the background currently rendering, or null. Backs `backgrounds.current()`. */
  activeBackgroundId(): string | null {
    return this.active?.id ?? null
  }

  setActive(id: string | null) {
    desiredId = id
    const targetId = id && id !== 'none' ? id : null
    if (this.active?.id === targetId) return
    const lg = lgCanvas()
    if (!lg || !lg.canvas) return

    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.last = 0
    if (this.active) {
      try {
        this.active.dispose?.(this.state)
      } catch (e) {
        console.error('[ZenKit] background dispose failed', e)
      }
    }
    this.active = null
    this.state = null
    this.layer?.remove()
    this.layer = null

    const def = targetId ? registry.get(targetId) : undefined
    if (!def) {
      this.restore(lg)
      lg.setDirty?.(true, true)
      return
    }
    this.active = def
    this.makeLayer(lg)
    this.suppress(lg)
    try {
      this.state = def.init?.(this.buildCtx(lg, performance.now())) ?? {}
    } catch (e) {
      console.error('[ZenKit] background init failed', e)
      this.state = {}
    }
    lg.setDirty?.(true, true)
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      this.tick(now)
    }
    this.raf = requestAnimationFrame(loop)
  }

  private tick(now: number) {
    const lg = lgCanvas()
    if (!this.active || !this.layer || !lg) return
    this.resize()
    if (lg.clear_background_color || lg.background_image) {
      lg.background_image = ''
      lg.clear_background_color = ''
      lg._pattern = undefined
      lg._bg_img = undefined
      lg.setDirty?.(false, true)
    }
    const c = this.buildCtx(lg, now)
    this.last = now
    try {
      this.active.frame(c, this.state)
    } catch (e) {
      console.error('[ZenKit] background frame failed; disabling', e)
      this.setActive(null)
    }
  }
}

const host = new Host()

/* ── public surface ─────────────────────────────────────────────────────────── */
const BG_LS = 'zenkit.bg.v1'

/** Whether the background is enabled (persisted; default on). */
export function backgroundEnabled(): boolean {
  try {
    return localStorage.getItem(BG_LS) !== '0'
  } catch {
    return true
  }
}

/** Enable/disable the background and persist the choice. */
export function setBackgroundEnabled(on: boolean) {
  try {
    localStorage.setItem(BG_LS, on ? '1' : '0')
  } catch {
    /* ignore */
  }
  host.setActive(on ? 'grid' : null)
}

export function startBackground(id: string | null = 'grid') {
  desiredId = backgroundEnabled() ? id : null
  host.mount()
}

export const backgrounds: ZenBackgrounds = {
  register: (bg) => {
    registry.set(bg.id, bg)
  },
  set: (id) => host.setActive(id),
  current: () => host.activeBackgroundId(),
  list: () => [...registry.values()].map((b) => ({ id: b.id, label: b.label })),
}

/** Cursor-follow behaviour for the grid: 'snap' (1:1, the classic look), 'follow' (the influence
 *  point eases in behind the cursor), or 'blob' (a tapered droplet trail that curves along the path
 *  you draw). Safe to call any time — it only sets host state, mounted or not. */
export function setBackgroundFollow(mode: string): void {
  host.setFollowMode(mode)
}

/** Follow smoothing speed, 0–100 (higher = snappier). No effect in 'snap' mode. */
export function setBackgroundFollowSpeed(v: number): void {
  host.setFollowSpeed(v)
}

/** Blob flow, 0–100: tail length and pointiness of the droplet trail. Only used in 'blob' mode. */
export function setBackgroundBlobFlow(v: number): void {
  host.setBlobFlow(v)
}
