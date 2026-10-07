import assert from 'node:assert/strict'
import test from 'node:test'
import { mockModule, sourceModule } from './source.mjs'

async function runModule(fetchApi) {
  const listeners = new Map()
  globalThis.runTestApi = {
    fetchApi,
    addEventListener: (type, listener) => listeners.set(type, listener),
    queuePrompt: async () => ({ prompt_id: 'early' }),
  }
  const module = await sourceModule('plugins/ComfyUI-ZenAgent/src/lib/runs.ts', {
    '@comfy/api': mockModule('export const api = globalThis.runTestApi'),
    '@comfy/app': mockModule('export const app = { graphToPrompt: async () => ({output:{}}) }'),
    '@nynxz/zenkit-client': mockModule('export const mediaKindOf = () => "image"'),
  })
  const emit = (type, id) => listeners.get(type)({ detail: { prompt_id: id } })
  return { ...module, emit }
}

function addRun(module, id, status = 'queued') {
  module.runs[id] = { promptId: id, status, error: null, finishedAt: null }
  return module.runs[id]
}

test('HTTP and network stop failures leave queued runs live and retryable', async () => {
  for (const fetchApi of [
    async () => ({ ok: false, status: 500 }),
    async () => {
      throw new Error('offline')
    },
  ]) {
    const module = await runModule(fetchApi)
    const run = addRun(module, 'queued')
    assert.deepEqual(await module.cancelRuns(['queued']), ['queued'])
    assert.equal(run.status, 'queued')
    assert.equal(run.finishedAt, null)
    assert.match(run.error, /Couldn't stop/)
    module.emit('execution_success', 'queued')
    assert.equal(run.status, 'done')
    assert.equal(run.error, null)
  }
})

test('successful deletion settles queued waiters but leaves running jobs awaiting events', async () => {
  const requests = []
  const module = await runModule(async (path, options) => {
    requests.push([path, JSON.parse(options.body)])
    return { ok: true }
  })
  const queued = addRun(module, 'queued')
  const running = addRun(module, 'running', 'running')
  const done = module.waitForRun('queued')
  assert.deepEqual(await module.cancelRuns(['queued', 'running', 'unknown']), [])
  assert.equal((await done).status, 'interrupted')
  assert.notEqual(queued.finishedAt, null)
  assert.equal(running.finishedAt, null)
  assert.deepEqual(requests, [
    ['/queue', { delete: ['queued'] }],
    ['/interrupt', { prompt_id: 'running' }],
  ])
  module.emit('execution_interrupted', 'running')
  assert.equal(running.status, 'interrupted')
})

test('a failed queued deletion does not prevent stopping a running job', async () => {
  const requests = []
  const module = await runModule(async (path) => {
    requests.push(path)
    return { ok: path !== '/queue', status: 500 }
  })
  addRun(module, 'queued')
  addRun(module, 'running', 'running')
  assert.deepEqual(await module.cancelRuns(['queued', 'running']), ['queued'])
  assert.deepEqual(requests, ['/queue', '/interrupt'])
})

test('failed interruption keeps the running job live until an execution event arrives', async () => {
  const module = await runModule(async () => ({ ok: false, status: 503 }))
  const run = addRun(module, 'running', 'running')
  assert.deepEqual(await module.cancelRuns(['running']), ['running'])
  assert.equal(run.status, 'running')
  assert.equal(run.finishedAt, null)
  assert.match(run.error, /HTTP 503/)
  module.emit('execution_interrupted', 'running')
  assert.equal(run.status, 'interrupted')
  assert.notEqual(run.finishedAt, null)
})

test('completion during deletion keeps the successful result', async () => {
  const module = await runModule(async () => {
    module.emit('execution_success', 'done')
    return { ok: false, status: 500 }
  })
  const run = addRun(module, 'done')
  assert.deepEqual(await module.cancelRuns(['done']), [])
  assert.equal(run.status, 'done')
  assert.equal(run.error, null)
})

test('a job starting during deletion is interrupted instead of prematurely finished', async () => {
  const requests = []
  const module = await runModule(async (path) => {
    requests.push(path)
    if (path === '/queue') module.emit('execution_start', 'race')
    return { ok: true }
  })
  const run = addRun(module, 'race')
  assert.deepEqual(await module.cancelRuns(['race']), [])
  assert.deepEqual(requests, ['/queue', '/interrupt'])
  assert.equal(run.status, 'running')
  assert.equal(run.finishedAt, null)
})

test('queue callbacks see buffered execution events before attempting cancellation', async () => {
  const requests = []
  const module = await runModule(async (path) => {
    requests.push(path)
    return { ok: true }
  })
  module.emit('execution_start', 'early')
  let cancellation
  await module.queueRun((id) => {
    cancellation = module.cancelRuns([id])
  })
  await cancellation
  assert.deepEqual(requests, ['/interrupt'])
})
