import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const bind = () => sourceModule('plugins/ComfyUI-ZenKit/src/suite/bind/bindings.ts')

test('widgets map to the control that edits them', async () => {
  const { controlKind } = await bind()
  const cases = [
    [{ name: 'seed', type: 'number' }, 'number'],
    [{ name: 'sampler', type: 'combo' }, 'combo'],
    [{ name: 'on', type: 'toggle' }, 'toggle'],
    [{ name: 'tag', type: 'text' }, 'text'],
    [{ name: 'text', type: 'customtext' }, 'multiline'],
    [{ name: 'upload', type: 'button' }, null],
    [{ name: 'preview', type: 'image' }, null],
  ]
  for (const [w, kind] of cases) assert.equal(controlKind(w), kind, w.name)
})

test('a widget fed by a link is not bindable', async () => {
  const { bindableWidgets } = await bind()
  const node = {
    id: 3,
    widgets: [
      { name: 'seed', type: 'number' },
      { name: 'cfg', type: 'number' },
      { name: 'image', type: 'image' },
    ],
    inputs: [{ widget: { name: 'cfg' }, link: 9 }],
  }
  assert.deepEqual(
    bindableWidgets(node).map((w) => w.name),
    ['seed'],
  )
})

test('number spec reads step2, falling back to the legacy 10x step', async () => {
  const { numberSpec } = await bind()
  assert.deepEqual(numberSpec({ name: 'cfg', options: { min: 0, max: 100, step2: 0.1 } }), {
    min: 0,
    max: 100,
    step: 0.1,
    precision: 1,
  })
  assert.equal(numberSpec({ name: 'steps', options: { step: 10 } }).step, 1)
  assert.equal(numberSpec({ name: 'steps', options: { step: 10 } }).precision, 0)
})

test('random seeds stay in range and exact', async () => {
  const { randomSeed, isSeed } = await bind()
  const w = { name: 'noise_seed', type: 'number', options: { min: 0, max: 2 ** 64 } }
  assert.ok(isSeed(w))
  assert.ok(!isSeed({ name: 'seeds_count', type: 'number' }))
  assert.equal(randomSeed(w, () => 0), 0)
  const high = randomSeed(w, () => 0.999999999999)
  assert.ok(Number.isSafeInteger(high) && high <= Number.MAX_SAFE_INTEGER)
  assert.equal(randomSeed({ ...w, options: { min: 10, max: 12 } }, () => 0.5), 11)
})

test('saved bindings are cleaned up on read', async () => {
  const { readBindings } = await bind()
  const out = readBindings([
    { id: 'a', node: 4, widget: 'seed', label: '  Seed  ' },
    { node: 5, widget: '' },
    null,
    { id: 'c', node: '6', widget: 'cfg', label: ' ' },
  ])
  assert.deepEqual(out, [
    { id: 'a', node: '4', widget: 'seed', label: 'Seed' },
    { id: 'c', node: '6', widget: 'cfg' },
  ])
  assert.deepEqual(readBindings('nope'), [])
})

test('toggling binds a widget once and unbinds it the second time', async () => {
  const { toggleBinding, hasBinding } = await bind()
  const once = toggleBinding([], 4, 'seed')
  assert.ok(hasBinding(once, '4', 'seed'))
  assert.deepEqual(toggleBinding(once, '4', 'seed'), [])
})

test('moving a binding reorders without losing any', async () => {
  const { moveBinding } = await bind()
  const list = ['a', 'b', 'c'].map((id) => ({ id, node: '1', widget: id }))
  assert.deepEqual(
    moveBinding(list, 0, 2).map((b) => b.id),
    ['b', 'c', 'a'],
  )
  assert.deepEqual(
    moveBinding(list, 2, 0).map((b) => b.id),
    ['c', 'a', 'b'],
  )
  assert.equal(moveBinding(list, 5, 0), list)
})
