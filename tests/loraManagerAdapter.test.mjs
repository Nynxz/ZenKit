import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const DIR = 'plugins/ComfyUI-ZenIntegrations/src/adapters/loraManager'
const routes = () => sourceModule(`${DIR}/routes.ts`)
const progress = () => sourceModule(`${DIR}/progress.ts`)

test('a restored panel path must be a LoRA Manager page on this origin', async () => {
  const { isLoraManagerPath, LM_HOME } = await routes()
  for (const path of [LM_HOME, '/checkpoints', '/embeddings', '/statistics'])
    assert.equal(isLoraManagerPath(path), true, path)
  assert.equal(isLoraManagerPath('/loras/recipes?page=2#top'), true)

  for (const path of [
    '/',
    '/settings',
    '/loras-evil',
    '//evil.com/loras',
    'https://evil.com/loras',
    'javascript:alert(1)',
    'loras',
  ])
    assert.equal(isLoraManagerPath(path), false, path)
  for (const value of [undefined, null, 42, {}, ['/loras']])
    assert.equal(isLoraManagerPath(value), false)
})

test('scan payloads from both channels normalise to one shape', async () => {
  const { initUpdate, scanUpdate } = await progress()

  assert.deepEqual(
    initUpdate({
      stage: 'process_models',
      progress: 40,
      details: 'Processing',
      scanner_type: 'lora',
    }),
    { modelType: 'lora', phase: 'run', current: 40, total: 100, message: 'Processing' },
  )
  assert.equal(initUpdate({ progress: 100, scanner_type: 'lora' }).phase, 'done')
  assert.equal(initUpdate({ progress: 50 }), null)

  assert.deepEqual(
    scanUpdate({
      type: 'scan_progress',
      status: 'processing',
      model_type: 'checkpoint',
      stage: 'process_new',
      progress: 30,
      processed: 3,
      total: 10,
    }),
    { modelType: 'checkpoint', phase: 'run', current: 3, total: 10, message: 'process_new' },
  )
  assert.equal(
    scanUpdate({ type: 'scan_progress', status: 'cancelled', model_type: 'lora' }).phase,
    'done',
  )
  assert.equal(
    scanUpdate({ type: 'scan_progress', status: 'error', model_type: 'lora' }).phase,
    'error',
  )
  // The fetch-progress channel carries other LoRA Manager messages too.
  assert.equal(scanUpdate({ type: 'download_id', model_type: 'lora' }), null)
})

function fakeJobs() {
  const jobs = []
  const start = async (name, opts) => {
    const job = { name, opts, updates: [], end: null }
    jobs.push(job)
    return {
      id: opts.id,
      update: (u) => job.updates.push(u),
      done: (m) => (job.end = ['done', m]),
      fail: (m) => (job.end = ['fail', m]),
    }
  }
  return { jobs, start }
}

const settle = () => new Promise((resolve) => setTimeout(resolve))

test('a scan is one job per model type, across both channels', async () => {
  const { createScanJobs } = await progress()
  const { jobs, start } = fakeJobs()
  const report = createScanJobs(start)

  report({ modelType: 'lora', phase: 'run', current: 1, total: 10, message: 'a' })
  report({ modelType: 'lora', phase: 'run', current: 5, total: 10, message: 'b' })
  report({ modelType: 'checkpoint', phase: 'run', current: 0, total: 100, message: 'c' })
  report({ modelType: 'lora', phase: 'done', current: 10, total: 10, message: 'finished' })
  report({ modelType: 'checkpoint', phase: 'error', current: 0, total: 100, message: 'boom' })
  await settle()

  assert.equal(jobs.length, 2)
  assert.equal(jobs[0].opts.id, 'loramanager:scan:lora')
  assert.deepEqual(
    jobs[0].updates.map((u) => u.current),
    [1, 5],
  )
  assert.deepEqual(jobs[0].end, ['done', 'finished'])
  assert.deepEqual(jobs[1].end, ['fail', 'boom'])

  // A later scan of the same type gets a fresh job.
  report({ modelType: 'lora', phase: 'run', current: 0, total: 10, message: '' })
  await settle()
  assert.equal(jobs.length, 3)
})

test('a finished scan replayed on connect does not open a job', async () => {
  const { createScanJobs } = await progress()
  const { jobs, start } = fakeJobs()
  const report = createScanJobs(start)

  report({ modelType: 'lora', phase: 'done', current: 100, total: 100, message: '' })
  report({ modelType: 'lora', phase: 'error', current: 0, total: 100, message: '' })
  await settle()

  assert.equal(jobs.length, 0)
})
