import assert from 'node:assert/strict'
import test from 'node:test'
import { mockModule, sourceModule, sourceUrl, storage } from './source.mjs'

const kept = async () =>
  sourceModule('packages/core/src/keptPanels.ts', {
    './workflowLayout': await sourceUrl('packages/core/src/workflowLayout.ts'),
  })

const G = '0b9d6f3e-1c2a-4f5b-8e7d-112233445566'
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

test('node-bound panel ids name their graph and node; others do not', async () => {
  const { nodePanelRef } = await kept()
  assert.deepEqual(nodePanelRef(`zencut:${G}:12`), { graph: G, node: '12' })
  assert.deepEqual(nodePanelRef(`nynxz.h3studio:${G.toUpperCase()}:7`), { graph: G, node: '7' })
  for (const id of ['zensuite:viewer', 'notes:pad#2', 'zencut.12', `zencut:${G}`, `x:${G}:1:2`])
    assert.equal(nodePanelRef(id), null, id)
})

test('a workspace counts its open and kept tiles, not the others', async () => {
  const { panelsHere } = await kept()
  const open = new Set(['a'])
  const waiting = new Set(['b'])
  const here = panelsHere(
    ['a', 'b', 'c'],
    (id) => open.has(id),
    (id) => waiting.has(id),
  )
  assert.deepEqual(here, ['a', 'b'])
  // Neither open nor kept (closed for good, or never reopened): not counted.
  assert.deepEqual(
    panelsHere(
      ['c'],
      () => false,
      () => false,
    ),
    [],
  )
})

test('a closed tile whose node is gone from its graph is stale', async () => {
  const { staleTiles } = await kept()
  const nodes = { [G]: new Set(['1', '2']) }
  const nodesOf = (g) => nodes[g] ?? null
  const ids = [
    `zencut:${G}:1`, // node still there
    `zencut:${G}:9`, // deleted
    `zencut:${OTHER}:9`, // another workflow's graph (or one just cleared for a load): unknown
    'zensuite:viewer', // not bound to a node
    `zencut:${G}:8`, // gone too, but open: its owner's business
  ]
  const open = new Set([`zencut:${G}:8`])
  assert.deepEqual(
    staleTiles(ids, (id) => open.has(id), nodesOf),
    [`zencut:${G}:9`],
  )
})

test('a workflow switch prunes nothing: the outgoing graph is not found', async () => {
  const { staleTiles } = await kept()
  // The graph was cleared under a fresh id: every lookup of the old one is null.
  assert.deepEqual(
    staleTiles(
      [`zencut:${G}:1`, `zencut:${G}:2`],
      () => false,
      () => null,
    ),
    [],
  )
  // The same workflow reloaded (an undo): the node is back.
  assert.deepEqual(
    staleTiles(
      [`zencut:${G}:1`],
      () => false,
      () => new Set(['1']),
    ),
    [],
  )
})

test('stale tiles look each graph up once', async () => {
  const { staleTiles } = await kept()
  let lookups = 0
  staleTiles(
    [`a:${G}:1`, `b:${G}:2`, `c:${G}:3`],
    () => false,
    () => (lookups++, new Set()),
  )
  assert.equal(lookups, 1)
})

test('kept panels round-trip through storage, sanitized and capped', async () => {
  const { parseKept, serializeKept, KEPT_MAX, KEPT_ICON } = await kept()
  const m = parseKept([
    [`zencut:${G}:1`, { title: 'ZenCut', icon: 'mdi mdi-movie-edit-outline' }],
    ['bad id with spaces', { title: 'x' }],
    [`zencut:${G}:2`, { title: 'Evil‮Name\n', icon: '"><img src=x onerror=alert(1)>' }],
    [`zencut:${G}:3`, null],
    'not a pair',
  ])
  assert.deepEqual([...m.keys()], [`zencut:${G}:1`, `zencut:${G}:2`, `zencut:${G}:3`])
  assert.equal(m.get(`zencut:${G}:2`).title, 'Evil Name')
  assert.equal(m.get(`zencut:${G}:2`).icon, KEPT_ICON)
  assert.equal(m.get(`zencut:${G}:3`).title, `zencut:${G}:3`)
  assert.deepEqual(parseKept(serializeKept(m)), m)
  assert.equal(parseKept('nope').size, 0)

  const many = Array.from({ length: KEPT_MAX + 50 }, (_, i) => [
    `p:${i}`,
    { title: 't', icon: 'i' },
  ])
  const parsed = parseKept(many)
  assert.equal(parsed.size, KEPT_MAX)
  assert.ok(parsed.has(`p:${KEPT_MAX + 49}`), 'keeps the most recent')
  assert.equal(serializeKept(new Map(many)).length, KEPT_MAX)
})

test('remembering a kept panel moves it to the recent end and evicts the oldest', async () => {
  const { rememberKept, KEPT_MAX } = await kept()
  const m = new Map()
  for (let i = 0; i < KEPT_MAX; i++) rememberKept(m, `p:${i}`, { title: 't', icon: 'i' })
  rememberKept(m, 'p:0', { title: 'again', icon: 'i' })
  assert.equal([...m.keys()].at(-1), 'p:0')
  rememberKept(m, 'p:new', { title: 't', icon: 'i' })
  assert.equal(m.size, KEPT_MAX)
  assert.equal(m.has('p:1'), false, 'the oldest goes')
  assert.equal(m.has('p:0'), true)
})

// --- the wiring in workspaces.ts, against a fake panel store and ComfyUI graph ------------------

async function workspacesWith({ nodes = {}, loading = false, ls = storage() } = {}) {
  const timers = []
  globalThis.window = {
    setTimeout: (fn) => (timers.push(fn), timers.length),
    clearTimeout: () => {},
  }
  globalThis.document = { documentElement: { dataset: {} }, createElement: () => ({}) }
  globalThis.localStorage = ls
  const graph = { nodes, loading, changed: null }
  const comfy = mockModule(`
    const g = globalThis.__graph
    export const activeWorkflow = () => null
    export const graphNodeIds = (id) => (g.loading ? null : g.nodes[id] ? new Set(g.nodes[id]) : null)
    export const isLoadingWorkflow = () => g.loading
    export const onGraphChanged = (cb) => { g.changed = cb; return () => {} }
    export const onWorkflowChange = () => () => {}
    export const onWorkflowClosed = () => () => {}
    export const rawOf = (o) => o
    export const startWorkflowTracking = () => {}
    export const storedLayout = () => undefined
    export const wf = { open: [] }
    export const workflowName = () => ''
    export const writeActiveExtra = () => { g.writes = (g.writes ?? 0) + 1; return true }
  `)
  globalThis.__graph = graph
  const mod = await sourceModule('packages/core/src/workspaces.ts', {
    './comfyWorkflows': comfy,
    './log': mockModule('export const zwarn = () => {}'),
    './tiling': mockModule(
      `export const freeArea = { value: { x: 0, y: 0, w: 1000, h: 800, g: 4 } }`,
    ),
    './tiling/engine': await sourceUrl('packages/core/src/tiling/engine.ts'),
    './workflowLayout': await sourceUrl('packages/core/src/workflowLayout.ts'),
    './keptPanels': await sourceUrl('packages/core/src/keptPanels.ts', {
      './workflowLayout': await sourceUrl('packages/core/src/workflowLayout.ts'),
    }),
  })
  const open = new Map()
  const forgotten = []
  const panels = {
    state: { registry: [], panelsHidden: false, list: [] },
    pluginEnabled: () => true,
    open: () => null,
    close: () => {},
    _ops: {
      get: (id) => open.get(id),
      forget: (id) => forgotten.push(id),
      restore: () => {},
      front: () => {},
      unpinSidebar: () => {},
      setDock: () => {},
      enterPlace: () => {},
      setPlace: () => {},
      movePlace: () => {},
    },
  }
  const apps = {
    state: { active: { app: null }, registry: [] },
    close: () => {},
    minimize: () => {},
    regOf: () => null,
    runTiled: () => {},
    setTiles: () => {},
  }
  mod.attachWorkspaces(panels, apps)
  const flush = () => {
    while (timers.length) timers.shift()()
  }
  /** Run only the timers due now (a sweep that waits schedules itself again). */
  const tick = () => {
    for (const fn of timers.splice(0)) fn()
  }
  return { mod, open, forgotten, graph, flush, tick }
}

test('workspaces: a kept tile counts and is listed by its title until it opens or goes', async () => {
  const { mod, open } = await workspacesWith()
  const id = `zencut:${G}:1`
  open.set(id, { id, title: 'ZenCut', icon: 'mdi mdi-x', status: 'open', frame: 'default' })
  mod.tilePanel(id)
  const w = mod.ws.list[0]
  assert.deepEqual(
    mod.tilesOf(w).map((t) => [t.id, t.kept]),
    [[id, false]],
  )

  // Closed with keep (stepping aside for the graph): still here, as it was titled.
  open.delete(id)
  mod.keepPanel(id, { title: 'ZenCut', icon: 'mdi mdi-x' })
  assert.deepEqual(mod.tilesOf(w), [{ id, title: 'ZenCut', icon: 'mdi mdi-x', kept: true }])

  // Opening again clears the kept entry; the open panel is what counts.
  mod.unkeep(id)
  assert.equal(mod.isKept(id), false)
  assert.equal(mod.tilesOf(w).length, 0)

  // A real close (untile) forgets it.
  mod.keepPanel(id, null)
  assert.equal(mod.tilesOf(w).length, 1)
  mod.untile(id)
  assert.equal(mod.isKept(id), false)
  assert.equal(mod.tilesOf(w).length, 0)
})

test('workspaces: a deleted node’s tile is pruned once things settle; a switch away is not', async () => {
  const id = `zencut:${G}:1`
  const keepMe = `zencut:${G}:2`
  const away = `zencut:${OTHER}:5`
  const { mod, open, forgotten, graph, flush, tick } = await workspacesWith({
    nodes: { [G]: ['2'] },
  })
  for (const p of [id, keepMe, away]) {
    open.set(p, { id: p, title: p, icon: 'i', status: 'open', frame: 'default' })
    mod.tilePanel(p)
  }
  const w = mod.ws.list[0]
  for (const p of [id, keepMe, away]) {
    open.delete(p)
    mod.keepPanel(p, null)
  }
  assert.equal(mod.tilesOf(w).length, 3)

  // While a load is under way nothing is decided.
  graph.loading = true
  tick()
  assert.equal(mod.tilesOf(w).length, 3)
  graph.loading = false
  flush()
  assert.deepEqual(
    mod.tilesOf(w).map((t) => t.id),
    [keepMe, away],
  )
  assert.equal(mod.isKept(id), false)
  assert.equal(mod.workspaceOf(id), null, 'its tile is gone')
  assert.deepEqual(forgotten, [id])

  // A graph change (ComfyUI's graphChanged) checks again: the other node goes too.
  graph.nodes[G] = []
  graph.changed()
  flush()
  assert.deepEqual(
    mod.tilesOf(w).map((t) => t.id),
    [away],
  )
})

test('workspaces: kept panels and open node panels tiled here survive a reload', async () => {
  const ls = storage()
  const id = `zencut:${G}:1`
  const other = `zencut:${G}:2`
  {
    const { mod, open, flush } = await workspacesWith({ ls, nodes: { [G]: ['1', '2'] } })
    mod.createWorkspace('Edit', 'global')
    for (const p of [id, other]) {
      open.set(p, {
        id: p,
        title: `T${p.at(-1)}`,
        icon: 'mdi mdi-x',
        status: 'open',
        frame: 'default',
      })
      mod.tilePanel(p)
    }
    // One waits (kept); the other is open on screen. Neither is a panel ZenKit reopens itself.
    open.delete(id)
    mod.keepPanel(id, { title: 'T1', icon: 'mdi mdi-x' })
    await Promise.resolve()
    flush()
  }
  const { mod } = await workspacesWith({ ls, nodes: { [G]: ['1', '2'] } })
  const w = mod.ws.list.find((x) => x.name === 'Edit')
  assert.ok(w)
  // Before any node mounts and re-parks its panel, both count.
  assert.deepEqual(
    mod.tilesOf(w).map((t) => [t.id, t.title, t.kept]),
    [
      [id, 'T1', true],
      [other, 'T2', true],
    ],
  )
})

test('workspaces: a kept tile keeps its rect, so the others do not reflow when it reopens', async () => {
  const { mod, open } = await workspacesWith()
  const a = 'notes:pad'
  const b = `zencut:${G}:1`
  for (const p of [a, b]) {
    open.set(p, { id: p, title: p, icon: 'i', status: 'open', frame: 'default' })
    mod.tilePanel(p)
  }
  const before = mod.wsLayout.value.tiles.get(a)
  // b steps aside (kept): its rect is held, a stays put, and the workspace shows a placeholder.
  open.delete(b)
  mod.keepPanel(b, { title: 'ZenCut', icon: 'mdi mdi-x' })
  assert.deepEqual(mod.wsLayout.value.tiles.get(a), before)
  assert.ok(mod.wsLayout.value.tiles.get(b))
  assert.deepEqual(
    mod.waitingTiles.value.map((t) => [t.id, t.title]),
    [[b, 'ZenCut']],
  )
  // Closed for good: its space goes to the others, and no placeholder.
  mod.untile(b)
  assert.equal(mod.wsLayout.value.tiles.has(b), false)
  assert.notDeepEqual(mod.wsLayout.value.tiles.get(a), before)
  assert.deepEqual(mod.waitingTiles.value, [])
})
