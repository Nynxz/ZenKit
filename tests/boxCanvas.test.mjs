import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule, sourceUrl } from './source.mjs'
import { testRenderer } from './renderer.mjs'

function findStage(el) {
  if (el.props?.tabindex === '-1') return el
  for (const child of el.children ?? []) {
    const found = findStage(child)
    if (found) return found
  }
  return null
}

async function mount(props = {}) {
  const { renderer, element } = testRenderer()
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  globalThis.Image = class {}
  const { default: ZenBoxCanvas } = await sourceModule('packages/ui/src/feature/ZenBoxCanvas.vue', {
    '../lib/boxes': await sourceUrl('packages/ui/src/lib/boxes.ts'),
  })
  const state = {
    boxes: [
      { id: 'a', x: 0.1, y: 0.1, w: 0.3, h: 0.3 },
      { id: 'b', x: 0.6, y: 0.6, w: 0.3, h: 0.3 },
    ],
    selected: ['a'],
  }
  const events = []
  const app = renderer.createApp(ZenBoxCanvas, {
    boxes: state.boxes,
    selected: state.selected,
    'onUpdate:selected': (ids) => (state.selected = ids),
    ...props(events),
  })
  const root = element()
  app.mount(root)
  const stage = findStage(root)
  stage.focus = () => {}
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 })
  let defaultPrevented = false
  let propagationStopped = false
  const fire = (name, init) => {
    defaultPrevented = false
    propagationStopped = false
    stage.props[name]({
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      altKey: false,
      button: 2,
      target: stage,
      preventDefault: () => (defaultPrevented = true),
      stopPropagation: () => (propagationStopped = true),
      ...init,
    })
    return { defaultPrevented, propagationStopped }
  }
  return { app, events, state, fire }
}

test('Ctrl+Z undoes and Ctrl+Shift+Z or Ctrl+Y redo through the history it was given', async () => {
  const { events, fire } = await mount((events) => ({
    history: { undo: () => events.push('undo'), redo: () => events.push('redo') },
  }))
  fire('onKeydown', { key: 'z', ctrlKey: true })
  fire('onKeydown', { key: 'Z', ctrlKey: true, shiftKey: true })
  fire('onKeydown', { key: 'y', metaKey: true })
  assert.deepEqual(events, ['undo', 'redo', 'redo'])
})

test('copy, cut, paste and duplicate go to the host with the selection and pointer', async () => {
  const { events, fire } = await mount((events) => ({
    onCopy: (ids) => events.push(['copy', ids]),
    onDelete: (ids) => events.push(['delete', ids]),
    onPaste: (at) => events.push(['paste', at]),
    onDuplicate: (ids) => events.push(['duplicate', ids]),
  }))
  fire('onKeydown', { key: 'c', ctrlKey: true })
  fire('onKeydown', { key: 'x', ctrlKey: true })
  fire('onPointermove', { clientX: 50, clientY: 25 })
  fire('onKeydown', { key: 'v', ctrlKey: true })
  fire('onKeydown', { key: 'd', ctrlKey: true })
  assert.deepEqual(events, [
    ['copy', ['a']],
    ['copy', ['a']],
    ['delete', ['a']],
    ['paste', [0.5, 0.25]],
    ['duplicate', ['a']],
  ])
})

test('a host that handles none of them leaves Ctrl+C and right-click to the graph', async () => {
  const { fire } = await mount(() => ({}))
  assert.equal(fire('onKeydown', { key: 'c', ctrlKey: true }).propagationStopped, false)
  assert.equal(fire('onContextmenu', { clientX: 20, clientY: 20 }).propagationStopped, false)
})

test('right-click selects the box under the pointer and hands the menu its ids', async () => {
  const { events, state, fire } = await mount((events) => ({
    onMenu: (_event, ids) => events.push(ids),
  }))
  const click = fire('onContextmenu', { clientX: 70, clientY: 70 })
  assert.ok(click.defaultPrevented && click.propagationStopped)
  fire('onContextmenu', { clientX: 50, clientY: 5 })
  assert.deepEqual(events, [['b'], []])
  assert.deepEqual(state.selected, [])
})
