import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const path = 'plugins/ComfyUI-ZenKit/src/suite/lib/runs.ts'
const node = (id, duration, status = 'done', type = 'KSampler') => ({
  id,
  title: 'Node ' + id,
  type,
  duration,
  status,
  groupId: null,
  group: null,
})
const run = (id, total, nodes, extra = {}) => ({
  id,
  at: 1000,
  workflow: 'portrait',
  status: 'done',
  total,
  nodes,
  ...extra,
})

test('an average is each node’s mean over the runs it ran in, and the mean total', async () => {
  const { averageOf } = await sourceModule(path)
  const avg = averageOf([
    run('b', 3000, [node('1', 1000), node('2', 0, 'cached')]),
    run('a', 5000, [node('1', 3000), node('2', 800)]),
  ])
  assert.equal(avg.total, 4000)
  assert.equal(avg.of, 2)
  assert.deepEqual(
    avg.nodes.map((n) => [n.id, n.duration, n.status]),
    [
      ['1', 2000, 'done'],
      ['2', 800, 'done'],
    ],
  )
})

test('a node cached in every run averages to cached', async () => {
  const { averageOf } = await sourceModule(path)
  const avg = averageOf([run('a', 10, [node('1', 0, 'cached')])])
  assert.deepEqual([avg.nodes[0].duration, avg.nodes[0].status], [0, 'cached'])
})

test('no runs have no average', async () => {
  const { averageOf } = await sourceModule(path)
  assert.equal(averageOf([]), null)
})

const deltaCases = [
  { name: 'slower is positive', now: node('1', 1500), base: node('1', 1000), want: 500 },
  { name: 'faster is negative', now: node('1', 700), base: node('1', 1000), want: -300 },
  {
    name: 'cached now has none',
    now: node('1', 0, 'cached'),
    base: node('1', 1000),
    want: undefined,
  },
  {
    name: 'cached before has none',
    now: node('1', 900),
    base: node('1', 0, 'cached'),
    want: undefined,
  },
  {
    name: 'another node type under the same id has none',
    now: node('1', 900, 'done', 'VAEDecode'),
    base: node('1', 1000),
    want: undefined,
  },
]
for (const c of deltaCases)
  test(`deltas against a baseline: ${c.name}`, async () => {
    const { deltasAgainst, nodeKey } = await sourceModule(path)
    const deltas = deltasAgainst([c.now], run('base', 0, [c.base]))
    assert.equal(deltas.get(nodeKey(c.now)), c.want)
  })

test('kept runs are newest first and capped, oldest dropped', async () => {
  const { keep } = await sourceModule(path)
  const kept = keep([run('b', 1, []), run('a', 1, [])], run('c', 1, []), 2)
  assert.deepEqual(
    kept.map((r) => r.id),
    ['c', 'b'],
  )
})

test('only finished runs of the same workflow that did work are comparable', async () => {
  const { comparable } = await sourceModule(path)
  const runs = [
    run('a', 1, [node('1', 5)]),
    run('b', 1, [node('1', 5)], { status: 'error' }),
    run('c', 1, [node('1', 5)], { workflow: 'landscape' }),
    run('d', 1, [node('1', 0, 'cached')]),
  ]
  assert.deepEqual(
    comparable(runs, 'portrait').map((r) => r.id),
    ['a'],
  )
})

test('stored runs drop malformed entries and nodes', async () => {
  const { parseRuns } = await sourceModule(path)
  const parsed = parseRuns([run('a', 1, [node('1', 5), { id: 2 }]), { id: 'broken' }, 'nonsense'])
  assert.deepEqual(
    parsed.map((r) => [r.id, r.nodes.length]),
    [['a', 1]],
  )
  assert.deepEqual(parseRuns(null), [])
})

test('a recorded run keeps finished rows only as times, cached as zero', async () => {
  const { recordOf } = await sourceModule(path)
  const rows = [
    { ...node('1', 0), start: 0, end: 50, duration: 50 },
    { ...node('2', 0, 'cached'), start: 0, end: 0, duration: 0 },
    { ...node('3', 0, 'running'), start: 0, end: null, duration: null },
  ]
  const rec = recordOf(rows, { id: 'r', at: 1, workflow: 'w', status: 'error', total: 60 })
  assert.deepEqual(
    rec.nodes.map((n) => [n.id, n.duration, n.status]),
    [
      ['1', 50, 'done'],
      ['2', 0, 'cached'],
      ['3', 0, 'error'],
    ],
  )
})

const workCases = [
  {
    name: 'the same nodes ran',
    a: [node('1', 5), node('2', 0, 'cached')],
    b: [node('1', 9), node('2', 0, 'cached')],
    want: true,
  },
  {
    name: 'a node ran in one and was cached in the other',
    a: [node('1', 5), node('2', 4)],
    b: [node('1', 9), node('2', 0, 'cached')],
    want: false,
  },
  {
    name: 'order does not matter',
    a: [node('1', 5), node('2', 4)],
    b: [node('2', 4), node('1', 5)],
    want: true,
  },
]
for (const c of workCases)
  test(`totals compare only for the same work: ${c.name}`, async () => {
    const { sameWork } = await sourceModule(path)
    assert.equal(sameWork({ nodes: c.a }, { nodes: c.b }), c.want)
  })
