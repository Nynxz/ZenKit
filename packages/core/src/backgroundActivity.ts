// How busy ComfyUI is, for the background to show while a workflow runs: a level that eases up
// when a prompt starts and settles after the queue empties, the sampler's step progress, and a
// beat each time the run moves on to another node. Backgrounds read it from
// `BackgroundContext.activity`; the pattern says how they draw it ('off' draws nothing).
import { api } from '@comfy/api'

export const ACTIVITY_PATTERNS = ['off', 'breathe', 'sweep', 'ripple', 'aurora'] as const
export type ActivityPattern = (typeof ACTIVITY_PATTERNS)[number]

const RISE = 0.5 // seconds: the glow comes up quickly
const FALL = 1.6 // and settles slowly

const st = {
  running: false,
  /** The current sampler's step progress, 0..1 (0 between samplers). */
  progress: 0,
  /** When the run last moved on to a node (performance.now()). */
  beatAt: 0,
  level: 0,
  last: 0,
}

let wired = false
/** Listen to ComfyUI's execution events. Idempotent; called when the background starts. */
export function watchActivity() {
  if (wired) return
  wired = true
  const on = (type: string, cb: (detail: unknown) => void) =>
    (
      api as { addEventListener?: (e: string, cb: (ev: { detail?: unknown }) => void) => void }
    ).addEventListener?.(type, (e) => cb(e?.detail))
  const beat = () => {
    st.beatAt = performance.now()
    st.progress = 0
  }
  on('execution_start', () => {
    st.running = true
    beat()
  })
  // The node now running, or null when the prompt is done.
  on('executing', (detail) => {
    const node = typeof detail === 'object' && detail ? (detail as { node?: unknown }).node : detail
    if (node === null || node === undefined) st.running = false
    else {
      st.running = true
      beat()
    }
  })
  on('progress', (detail) => {
    const { value, max } = (detail ?? {}) as { value?: number; max?: number }
    if (typeof value === 'number' && typeof max === 'number' && max > 0) {
      st.running = true
      st.progress = Math.min(1, value / max)
    }
  })
  for (const end of ['execution_success', 'execution_error', 'execution_interrupted'])
    on(end, () => {
      st.running = false
      st.progress = 0
    })
  // The queue emptied (a run that ended without its own event, e.g. everything was cached).
  on('status', (detail) => {
    const left = (detail as { exec_info?: { queue_remaining?: number } } | null)?.exec_info
      ?.queue_remaining
    if (left === 0) st.running = false
  })
}

export interface Activity {
  /** 0..1, eased: how much to show. */
  level: number
  progress: number
  /** Seconds since the run last moved on to a node. */
  beat: number
}

/** Advance the easing to `now` and read the activity. */
export function readActivity(now: number): Activity {
  const dt = st.last ? Math.min(0.25, (now - st.last) / 1000) : 0
  st.last = now
  const target = st.running ? 1 : 0
  const tau = target > st.level ? RISE : FALL
  st.level += (target - st.level) * (1 - Math.exp(-dt / tau))
  if (st.level < 0.002 && !st.running) st.level = 0
  return { level: st.level, progress: st.progress, beat: (now - st.beatAt) / 1000 }
}

/** Whether the glow still has anything to draw (running, or settling after a run). */
export const activityShowing = () => st.running || st.level > 0
