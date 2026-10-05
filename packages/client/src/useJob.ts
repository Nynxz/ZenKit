import { getCurrentScope, onScopeDispose, readonly, ref } from 'vue'
import type { DeepReadonly, Ref } from 'vue'
import type { Job } from './contract'
import { whenZen } from './index'

/**
 * The running job `match` picks out (e.g. by id prefix), or null when none is running.
 * Finished and failed jobs read as null. Stops listening when the calling scope ends.
 */
export function useJob(match: (job: Job) => boolean): DeepReadonly<Ref<Job | null>> {
  const job = ref<Job | null>(null)
  let stop: (() => void) | null = null
  let disposed = false
  const take = (next: Job) => {
    if (!match(next)) return
    job.value = next.status === 'done' || next.status === 'error' ? null : next
  }
  void whenZen().then((zen) => {
    if (!zen || disposed) return
    for (const running of zen.jobs.list()) take(running)
    stop = zen.jobs.on(take)
  })
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true
      stop?.()
    })
  return readonly(job)
}
