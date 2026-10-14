#!/usr/bin/env node
// pnpm release <patch|minor|major|x.y.z>
//
// One version for everything ZenKit publishes: the npm packages and the registry plugins move
// together. Bumps them, commits, and tags vX.Y.Z; `git push --follow-tags` then publishes, since
// a v* tag runs publish-npm and publish-registry.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const PACKAGES = ['client', 'core', 'nodekit', 'theme', 'ui'].map(
  (p) => `packages/${p}/package.json`,
)
const PLUGINS = ['ComfyUI-ZenKit', 'ComfyUI-ZenInspector'].map((p) => `plugins/${p}`)

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const fail = (msg) => {
  console.error(`release: ${msg}`)
  process.exit(1)
}

const arg = process.argv[2]
if (!arg) fail('say patch, minor, major or a version (x.y.z)')
if (git('status', '--porcelain')) fail('commit or stash your changes first')

const current = JSON.parse(readFileSync('packages/ui/package.json', 'utf8')).version
const [maj, min, pat] = current.split('.').map(Number)
const next =
  arg === 'patch'
    ? `${maj}.${min}.${pat + 1}`
    : arg === 'minor'
      ? `${maj}.${min + 1}.0`
      : arg === 'major'
        ? `${maj + 1}.0.0`
        : /^\d+\.\d+\.\d+$/.test(arg)
          ? arg
          : fail(`not a version: ${arg}`)
if (git('tag', '--list', `v${next}`)) fail(`v${next} is already tagged`)

const setJson = (file) => {
  const text = readFileSync(file, 'utf8')
  const out = text.replace(/("version":\s*")[^"]+(")/, `$1${next}$2`)
  if (out === text) fail(`no version in ${file}`)
  writeFileSync(file, out)
}
const setToml = (file) => {
  const text = readFileSync(file, 'utf8')
  const out = text.replace(/^version = "[^"]+"/m, `version = "${next}"`)
  if (out === text) fail(`no version in ${file}`)
  writeFileSync(file, out)
}

for (const file of PACKAGES) setJson(file)
for (const dir of PLUGINS) {
  setJson(`${dir}/package.json`)
  setToml(`${dir}/pyproject.toml`)
}
const files = [...PACKAGES, ...PLUGINS.flatMap((d) => [`${d}/package.json`, `${d}/pyproject.toml`])]
git('add', ...files)
git('commit', '-m', `chore(release): ${next}`)
git('tag', '-a', `v${next}`, '-m', `ZenKit ${next}`)
console.log(`${current} → ${next}, tagged v${next}. Publish with: git push --follow-tags`)
