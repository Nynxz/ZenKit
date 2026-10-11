import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const layout = () => sourceModule('packages/core/src/workflowLayout.ts')
const leaf = (id) => ({ type: 'leaf', id })
const split = (a, b, ratio = 0.5, axis = 'row') => ({ type: 'split', axis, ratio, a, b })

test('absent extra.zenkit is no layout and no problem', async () => {
  const { parseZenkitExtra } = await layout()
  assert.deepEqual(parseZenkitExtra(undefined), { layout: null, problem: null })
  assert.deepEqual(parseZenkitExtra(null), { layout: null, problem: null })
})

test('malformed extra.zenkit is ignored with a problem', async () => {
  const { parseZenkitExtra } = await layout()
  for (const bad of ['x', 7, [], { v: 2, workspaces: [] }, { v: 1, workspaces: 'no' }]) {
    const r = parseZenkitExtra(bad)
    assert.equal(r.layout, null)
    assert.ok(r.problem, JSON.stringify(bad))
  }
})

test('a clean layout round-trips', async () => {
  const { parseZenkitExtra, serializeLayout } = await layout()
  const extra = {
    v: 1,
    workspaces: [
      { id: 'w1', name: 'Shots', tree: split(leaf('zensuite:viewer'), leaf('notes:pad#2'), 0.3) },
      { id: 'w2', name: 'Edit', tree: null },
    ],
    active: 'w2',
  }
  const r = parseZenkitExtra(extra)
  assert.equal(r.problem, null)
  assert.deepEqual(serializeLayout(r.layout), extra)
})

test('caps workspaces, depth and tiles; clamps ratios', async () => {
  const { parseZenkitExtra, leafIds, LAYOUT_LIMITS } = await layout()
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `w${i}`, name: `W${i}`, tree: null }))
  const r1 = parseZenkitExtra({ v: 1, workspaces: many })
  assert.equal(r1.layout.workspaces.length, LAYOUT_LIMITS.workspaces)
  assert.match(r1.problem, /first 16/)

  // A chain 20 splits deep: nothing below depth 8 survives.
  let deep = leaf('bottom')
  for (let i = 0; i < 20; i++) deep = split(leaf(`p${i}`), deep)
  const r2 = parseZenkitExtra({ v: 1, workspaces: [{ id: 'w1', name: 'Deep', tree: deep }] })
  const depth = (n) => (!n || n.type === 'leaf' ? 1 : 1 + Math.max(depth(n.a), depth(n.b)))
  assert.ok(depth(r2.layout.workspaces[0].tree) <= LAYOUT_LIMITS.depth)
  assert.ok(r2.problem)

  // 50 tiles spread over workspaces: at most 32 kept in total.
  const wide = Array.from({ length: 5 }, (_, w) => {
    let t = leaf(`a${w}_0`)
    for (let i = 1; i < 10; i++) t = split(t, leaf(`a${w}_${i}`))
    return { id: `w${w}`, name: `W${w}`, tree: t }
  })
  const r3 = parseZenkitExtra({ v: 1, workspaces: wide })
  const total = r3.layout.workspaces.flatMap((w) => leafIds(w.tree)).length
  assert.ok(total <= LAYOUT_LIMITS.tiles, `${total} tiles`)

  const r4 = parseZenkitExtra({
    v: 1,
    workspaces: [
      { id: 'w1', name: 'R', tree: split(leaf('a'), split(leaf('b'), leaf('c'), 'x'), 9) },
    ],
  })
  const t = r4.layout.workspaces[0].tree
  assert.equal(t.ratio, 0.95)
  assert.equal(t.b.ratio, 0.5)
})

test('hostile names, ids and nodes are neutralised', async () => {
  const { parseZenkitExtra } = await layout()
  const r = parseZenkitExtra({
    v: 1,
    workspaces: [
      {
        id: '<img src=x onerror=alert(1)>',
        name: '<script>alert(1)</script>‮\n' + 'x'.repeat(200),
        tree: split(leaf('<b>bad</b>'), split(leaf('ok:panel'), { type: 'evil', html: '<i>' })),
      },
      { id: 'w1', name: '   ', tree: split(leaf('ok:panel'), leaf('other:one')) },
      { id: 'w1', name: 'dup id', tree: { type: 'leaf', id: 42 } },
      'nope',
    ],
    active: '<img src=x onerror=alert(1)>',
  })
  const [a, b, c] = r.layout.workspaces
  // The id is reissued and `active` follows it; the name is plain text, one line, capped.
  assert.match(a.id, /^[A-Za-z0-9_-]+$/)
  assert.equal(r.layout.active, a.id)
  assert.ok(!/[\n‮]/.test(a.name) && a.name.length <= 48)
  // Bad panel ids and unknown node types are dropped; a panel tiles once across workspaces.
  assert.deepEqual(a.tree, leaf('ok:panel'))
  assert.deepEqual(b.tree, leaf('other:one'))
  assert.equal(b.name, 'Workspace 2')
  assert.notEqual(c.id, 'w1')
  assert.equal(c.tree, null)
  assert.ok(r.problem)
})

test('an incoming layout fits beside the global workspaces', async () => {
  const { fitBesideGlobals } = await layout()
  const fitted = fitBesideGlobals(
    {
      workspaces: [
        { id: 'g1', name: 'Clash', tree: split(leaf('shared'), leaf('mine')) },
        { id: 'w2', name: 'Other', tree: leaf('only') },
      ],
      active: 'g1',
    },
    [{ id: 'g1', tree: leaf('shared') }],
  )
  assert.notEqual(fitted.workspaces[0].id, 'g1')
  assert.equal(fitted.active, fitted.workspaces[0].id)
  assert.deepEqual(fitted.workspaces[0].tree, leaf('mine'))
  assert.deepEqual(fitted.workspaces[1].tree, leaf('only'))
})

test('a swap closes only the outgoing workflow’s own reopenable panels and opens the incoming', async () => {
  const { planSwap } = await layout()
  const open = new Set(['a', 'both', 'g', 'node:graph:1', 'float'])
  const registered = new Set(['a', 'both', 'g', 'b', 'c'])
  const plan = planSwap({
    outgoing: [split(leaf('a'), leaf('both')), leaf('node:graph:1')],
    incoming: [split(leaf('both'), leaf('b')), leaf('unknown:x'), leaf('g')],
    globals: [leaf('g')],
    isOpen: (id) => open.has(id),
    canReopen: (id) => registered.has(id),
  })
  // 'both' stays (the incoming workflow tiles it too), 'g' is a global's, the node-bound panel
  // closes itself with its node, floating panels aren't in any tree.
  assert.deepEqual(plan.close, ['a'])
  // Unregistered ids from the file are never opened.
  assert.deepEqual(plan.open, ['b'])
})

test('swapping A → B → A restores what each had', async () => {
  const { planSwap } = await layout()
  const A = [leaf('viewer')]
  const B = [leaf('notes')]
  const open = new Set(['viewer'])
  const step = (outgoing, incoming) => {
    const plan = planSwap({
      outgoing,
      incoming,
      globals: [],
      isOpen: (id) => open.has(id),
      canReopen: () => true,
    })
    plan.close.forEach((id) => open.delete(id))
    plan.open.forEach((id) => open.add(id))
    return plan
  }
  assert.deepEqual(step(A, B), { close: ['viewer'], open: ['notes'] })
  assert.deepEqual([...open], ['notes'])
  assert.deepEqual(step(B, A), { close: ['notes'], open: ['viewer'] })
  assert.deepEqual([...open], ['viewer'])
})
