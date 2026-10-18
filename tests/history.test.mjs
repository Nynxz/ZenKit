import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const history = () => sourceModule('packages/ui/src/lib/history.ts')

function editor(createHistory, limit) {
  let state = { boxes: [] }
  const h = createHistory({ read: () => state, write: (s) => (state = s), limit })
  const add = (id) => {
    state = { boxes: [...state.boxes, id] }
    h.record()
  }
  return { h, add, ids: () => state.boxes }
}

test('undo and redo walk back and forth through recorded steps', async () => {
  const { createHistory } = await history()
  const e = editor(createHistory)
  e.add('a')
  e.add('b')
  assert.ok(e.h.undo())
  assert.deepEqual(e.ids(), ['a'])
  assert.ok(e.h.undo())
  assert.deepEqual(e.ids(), [])
  assert.equal(e.h.undo(), false)
  assert.equal(e.h.canUndo.value, false)
  assert.ok(e.h.redo())
  assert.ok(e.h.redo())
  assert.deepEqual(e.ids(), ['a', 'b'])
  assert.equal(e.h.canRedo.value, false)
})

test('a new edit after undoing drops the steps that were undone', async () => {
  const { createHistory } = await history()
  const e = editor(createHistory)
  e.add('a')
  e.add('b')
  e.h.undo()
  e.add('c')
  assert.equal(e.h.canRedo.value, false)
  e.h.undo()
  assert.deepEqual(e.ids(), ['a'])
})

test('recording an unchanged state adds no step', async () => {
  const { createHistory } = await history()
  const e = editor(createHistory)
  e.add('a')
  e.h.record()
  e.h.undo()
  assert.deepEqual(e.ids(), [])
})

test('only the newest steps are kept past the limit', async () => {
  const { createHistory } = await history()
  const e = editor(createHistory, 2)
  for (const id of ['a', 'b', 'c', 'd']) e.add(id)
  while (e.h.undo());
  assert.deepEqual(e.ids(), ['a', 'b'])
})

test('a restored step is a copy the history keeps unchanged', async () => {
  const { createHistory } = await history()
  const e = editor(createHistory)
  e.add('a')
  e.h.undo()
  e.ids().push('stray')
  e.h.redo()
  e.h.undo()
  assert.deepEqual(e.ids(), [])
})

test('reset forgets every step', async () => {
  const { createHistory } = await history()
  const e = editor(createHistory)
  e.add('a')
  e.h.reset()
  assert.equal(e.h.canUndo.value, false)
  assert.deepEqual(e.ids(), ['a'])
})
