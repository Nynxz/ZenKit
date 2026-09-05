// zen.jobs — live backend progress reported over ComfyUI websocket events.
// Python producers emit `zenkit.job`; ZenKit normalizes that into the public
// `window.ZenKit.jobs` API and mirrors updates on the bus as `job` / `job:<id>`.
import { reactive } from 'vue'
import { api } from '@comfy/api'
import type { Job, JobStatus } from '@nynxz/zenkit-types'
import type { ZenBus } from './bus'
import { zdebug, zwarn } from './log'

export const JOB_EVENT = 'zenkit.job'
export const jobsState = reactive({
  byId: {} as Record<string, Job>,
})

function statusOf(v: unknown): JobStatus {
  return v === 'start' || v === 'done' || v === 'error' ? v : 'progress'
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function createJobs(bus: ZenBus) {
  const cleanupTimers = new Map<string, number>()

  function removeLater(id: string): void {
    window.clearTimeout(cleanupTimers.get(id))
    cleanupTimers.set(
      id,
      window.setTimeout(() => {
        delete jobsState.byId[id]
        cleanupTimers.delete(id)
        bus.emit('jobs:change', id)
      }, 2500),
    )
  }

  function publish(input: Record<string, unknown>): void {
    const id = String(input.id ?? '').trim()
    if (!id) return
    const now = Date.now()
    const prev = jobsState.byId[id]
    const status = statusOf(input.status)
    const job: Job = {
      id,
      name: String(input.name ?? prev?.name ?? id),
      status,
      current: num(input.current, prev?.current ?? 0),
      total: num(input.total, prev?.total ?? 0),
      message: String(input.message ?? prev?.message ?? ''),
      startedAt: num(input.startedAt, prev?.startedAt ?? now),
      updatedAt: num(input.updatedAt, now),
    }
    jobsState.byId[id] = job
    bus.emit('job', job)
    bus.emit('job:' + id, job)
    bus.emit('jobs:change', id)
    if (status === 'done' || status === 'error') removeLater(id)
    else {
      window.clearTimeout(cleanupTimers.get(id))
      cleanupTimers.delete(id)
    }
  }

  try {
    ;(
      api as { addEventListener?: (e: string, cb: (ev: { detail?: unknown }) => void) => void }
    )?.addEventListener?.(JOB_EVENT, (e) => {
      const d = (e?.detail as Record<string, unknown>) || {}
      zdebug('job event:', d.id, d)
      publish(d)
    })
  } catch (err) {
    zwarn('jobs: listener failed to register', err)
  }

  return {
    state: jobsState,
    list: (): Job[] => Object.values(jobsState.byId),
    get: (id: string): Job | null => jobsState.byId[id] ?? null,
    on: (cb: (job: Job) => void): (() => void) => bus.on('job', (p) => cb(p as Job)),
    publish,
  }
}
