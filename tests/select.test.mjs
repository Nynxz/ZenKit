import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { nextTick } from 'vue'
import { sourceUrl } from './source.mjs'
import { findElement, testRenderer } from './renderer.mjs'

async function select() {
  const listeners = new Map()
  globalThis.window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type)
    },
  }
  globalThis.CSS = { escape: (value) => value }
  const layerUrl = await sourceUrl('packages/ui/src/overlays/layers.ts')
  const { openLayer } = await import(layerUrl)
  const { default: Select } = await import(
    await sourceUrl('packages/ui/src/inputs/ZenSelect.vue', {
      '../lib/icon': await sourceUrl('packages/ui/src/lib/icon.ts'),
      '../overlays/layers': layerUrl,
    })
  )
  const { renderer, element } = testRenderer()
  const root = element()
  const updates = []
  const app = renderer.createApp(Select, {
    modelValue: 'a',
    options: ['a', 'b'],
    'onUpdate:modelValue': (value) => updates.push(value),
  })
  app.mount(root)
  const trigger = findElement(root, 'button')
  return { app, trigger, listeners, openLayer, updates }
}

test('unmounting before deferred dropdown setup leaves no global listeners', async () => {
  const { app, trigger, listeners } = await select()
  trigger.props.onClick()
  app.unmount()
  await delay(5)
  assert.equal(listeners.size, 0)
})

test('closing before deferred dropdown setup leaves no global listeners', async () => {
  const { app, trigger, listeners } = await select()
  trigger.props.onClick()
  await nextTick()
  trigger.props.onClick()
  await delay(5)
  assert.equal(listeners.size, 0)
  app.unmount()
})

test('dropdown keyboard input respects the topmost floating layer', async () => {
  const { app, trigger, listeners, openLayer, updates } = await select()
  trigger.props.onClick()
  await delay(5)
  let prevented = false
  const key = (value) => ({
    key: value,
    preventDefault: () => {
      prevented = true
    },
    stopPropagation() {},
  })
  const overlay = openLayer()
  listeners.get('keydown')(key('Enter'))
  assert.equal(prevented, false)
  assert.deepEqual(updates, [])
  overlay.release()
  listeners.get('keydown')(key('ArrowDown'))
  listeners.get('keydown')(key('Enter'))
  assert.deepEqual(updates, ['b'])
  assert.equal(listeners.size, 0)
  app.unmount()
})
