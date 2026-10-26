// The Memory panel's data: snapshots from /zensuite/memory (see suite/memory_api.py), polled while
// the panel or the taskbar meter is showing, plus a short history for the charts. The breakdowns
// below are pure so they can be tested without a GPU.
import { reactive } from 'vue'

export interface Telemetry {
  source: 'nvml' | 'torch'
  util: number | null
  mem_util: number | null
  temp: number | null
  /** Watts. */
  power: number | null
  power_limit: number | null
  fan: number | null
  /** MHz. */
  clock: number | null
  /** Device-wide VRAM in use, every process included (NVML only). */
  used: number | null
}
export interface MemDevice {
  key: string
  name: string
  type: string
  index: number | null
  total: number
  free: number
  torch_reserved: number
  torch_allocated: number
  telemetry: Telemetry | null
  aimdo: { used: number | null } | null
}
export interface Residency {
  /** Bytes per page. */
  page: number
  /** One character per page: '0' absent, '1' in VRAM, '2' pinned in RAM, '3' both. */
  pages: string
  watermark: number | null
}
export interface MemModel {
  index: number
  /** Stable while loaded; what unloadModel takes. */
  id: string
  name: string
  kind: 'diffusion' | 'text' | 'vae' | 'other'
  device: string
  size: number
  loaded: number
  pinned: number
  dynamic: boolean
  in_use: boolean
  residency: Residency | null
}
export interface MemRam {
  total: number
  available: number
  process: number | null
  pinned: number
  pinned_max: number | null
  swap_total: number | null
  swap_used: number | null
}
export interface MemSnapshot {
  time: number
  running: boolean
  aimdo: { enabled: boolean; version: string | null }
  devices: MemDevice[]
  ram: MemRam
  models: MemModel[]
}

export type SegmentKey = 'weights' | 'working' | 'cache' | 'other' | 'free'
export interface Segment {
  key: SegmentKey
  label: string
  bytes: number
}

const pos = (n: number) => Math.max(0, n)

/** Where a device's VRAM is going. Weights loaded through dynamic VRAM live in aimdo's own
 *  allocations, outside torch's; the rest of ComfyUI's use is torch's. Whatever the device has
 *  in use beyond that (NVML's count, when there is one) belongs to other programs. */
export function vramSegments(device: MemDevice, models: MemModel[]): Segment[] {
  const here = models.filter((m) => m.device === device.key)
  const dynamic = here.filter((m) => m.dynamic).reduce((t, m) => t + m.loaded, 0)
  const fixed = here.filter((m) => !m.dynamic).reduce((t, m) => t + m.loaded, 0)
  const aimdoExtra = pos((device.aimdo?.used ?? dynamic) - dynamic)
  const working = pos(device.torch_allocated - fixed) + aimdoExtra
  const cache = pos(device.torch_reserved - device.torch_allocated)
  const weights = dynamic + Math.min(fixed, device.torch_allocated || fixed)
  const comfy = weights + working + cache
  const used = Math.max(device.telemetry?.used ?? device.total - device.free, comfy)
  return [
    { key: 'weights', label: 'Model weights', bytes: weights },
    { key: 'working', label: 'Working memory', bytes: working },
    { key: 'cache', label: 'Torch cache', bytes: cache },
    { key: 'other', label: 'Other programs', bytes: pos(used - comfy) },
    { key: 'free', label: 'Free', bytes: pos(device.total - used) },
  ]
}

/** Where system RAM is going: ComfyUI (its pinned memory shown apart), other programs, free. */
export function ramSegments(ram: MemRam): Segment[] {
  const used = pos(ram.total - ram.available)
  const process = Math.min(ram.process ?? 0, used)
  const pinned = Math.min(ram.pinned, process)
  return [
    { key: 'weights', label: 'Pinned for the GPU', bytes: pinned },
    { key: 'working', label: 'ComfyUI', bytes: process - pinned },
    { key: 'other', label: 'Other programs', bytes: used - process },
    { key: 'free', label: 'Available', bytes: ram.available },
  ]
}

export type PageState = 'absent' | 'vram' | 'pinned' | 'both'
const PAGE_STATES: PageState[] = ['absent', 'vram', 'pinned', 'both']

/** A residency string as runs of the same state, for drawing: at most `cells` cells, each the
 *  state most of its pages are in, so a long model still fits a strip. */
export function pageCells(pages: string, cells: number): PageState[] {
  if (!pages.length || cells <= 0) return []
  const n = Math.min(cells, pages.length)
  const out: PageState[] = []
  for (let c = 0; c < n; c++) {
    const from = Math.floor((c * pages.length) / n)
    const to = Math.max(from + 1, Math.floor(((c + 1) * pages.length) / n))
    const counts = [0, 0, 0, 0]
    for (let i = from; i < to; i++) counts[Number(pages[i]) & 3]++
    out.push(PAGE_STATES[counts.indexOf(Math.max(...counts))])
  }
  return out
}

/** How many of a model's pages are in each state. */
export function pageCounts(pages: string): Record<PageState, number> {
  const out: Record<PageState, number> = { absent: 0, vram: 0, pinned: 0, both: 0 }
  for (const ch of pages) out[PAGE_STATES[Number(ch) & 3]]++
  return out
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']
/** Bytes in binary units, to three significant figures: 812 MB, 23.4 GB. */
export function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  let v = Math.abs(n)
  let u = 0
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024
    u++
  }
  const digits = u === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2
  return `${n < 0 ? '−' : ''}${v.toFixed(digits)} ${UNITS[u]}`
}

// --- polling --------------------------------------------------------------------------------

/** Samples kept per device for the charts. */
export const HISTORY = 120

export interface Sample {
  t: number
  used: number
  util: number | null
}

export const memory = reactive({
  snapshot: null as MemSnapshot | null,
  error: null as string | null,
  /** Per device key, oldest first. */
  history: {} as Record<string, Sample[]>,
  ram: [] as number[],
})

/** The error while the server runs a ZenKit older than this page: the route only arrives with a
 *  restart. */
export const ROUTE_MISSING = 'restart ComfyUI to load ZenKit’s memory route'

const watchers = new Map<symbol, number>()
let timer: number | undefined
let rate = 0
let inFlight = false

async function poll() {
  if (inFlight || document.hidden) return
  inFlight = true
  try {
    const r = await fetch('/zensuite/memory')
    if (r.status === 404) throw new Error(ROUTE_MISSING)
    const snap = (await r.json()) as MemSnapshot & { error?: string }
    if (!r.ok || snap.error) throw new Error(snap.error ?? `HTTP ${r.status}`)
    memory.snapshot = snap
    memory.error = null
    record(snap)
  } catch (e) {
    memory.error = e instanceof Error ? e.message : String(e)
  } finally {
    inFlight = false
  }
}

function record(snap: MemSnapshot) {
  for (const d of snap.devices) {
    const used = vramSegments(d, snap.models)
      .filter((s) => s.key !== 'free')
      .reduce((t, s) => t + s.bytes, 0)
    const list = (memory.history[d.key] ??= [])
    list.push({ t: snap.time, used, util: d.telemetry?.util ?? null })
    if (list.length > HISTORY) list.splice(0, list.length - HISTORY)
  }
  memory.ram.push(snap.ram.total - snap.ram.available)
  if (memory.ram.length > HISTORY) memory.ram.splice(0, memory.ram.length - HISTORY)
}

function reschedule() {
  const want = watchers.size ? Math.min(...watchers.values()) : 0
  if (want === rate) return
  rate = want
  window.clearInterval(timer)
  timer = undefined
  if (!want) return
  timer = window.setInterval(poll, want)
  void poll()
}

/** Keep snapshots coming every `everyMs` (the fastest watcher wins) until the returned stop. */
export function watchMemory(everyMs: number): () => void {
  const key = Symbol('memory')
  watchers.set(key, everyMs)
  reschedule()
  return () => {
    watchers.delete(key)
    reschedule()
  }
}

/** Ask ComfyUI to unload its models, and with `clearCache` also forget the node outputs it keeps
 *  (the next run computes everything again). ComfyUI's execution thread acts on it between
 *  prompts, so it's safe mid-run: it waits for the current one. */
export async function freeMemory(opts: { clearCache: boolean }): Promise<void> {
  await fetch('/free', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: opts.clearCache }),
  })
  window.setTimeout(() => void poll(), 400)
}

/** Ask ComfyUI to unload one model. Like freeMemory it happens on the execution thread, after
 *  the running prompt if there is one. */
export async function unloadModel(id: string): Promise<void> {
  await fetch('/zensuite/memory/unload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
  })
  window.setTimeout(() => void poll(), 400)
}
