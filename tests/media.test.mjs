import assert from 'node:assert/strict'
import test from 'node:test'
import { mockModule, sourceModule, sourceUrl } from './source.mjs'

const sharedPath = 'packages/client/src/mediaRefs.ts'

test('shared media parsing accepts ComfyUI files and rejects malformed refs', async () => {
  const { parseMediaRef } = await sourceModule(sharedPath)
  for (const type of ['input', 'output', 'temp']) {
    assert.deepEqual(parseMediaRef(`${type}/sub/space name.png`), {
      type,
      subfolder: 'sub',
      filename: 'space name.png',
    })
  }
  for (const ref of [
    '',
    null,
    42,
    '/output/x.png',
    'https://example.com/x.png',
    'stash:x.png',
    'output/',
    'output//x.png',
    'output/../x.png',
    'output/./x.png',
    'output/sub/..',
  ]) {
    assert.equal(parseMediaRef(ref), null, String(ref))
  }
})

test('shared media kinds handle URLs, data URIs and GIFs consistently', async () => {
  const { mediaKind } = await sourceModule(sharedPath)
  for (const [name, kind] of [
    ['output/video.MP4', 'video'],
    ['https://example.com/video.webm?x=1', 'video'],
    ['sound.flac#preview', 'audio'],
    ['data:VIDEO/mp4;base64,AAAA', 'video'],
    ['data:audio/wav;base64,AAAA', 'audio'],
    ['animated.gif', 'image'],
    ['', 'image'],
  ])
    assert.equal(mediaKind(name), kind, name)
})

test('runtime and node widgets resolve the same refs without changing their public failure behavior', async () => {
  const shared = await sourceUrl(sharedPath)
  const api = mockModule('export const api = { apiURL: path => "/api" + path }')
  const core = await sourceModule('packages/core/src/media.ts', {
    '@comfy/api': api,
    '../../client/src/mediaRefs': shared,
  })
  const nodekit = await sourceModule('packages/nodekit/src/mediaRefs.ts', {
    '@comfy/api': api,
    './viewUrl': await sourceUrl('packages/nodekit/src/viewUrl.ts', {
      '@comfy/api': api,
      '@comfy/app': mockModule('export const app = {}'),
    }),
    './zenkit': mockModule(`export { mediaKind, parseMediaRef } from '${shared}';
      export const ZEN_MEDIA_MIME = 'application/x-zen-image';
      export const ZEN_MEDIA_LIST_MIME = 'application/x-zen-media-list';
      export const COMFY_ASSET_MIME = 'application/x-comfy-asset';`),
  })
  const media = core.createMedia()
  for (const ref of ['output/sub/space name.png', 'input/a.wav', 'temp/video.mp4']) {
    const info = await media.resolve(ref)
    const widgetUrl = new URL(nodekit.mediaRefUrl(ref), 'http://localhost')
    const runtimeUrl = new URL(info.url, 'http://localhost')
    assert.equal(widgetUrl.pathname, runtimeUrl.pathname)
    for (const [key, value] of runtimeUrl.searchParams) {
      assert.equal(widgetUrl.searchParams.get(key), value)
    }
    assert.ok(widgetUrl.searchParams.has('r'))
    assert.equal(nodekit.mediaKind(ref), info.kind)
  }
  assert.equal(await media.toInput('input/sub/a.png'), 'sub/a.png')
  assert.equal(await media.toInput('output/sub/a.png'), 'sub/a.png [output]')
  for (const ref of ['output/../a.png', 'https://example.com/a.png']) {
    await assert.rejects(media.resolve(ref))
    assert.equal(nodekit.mediaRefUrl(ref), '/api/view?filename=')
  }
})

test('a node widget takes every ComfyUI file of a dropped media list, else the single file', async () => {
  const shared = await sourceUrl(sharedPath)
  const api = mockModule('export const api = { apiURL: path => "/api" + path }')
  const nodekit = await sourceModule('packages/nodekit/src/mediaRefs.ts', {
    '@comfy/api': api,
    './viewUrl': await sourceUrl('packages/nodekit/src/viewUrl.ts', {
      '@comfy/api': api,
      '@comfy/app': mockModule('export const app = {}'),
    }),
    './zenkit': mockModule(`export { mediaKind, parseMediaRef } from '${shared}';
      export const ZEN_MEDIA_MIME = 'zen-media';
      export const ZEN_MEDIA_LIST_MIME = 'zen-list';
      export const COMFY_ASSET_MIME = 'comfy-asset';`),
  })
  globalThis.location = { href: 'http://localhost/' }
  const drop = (data) => ({
    dataTransfer: { types: Object.keys(data), files: [], getData: (type) => data[type] ?? '' },
  })
  const single = { 'zen-media': JSON.stringify({ ref: 'output/one.png' }) }
  const list = { ...single, 'zen-list': JSON.stringify({ url: 'http://localhost/album' }) }
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      items: [
        { url: 'http://localhost/api/view?filename=a.png&type=output&subfolder=s' },
        { url: 'https://example.com/elsewhere.png' },
        { url: 'http://localhost/api/view?filename=b.mp4&type=input' },
      ],
    }),
  })
  assert.ok(nodekit.hasMediaDrop(drop({ 'zen-list': '' })))
  assert.deepEqual(await nodekit.readMediaDrop(drop(list)), ['output/s/a.png', 'input/b.mp4'])
  globalThis.fetch = async () => ({ ok: false })
  assert.deepEqual(await nodekit.readMediaDrop(drop(list)), ['output/one.png'])
})
