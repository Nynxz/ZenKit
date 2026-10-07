import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule, sourceUrl } from './source.mjs'
import { testRenderer, findElement } from './renderer.mjs'

async function setup(props = {}) {
  const { renderer, element, body } = testRenderer()
  const listeners = new Map()
  globalThis.window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name, callback) => {
      if (listeners.get(name) === callback) listeners.delete(name)
    },
  }
  body.style.cursor = 'crosshair'
  body.style.userSelect = 'text'
  globalThis.document = { body }
  const { default: Handle } = await sourceModule('packages/ui/src/layout/ZenResizeHandle.vue')
  const events = []
  const app = renderer.createApp(Handle, {
    label: 'Resize',
    ...props,
    onDragStart: () => events.push('start'),
    onDragMove: () => events.push('move'),
    onDragEnd: (cancelled) => events.push(cancelled ? 'cancel' : 'commit'),
    onNudge: (pixels, axis) => events.push([pixels, axis]),
    onLimit: (edge) => events.push(edge),
    onToggle: () => events.push('toggle'),
  })
  const root = element()
  app.mount(root)
  const handle = findElement(root, 'div')
  const pointer = (id = 1) => ({
    pointerId: id,
    button: 0,
    currentTarget: handle,
    clientX: 0,
    clientY: 0,
    preventDefault() {},
    stopPropagation() {},
  })
  const key = (key, shiftKey = false) => ({
    key,
    shiftKey,
    preventDefault() {},
    stopPropagation() {},
  })
  return { app, handle, events, listeners, body, pointer, key }
}

test('resize handles expose separator values and support axis-aware keyboard resizing', async () => {
  const { app, handle, events, key } = await setup({
    value: 50,
    min: 20,
    max: 80,
    controls: 'pane',
  })
  assert.equal(handle.props.role, 'separator')
  assert.equal(handle.props['aria-orientation'], 'vertical')
  assert.equal(handle.props['aria-valuenow'], 50)
  handle.props.onKeydown(key('ArrowDown'))
  handle.props.onKeydown(key('ArrowRight'))
  handle.props.onKeydown(key('ArrowLeft', true))
  handle.props.onKeydown(key('Home'))
  handle.props.onKeydown(key('End'))
  handle.props.onKeydown(key('Enter'))
  assert.deepEqual(events, [[10, 'x'], [-50, 'x'], 'min', 'max', 'toggle'])
  app.unmount()
})

test('junctions support both axes without announcing a one-axis separator value', async () => {
  const { app, handle, events, key } = await setup({ orientation: 'both', value: 50 })
  assert.equal(handle.props.role, 'button')
  assert.equal(handle.props['aria-valuenow'], undefined)
  handle.props.onKeydown(key('ArrowRight'))
  handle.props.onKeydown(key('ArrowUp'))
  assert.deepEqual(events, [
    [10, 'x'],
    [-10, 'y'],
  ])
  app.unmount()
})

test('pointer completion filters other pointers and restores capture, listeners and body styles', async () => {
  const { app, handle, events, listeners, body, pointer } = await setup()
  handle.props.onPointerdown(pointer())
  assert.equal(body.style.cursor, 'col-resize')
  listeners.get('pointermove')(pointer(2))
  listeners.get('pointerup')(pointer(2))
  listeners.get('pointermove')(pointer())
  listeners.get('pointerup')(pointer())
  assert.deepEqual(events, ['start', 'move', 'commit'])
  assert.equal(listeners.size, 0)
  assert.equal(handle.listeners.size, 0)
  assert.equal(handle.capture, null)
  assert.equal(body.style.cursor, 'crosshair')
  assert.equal(body.style.userSelect, 'text')
  app.unmount()
  assert.deepEqual(events, ['start', 'move', 'commit'])
})

test('Escape, pointer cancellation, lost capture and unmount cancel exactly once', async () => {
  for (const reason of ['Escape', 'pointercancel', 'lostpointercapture', 'unmount']) {
    const { app, handle, events, listeners, pointer, key, body } = await setup()
    handle.props.onPointerdown(pointer())
    if (reason === 'Escape') listeners.get('keydown')(key('Escape'))
    else if (reason === 'pointercancel') listeners.get(reason)(pointer())
    else if (reason === 'lostpointercapture') handle.listeners.get(reason)(pointer())
    app.unmount()
    assert.deepEqual(events, ['start', 'cancel'], reason)
    assert.equal(listeners.size, 0, reason)
    assert.equal(body.style.cursor, 'crosshair', reason)
  }
})

test('ZenSplit keeps cancelled sizes and commits a successful resize only once', async () => {
  const { renderer, element, body } = testRenderer()
  globalThis.document = { body }
  const listeners = new Map()
  globalThis.window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  }
  const handleUrl = await sourceUrl('packages/ui/src/layout/ZenResizeHandle.vue')
  const { default: Split } = await sourceModule('packages/ui/src/layout/ZenSplit.vue', {
    './ZenResizeHandle.vue': handleUrl,
  })
  const updates = []
  const app = renderer.createApp(Split, {
    panes: [{}, {}],
    sizes: [0.5, 0.5],
    'onUpdate:sizes': (sizes) => updates.push(sizes),
  })
  const root = element()
  app.mount(root)
  const handle = root.children[0].children.find((child) => child.props?.role === 'separator')
  const pointer = (x) => ({
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: 0,
    currentTarget: handle,
    preventDefault() {},
    stopPropagation() {},
  })
  handle.props.onPointerdown(pointer(0))
  listeners.get('pointermove')(pointer(40))
  listeners.get('pointercancel')(pointer(40))
  assert.deepEqual(updates, [])
  handle.props.onPointerdown(pointer(0))
  listeners.get('pointermove')(pointer(40))
  listeners.get('pointerup')(pointer(40))
  assert.deepEqual(updates, [[0.6, 0.4]])
  app.unmount()
})

test('workspace drag cancellation restores its original workspace and clears a queued layout frame', async () => {
  const { reactive, ref } = await import('vue')
  const { mockModule } = await import('./source.mjs')
  const { renderer, element, body } = testRenderer()
  globalThis.document = { body }
  const listeners = new Map()
  globalThis.window = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
  }
  const frames = new Map()
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(1, callback)
    return 1
  }
  globalThis.cancelAnimationFrame = (id) => frames.delete(id)
  const ratios = []
  const interactions = []
  globalThis.workspaceResizeTest = {
    ws: reactive({ active: 'original', list: [{ id: 'original', name: 'Test' }] }),
    layout: ref({
      bounds: { x: 0, y: 0, w: 1000, h: 600 },
      tiles: new Map([['panel', {}]]),
      dividers: [
        { path: '', axis: 'row', ratio: 0.5, length: 1000, rect: { x: 500, y: 0, w: 8, h: 600 } },
      ],
    }),
    setRatio: (path, ratio, workspaceId) => ratios.push([path, ratio, workspaceId]),
  }
  const storeUrl = mockModule('export const STORE_KEY = Symbol("store")')
  const { STORE_KEY } = await import(storeUrl)
  const handleUrl = await sourceUrl('packages/ui/src/layout/ZenResizeHandle.vue')
  const { default: Workspace } = await sourceModule(
    'packages/core/src/components/ZenWorkspace.vue',
    {
      '@nynxz/zenkit-ui': mockModule(`export { default as ZenResizeHandle } from '${handleUrl}'`),
      '../panelStore': storeUrl,
      '../workspaces': mockModule(`export const ws = globalThis.workspaceResizeTest.ws;
      export const wsLayout = globalThis.workspaceResizeTest.layout;
      export const setRatio = globalThis.workspaceResizeTest.setRatio;
      export const clampTileRatio = ratio => Math.min(0.8, Math.max(0.2, ratio));`),
    },
  )
  const app = renderer.createApp(Workspace)
  app.provide(STORE_KEY, { _ops: { setInteract: (on) => interactions.push(on) } })
  const root = element()
  app.mount(root)
  const handle = root.children.find((child) => child.props?.role === 'separator')
  const pointer = (x) => ({
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: 0,
    currentTarget: handle,
    preventDefault() {},
    stopPropagation() {},
  })
  handle.props.onPointerdown(pointer(500))
  listeners.get('pointermove')(pointer(600))
  assert.equal(frames.size, 1)
  globalThis.workspaceResizeTest.ws.active = 'another'
  app.unmount()
  assert.deepEqual(ratios, [['', 0.5, 'original']])
  assert.deepEqual(interactions, [true, false])
  assert.equal(frames.size, 0)
  assert.equal(listeners.size, 0)
})
