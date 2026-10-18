import type { JobHandle, JobStartOptions } from '@nynxz/zenkit-client'

// LoRA Manager's library scans as ZenKit jobs, so a scan stays visible in the taskbar while
// the panel is closed. LoRA Manager reports them on two of its own websockets, and only its
// own UI listens to those — this reads the same streams and mirrors them:
//
//   • /ws/init-progress  — the startup scan. The server replays the latest payload per model
//                          type to every new client, so a scan that started before the page
//                          loaded is still picked up (and a long-finished one is replayed too,
//                          which is why a terminal update never opens a job of its own).
//   • /ws/fetch-progress — manual refreshes (`type: 'scan_progress'`), among other messages.

/** One scan's state, normalised from either channel. */
export interface ScanUpdate {
  modelType: string
  phase: 'run' | 'done' | 'error'
  current: number
  total: number
  message: string
}

type Payload = Record<string, unknown>

const PHASES: Record<string, ScanUpdate['phase']> = {
  completed: 'done',
  cancelled: 'done',
  error: 'error',
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Real file counts when the scan knows them, else its 0–100 percentage. */
function counts(payload: Payload): Pick<ScanUpdate, 'current' | 'total'> {
  const total = num(payload.total)
  if (total && total > 0) return { current: num(payload.processed) ?? 0, total }
  return { current: num(payload.progress) ?? 0, total: 100 }
}

/** A /ws/init-progress payload: `{stage, progress, details, scanner_type, pageType}`. */
export function initUpdate(payload: Payload): ScanUpdate | null {
  const modelType = text(payload.scanner_type)
  if (!modelType) return null
  return {
    modelType,
    phase: num(payload.progress) === 100 ? 'done' : 'run',
    ...counts(payload),
    message: text(payload.details) || text(payload.stage),
  }
}

/** A /ws/fetch-progress payload; anything but a `scan_progress` message is not ours. */
export function scanUpdate(payload: Payload): ScanUpdate | null {
  const modelType = text(payload.model_type)
  if (payload.type !== 'scan_progress' || !modelType) return null
  return {
    modelType,
    phase: PHASES[text(payload.status)] ?? 'run',
    ...counts(payload),
    message: text(payload.details) || text(payload.stage),
  }
}

type Start = (name: string, opts?: JobStartOptions) => Promise<JobHandle>

/** Feeds scan updates into ZenKit jobs: one job per model type, shared by both channels. */
export function createScanJobs(start: Start): (update: ScanUpdate) => void {
  const running = new Map<string, Promise<JobHandle>>()

  return ({ modelType, phase, current, total, message }) => {
    let job = running.get(modelType)
    if (phase !== 'run') {
      if (!job) return
      running.delete(modelType)
      void job.then((j) => (phase === 'done' ? j.done(message) : j.fail(message)))
      return
    }
    if (!job) {
      job = start(`Scanning ${modelType}s`, {
        id: `loramanager:scan:${modelType}`,
        source: 'LoRA Manager',
      })
      running.set(modelType, job)
    }
    void job.then((j) => j.update({ current, total, message }))
  }
}

/** Listen on one of LoRA Manager's websockets for the life of the page, reconnecting with
 *  backoff when ComfyUI restarts. */
export function listen(path: string, onMessage: (payload: Payload) => void): void {
  let delay = 1000
  const open = () => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}${path}`)
    ws.onopen = () => {
      delay = 1000
    }
    ws.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data))
      } catch {
        /* not JSON — not a progress message */
      }
    }
    ws.onclose = () => {
      setTimeout(open, delay)
      delay = Math.min(delay * 2, 30_000)
    }
  }
  open()
}
