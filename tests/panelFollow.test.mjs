import assert from 'node:assert/strict'
import test from 'node:test'
import { mockModule, sourceModule, sourceUrl } from './source.mjs'

const rules = () => sourceModule('packages/nodekit/src/panelFollow.ts')

test('a tiled panel hides when its workspace goes off screen', async () => {
  const { followDecision } = await rules()
  // the graph, or another workspace
  assert.equal(followDecision({ tiledIn: 'w1', current: null, parked: false }), 'hide')
  assert.equal(followDecision({ tiledIn: 'w1', current: 'w2', parked: false }), 'hide')
  assert.equal(followDecision({ tiledIn: 'w1', current: 'w1', parked: false }), 'stay')
})

test('a parked panel shows when its workspace is back, and only then', async () => {
  const { followDecision } = await rules()
  assert.equal(followDecision({ tiledIn: 'w1', current: 'w1', parked: true }), 'show')
  assert.equal(followDecision({ tiledIn: 'w1', current: 'w2', parked: true }), 'stay')
  assert.equal(followDecision({ tiledIn: 'w1', current: null, parked: true }), 'stay')
})

test('a floating panel stays as it is, and a parked one whose tile is gone waits', async () => {
  const { followDecision } = await rules()
  for (const current of [null, 'w1'])
    assert.equal(followDecision({ tiledIn: null, current, parked: false }), 'stay')
  // A workflow switch (its layout no longer counts) or a removed workspace.
  assert.equal(followDecision({ tiledIn: null, current: null, parked: true }), 'stay')
})

test('first open: tiled off screen parks unless asked to reveal', async () => {
  const { initialDecision } = await rules()
  assert.equal(initialDecision({ tiledIn: null, current: null, reveal: false }), 'open')
  assert.equal(initialDecision({ tiledIn: 'w1', current: 'w1', reveal: false }), 'open')
  assert.equal(initialDecision({ tiledIn: 'w1', current: null, reveal: false }), 'park')
  assert.equal(initialDecision({ tiledIn: 'w1', current: 'w2', reveal: false }), 'park')
  assert.equal(initialDecision({ tiledIn: 'w1', current: null, reveal: true }), 'reveal')
  assert.equal(initialDecision({ tiledIn: null, current: null, reveal: true }), 'open')
})

// --- openZenPanel against a fake ZenKit --------------------------------------------------------

function fakeZen() {
  const listeners = new Set()
  const open = new Map() // id -> { closeCbs:Set }
  const log = []
  const zen = {
    tiles: new Map(), // panel id -> workspace id
    active: null,
    log,
    open,
    change() {
      for (const cb of [...listeners]) cb(zen.active)
    },
    panels: {
      open(spec) {
        log.push(`open ${spec.id}`)
        if (!open.has(spec.id)) open.set(spec.id, { closeCbs: new Set(), title: spec.title })
        const entry = open.get(spec.id)
        return {
          close: (opts) => zen.panels.close(spec.id, opts),
          setTitle: (t) => (entry.title = t),
          focus: () => log.push(`focus ${spec.id}`),
          on: (ev, cb) => {
            entry.closeCbs.add(cb)
            return () => entry.closeCbs.delete(cb)
          },
        }
      },
      close(id, opts) {
        log.push(`close ${id}${opts?.keep ? ' keep' : ''}`)
        if (!opts?.keep) zen.tiles.delete(id)
        const entry = open.get(id)
        open.delete(id)
        for (const cb of entry?.closeCbs ?? []) cb()
      },
    },
    workspaces: {
      of: (id) => zen.tiles.get(id) ?? null,
      current: () => zen.active,
      activate: (id) => {
        log.push(`activate ${id}`)
        zen.active = id
      },
      onChange: (cb) => {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
    },
    listeners,
  }
  return zen
}

async function nodekitWith(zen) {
  globalThis.window = { ZenKit: zen }
  return sourceModule('packages/nodekit/src/zenPanel.ts', {
    './zenkit': mockModule(`export const getZenKit = () => globalThis.window.ZenKit
export const whenZen = async () => globalThis.window.ZenKit`),
    './panelFollow': await sourceUrl('packages/nodekit/src/panelFollow.ts'),
  })
}

test('openZenPanel: hides off screen without onClose, reshows, and a real close ends it', async () => {
  const zen = fakeZen()
  const { openZenPanel } = await nodekitWith(zen)
  let closes = 0
  const spec = { id: 'p', title: 'P', onClose: () => closes++ }
  const h = openZenPanel(spec, {})
  assert.ok(h)
  assert.ok(zen.open.has('p'))

  // Tiled into w1, which is on screen: nothing to do.
  zen.tiles.set('p', 'w1')
  zen.active = 'w1'
  zen.change()
  assert.ok(zen.open.has('p'))

  // Back to the graph: parked, kept, and not a close.
  zen.active = null
  zen.change()
  assert.equal(zen.open.has('p'), false)
  assert.equal(zen.tiles.get('p'), 'w1')
  assert.equal(closes, 0)

  // w1 again: reopened (its tile is still there).
  zen.active = 'w1'
  zen.change()
  assert.ok(zen.open.has('p'))

  // Dragged out to float: stays open over the graph.
  zen.tiles.delete('p')
  zen.active = null
  zen.change()
  assert.ok(zen.open.has('p'))

  // A real close: onClose once, and no more following.
  h.close()
  assert.equal(closes, 1)
  assert.equal(zen.listeners.size, 0)
  h.close()
  assert.equal(closes, 1)
})

test('openZenPanel: closes while parked, and its own ✕, end it once', async () => {
  const zen = fakeZen()
  const { openZenPanel } = await nodekitWith(zen)
  let closes = 0
  zen.tiles.set('p', 'w1')
  zen.active = 'w1'
  const h = openZenPanel({ id: 'p', title: 'P', onClose: () => closes++ }, {})
  zen.active = 'w2'
  zen.change()
  assert.equal(zen.open.has('p'), false)
  // A node removed while its panel waits: close with keep leaves the tile, calls onClose.
  h.close({ keep: true })
  assert.equal(closes, 1)
  assert.equal(zen.tiles.get('p'), 'w1')
  assert.equal(zen.listeners.size, 0)

  // Its own ✕ (a close the follower didn't make) ends it too.
  zen.active = 'w1'
  let c2 = 0
  openZenPanel({ id: 'q', title: 'Q', onClose: () => c2++ }, {})
  zen.panels.close('q')
  assert.equal(c2, 1)

  // A close without keep while parked forgets the tile, as it would on screen.
  zen.tiles.set('r', 'w1')
  zen.active = null
  const r = openZenPanel({ id: 'r', title: 'R' }, {})
  assert.equal(zen.open.has('r'), false)
  r.close()
  assert.equal(zen.tiles.has('r'), false)
})

test('openZenPanel: restoring into an off-screen tile parks; reveal or a second open shows it', async () => {
  const zen = fakeZen()
  const { openZenPanel } = await nodekitWith(zen)
  zen.tiles.set('p', 'w1')
  const h = openZenPanel({ id: 'p', title: 'P' }, {})
  assert.equal(zen.open.has('p'), false, 'no flash over the graph')
  assert.equal(zen.active, null)

  // The pop-out button again: same handle, goes to w1 and opens there.
  const again = openZenPanel({ id: 'p', title: 'P' }, {})
  assert.equal(again, h)
  assert.equal(zen.active, 'w1')
  assert.ok(zen.open.has('p'))

  // reveal: true on a first open goes there directly.
  zen.tiles.set('s', 'w2')
  openZenPanel({ id: 's', title: 'S', reveal: true }, {})
  assert.equal(zen.active, 'w2')
  assert.ok(zen.open.has('s'))

  // focus() on a parked handle reveals it too.
  zen.tiles.set('t', 'w1')
  const t = openZenPanel({ id: 't', title: 'T' }, {})
  assert.equal(zen.open.has('t'), false)
  t.focus()
  assert.equal(zen.active, 'w1')
  assert.ok(zen.open.has('t'))
})

test('openZenPanel: followWorkspace false keeps the old behaviour', async () => {
  const zen = fakeZen()
  const { openZenPanel } = await nodekitWith(zen)
  zen.tiles.set('p', 'w1')
  openZenPanel({ id: 'p', title: 'P', followWorkspace: false }, {})
  assert.ok(zen.open.has('p'))
  assert.equal(zen.listeners.size, 0)
})

test('openZenPanel: a panel waiting for its workspace tells ZenKit, and so does its node leaving', async () => {
  const zen = fakeZen()
  const { openZenPanel } = await nodekitWith(zen)
  // Restored into an off-screen tile: parked, and ZenKit hears it waits there (a keep close of
  // a panel that isn't open), so the workspace counts it.
  zen.tiles.set('p', 'w1')
  const h = openZenPanel({ id: 'p', title: 'P' }, {})
  assert.equal(zen.open.has('p'), false)
  assert.deepEqual(zen.log, ['close p keep'])
  // Its node leaving while it waits: the keep close reaches ZenKit too, which checks for a
  // deleted node; the tile stays for ZenKit to decide.
  h.close({ keep: true })
  assert.deepEqual(zen.log, ['close p keep', 'close p keep'])
  assert.equal(zen.tiles.get('p'), 'w1')
  // Already open in ZenKit (someone else opened the id): not closed behind its back.
  zen.panels.get = (id) => (zen.open.has(id) ? {} : null)
  zen.open.set('q', { closeCbs: new Set() })
  zen.tiles.set('q', 'w1')
  zen.log.length = 0
  openZenPanel({ id: 'q', title: 'Q' }, {})
  assert.deepEqual(zen.log, [])
})
