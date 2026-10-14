import assert from 'node:assert/strict'
import test from 'node:test'
import { mockModule, sourceModule, storage } from './source.mjs'

async function appStore(saved = {}) {
  globalThis.localStorage = storage(saved)
  const { createAppStore } = await sourceModule('packages/core/src/appStore.ts', {
    './log': mockModule('export const zlog = () => {}'),
  })
  const handlers = []
  const bus = {
    emit: (event, payload) => handlers.forEach(([e, cb]) => e === event && cb(payload)),
    on: (event, cb) => {
      const h = [event, cb]
      handlers.push(h)
      return () => handlers.splice(handlers.indexOf(h), 1)
    },
  }
  return createAppStore(bus)
}

const app = (id, extra = {}) => ({
  id,
  title: id,
  namespace: 'zen',
  routes: [{ path: '' }, { path: 'item/:id' }],
  ...extra,
})

test('minimizing keeps an app running where it was; close removes it', async () => {
  const apps = await appStore()
  apps.register(app('a'))
  apps.register(app('b'))
  apps.open('a', { path: 'item/7' })
  apps.open('b')
  assert.equal(apps.current(), 'zen/b')
  assert.deepEqual(
    apps.running().map((l) => [l.app, l.path, l.route]),
    [
      ['zen/a', 'item/7', 'item/:id'],
      ['zen/b', '', ''],
    ],
  )
  assert.deepEqual(apps.state.mounted, ['zen/a', 'zen/b'])

  apps.minimize()
  assert.equal(apps.current(), null)
  assert.equal(apps.minimized().app, 'zen/b')

  // Opening a running app without a route brings it back where it was.
  apps.open('a')
  assert.equal(apps.location().path, 'item/7')
  assert.equal(apps.location().params.id, '7')

  apps.close('a')
  assert.equal(apps.current(), null)
  assert.deepEqual(apps.state.mounted, ['zen/b'])
  assert.deepEqual(
    apps.running().map((l) => l.app),
    ['zen/b'],
  )
})

test('back and forward stay inside the app', async () => {
  const apps = await appStore()
  apps.register(app('a'))
  apps.register(app('b'))
  apps.open('b')
  const a = apps.open('a')
  a.router.go('item/1')
  a.router.go('item/2')
  apps.back()
  assert.equal(apps.location().path, 'item/1')
  apps.back()
  apps.back() // at the start of a's history: stays in a, never jumps to b or the graph
  assert.equal(apps.current(), 'zen/a')
  assert.equal(apps.location().path, '')
  assert.equal(apps.canStep('zen/a', -1), false)
  apps.forward()
  assert.equal(apps.location().path, 'item/1')
  // Navigating after going back drops the forward entries.
  a.router.go('item/3')
  assert.equal(apps.canStep('zen/a', 1), false)
})

test('a mounted app follows its own routes while minimized', async () => {
  const apps = await appStore()
  apps.register(app('a', { mount() {} }))
  const a = apps.open('a')
  const seen = []
  a.router.on((loc) => seen.push(loc.path))
  a.router.go('item/4')
  apps.minimize()
  assert.deepEqual(seen, ['item/4'])
  assert.equal(a.router.location().path, 'item/4')
})

test('running apps come back as chips after a reload, the active one showing', async () => {
  const saved = {
    'zenkit.apps.v1': JSON.stringify({ path: 'zen/b', running: ['zen/a/item/9', 'zen/b'] }),
  }
  const apps = await appStore(saved)
  apps.register(app('a'))
  assert.equal(apps.current(), null) // b isn't registered yet: its location waits
  assert.deepEqual(apps.state.mounted, [])
  apps.register(app('b'))
  assert.equal(apps.current(), 'zen/b')
  assert.deepEqual(
    apps.running().map((l) => [l.app, l.path]),
    [
      ['zen/a', 'item/9'],
      ['zen/b', ''],
    ],
  )
  // Only what has been shown is mounted: a mounts when it is first restored.
  assert.deepEqual(apps.state.mounted, ['zen/b'])
  apps.restore('zen/a')
  assert.equal(apps.location().params.id, '9')
  assert.deepEqual(apps.state.mounted, ['zen/b', 'zen/a'])
})

test('unregistering a running app closes it', async () => {
  const apps = await appStore()
  const off = apps.register(app('a'))
  apps.open('a')
  off()
  assert.equal(apps.current(), null)
  assert.deepEqual(apps.running(), [])
})

test('a tiled app runs in its tile: its routes move it there, never full screen', async () => {
  const apps = await appStore()
  apps.register(app('a', { mount() {} }))
  const tiles = new Set(['zen/a'])
  const revealed = []
  apps.setTiles({ has: (key) => tiles.has(key), reveal: (key) => revealed.push(key) })
  apps.runTiled('zen/a')
  assert.deepEqual(apps.state.mounted, ['zen/a'])
  assert.equal(apps.current(), null) // running, but not full screen
  const router = apps.makeRouter('zen/a')
  const seen = []
  router.on((loc) => seen.push(loc.path))
  router.go('item/5')
  assert.equal(apps.current(), null)
  assert.equal(router.location().params.id, '5')
  router.back()
  assert.deepEqual(seen, ['item/5', ''])
  // Opening it from the taskbar or launcher shows its workspace instead.
  apps.open('a')
  assert.equal(apps.current(), null)
  assert.deepEqual(revealed, ['zen/a'])
  // Out of its tile, the same navigation shows it full screen again.
  tiles.clear()
  router.go('item/6')
  assert.equal(apps.current(), 'zen/a')
})
