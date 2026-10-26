import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const path = 'packages/core/src/uncover.ts'
const view = { w: 1500, h: 1000 }

test('a title bar under a short top-row control moves down past it', async () => {
  const { clearMove } = await sourceModule(path)
  const panel = { x: 600, y: 10, w: 400, h: 300 }
  const strip = { x: 600, y: 10, w: 400, h: 33 }
  assert.deepEqual(clearMove(panel, strip, { x: 900, y: 0, w: 200, h: 40 }, view), {
    dx: 0,
    dy: 38,
  })
})

test('a title bar under the full-height sidebar moves right of it', async () => {
  const { clearMove } = await sourceModule(path)
  const panel = { x: 200, y: 300, w: 400, h: 300 }
  const strip = { x: 200, y: 300, w: 400, h: 33 }
  assert.deepEqual(clearMove(panel, strip, { x: 0, y: 0, w: 360, h: 1000 }, view), {
    dx: 168,
    dy: 0,
  })
})

test('no move is offered when every way out leaves the screen', async () => {
  const { clearMove } = await sourceModule(path)
  const panel = { x: 0, y: 0, w: 1500, h: 1000 }
  const strip = { x: 0, y: 0, w: 1500, h: 33 }
  assert.equal(clearMove(panel, strip, { x: 0, y: 0, w: 360, h: 1000 }, view), null)
})
