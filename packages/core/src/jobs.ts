// zen.jobs — progress for long-running work. Python producers emit the `zenkit.job` websocket
// event; frontend code calls `jobs.start`. Both land in one reactive list (running jobs plus
// recently finished ones), mirrored on the bus as `job` / `job:<id>`, and the taskbar's Jobs
// widget shows it.
import { reactive } from 'vue'
import type { Job, JobHandle, JobStartOptions, JobStatus, JobUpdate } from '@nynxz/zenkit-types'
import type { ZenBus } from './bus'
import { zdebug } from './log'
import { onJobEvent } from './wsEvents'

const KEEP_FINISHED_MS = 60_000
const MAX_FINISHED = 10

export const jobsState = reactive({
  byId: {} as Record<string, Job>,
})

const isFinished = (job: Job) => job.status === 'done' || job.status === 'error'

let removeJob: ((id: string) => void) | null = null

/** Drop every finished job from the list (the Jobs widget's "Clear finished"). */
export function clearFinishedJobs(): void {
  for (const job of Object.values(jobsState.byId)) if (isFinished(job)) removeJob?.(job.id)
}

function statusOf(v: unknown): JobStatus {
  return v === 'start' || v === 'done' || v === 'error' ? v : 'progress'
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function createJobs(bus: ZenBus) {
  const expiry = new Map<string, number>()
  let sequence = 0

  function remove(id: string): void {
    window.clearTimeout(expiry.get(id))
    expiry.delete(id)
    delete jobsState.byId[id]
    bus.emit('jobs:change', id)
  }

  function keepRecent(id: string): void {
    window.clearTimeout(expiry.get(id))
    expiry.set(
      id,
      window.setTimeout(() => remove(id), KEEP_FINISHED_MS),
    )
    const finished = Object.values(jobsState.byId)
      .filter(isFinished)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    for (const old of finished.slice(MAX_FINISHED)) remove(old.id)
  }

  function publish(input: Record<string, unknown>): void {
    const id = String(input.id ?? '').trim()
    if (!id) return
    const now = Date.now()
    const prev = jobsState.byId[id]
    const status = statusOf(input.status)
    const total = num(input.total, prev?.total ?? 0)
    const job: Job = {
      id,
      name: String(input.name ?? prev?.name ?? id),
      status,
      current: status === 'done' && total > 0 ? total : num(input.current, prev?.current ?? 0),
      total,
      message: String(input.message ?? prev?.message ?? ''),
      startedAt: num(input.startedAt, prev?.startedAt ?? now),
      updatedAt: num(input.updatedAt, now),
      source: String(input.source ?? prev?.source ?? '') || undefined,
    }
    jobsState.byId[id] = job
    bus.emit('job', job)
    bus.emit('job:' + id, job)
    bus.emit('jobs:change', id)
    if (isFinished(job)) keepRecent(id)
    else {
      window.clearTimeout(expiry.get(id))
      expiry.delete(id)
    }
  }

  function start(name: string, opts: JobStartOptions = {}): JobHandle {
    const id = opts.id ?? `frontend:${Date.now().toString(36)}:${++sequence}`
    publish({ id, name, status: 'start', total: opts.total ?? 0, current: 0, ...opts })
    return {
      id,
      update: (progress: JobUpdate) => publish({ id, status: 'progress', ...progress }),
      done: (message?: string) => publish({ id, status: 'done', message }),
      fail: (message?: string) => publish({ id, status: 'error', message }),
    }
  }

  removeJob = remove

  onJobEvent((d) => {
    zdebug('job event:', d.id, d)
    publish(d)
  })

  return {
    state: jobsState,
    list: (): Job[] => Object.values(jobsState.byId),
    get: (id: string): Job | null => jobsState.byId[id] ?? null,
    on: (cb: (job: Job) => void): (() => void) => bus.on('job', (p) => cb(p as Job)),
    start,
  }
}
