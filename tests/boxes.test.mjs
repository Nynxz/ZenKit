import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const boxes = () => sourceModule('packages/ui/src/lib/boxes.ts')
const close = (a, b) =>
  ['x', 'y', 'w', 'h'].forEach((k) =>
    assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${k}: ${a[k]} vs ${b[k]}`),
  )

test('a span is the same rect whichever corner the drag started from, clamped to the canvas', async () => {
  const { spanRect } = await boxes()
  close(spanRect(0.6, 0.7, 0.2, 0.1), { x: 0.2, y: 0.1, w: 0.4, h: 0.6 })
  close(spanRect(-0.2, 0.5, 0.5, 1.4), { x: 0, y: 0.5, w: 0.5, h: 0.5 })
})

test('a moved box stops at the canvas edge instead of leaving it', async () => {
  const { moveRect } = await boxes()
  close(moveRect({ x: 0.7, y: 0.1, w: 0.2, h: 0.2 }, 0.5, -0.5), { x: 0.8, y: 0, w: 0.2, h: 0.2 })
})

test('a handle moves only its own edges, and a box never inverts', async () => {
  const { resizeRect } = await boxes()
  const r = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 }
  close(resizeRect(r, 'se', 0.1, 0.1), { x: 0.2, y: 0.2, w: 0.5, h: 0.5 })
  close(resizeRect(r, 'w', 0.1, 0.3), { x: 0.3, y: 0.2, w: 0.3, h: 0.4 })
  const squashed = resizeRect(r, 'e', -0.9, 0, { min: 0.02 })
  assert.ok(squashed.w >= 0.02 - 1e-9 && squashed.x === 0.2)
})

test('shift keeps the on-screen shape, with the opposite corner pinned', async () => {
  const { resizeRect } = await boxes()
  // A square on screen on a 2:1 canvas is twice as tall in fractions as it is wide.
  const r = { x: 0.1, y: 0.1, w: 0.2, h: 0.4 }
  const out = resizeRect(r, 'se', 0.1, 0.0, { keepAspect: true, aspect: 2 })
  assert.ok(Math.abs((out.w * 2) / out.h - 1) < 1e-9, 'stays square on screen')
  assert.equal(out.x, 0.1)
  assert.equal(out.y, 0.1)
  const nw = resizeRect(r, 'nw', -0.05, -0.05, { keepAspect: true, aspect: 2 })
  assert.ok(Math.abs(nw.x + nw.w - 0.3) < 1e-9 && Math.abs(nw.y + nw.h - 0.5) < 1e-9)
})

test('scaling a selection scales every member with it', async () => {
  const { scaleWithin } = await boxes()
  const from = { x: 0, y: 0, w: 0.5, h: 0.5 }
  const to = { x: 0, y: 0, w: 1, h: 1 }
  close(scaleWithin({ x: 0.25, y: 0.1, w: 0.25, h: 0.1 }, from, to), {
    x: 0.5,
    y: 0.2,
    w: 0.5,
    h: 0.2,
  })
})

test('the topmost visible box wins a hit test', async () => {
  const { boxAt } = await boxes()
  const list = [
    { id: 'a', x: 0, y: 0, w: 1, h: 1 },
    { id: 'b', x: 0.2, y: 0.2, w: 0.3, h: 0.3 },
    { id: 'c', x: 0.2, y: 0.2, w: 0.3, h: 0.3, hidden: true },
  ]
  assert.equal(boxAt(list, 0.3, 0.3)?.id, 'b')
  assert.equal(boxAt(list, 0.9, 0.9)?.id, 'a')
  assert.equal(boxAt(list.slice(2), 0.3, 0.3), null)
})
