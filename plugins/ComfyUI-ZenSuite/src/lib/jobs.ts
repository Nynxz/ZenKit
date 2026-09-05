// Minimal listener for the ZenKit job protocol (the `zenkit.job` websocket
// event). Used for the Asset Browser's inline scan progress bar — works whether
// or not the ZenKit runtime is installed, since it reads the raw event. (When
// ZenKit IS present it also drives the global progress chip; same protocol.)

import { api } from '@comfy/api'
import { ref } from 'vue'

export interface JobProgress {
  id: string
  name: string
  status: 'start' | 'progress' | 'done' | 'error'
  current: number
  total: number
}

/** Watch jobs whose id satisfies `match`. Returns a reactive current progress
 *  (null when idle/finished) and a stop() to detach the listener. */
export function watchJobs(match: (id: string) => boolean) {
  const progress = ref<JobProgress | null>(null)
  const handler = (e: { detail?: Record<string, unknown> }) => {
    const d = e?.detail || {}
    const id = String(d.id ?? '')
    if (!id || !match(id)) return
    const status = String(d.status ?? 'progress') as JobProgress['status']
    if (status === 'done' || status === 'error') {
      progress.value = null
    } else {
      progress.value = {
        id,
        name: String(d.name ?? ''),
        status,
        current: Number(d.current) || 0,
        total: Number(d.total) || 0,
      }
    }
  }
  ;(api as any).addEventListener('zenkit.job', handler)
  return {
    progress,
    stop: () => (api as any).removeEventListener('zenkit.job', handler),
  }
}
