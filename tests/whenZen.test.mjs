import assert from 'node:assert/strict'
import test from 'node:test'
import { mockModule, sourceModule } from './source.mjs'

const client = () =>
  sourceModule('packages/client/src/index.ts', {
    './mediaRefs': mockModule(
      'export const mediaKind = () => null; export const parseMediaRef = () => null',
    ),
    './useJob': mockModule('export const useJob = () => {}'),
    './mountVue': mockModule(
      'export const mountVue = () => {}; export const mountVueApp = () => {}',
    ),
    './useAppLocation': mockModule('export const useAppLocation = () => {}'),
    './useLightbox': mockModule('export const useLightbox = () => {}'),
  })

function host(probe) {
  const win = new EventTarget()
  globalThis.window = win
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/zenkit/themes')
    assert.equal(init.method, 'HEAD')
    return probe()
  }
  return win
}

const settle = (ms) => new Promise((resolve) => setTimeout(() => resolve('pending'), ms))

test('without ZenKit on the server, whenZen answers null without waiting out the timeout', async (t) => {
  t.mock.method(console, 'warn', () => {})
  host(() => ({ ok: false, status: 404 }))
  const { whenZen } = await client()
  assert.equal(await Promise.race([whenZen(5000), settle(500)]), null)
})

test('with ZenKit on the server, whenZen outlasts the timeout and resolves once ZenKit is ready', async () => {
  const win = host(() => ({ ok: true, status: 200 }))
  const { whenZen } = await client()
  const waiting = whenZen(20)
  assert.equal(await Promise.race([waiting, settle(100)]), 'pending')
  const zen = { version: 'test' }
  win.ZenKit = zen
  win.dispatchEvent(new Event('zen:ready'))
  assert.equal(await waiting, zen)
})

test('when the server cannot be asked, whenZen falls back to the timeout', async (t) => {
  t.mock.method(console, 'warn', () => {})
  host(() => Promise.reject(new TypeError('offline')))
  const { whenZen } = await client()
  assert.equal(await Promise.race([whenZen(20), settle(500)]), null)
})
