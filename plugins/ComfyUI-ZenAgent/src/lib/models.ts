import { api } from '@comfy/api'

// The model files installed in this ComfyUI, for the agent: what folders there are, searching them
// by words, and matching a model name the agent half-remembers (or a workflow from elsewhere
// names) to a file that's actually here. Uses ComfyUI's own /models routes.

/** The words people (and models) use for each folder. */
const ALIASES: Record<string, string[]> = {
  checkpoints: ['checkpoint', 'ckpt', 'model', 'models', 'sd', 'sdxl'],
  loras: ['lora', 'lycoris', 'locon'],
  diffusion_models: ['diffusion', 'diffusion_model', 'unet', 'unets', 'transformer', 'dit'],
  text_encoders: ['text_encoder', 'clip', 'clips', 't5', 'encoder', 'te'],
  vae: ['vaes'],
  upscale_models: ['upscale', 'upscaler', 'upscalers', 'esrgan'],
  controlnet: ['controlnets', 'control', 't2i_adapter'],
  embeddings: ['embedding', 'textual_inversion', 'ti'],
  clip_vision: ['clipvision', 'vision'],
  style_models: ['style'],
  hypernetworks: ['hypernetwork'],
  audio_encoders: ['audio_encoder'],
}

const CACHE_MS = 60_000
let folderList: { at: number; names: string[] } | null = null
const fileLists = new Map<string, { at: number; files: string[] }>()

async function getJson<T>(path: string): Promise<T | null> {
  const res = await (api as { fetchApi(p: string): Promise<Response> }).fetchApi(path)
  return res.ok ? ((await res.json()) as T) : null
}

export async function folders(): Promise<string[]> {
  if (!folderList || Date.now() - folderList.at > CACHE_MS)
    folderList = { at: Date.now(), names: (await getJson<string[]>('/models')) ?? [] }
  return folderList.names
}

export async function filesIn(folder: string): Promise<string[]> {
  const known = fileLists.get(folder)
  if (known && Date.now() - known.at < CACHE_MS) return known.files
  const files = (await getJson<string[]>(`/models/${encodeURIComponent(folder)}`)) ?? []
  fileLists.set(folder, { at: Date.now(), files })
  return files
}

const norm = (s: string) => s.toLowerCase().replace(/\\/g, '/')
const words = (s: string) =>
  norm(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
const stem = (s: string) =>
  norm(s)
    .split('/')
    .pop()!
    .replace(/\.[a-z0-9]+$/, '')

/** The folder a type names: the folder itself, one of its aliases, or the only folder containing
 *  the word. Null when nothing (or more than one folder) fits. */
export function folderFor(type: string, available: string[]): string | null {
  const t = norm(type).replace(/[\s-]+/g, '_')
  if (available.includes(t)) return t
  for (const [folder, names] of Object.entries(ALIASES))
    if (available.includes(folder) && (names.includes(t) || `${t}s` === folder)) return folder
  const partial = available.filter((f) => f.includes(t))
  return partial.length === 1 ? partial[0]! : null
}

/** Files ranked by how many of the query's words they contain (all words first), then shortest. */
export function rank(files: string[], query: string): { file: string; all: boolean }[] {
  const want = words(query)
  if (!want.length) return files.map((file) => ({ file, all: true }))
  return files
    .map((file) => {
      const hay = norm(file)
      const parts = words(file)
      // "detailer" still finds "Detail_Boost": a query word may run on past a word of the file's.
      const hits = want.filter(
        (w) => hay.includes(w) || parts.some((p) => p.length >= 4 && w.startsWith(p)),
      ).length
      return { file, hits, all: hits === want.length }
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.file.length - b.file.length)
    .map(({ file, all }) => ({ file, all }))
}

/** The one option a near-miss value means: the same file in any case, by its name alone, without
 *  its extension, or under another folder. Null when none or several fit. */
export function resolveOption(options: unknown[], value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const v = norm(value.trim())
  const strings = options.filter((o): o is string => typeof o === 'string')
  const tests = [
    (o: string) => norm(o) === v,
    (o: string) => norm(o).endsWith(`/${v}`),
    (o: string) => stem(o) === stem(v),
  ]
  for (const test of tests) {
    const hits = strings.filter(test)
    if (hits.length === 1) return hits[0]!
    if (hits.length > 1) return null
  }
  return null
}

/** The options closest to a value that isn't one, best first. */
export function closest(options: unknown[], value: unknown, n = 8): string[] {
  const strings = options.filter((o): o is string => typeof o === 'string')
  return rank(strings, String(value ?? ''))
    .slice(0, n)
    .map((r) => r.file)
}

interface NodeDefLike {
  name: string
  input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> }
}
/** A combo input's options, in either node-def format (`[[...]]` or `['COMBO', {options}]`). */
export function comboOptions(spec: unknown[] | undefined): unknown[] | null {
  if (!spec) return null
  if (Array.isArray(spec[0])) return spec[0]
  const opts = (spec[1] as { options?: unknown } | undefined)?.options
  return spec[0] === 'COMBO' && Array.isArray(opts) ? opts : null
}

/** Which node inputs take this folder's files (e.g. `LoraLoader.lora_name`), judged by whose
 *  options hold its first files. */
export function usedBy(defs: Record<string, NodeDefLike>, files: string[], n = 6): string[] {
  const sample = files.slice(0, 3)
  if (!sample.length) return []
  const out: string[] = []
  for (const def of Object.values(defs))
    for (const [name, spec] of Object.entries({ ...def.input?.required, ...def.input?.optional })) {
      const options = comboOptions(spec)
      if (options && sample.every((f) => options.includes(f))) out.push(`${def.name}.${name}`)
    }
  return out.slice(0, n)
}
