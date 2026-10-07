// Exercise source modules with the real Vue runtime and mocked ComfyUI boundaries, without
// building the browser bundles or adding a second test framework.
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { compileScript, parse } from 'vue/compiler-sfc'

let sequence = 0

export async function sourceModule(path, mocks = {}) {
  return import(await sourceUrl(path, mocks))
}

export async function sourceUrl(path, mocks = {}) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  if (path.endsWith('.vue')) {
    const { descriptor } = parse(source)
    source = compileScript(descriptor, { id: 'regression', inlineTemplate: true }).content
  }
  let js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  // The test renderer exercises component behavior without loading stylesheets.
  js = js.replace(/^import ['"][^'"]+\.css['"];?\s*$/gm, '')
  const imports = { vue: import.meta.resolve('vue'), ...mocks }
  for (const [name, url] of Object.entries(imports)) {
    js = js.replaceAll(`from '${name}'`, `from '${url}'`)
    js = js.replaceAll(`from "${name}"`, `from '${url}'`)
  }
  // Fresh module state for each test, including registries seeded from localStorage.
  return `data:text/javascript;base64,${Buffer.from(`${js}\n// ${sequence++}`).toString('base64')}`
}

export function mockModule(source) {
  return `data:text/javascript;base64,${Buffer.from(`${source}\n// ${sequence++}`).toString('base64')}`
}

export function storage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}
