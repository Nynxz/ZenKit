import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule, storage } from './source.mjs'

test('plugin cleanup removes its record and emits once, without removing a replacement', async () => {
  const { createPlugins } = await sourceModule('packages/core/src/pluginRegistry.ts')
  const events = []
  const plugins = createPlugins({ emit: (event) => events.push(event) })
  const old = plugins.register({ id: 'demo', name: 'Old' })
  const current = plugins.register({ id: 'demo', name: 'Current' })
  old()
  assert.equal(plugins.get('demo').name, 'Current')
  current()
  current()
  assert.deepEqual(plugins.registered(), [])
  assert.deepEqual(events, ['plugins:change', 'plugins:change', 'plugins:change'])
})

const widget = (id, order) => ({ id, label: id, order, render() {} })

test('old widget cleanup preserves its replacement', async () => {
  globalThis.localStorage = storage()
  const { registerTaskbarWidget, orderedWidgets } = await sourceModule(
    'packages/core/src/taskbarWidgets.ts',
  )
  const old = registerTaskbarWidget(widget('a', 10))
  const replacement = widget('a', 20)
  const current = registerTaskbarWidget(replacement)
  old()
  assert.deepEqual(orderedWidgets(), [replacement])
  current()
  current()
  assert.deepEqual(orderedWidgets(), [])
})

test('new widgets preserve saved order, including after reload', async () => {
  globalThis.localStorage = storage({
    'zenkit.taskbar.widgets.v1': JSON.stringify({ on: {}, order: ['b', 'a'] }),
  })
  const path = 'packages/core/src/taskbarWidgets.ts'
  const widgets = await sourceModule(path)
  for (const w of [widget('a', 10), widget('b', 20), widget('c', 15)])
    widgets.registerTaskbarWidget(w)
  assert.deepEqual(
    widgets
      .orderedWidgets()
      .filter((w) => w.id !== 'c')
      .map((w) => w.id),
    ['b', 'a'],
  )
  const savedOrder = widgets.orderedWidgets().map((w) => w.id)
  const reloaded = await sourceModule(path)
  for (const w of [widget('c', 15), widget('a', 10), widget('b', 20)])
    reloaded.registerTaskbarWidget(w)
  assert.deepEqual(
    reloaded.orderedWidgets().map((w) => w.id),
    savedOrder,
  )
})

test('fresh widget preferences seed by hints and preserve disabled defaults', async () => {
  globalThis.localStorage = storage()
  const widgets = await sourceModule('packages/core/src/taskbarWidgets.ts')
  widgets.registerTaskbarWidget(widget('b', 20))
  widgets.registerTaskbarWidget({ ...widget('a', 10), defaultOn: false })
  assert.deepEqual(
    widgets.orderedWidgets().map((w) => w.id),
    ['a', 'b'],
  )
  assert.deepEqual(
    widgets.activeWidgets().map((w) => w.id),
    ['b'],
  )
})
