import { api } from '@comfy/api'
import { startJob } from '@nynxz/zenkit-client'

const SOURCE = 'Zen Example'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type JobKind = 'counted' | 'open' | 'fail' | 'burst'

async function counted(name: string, total: number, delay: number, failAt?: number) {
  const job = await startJob(name, { total, source: SOURCE })
  for (let step = 1; step <= total; step++) {
    await sleep(delay)
    if (step === failAt) return job.fail(`Simulated failure at step ${step}`)
    job.update({ current: step, message: `Step ${step} of ${total}` })
  }
  job.done()
}

async function openEnded(name: string, seconds: number) {
  const job = await startJob(name, { source: SOURCE, message: 'Starting…' })
  for (let second = 1; second <= seconds; second++) {
    await sleep(1000)
    job.update({ message: `Working… ${second}s` })
  }
  job.done()
}

/** The same four kinds the server runs, done in the browser through `startJob`. */
export function runInBrowser(kind: JobKind): void {
  if (kind === 'counted') void counted('Resize images', 20, 250)
  else if (kind === 'open') void openEnded('Index library', 6)
  else if (kind === 'fail') void counted('Upload batch', 12, 300, 7)
  else
    for (let n = 1; n <= 4; n++) void counted(`Thumbnail ${n}`, 6 + Math.floor(Math.random() * 9), 200)
}

/** Ask the server to run one (see jobs_api.py); its progress arrives as `zenkit.job` events. */
export function runOnServer(kind: JobKind): Promise<Response> {
  return api.fetchApi(`/zenexample/jobs/${kind}`, { method: 'POST' })
}
