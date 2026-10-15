import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const sortable = () => sourceModule('packages/ui/src/lib/sortable.ts')

test('the landing slot counts the rows the dragged one has passed', async () => {
  const { insertionIndex } = await sortable()
  const mids = [10, 40, 70, 100]
  const cases = [
    [0, 10, 0],
    [0, 45, 1],
    [0, 101, 3],
    [3, 5, 0],
    [3, 55, 2],
    [1, 40, 1],
  ]
  for (const [from, center, want] of cases)
    assert.equal(insertionIndex(mids, from, center), want, `from ${from} at ${center}`)
})

test('pinned ends hold: the landing slot stays inside lo..hi', async () => {
  const { insertionIndex } = await sortable()
  assert.equal(insertionIndex([10, 40, 70, 100], 1, 999, 0, 2), 2)
  assert.equal(insertionIndex([10, 40, 70, 100], 2, -5, 1, 3), 1)
})

test('rows between the grab and the landing slot move aside toward the gap', async () => {
  const { sortShift } = await sortable()
  const down = [0, 1, 2, 3, 4].map((i) => sortShift(i, 1, 3))
  assert.deepEqual(down, [0, 0, -1, -1, 0])
  const up = [0, 1, 2, 3, 4].map((i) => sortShift(i, 3, 1))
  assert.deepEqual(up, [0, 1, 1, 0, 0])
  assert.deepEqual(
    [0, 1, 2].map((i) => sortShift(i, 1, 1)),
    [0, 0, 0],
  )
  assert.deepEqual(
    [0, 1].map((i) => sortShift(i, -1, 1)),
    [0, 0],
  )
})

test('a stride is the dragged row and its gap, whatever the others measure', async () => {
  const { rowStride, shiftStyle } = await sortable()
  const tops = [0, 36, 100, 136]
  const heights = [30, 58, 30, 30]
  assert.equal(rowStride(tops, heights, 0), 36)
  assert.equal(rowStride(tops, heights, 1), 64)
  assert.equal(rowStride(tops, heights, 3), 36)
  assert.equal(rowStride([0], [24], 0), 24)
  assert.deepEqual(shiftStyle(-1, 36), { transform: 'translateY(-36px)' })
  assert.equal(shiftStyle(0, 36), undefined)
})

test('the dragged row lands where its slot is in the new order', async () => {
  const { landingTop } = await sortable()
  const tops = [0, 36, 100, 136]
  const heights = [30, 58, 30, 30]
  assert.equal(landingTop(tops, heights, 3, 1), 36)
  assert.equal(landingTop(tops, heights, 0, 2), 100)
  assert.equal(landingTop(tops, heights, 1, 3), 108)
  assert.equal(landingTop(tops, heights, 2, 2), 100)
})
