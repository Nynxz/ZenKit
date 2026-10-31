import assert from 'node:assert/strict'
import test from 'node:test'
import { sourceModule } from './source.mjs'

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
