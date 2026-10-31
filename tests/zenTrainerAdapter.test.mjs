import assert from 'node:assert/strict'
import test from 'node:test'
import { mockModule, sourceModule, sourceUrl } from './source.mjs'

const routes = () =>
  sourceModule('plugins/ComfyUI-ZenIntegrations/src/adapters/zenTrainer/routes.ts')
const HERE = new URL('http://127.0.0.1:8188/?workflow=1')

test('the address setting resolves to the app root, origin only', async () => {
  const { appUrl } = await routes()
  for (const [setting, want] of [
    ['', 'http://127.0.0.1:8188/zentrainer/'],
    ['   ', 'http://127.0.0.1:8188/zentrainer/'],
    [undefined, 'http://127.0.0.1:8188/zentrainer/'],
    ['8190', 'http://127.0.0.1:8190/zentrainer/'],
    ['http://box.local:8189', 'http://box.local:8189/zentrainer/'],
    ['https://box.local/elsewhere?x=1', 'https://box.local/zentrainer/'],
  ])
    assert.equal(appUrl(setting, HERE)?.href, want, String(setting))
  for (const setting of ['0', '70000', 'javascript:alert(1)', 'file:///etc', 'not a url'])
    assert.equal(appUrl(setting, HERE), null, setting)
})

test('a restored panel path must be a ZenTrainer page, not its API or elsewhere', async () => {
  const { isZenTrainerPath } = await routes()
  for (const path of [
    '/zentrainer/',
    '/zentrainer/runs/abc?tab=loss',
    '/zentrainer/datasets/x#y',
    '/zentrainer/datasets/a..b',
    '/zentrainer/datasets/my%20set',
  ])
    assert.equal(isZenTrainerPath(path), true, path)
  for (const path of [
    '/zentrainer',
    '/zentrainer/api/runs',
    '/zentrainer/../settings',
    // encoded and other spellings of a parent segment, which the URL parser resolves too
    '/zentrainer/%2e%2e/settings',
    '/zentrainer/%2E%2E/',
    '/zentrainer/.%2e/settings',
    '/zentrainer/runs/%2e%2e/%2e%2e/settings',
    '/zentrainer/..',
    '/zentrainer/%61pi/runs',
    '/zentrainer/%E0%A4%A',
    '/loras',
    '//evil.com/zentrainer/',
    'https://evil.com/zentrainer/',
    'zentrainer/',
  ])
    assert.equal(isZenTrainerPath(path), false, path)
  for (const value of [undefined, null, 7, {}]) assert.equal(isZenTrainerPath(value), false)
})

// connectZenTrainer with its boundaries stood in: which addresses it probes, in what order, and
// what it registers. `up` holds the origins that answer.
async function discover({ up = [], address = '', here = 'http://192.168.1.5:8188/' } = {}) {
  const tried = []
  const registered = []
  globalThis.__zt = { tried, registered, up: new Set(up), address }
  globalThis.location = new URL(here)
  const index = await sourceModule(
    'plugins/ComfyUI-ZenIntegrations/src/adapters/zenTrainer/index.ts',
    {
      '@comfy/app': mockModule(
        'export const app = { extensionManager: { setting: { get: () => globalThis.__zt.address } } }',
      ),
      '@nynxz/zenkit-client': mockModule(
        'export async function registerZenPlugin(p) { globalThis.__zt.registered.push(p) }',
      ),
      './logo': mockModule("export const ZT_ICON = ''; export const ZT_LOGO = ''"),
      './panel': mockModule(
        'export const mountZenTrainer = (url) => ({ url })\n' +
          'export async function reachable(url) { globalThis.__zt.tried.push(url.href); return globalThis.__zt.up.has(url.origin) }',
      ),
      './routes': await sourceUrl(
        'plugins/ComfyUI-ZenIntegrations/src/adapters/zenTrainer/routes.ts',
      ),
    },
  )
  await index.connectZenTrainer()
  return { tried, at: registered[0]?.panels[0].render.url.href ?? null }
}

test('discovery: this ComfyUI first, then the standalone port on this host, then loopback', async () => {
  const local = 'http://192.168.1.5:8188/zentrainer/'
  const host = 'http://192.168.1.5:8189/zentrainer/'
  const loop = 'http://127.0.0.1:8189/zentrainer/'
  assert.deepEqual(await discover({ up: ['http://192.168.1.5:8188'] }), {
    tried: [local],
    at: local,
  })
  assert.deepEqual(await discover({ up: ['http://192.168.1.5:8189'] }), {
    tried: [local, host],
    at: host,
  })
  assert.deepEqual(await discover({ up: ['http://127.0.0.1:8189'] }), {
    tried: [local, host, loop],
    at: loop,
  })
  assert.deepEqual(await discover(), { tried: [local, host, loop], at: null })
  // opened on loopback itself: the standalone candidate isn't tried twice
  assert.deepEqual(await discover({ here: 'http://127.0.0.1:8188/' }), {
    tried: ['http://127.0.0.1:8188/zentrainer/', loop],
    at: null,
  })
})

test('discovery: a set address is used as it is, without probing', async () => {
  assert.deepEqual(await discover({ address: '8190' }), {
    tried: [],
    at: 'http://192.168.1.5:8190/zentrainer/',
  })
})
