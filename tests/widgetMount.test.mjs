import assert from 'node:assert/strict'
import test from 'node:test'
import { h, nextTick, shallowRef } from 'vue'
import { sourceModule } from './source.mjs'
import { testRenderer } from './renderer.mjs'

test('replacing a mounted widget cleans its content and mounts the new renderer', async () => {
  const { default: WidgetMount } = await sourceModule(
    'packages/core/src/components/TaskbarWidgetMount.vue',
  )
  const { renderer, element } = testRenderer()
  const events = []
  const widget = (label) => ({
    id: 'same-id',
    label,
    render(el) {
      assert.deepEqual(el.children, [])
      events.push(`mount ${label}`)
      el.children.push(label)
      return () => events.push(`cleanup ${label}`)
    },
  })
  const current = shallowRef(widget('old'))
  const app = renderer.createApp({ render: () => h(WidgetMount, { widget: current.value }) })
  app.mount(element())
  current.value = widget('new')
  await nextTick()
  assert.deepEqual(events, ['mount old', 'cleanup old', 'mount new'])
  app.unmount()
  assert.deepEqual(events, ['mount old', 'cleanup old', 'mount new', 'cleanup new'])
})
