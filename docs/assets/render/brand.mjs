/* global process, console */
// Writes the static lotus assets: the colour and mono logos, and one tile per plugin (the lotus
// on a rounded square with a badge for what the plugin does). Each plugin also gets a copy of
// its tile as src/logo.svg, which it passes to registerZenPlugin as its `logo`.
//
//   node docs/assets/render/brand.mjs        (from the repo root)
//
// PNGs for the Comfy registry `Icon` are rendered from these SVGs with ImageMagick.
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const C = {
  back: '#7d55b8',
  mid: '#b680f2',
  tip: '#f4abd4',
  water: '#5d7fe6',
  tile: '#231d3b',
  edge: '#3a3260',
  ink: '#16121f',
}

// A petal pointing up from (0,0): pointed tip, full belly.
const petal = (h, w) =>
  `M0,0 C${w},${-h * 0.3} ${w * 0.7},${-h * 0.78} 0,${-h} C${-w * 0.7},${-h * 0.78} ${-w},${-h * 0.3} 0,0Z`

/** The Full Bloom petals, drawn around a base at (0,0). `mono` uses currentColor + opacity. */
function bloom({ mono = false, id = 'lotus' } = {}) {
  const back = mono ? 'currentColor' : C.back
  const mid = mono ? 'currentColor' : C.mid
  const front = mono ? 'currentColor' : `url(#${id})`
  const defs = mono
    ? ''
    : `<defs><linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${C.mid}"/><stop offset="1" stop-color="${C.tip}"/></linearGradient></defs>`
  return `${defs}<g fill="${back}" opacity="${mono ? 0.35 : 0.8}"><path d="${petal(54, 24)}" transform="rotate(-70)"/><path d="${petal(54, 24)}" transform="rotate(70)"/></g><g fill="${mid}" opacity="${mono ? 0.6 : 0.85}"><path d="${petal(66, 26)}" transform="rotate(-36)"/><path d="${petal(66, 26)}" transform="rotate(36)"/></g><path d="${petal(78, 28)}" fill="${front}"/>`
}

const logo = ({ mono }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-60 -84 120 106" width="120" height="106">${bloom({ mono })}<ellipse cx="0" cy="12" rx="44" ry="5" fill="${mono ? 'currentColor' : C.water}" opacity=".45"/></svg>\n`

// Badge glyphs on a 24-unit grid.
const GLYPH = {
  zenkit: '',
  zensuite:
    '<rect x="5" y="5" width="6" height="6" rx="1.5"/><rect x="13" y="5" width="6" height="6" rx="1.5"/><rect x="5" y="13" width="6" height="6" rx="1.5"/><rect x="13" y="13" width="6" height="6" rx="1.5"/>',
  zeninspector: `<circle cx="10.5" cy="10.5" r="5" fill="none" stroke="${C.ink}" stroke-width="2.4"/><path d="M14.5 14.5 19 19" stroke="${C.ink}" stroke-width="2.6" stroke-linecap="round"/>`,
  zenagent: '<path d="M12 3.5 13.9 10.1 20.5 12 13.9 13.9 12 20.5 10.1 13.9 3.5 12 10.1 10.1Z"/>',
  zenexample: `<path d="M9 7 4.5 12 9 17M15 7l4.5 5L15 17" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
}

function tile(kind) {
  const glyph = GLYPH[kind]
  const badge = glyph
    ? `<g transform="translate(73,73)"><circle r="23" fill="${C.mid}" stroke="${C.tile}" stroke-width="6"/><g transform="translate(-12,-12)" fill="${C.ink}">${glyph}</g></g>`
    : ''
  // Without a badge (ZenKit itself) the lotus sits centred and a little larger.
  const mark = glyph
    ? `<svg x="2" y="4" width="84" height="76" viewBox="-60 -84 120 90">${bloom({ id: `${kind}-g` })}</svg>`
    : `<svg x="8" y="10" width="84" height="76" viewBox="-60 -84 120 90">${bloom({ id: `${kind}-g` })}</svg>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect x="2" y="2" width="96" height="96" rx="24" fill="${C.tile}" stroke="${C.edge}" stroke-width="2"/>${mark}${badge}</svg>\n`
}

const PLUGIN_DIR = {
  zenkit: 'ComfyUI-ZenKit',
  zensuite: 'ComfyUI-ZenSuite',
  zeninspector: 'ComfyUI-ZenInspector',
  zenagent: 'ComfyUI-ZenAgent',
  zenexample: 'ComfyUI-ZenExample',
}

const out = 'docs/assets/brand'
mkdirSync(out, { recursive: true })
writeFileSync(`${out}/logo.svg`, logo({ mono: false }))
writeFileSync(`${out}/logo-mono.svg`, logo({ mono: true }))
for (const [kind, dir] of Object.entries(PLUGIN_DIR)) {
  const svg = tile(kind)
  writeFileSync(`${out}/${kind}.svg`, svg)
  writeFileSync(`plugins/${dir}/src/logo.svg`, svg)
  execFileSync('magick', [
    '-background',
    'none',
    '-density',
    '600',
    `${out}/${kind}.svg`,
    '-resize',
    '256x256',
    `${out}/${kind}.png`,
  ])
}
// Core's copy: the ZenKit row in Zen Settings.
mkdirSync('packages/core/src/brand', { recursive: true })
writeFileSync('packages/core/src/brand/zenkit.svg', tile('zenkit'))
execFileSync('magick', [
  '-background',
  'none',
  '-density',
  '600',
  `${out}/logo.svg`,
  '-resize',
  '512x',
  `${out}/logo.png`,
])
console.log('wrote', out, process.cwd())
