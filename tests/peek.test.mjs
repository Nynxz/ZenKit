import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

const path = 'packages/ui/src/feature/peek.ts'

test('peek media kinds come from data-peek-kind, else the URL', async () => {
  const { guessKind, peekTarget } = await sourceModule(path)
  assert.equal(guessKind('/view?filename=a.MP4'), 'video')
  assert.equal(guessKind('a.mp4.png'), 'image')
  assert.equal(guessKind('a.webm?x=1'), 'video')
  assert.equal(guessKind('song.flac'), 'audio')
  assert.equal(guessKind('pic.png'), 'image')
  assert.deepEqual(peekTarget({ peek: 'clip.mp4', peekLabel: 'Clip' }), {
    kind: 'video',
    url: 'clip.mp4',
    id: '',
    label: 'Clip',
    detail: '',
    key: 'video:clip.mp4',
  })
  assert.equal(peekTarget({ peek: '/view?f=1', peekKind: 'audio' }).kind, 'audio')
  // An unknown kind falls back to guessing, as before custom content existed.
  assert.equal(peekTarget({ peek: 'x.mov', peekKind: 'bogus' }).kind, 'video')
  assert.equal(peekTarget({}), null)
  assert.equal(peekTarget({ peek: '' }), null)
})

test('custom peeks carry the host id, from data-peek-id or data-peek', async () => {
  const { peekTarget, PEEK_SELECTOR } = await sourceModule(path)
  assert.deepEqual(
    peekTarget({ peekKind: 'custom', peekId: 'fx:vhs', peekLabel: 'VHS', peekDetail: 'Tape' }),
    { kind: 'custom', url: '', id: 'fx:vhs', label: 'VHS', detail: 'Tape', key: 'custom:fx:vhs' },
  )
  assert.equal(peekTarget({ peekKind: 'custom', peek: 'b' }).id, 'b')
  assert.equal(peekTarget({ peekKind: 'custom', peekId: 'a', peek: 'b' }).id, 'a')
  assert.equal(peekTarget({ peekKind: 'custom' }), null)
  // Media and custom never share a key, so switching between them replaces the content.
  assert.notEqual(
    peekTarget({ peekKind: 'custom', peekId: 'x.png' }).key,
    peekTarget({ peek: 'x.png' }).key,
  )
  assert.match(PEEK_SELECTOR, /\[data-peek\]/)
  assert.match(PEEK_SELECTOR, /data-peek-kind="custom"/)
})

test('the peek window sits beside the thumbnail and stays on screen', async () => {
  const { placePeek } = await sourceModule(path)
  const vp = { width: 1000, height: 800 }
  // Room on the right: to the right, centred vertically on the thumbnail.
  assert.deepEqual(placePeek({ left: 100, right: 200, top: 300, height: 100 }, 300, 200, vp), {
    left: 212,
    top: 250,
  })
  // No room on the right: to the left.
  assert.deepEqual(placePeek({ left: 800, right: 900, top: 300, height: 100 }, 300, 200, vp), {
    left: 488,
    top: 250,
  })
  // Near the top and bottom edges: clamped 8px inside.
  assert.equal(placePeek({ left: 100, right: 200, top: 0, height: 20 }, 300, 200, vp).top, 8)
  assert.equal(placePeek({ left: 100, right: 200, top: 790, height: 20 }, 300, 200, vp).top, 592)
  // Wider than either side: kept inside the viewport.
  const wide = placePeek({ left: 400, right: 600, top: 300, height: 100 }, 900, 200, vp)
  assert.ok(wide.left >= 8 && wide.left + 900 <= 1000 - 8 + 1e-9, JSON.stringify(wide))
})

test('a peek placed above opens over the element, else below it, centred and on screen', async () => {
  const { placePeekAbove } = await sourceModule(path)
  const vp = { width: 1000, height: 800 }
  // Room above: over it, centred across it.
  assert.deepEqual(
    placePeekAbove({ left: 200, right: 600, width: 400, top: 500, height: 40 }, 300, 200, vp),
    { left: 250, top: 290 },
  )
  // No room above: below it.
  assert.deepEqual(
    placePeekAbove({ left: 200, right: 600, width: 400, top: 50, height: 40 }, 300, 200, vp),
    { left: 250, top: 100 },
  )
  // A wide element running off the right: kept inside the viewport.
  assert.equal(
    placePeekAbove({ left: 700, right: 1400, width: 700, top: 500, height: 40 }, 300, 200, vp).left,
    692,
  )
})
