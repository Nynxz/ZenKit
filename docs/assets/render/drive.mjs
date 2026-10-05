/* global process, Buffer, WebSocket, setTimeout, fetch, console */
// Drives headless Chromium over CDP (no deps) to dump deterministic frames.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
const [, , name, mode, rain, fps, scale, out] = process.argv
const port = 9400 + Math.floor(Math.random() * 500)
const chrome = spawn(
  'chromium',
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--user-data-dir=' + process.cwd() + '/prof-' + port,
    'about:blank',
  ],
  { stdio: 'ignore' },
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let list
for (let i = 0; i < 50; i++) {
  try {
    list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    if (list.length) break
  } catch {
    // not listening yet
  }
  await sleep(200)
}
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (pend.has(m.id)) {
    pend.get(m.id)(m)
    pend.delete(m.id)
  }
}
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id
    pend.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (expr) => {
  const m = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  })
  if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails))
  return m.result.result.value
}
await send('Page.navigate', { url: 'file://' + process.cwd() + '/harness.html' })
await sleep(800)
await ev(
  `document.fonts.load('700 84px "JetBrains Mono"').then(() => document.fonts.load('500 10px "JetBrains Mono"'))`,
)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
await ev(
  `setup(${JSON.stringify(name)}, ${JSON.stringify(mode)}, ${JSON.stringify(rain)}, ${scale})`,
)
const total = await ev('TOTAL'),
  n = Math.round(total * fps)
for (let f = 0; f < n; f++) {
  const url = await ev(`frame(${f / fps}, false)`)
  writeFileSync(
    `${out}/f${String(f).padStart(4, '0')}.png`,
    Buffer.from(url.split(',')[1], 'base64'),
  )
}
await ev(
  `setup(${JSON.stringify(name)}, ${JSON.stringify(mode)}, ${JSON.stringify(rain)}, ${scale})`,
)
writeFileSync(`${out}/still.png`, Buffer.from((await ev('frame(8, true)')).split(',')[1], 'base64'))
console.log(name, mode, n, 'frames')
ws.close()
chrome.kill()
await sleep(300)
rmSync(process.cwd() + '/prof-' + port, { recursive: true, force: true })
process.exit(0)
