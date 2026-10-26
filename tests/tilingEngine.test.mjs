import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const path = 'packages/core/src/tiling/engine.ts'
const leaf = (id) => ({ type: 'leaf', id })
const split = (a, b, ratio = 0.3) => ({ type: 'split', axis: 'row', ratio, a, b })

test('renaming a tile keeps its place and share in the split', async () => {
  const { renameTile } = await sourceModule(path)
  const tree = split(leaf('left'), split(leaf('top'), leaf('bottom'), 0.6))
  assert.deepEqual(
    renameTile(tree, 'top', 'placeholder'),
    split(leaf('left'), split(leaf('placeholder'), leaf('bottom'), 0.6)),
  )
})

test('renaming a tile that is not in the tree returns the same tree', async () => {
  const { renameTile } = await sourceModule(path)
  const tree = split(leaf('left'), leaf('right'))
  assert.equal(renameTile(tree, 'missing', 'other'), tree)
})
