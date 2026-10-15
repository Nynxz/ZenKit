import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const mirror = () => sourceModule('packages/nodekit/src/widgetMirror.ts')
const tick = () => new Promise((r) => setTimeout(r, 0))

function setup(createMirrorHub) {
  const refreshed = []
  const hub = createMirrorHub(() => refreshed.push('original'))
  let stored = 0
  const widget = {
    get value() {
      return stored
    },
    set value(v) {
      const previous = stored
      stored = v
      hub.changed(previous, v)
    },
  }
  const view = { refresh: () => refreshed.push('mirror') }
  hub.add(view)
  return { hub, widget, view, refreshed }
}

test('a write through the widget refreshes the mirrors, not the body', async () => {
  const { createMirrorHub } = await mirror()
  const { widget, refreshed } = setup(createMirrorHub)
  widget.value = 5
  await tick()
  assert.deepEqual(refreshed, ['mirror'])
})

test('a write through a mirror refreshes the body, not that mirror', async () => {
  const { createMirrorHub } = await mirror()
  const { hub, widget, view, refreshed } = setup(createMirrorHub)
  hub.writerFor(widget, view).value = 7
  await tick()
  assert.equal(widget.value, 7)
  assert.deepEqual(refreshed, ['original'])
})

test('rewriting the same value refreshes nobody', async () => {
  const { createMirrorHub } = await mirror()
  const { hub, widget, view, refreshed } = setup(createMirrorHub)
  widget.value = [{ name: 'a', strength: 1 }]
  await tick()
  refreshed.length = 0
  hub.writerFor(widget, view).value = [{ name: 'a', strength: 1 }]
  widget.value = [{ name: 'a', strength: 1 }]
  await tick()
  assert.deepEqual(refreshed, [])
})

test('several writes in one turn refresh each view once', async () => {
  const { createMirrorHub } = await mirror()
  const { widget, refreshed } = setup(createMirrorHub)
  widget.value = 1
  widget.value = 2
  widget.value = 3
  await tick()
  assert.deepEqual(refreshed, ['mirror'])
})

test('a removed mirror is not refreshed', async () => {
  const { createMirrorHub } = await mirror()
  const refreshed = []
  const hub = createMirrorHub(() => refreshed.push('original'))
  const off = hub.add({ refresh: () => refreshed.push('mirror') })
  off()
  hub.changed(0, 1)
  await tick()
  assert.deepEqual(refreshed, [])
})

test('mirrorOf finds only a usable handle', async () => {
  const { mirrorOf } = await mirror()
  const handle = { fill: false, mount: () => () => {} }
  assert.equal(mirrorOf({ zenMirror: handle }), handle)
  assert.equal(mirrorOf({ zenMirror: {} }), null)
  assert.equal(mirrorOf(null), null)
})
