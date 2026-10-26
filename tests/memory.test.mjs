import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const path = 'plugins/ComfyUI-ZenKit/src/suite/lib/memory.ts'
const GB = 1024 ** 3
const device = (extra = {}) => ({
  key: 'cuda:0',
  name: 'GPU',
  type: 'cuda',
  index: 0,
  total: 32 * GB,
  free: 20 * GB,
  torch_reserved: 0,
  torch_allocated: 0,
  telemetry: null,
  aimdo: null,
  ...extra,
})
const model = (loaded, extra = {}) => ({
  index: 0,
  name: 'Flux',
  kind: 'diffusion',
  device: 'cuda:0',
  size: loaded,
  loaded,
  pinned: 0,
  dynamic: false,
  in_use: true,
  residency: null,
  ...extra,
})
const byKey = (segments) => Object.fromEntries(segments.map((s) => [s.key, s.bytes / GB]))

const vramCases = [
  {
    name: 'a classic model lives in torch, the rest of torch is working memory',
    device: device({ torch_reserved: 10 * GB, torch_allocated: 8 * GB, free: 22 * GB }),
    models: [model(6 * GB)],
    want: { weights: 6, working: 2, cache: 2, other: 0, free: 22 },
  },
  {
    name: 'dynamic weights sit outside torch, in aimdo',
    device: device({
      torch_reserved: 2 * GB,
      torch_allocated: 2 * GB,
      aimdo: { used: 13 * GB, reclaimable: 0 },
      free: 17 * GB,
    }),
    models: [model(12 * GB, { dynamic: true })],
    want: { weights: 12, working: 3, cache: 0, other: 0, free: 17 },
  },
  {
    name: 'what NVML sees beyond ComfyUI belongs to other programs',
    device: device({
      torch_reserved: 4 * GB,
      torch_allocated: 4 * GB,
      telemetry: { used: 10 * GB },
    }),
    models: [model(4 * GB)],
    want: { weights: 4, working: 0, cache: 0, other: 6, free: 22 },
  },
  {
    name: 'models on another device do not count here',
    device: device({ torch_reserved: 1 * GB, torch_allocated: 1 * GB, free: 31 * GB }),
    models: [model(8 * GB, { device: 'cuda:1' })],
    want: { weights: 0, working: 1, cache: 0, other: 0, free: 31 },
  },
]
for (const c of vramCases)
  test(`VRAM breakdown: ${c.name}`, async () => {
    const { vramSegments } = await sourceModule(path)
    assert.deepEqual(byKey(vramSegments(c.device, c.models)), c.want)
  })

test('the VRAM breakdown always adds up to the card', async () => {
  const { vramSegments } = await sourceModule(path)
  const total = vramSegments(
    device({ torch_reserved: 40 * GB, torch_allocated: 39 * GB, free: 0 }),
    [model(30 * GB)],
  ).reduce((t, s) => t + s.bytes, 0)
  assert.ok(total >= 32 * GB)
  const segs = vramSegments(device({ torch_reserved: 3 * GB, torch_allocated: 2 * GB }), [])
  assert.equal(
    segs.reduce((t, s) => t + s.bytes, 0),
    32 * GB,
  )
})

test('RAM breakdown splits ComfyUI’s pinned memory from the rest of it', async () => {
  const { ramSegments } = await sourceModule(path)
  const segs = ramSegments({
    total: 64 * GB,
    available: 24 * GB,
    process: 30 * GB,
    pinned: 12 * GB,
    pinned_max: null,
    swap_total: null,
    swap_used: null,
  })
  assert.deepEqual(byKey(segs), { weights: 12, working: 18, other: 10, free: 24 })
})

test('page cells follow the pages one to one when they fit', async () => {
  const { pageCells } = await sourceModule(path)
  assert.deepEqual(pageCells('0123', 10), ['absent', 'vram', 'pinned', 'both'])
})

test('page cells take the state most of their pages are in when squeezed', async () => {
  const { pageCells } = await sourceModule(path)
  assert.deepEqual(pageCells('11102222', 2), ['vram', 'pinned'])
  assert.deepEqual(pageCells('', 4), [])
})

test('page counts tally each state', async () => {
  const { pageCounts } = await sourceModule(path)
  assert.deepEqual(pageCounts('0113'), { absent: 1, vram: 2, pinned: 0, both: 1 })
})

const byteCases = [
  [512, '512 B'],
  [812 * 1024 ** 2, '812 MB'],
  [23.4 * GB, '23.4 GB'],
  [1.5 * GB, '1.50 GB'],
  [null, '—'],
]
for (const [n, want] of byteCases)
  test(`bytes read as ${want}`, async () => {
    const { fmtBytes } = await sourceModule(path)
    assert.equal(fmtBytes(n), want)
  })
