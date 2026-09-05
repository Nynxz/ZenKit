<script setup lang="ts">
// ZenMaskCanvas — the mask/paint editor CONTENT, host-agnostic and self-contained. It fills
// its container, so it can live in a ZenWindow (the ZenMaskEditor fallback) OR a ZenKit panel
// (taskbar / minimize / restore) — the host owns the chrome; this owns the editing + an Apply
// button. Hand it an image URL; it emits `apply` with the painted mask. Runtime-free.
//
//   Tools: brush · eraser · bucket fill · color-select (RGB/HSL/LAB) — on a MASK layer or an
//          RGB PAINT layer. Pan via middle-mouse, Space-drag, or the Hand tool.
//   Brush: size · opacity · hardness · shape · spacing. Transforms: rotate L/R, mirror H/V.
//   Edit:  undo/redo · clear · invert. Mask overlay (white/black/negative) at adjustable opacity.
//
// `apply` does NOT imply close — the host decides lifecycle. Output: `maskCanvas` alpha = painted
// coverage; `toMaskBlob(true)` → alpha = 255 − coverage (ComfyUI /upload/mask convention).
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import {
  ZenColorPicker,
  ZenButton,
  ZenIconButton,
  ZenToggleGroup,
  ZenSlider,
  ZenNumber,
} from '@nynxz/zenkit-ui'
import type { MaskResult } from './types'

const props = withDefaults(
  defineProps<{
    src: string
    /** A SEPARATE mask image (grayscale, white = masked) to seed the mask layer from — keeps
     *  the base pristine (no alpha-baked holes). Takes precedence over initialMaskFromAlpha. */
    maskSrc?: string
    /** Hide the RGB paint layer + its tools — a pure mask editor. */
    maskOnly?: boolean
    /** Seed the mask from the base image's own alpha (legacy; only used when maskSrc is absent). */
    initialMaskFromAlpha?: boolean
  }>(),
  { initialMaskFromAlpha: true, maskOnly: false },
)
const emit = defineEmits<{ apply: [MaskResult] }>()

type Tool = 'brush' | 'eraser' | 'bucket' | 'colorselect' | 'pan'
type Shape = 'circle' | 'square'
type Blend = 'white' | 'black' | 'negative'
type Layer = 'mask' | 'paint'
type Space = 'rgb' | 'hsl' | 'lab'

const stageRef = ref<HTMLElement | null>(null)
const imgCanvasRef = ref<HTMLCanvasElement | null>(null)
const paintCanvasRef = ref<HTMLCanvasElement | null>(null)
const maskCanvasRef = ref<HTMLCanvasElement | null>(null)
const W = ref(0)
const H = ref(0)
const ready = ref(false)

let maskBuf: HTMLCanvasElement | null = null
let maskCtx: CanvasRenderingContext2D | null = null

const zoom = ref(1)
const tx = ref(0)
const ty = ref(0)
const clampZ = (z: number) => Math.max(0.05, Math.min(16, z))

const tool = ref<Tool>('brush')
const activeLayer = ref<Layer>('mask')
const paintColor = ref('#ff3b30')
const brushSize = ref(60)
const brushOpacity = ref(1)
const brushHardness = ref(0.7)
const brushShape = ref<Shape>('circle')
const brushSpacing = ref(0.15)
const tolerance = ref(28)
const colorSpace = ref<Space>('rgb')
const maskOpacity = ref(0.6)
const maskBlend = ref<Blend>('white')

const TOOLS = [
  { value: 'brush', icon: 'mdi mdi-brush', title: 'Brush (B)' },
  { value: 'eraser', icon: 'mdi mdi-eraser', title: 'Erase (E)' },
  { value: 'bucket', icon: 'mdi mdi-format-color-fill', title: 'Fill contiguous region (G)' },
  { value: 'colorselect', icon: 'mdi mdi-eyedropper-variant', title: 'Select by colour' },
  { value: 'pan', icon: 'mdi mdi-cursor-move', title: 'Pan (Space / middle-drag)' },
]
const LAYERS = [
  { value: 'mask', label: 'Mask' },
  { value: 'paint', label: 'Paint' },
]
const SHAPES = [
  { value: 'circle', icon: 'mdi mdi-circle', title: 'Round' },
  { value: 'square', icon: 'mdi mdi-square', title: 'Square' },
]
const BLENDS = [
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'negative', label: 'Negative' },
]
const SPACES = [
  { value: 'rgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' },
  { value: 'lab', label: 'LAB' },
]
const PRESETS = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#ffffff', '#000000']
const isFill = computed(() => tool.value === 'bucket' || tool.value === 'colorselect')

interface HistEntry {
  layer: Layer
  data: ImageData
}
const undoStack: HistEntry[] = []
const redoStack: HistEntry[] = []
const canUndo = ref(false)
const canRedo = ref(false)
function syncHist() {
  canUndo.value = undoStack.length > 0
  canRedo.value = redoStack.length > 0
}
function clearHistory() {
  undoStack.length = 0
  redoStack.length = 0
  syncHist()
}
function layerCtx(l: Layer): CanvasRenderingContext2D | null {
  return l === 'paint' ? (paintCanvasRef.value?.getContext('2d') ?? null) : maskCtx
}
function getLayerData(l: Layer): ImageData | null {
  const c = layerCtx(l)
  return c ? c.getImageData(0, 0, W.value, H.value) : null
}
function setLayerData(l: Layer, d: ImageData) {
  layerCtx(l)?.putImageData(d, 0, 0)
  if (l === 'mask') renderMask()
}
function pushHistory(l: Layer) {
  const d = getLayerData(l)
  if (!d) return
  undoStack.push({ layer: l, data: d })
  if (undoStack.length > 20) undoStack.shift()
  redoStack.length = 0
  syncHist()
}
function undo() {
  const e = undoStack.pop()
  if (!e) return
  const cur = getLayerData(e.layer)
  if (cur) redoStack.push({ layer: e.layer, data: cur })
  setLayerData(e.layer, e.data)
  syncHist()
}
function redo() {
  const e = redoStack.pop()
  if (!e) return
  const cur = getLayerData(e.layer)
  if (cur) undoStack.push({ layer: e.layer, data: cur })
  setLayerData(e.layer, e.data)
  syncHist()
}

// --- image load + init ------------------------------------------------------
function loadImage() {
  ready.value = false
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    W.value = img.naturalWidth || img.width
    H.value = img.naturalHeight || img.height
    nextTick(() => initCanvases(img))
  }
  img.onerror = () => {
    ready.value = false
  }
  img.src = props.src
}
function initCanvases(img: HTMLImageElement) {
  const ic = imgCanvasRef.value
  const pc = paintCanvasRef.value
  const mc = maskCanvasRef.value
  if (!ic || !pc || !mc) return
  ic.width = pc.width = mc.width = W.value
  ic.height = pc.height = mc.height = H.value

  // BASE layer — composite over OPAQUE WHITE so an image that already has transparency doesn't
  // read back as black (the canvas premultiplied-alpha quirk that caused the "black hole").
  const ictx = ic.getContext('2d')!
  ictx.clearRect(0, 0, W.value, H.value)
  ictx.fillStyle = '#ffffff'
  ictx.fillRect(0, 0, W.value, H.value)
  ictx.drawImage(img, 0, 0)

  // PAINT layer — starts empty.
  pc.getContext('2d')!.clearRect(0, 0, W.value, H.value)

  // MASK layer — its own buffer, seeded from a SEPARATE mask image (sidecar) if given, else empty.
  maskBuf = document.createElement('canvas')
  maskBuf.width = W.value
  maskBuf.height = H.value
  maskCtx = maskBuf.getContext('2d')
  if (props.maskSrc) seedMaskFrom(props.maskSrc)

  clearHistory()
  renderMask()
  ready.value = true
  fitted = false
  tryFit()
}
// Seed the mask layer from a separate grayscale mask image (white = masked).
function seedMaskFrom(url: string) {
  if (!maskCtx) return
  const mImg = new Image()
  mImg.crossOrigin = 'anonymous'
  mImg.onload = () => {
    if (!maskCtx) return
    const tmp = document.createElement('canvas')
    tmp.width = W.value
    tmp.height = H.value
    const tctx = tmp.getContext('2d')!
    tctx.drawImage(mImg, 0, 0, W.value, H.value)
    const md = tctx.getImageData(0, 0, W.value, H.value).data
    const seed = maskCtx.createImageData(W.value, H.value)
    const s = seed.data
    for (let i = 0; i < s.length; i += 4) {
      s[i] = s[i + 1] = s[i + 2] = 255
      s[i + 3] = md[i] // grayscale mask: luminance (R) = coverage
    }
    maskCtx.putImageData(seed, 0, 0)
    clearHistory()
    renderMask()
  }
  mImg.onerror = () => {
    /* no mask yet — start empty */
  }
  mImg.src = url
}

function renderMask() {
  const c = maskCanvasRef.value
  if (!c || !maskBuf) return
  const x = c.getContext('2d')!
  x.clearRect(0, 0, W.value, H.value)
  if (maskBlend.value === 'negative') {
    x.globalCompositeOperation = 'source-over'
    x.fillStyle = '#000'
    x.fillRect(0, 0, W.value, H.value)
    x.globalCompositeOperation = 'destination-out'
    x.drawImage(maskBuf, 0, 0)
  } else {
    x.globalCompositeOperation = 'source-over'
    x.drawImage(maskBuf, 0, 0)
    x.globalCompositeOperation = 'source-in'
    x.fillStyle = maskBlend.value === 'black' ? '#000' : '#fff'
    x.fillRect(0, 0, W.value, H.value)
  }
  x.globalCompositeOperation = 'source-over'
}
watch(maskBlend, renderMask)

function toImg(e: PointerEvent): { x: number; y: number } {
  const c = maskCanvasRef.value!
  const r = c.getBoundingClientRect()
  return {
    x: ((e.clientX - r.left) / r.width) * W.value,
    y: ((e.clientY - r.top) / r.height) * H.value,
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
function stamp(mx: number, my: number) {
  const paint = activeLayer.value === 'paint'
  const ctx = paint ? paintCanvasRef.value?.getContext('2d') : maskCtx
  if (!ctx) return
  const r = Math.max(0.5, brushSize.value / 2)
  const a = brushOpacity.value
  const [cr, cg, cb] = paint ? hexToRgb(paintColor.value) : [255, 255, 255]
  ctx.globalCompositeOperation = tool.value === 'eraser' ? 'destination-out' : 'source-over'
  if (brushShape.value === 'square') {
    ctx.globalAlpha = a
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`
    ctx.fillRect(mx - r, my - r, r * 2, r * 2)
    ctx.globalAlpha = 1
  } else {
    const r0 = Math.min(r - 0.01, r * brushHardness.value)
    const g = ctx.createRadialGradient(mx, my, Math.max(0, r0), mx, my, r)
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`)
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(mx, my, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'
}
let lastX = 0
let lastY = 0
function strokeTo(x2: number, y2: number) {
  const dx = x2 - lastX
  const dy = y2 - lastY
  const dist = Math.hypot(dx, dy)
  const step = Math.max(1, brushSize.value * Math.max(0.02, brushSpacing.value))
  const n = Math.max(1, Math.ceil(dist / step))
  for (let i = 1; i <= n; i++) stamp(lastX + (dx * i) / n, lastY + (dy * i) / n)
  lastX = x2
  lastY = y2
  if (activeLayer.value === 'mask') renderMask()
}

function rgb2hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  let h = 0
  let s = 0
  if (d) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [h, s, l]
}
function rgb2lab(r: number, g: number, b: number): [number, number, number] {
  let R = r / 255,
    G = g / 255,
    B = b / 255
  const lin = (c: number) => (c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92)
  R = lin(R)
  G = lin(G)
  B = lin(B)
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  x = f(x)
  y = f(y)
  z = f(z)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
function colorDist(a: [number, number, number], b: [number, number, number]): number {
  if (colorSpace.value === 'hsl') {
    const A = rgb2hsl(...a)
    const B = rgb2hsl(...b)
    let dh = Math.abs(A[0] - B[0])
    dh = Math.min(dh, 360 - dh)
    return ((dh / 180) * 0.6 + Math.abs(A[1] - B[1]) * 0.2 + Math.abs(A[2] - B[2]) * 0.2) * 100
  }
  if (colorSpace.value === 'lab') {
    const A = rgb2lab(...a)
    const B = rgb2lab(...b)
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2])
  }
  return (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 441) * 100
}
function selectionAt(px: number, py: number, contiguous: boolean): Uint8Array | null {
  const ic = imgCanvasRef.value
  if (!ic) return null
  const w = W.value
  const h = H.value
  const base = ic.getContext('2d')!.getImageData(0, 0, w, h).data
  const sx = Math.max(0, Math.min(w - 1, Math.round(px)))
  const sy = Math.max(0, Math.min(h - 1, Math.round(py)))
  const start = sy * w + sx
  const target: [number, number, number] = [
    base[start * 4],
    base[start * 4 + 1],
    base[start * 4 + 2],
  ]
  const tol = tolerance.value
  const sel = new Uint8Array(w * h)
  if (contiguous) {
    const seen = new Uint8Array(w * h)
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop()!
      const c: [number, number, number] = [base[p * 4], base[p * 4 + 1], base[p * 4 + 2]]
      if (colorDist(c, target) > tol) continue
      sel[p] = 1
      const x = p % w
      const y = (p / w) | 0
      if (x > 0 && !seen[p - 1]) {
        seen[p - 1] = 1
        stack.push(p - 1)
      }
      if (x < w - 1 && !seen[p + 1]) {
        seen[p + 1] = 1
        stack.push(p + 1)
      }
      if (y > 0 && !seen[p - w]) {
        seen[p - w] = 1
        stack.push(p - w)
      }
      if (y < h - 1 && !seen[p + w]) {
        seen[p + w] = 1
        stack.push(p + w)
      }
    }
  } else {
    for (let p = 0; p < w * h; p++) {
      const c: [number, number, number] = [base[p * 4], base[p * 4 + 1], base[p * 4 + 2]]
      if (colorDist(c, target) <= tol) sel[p] = 1
    }
  }
  return sel
}
function applySelection(sel: Uint8Array) {
  const paint = activeLayer.value === 'paint'
  const ctx = paint ? paintCanvasRef.value?.getContext('2d') : maskCtx
  if (!ctx) return
  const img = ctx.getImageData(0, 0, W.value, H.value)
  const d = img.data
  const a = Math.round(255 * brushOpacity.value)
  const [cr, cg, cb] = paint ? hexToRgb(paintColor.value) : [255, 255, 255]
  const erase = tool.value === 'eraser'
  for (let p = 0; p < sel.length; p++) {
    if (!sel[p]) continue
    const i = p * 4
    if (erase) {
      d[i + 3] = 0
    } else {
      d[i] = cr
      d[i + 1] = cg
      d[i + 2] = cb
      d[i + 3] = Math.max(d[i + 3], a)
    }
  }
  ctx.putImageData(img, 0, 0)
  if (!paint) renderMask()
}
function doFill(e: PointerEvent) {
  const p = toImg(e)
  const sel = selectionAt(p.x, p.y, tool.value === 'bucket')
  if (!sel) return
  pushHistory(activeLayer.value)
  applySelection(sel)
}

const spaceDown = ref(false)
const hovering = ref(false)
const cursor = ref({ x: 0, y: 0, over: false })
function onStagePointerDown(e: PointerEvent) {
  if (!ready.value) return
  if (e.button === 1 || spaceDown.value || tool.value === 'pan') {
    e.preventDefault()
    return startPan(e)
  }
  if (e.button !== 0) return
  if (isFill.value) return doFill(e)
  e.preventDefault()
  pushHistory(activeLayer.value)
  const p = toImg(e)
  lastX = p.x
  lastY = p.y
  stamp(p.x, p.y)
  if (activeLayer.value === 'mask') renderMask()
  const move = (m: PointerEvent) => strokeTo(toImg(m).x, toImg(m).y)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function startPan(e: PointerEvent) {
  e.preventDefault()
  const ox = e.clientX - tx.value
  const oy = e.clientY - ty.value
  const move = (m: PointerEvent) => {
    tx.value = m.clientX - ox
    ty.value = m.clientY - oy
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function onStageMove(e: PointerEvent) {
  const s = stageRef.value?.getBoundingClientRect()
  if (!s) return
  cursor.value = { x: e.clientX - s.left, y: e.clientY - s.top, over: true }
}
function onStageLeave() {
  cursor.value = { ...cursor.value, over: false }
}
function onWheel(e: WheelEvent) {
  e.preventDefault()
  const s = stageRef.value?.getBoundingClientRect()
  if (!s) return
  zoomAt(e.clientX - s.left, e.clientY - s.top, e.deltaY < 0 ? 1.1 : 1 / 1.1)
}
function zoomAt(px: number, py: number, f: number) {
  const z2 = clampZ(zoom.value * f)
  tx.value = px - (px - tx.value) * (z2 / zoom.value)
  ty.value = py - (py - ty.value) * (z2 / zoom.value)
  zoom.value = z2
}
let fitted = false
function fit(): boolean {
  const s = stageRef.value?.getBoundingClientRect()
  if (!s || !s.width || !s.height || !W.value || !H.value) return false
  const z = clampZ(Math.min(s.width / W.value, s.height / H.value) * 0.95)
  zoom.value = z
  tx.value = (s.width - W.value * z) / 2
  ty.value = (s.height - H.value * z) / 2
  return true
}
function tryFit() {
  if (!fitted && ready.value && fit()) fitted = true
}

function clearLayer() {
  const ctx = layerCtx(activeLayer.value)
  if (!ctx) return
  pushHistory(activeLayer.value)
  ctx.clearRect(0, 0, W.value, H.value)
  if (activeLayer.value === 'mask') renderMask()
}
function invertMask() {
  if (!maskCtx) return
  pushHistory('mask')
  const d = maskCtx.getImageData(0, 0, W.value, H.value)
  const a = d.data
  for (let i = 0; i < a.length; i += 4) {
    a[i] = a[i + 1] = a[i + 2] = 255
    a[i + 3] = 255 - a[i + 3]
  }
  maskCtx.putImageData(d, 0, 0)
  renderMask()
}
function transformAll(kind: 'rotL' | 'rotR' | 'flipH' | 'flipV') {
  const ic = imgCanvasRef.value
  const pc = paintCanvasRef.value
  if (!ic || !pc || !maskBuf) return
  const rot = kind === 'rotL' || kind === 'rotR'
  const nw = rot ? H.value : W.value
  const nh = rot ? W.value : H.value
  const xform = (src: HTMLCanvasElement): HTMLCanvasElement => {
    const dst = document.createElement('canvas')
    dst.width = nw
    dst.height = nh
    const c = dst.getContext('2d')!
    if (kind === 'rotR') {
      c.translate(nw, 0)
      c.rotate(Math.PI / 2)
    } else if (kind === 'rotL') {
      c.translate(0, nh)
      c.rotate(-Math.PI / 2)
    } else if (kind === 'flipH') {
      c.translate(nw, 0)
      c.scale(-1, 1)
    } else {
      c.translate(0, nh)
      c.scale(1, -1)
    }
    c.drawImage(src, 0, 0)
    return dst
  }
  const nbase = xform(ic)
  const npaint = xform(pc)
  const nmask = xform(maskBuf)
  W.value = nw
  H.value = nh
  for (const [cv, src] of [
    [ic, nbase],
    [pc, npaint],
  ] as [HTMLCanvasElement, HTMLCanvasElement][]) {
    cv.width = nw
    cv.height = nh
    cv.getContext('2d')!.drawImage(src, 0, 0)
  }
  maskBuf.width = nw
  maskBuf.height = nh
  maskCtx = maskBuf.getContext('2d')
  maskCtx!.drawImage(nmask, 0, 0)
  maskCanvasRef.value!.width = nw
  maskCanvasRef.value!.height = nh
  clearHistory()
  renderMask()
  fitted = false
  tryFit()
}

function buildMaskCanvas(invert: boolean): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = W.value
  out.height = H.value
  const octx = out.getContext('2d')!
  if (maskBuf) {
    const src = maskBuf.getContext('2d')!.getImageData(0, 0, W.value, H.value)
    const od = octx.createImageData(W.value, H.value)
    const s = src.data
    const o = od.data
    for (let i = 0; i < s.length; i += 4) {
      o[i] = o[i + 1] = o[i + 2] = 255
      o[i + 3] = invert ? 255 - s[i + 3] : s[i + 3]
    }
    octx.putImageData(od, 0, 0)
  }
  return out
}
function clonePaint(): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = W.value
  out.height = H.value
  if (paintCanvasRef.value) out.getContext('2d')!.drawImage(paintCanvasRef.value, 0, 0)
  return out
}
function paintUsed(): boolean {
  const pc = paintCanvasRef.value
  if (!pc) return false
  const d = pc.getContext('2d')!.getImageData(0, 0, W.value, H.value).data
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true
  return false
}
function compositeImage(): HTMLCanvasElement {
  const out = document.createElement('canvas')
  out.width = W.value
  out.height = H.value
  const c = out.getContext('2d')!
  if (imgCanvasRef.value) c.drawImage(imgCanvasRef.value, 0, 0)
  if (paintCanvasRef.value) c.drawImage(paintCanvasRef.value, 0, 0)
  return out
}
function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
  )
}
// Apply — emit the result; the HOST decides whether to keep the editor open (it does).
function applyMask() {
  const hasPaint = paintUsed()
  emit('apply', {
    width: W.value,
    height: H.value,
    maskCanvas: buildMaskCanvas(false),
    paintCanvas: hasPaint ? clonePaint() : null,
    hasPaint,
    toMaskBlob: (invert = false) => canvasToBlob(buildMaskCanvas(invert)),
    toImageBlob: () => canvasToBlob(compositeImage()),
  })
}

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}
function onKeyDown(e: KeyboardEvent) {
  if (!hovering.value) return // only grab keys while the pointer is over the editor
  if (e.key === ' ') {
    spaceDown.value = true
    e.preventDefault()
    return
  }
  if (isEditable(e.target)) return
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) redo()
    else undo()
    e.preventDefault()
    return
  }
  if (mod && e.key.toLowerCase() === 'y') {
    redo()
    e.preventDefault()
    return
  }
  switch (e.key) {
    case 'b':
    case 'B':
      tool.value = 'brush'
      break
    case 'e':
    case 'E':
      tool.value = 'eraser'
      break
    case 'g':
    case 'G':
      tool.value = 'bucket'
      break
    case '[':
      brushSize.value = Math.max(1, brushSize.value - 4)
      break
    case ']':
      brushSize.value = Math.min(250, brushSize.value + 4)
      break
    case '0':
      fitted = false
      tryFit()
      break
    default:
      return
  }
  e.preventDefault()
}
function onKeyUp(e: KeyboardEvent) {
  if (e.key === ' ') spaceDown.value = false
}

let stageRO: ResizeObserver | null = null
onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  // fit once the stage actually has a size (the host may lay it out a frame late)
  if (typeof ResizeObserver !== 'undefined' && stageRef.value) {
    stageRO = new ResizeObserver(() => tryFit())
    stageRO.observe(stageRef.value)
  }
  nextTick(loadImage)
})
watch(
  () => [props.src, props.maskSrc],
  () => nextTick(loadImage),
)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  stageRO?.disconnect()
  stageRO = null
})
// Named rather than inlined in the template: Prettier's `semi: false` strips the separator from a
// multi-statement inline handler, and Vue cannot parse newline-separated statements there.
function refit() {
  fitted = false
  tryFit()
}
</script>

<template>
  <div class="zmc">
    <div class="zmc-mid" @pointerenter="hovering = true" @pointerleave="hovering = false">
      <aside class="zmc-rail">
        <div class="zmc-tools">
          <ZenIconButton
            v-for="t in TOOLS"
            :key="t.value"
            :icon="t.icon"
            :title="t.title"
            :active="tool === t.value"
            @click="tool = t.value as Tool"
          />
        </div>

        <template v-if="!maskOnly">
          <div class="zmc-sep" />
          <div class="zmc-group">
            <label class="zmc-lab">Layer</label>
            <ZenToggleGroup v-model="activeLayer" :options="LAYERS" />
            <template v-if="activeLayer === 'paint'">
              <label class="zmc-lab">Paint colour</label>
              <ZenColorPicker v-model="paintColor" :presets="PRESETS" />
            </template>
          </div>
        </template>

        <div class="zmc-sep" />
        <div class="zmc-group">
          <label class="zmc-lab">Brush size</label>
          <div class="zmc-ctl">
            <ZenSlider v-model="brushSize" :min="1" :max="250" :step="1" />
            <ZenNumber v-model="brushSize" :min="1" :max="250" :step="1" bare />
          </div>
          <label class="zmc-lab">Opacity</label>
          <div class="zmc-ctl">
            <ZenSlider v-model="brushOpacity" :min="0" :max="1" :step="0.01" />
            <ZenNumber v-model="brushOpacity" :min="0" :max="1" :step="0.05" bare />
          </div>
          <label class="zmc-lab">Hardness</label>
          <div class="zmc-ctl">
            <ZenSlider v-model="brushHardness" :min="0" :max="1" :step="0.01" />
            <ZenNumber v-model="brushHardness" :min="0" :max="1" :step="0.05" bare />
          </div>
          <label class="zmc-lab">Spacing</label>
          <div class="zmc-ctl">
            <ZenSlider v-model="brushSpacing" :min="0.02" :max="1" :step="0.01" />
            <ZenNumber v-model="brushSpacing" :min="0.02" :max="1" :step="0.05" bare />
          </div>
          <label class="zmc-lab">Shape</label>
          <ZenToggleGroup v-model="brushShape" :options="SHAPES" />
        </div>

        <div v-if="isFill" class="zmc-sep" />
        <div v-if="isFill" class="zmc-group">
          <label class="zmc-lab">Tolerance</label>
          <div class="zmc-ctl">
            <ZenSlider v-model="tolerance" :min="0" :max="100" :step="1" />
            <ZenNumber v-model="tolerance" :min="0" :max="100" :step="1" bare />
          </div>
          <template v-if="tool === 'colorselect'">
            <label class="zmc-lab">Compare in</label>
            <ZenToggleGroup v-model="colorSpace" :options="SPACES" />
          </template>
        </div>

        <div class="zmc-sep" />
        <div class="zmc-group">
          <label class="zmc-lab">Mask opacity</label>
          <ZenSlider v-model="maskOpacity" :min="0.1" :max="1" :step="0.05" />
          <label class="zmc-lab">Show as</label>
          <ZenToggleGroup v-model="maskBlend" :options="BLENDS" />
        </div>

        <div class="zmc-sep" />
        <div class="zmc-group">
          <label class="zmc-lab">Transform</label>
          <div class="zmc-tools">
            <ZenIconButton
              icon="mdi mdi-rotate-left"
              title="Rotate left"
              @click="transformAll('rotL')"
            />
            <ZenIconButton
              icon="mdi mdi-rotate-right"
              title="Rotate right"
              @click="transformAll('rotR')"
            />
            <ZenIconButton
              icon="mdi mdi-flip-horizontal"
              title="Mirror horizontal"
              @click="transformAll('flipH')"
            />
            <ZenIconButton
              icon="mdi mdi-flip-vertical"
              title="Mirror vertical"
              @click="transformAll('flipV')"
            />
          </div>
        </div>

        <div class="zmc-sep" />
        <div class="zmc-actions">
          <ZenButton variant="ghost" sm block icon="mdi mdi-select-inverse" @click="invertMask">
            Invert mask
          </ZenButton>
          <ZenButton variant="ghost" sm block icon="mdi mdi-delete-outline" @click="clearLayer">
            Clear {{ activeLayer }}
          </ZenButton>
        </div>
      </aside>

      <div
        ref="stageRef"
        class="zmc-stage"
        :class="{ panning: tool === 'pan' || spaceDown }"
        @wheel="onWheel"
        @pointerdown="onStagePointerDown"
        @pointermove="onStageMove"
        @pointerleave="onStageLeave"
      >
        <div class="zmc-wrap" :style="{ transform: `translate(${tx}px, ${ty}px) scale(${zoom})` }">
          <canvas ref="imgCanvasRef" class="zmc-cv base" />
          <canvas ref="paintCanvasRef" class="zmc-cv paint" />
          <canvas ref="maskCanvasRef" class="zmc-cv mask" :style="{ opacity: maskOpacity }" />
        </div>
        <div
          v-if="cursor.over && tool !== 'pan' && !spaceDown && ready"
          class="zmc-ring"
          :style="{
            left: cursor.x + 'px',
            top: cursor.y + 'px',
            width: brushSize * zoom + 'px',
            height: brushSize * zoom + 'px',
          }"
        />
        <div v-if="!ready" class="zmc-loading">
          <i class="mdi mdi-loading mdi-spin" />
          Loading…
        </div>
      </div>
    </div>

    <footer class="zmc-foot">
      <ZenIconButton icon="mdi mdi-undo" title="Undo (Ctrl+Z)" :disabled="!canUndo" @click="undo" />
      <ZenIconButton
        icon="mdi mdi-redo"
        title="Redo (Ctrl+Shift+Z)"
        :disabled="!canRedo"
        @click="redo"
      />
      <ZenButton variant="primary" sm icon="mdi mdi-check" :disabled="!ready" @click="applyMask">
        Apply
      </ZenButton>
      <span class="zmc-grow" />
      <span class="zmc-dims">{{ W }} × {{ H }}</span>
      <button class="zmc-zoom" title="Fit to screen (0)" @click="refit()">
        {{ Math.round(zoom * 100) }}%
      </button>
    </footer>
  </div>
</template>

<style scoped>
.zmc {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--zen-text, #e5e5ea);
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zmc-mid {
  flex: 1;
  min-height: 0;
  display: flex;
}
.zmc-rail {
  flex: 0 0 236px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  overflow-y: auto;
  border-right: 1px solid var(--zen-border, #34343c);
}
.zmc-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.zmc-sep {
  height: 1px;
  background: var(--zen-border, #34343c);
  margin: 2px 0;
}
.zmc-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.zmc-lab {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--zen-muted, #9aa0aa);
}
.zmc-ctl {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zmc-ctl .zen-slider {
  flex: 1;
}
.zmc-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.zmc-stage {
  flex: 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
  background: var(--zen-bg, #15151a);
}
.zmc-stage.panning {
  cursor: grab;
}
.zmc-stage.panning:active {
  cursor: grabbing;
}
.zmc-wrap {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  will-change: transform;
}
.zmc-cv {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
}
.zmc-cv.base {
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12);
  background: #fff;
}
.zmc-cv.paint,
.zmc-cv.mask {
  pointer-events: none;
}
.zmc-ring {
  position: absolute;
  border: 1.5px solid #fff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  mix-blend-mode: difference;
}
.zmc-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 13px;
}

.zmc-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--zen-surface, #202026) 82%, transparent);
  border-top: 1px solid var(--zen-border, #34343c);
}
.zmc-grow {
  flex: 1;
}
.zmc-dims {
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
  font-variant-numeric: tabular-nums;
}
.zmc-zoom {
  min-width: 52px;
  padding: 4px 8px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 6px);
  background: var(--zen-input, #1b1b20);
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.zmc-zoom:hover {
  border-color: var(--zen-accent, #6366f1);
}
.mdi-spin {
  animation: zmc-spin 1s linear infinite;
}
@keyframes zmc-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
