// The join. Five sources disagree about what's installed, and the disagreements ARE the
// diagnostics — so nothing here averages them out:
//
//   /object_info            what the server will execute, attributed by `python_module`
//   /extensions             what JS each pack serves
//   /zeninspector/inspect   disk truth, incl. packs that never imported (see inspect_api.py)
//   the live page           what actually registered (app.extensions, LiteGraph, the graph)
//   window.ZenKit.plugins   ZenKit's own surface ledger
//
// Every source is optional. A missing one narrows what we can claim, and `Snapshot.sources`
// records which were reachable so the UI can say "couldn't check" instead of "broken".
import type { RegisteredPlugin, ZenKitApi } from '@nynxz/zenkit-client'
import { extensionNames, getJson, graphNodeTypes, registeredNodeTypes } from './host'
import {
  EMPTY_SNAPSHOT,
  HEALTH_RANK,
  type Health,
  type Issue,
  type IssueLevel,
  type NodeRow,
  type Pack,
  type PackSource,
  type PyPack,
  type Snapshot,
  type WebFile,
} from './types'

/* ── source payloads ───────────────────────────────────────────────────────────────── */

interface NodeDef {
  display_name?: string
  category?: string
  description?: string
  python_module?: string
  input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> }
  output?: unknown
  output_node?: boolean
  deprecated?: boolean
  experimental?: boolean
  api_node?: boolean
}

/** Synthetic pack keys. `@`-prefixed so they can never collide with a folder name. */
const CORE = '@core'
const EXTRAS = '@extras'
const API_NODES = '@api-nodes'
const FRONTEND = '@frontend'

const CORE_LABELS: Record<string, string> = {
  [CORE]: 'ComfyUI Core',
  [EXTRAS]: 'ComfyUI Extras',
  [API_NODES]: 'ComfyUI API Nodes',
  [FRONTEND]: 'ComfyUI Frontend',
}

/** `python_module` → owning pack. Core ships nodes under several module roots; they're
 *  bucketed rather than listed as dozens of one-node "packs". */
function classify(pm: string): { key: string; label: string; source: PackSource } {
  if (pm === 'nodes') return { key: CORE, label: CORE_LABELS[CORE], source: 'core' }
  if (pm.startsWith('comfy_extras'))
    return { key: EXTRAS, label: CORE_LABELS[EXTRAS], source: 'core' }
  if (pm.startsWith('comfy_api_nodes'))
    return { key: API_NODES, label: CORE_LABELS[API_NODES], source: 'core' }
  if (pm.startsWith('custom_nodes.')) {
    const key = pm.slice('custom_nodes.'.length)
    return { key, label: key, source: 'custom' }
  }
  return { key: pm, label: pm, source: 'core' }
}

/* ── name matching ─────────────────────────────────────────────────────────────────── */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
/** Drop a leading comfy/comfyui so `ComfyUI-ZenKit`, `comfyui_zenkit` and `zenkit` all
 *  reduce to the same token — the folder / pyproject name / extension name for one pack
 *  routinely disagree on that prefix (and on case, and on the separator). */
const bare = (s: string) => norm(s).replace(/^comfyui?/, '')

const ALIAS_MIN = 4 // shorter aliases match everything; not worth the false positives

/* ── nodes ─────────────────────────────────────────────────────────────────────────── */

function outputsOf(def: NodeDef): string[] {
  const raw = def.output
  if (!Array.isArray(raw)) return typeof raw === 'string' ? [raw] : []
  return raw.map((o) => (typeof o === 'string' ? o : Array.isArray(o) ? 'COMBO' : String(o)))
}

function toRow(
  cls: string,
  def: NodeDef,
  pack: string,
  lg: Set<string> | null,
  graph: Map<string, number>,
): NodeRow {
  return {
    cls,
    display: def.display_name || cls,
    category: def.category || '',
    description: def.description || '',
    pythonModule: def.python_module || 'nodes',
    pack,
    inputsRequired: Object.keys(def.input?.required ?? {}).length,
    inputsOptional: Object.keys(def.input?.optional ?? {}).length,
    outputs: outputsOf(def),
    outputNode: def.output_node === true,
    deprecated: def.deprecated === true,
    experimental: def.experimental === true,
    apiNode: def.api_node === true,
    clientRegistered: lg ? lg.has(cls) : null,
    inGraph: graph.get(cls) ?? 0,
    def,
  }
}

/* ── scan ──────────────────────────────────────────────────────────────────────────── */

export async function scan(zen: ZenKitApi | null): Promise<Snapshot> {
  const sources = { ...EMPTY_SNAPSHOT.sources }

  // Three independent requests — one being down must not cost us the other two.
  const [defsRes, extRes, pyRes] = await Promise.allSettled([
    getJson<Record<string, NodeDef>>('/object_info'),
    getJson<string[]>('/extensions'),
    getJson<{ ok?: boolean; packs?: PyPack[] }>('/zeninspector/inspect'),
  ])

  const defs = defsRes.status === 'fulfilled' && defsRes.value ? defsRes.value : {}
  sources.objectInfo = defsRes.status === 'fulfilled' ? 'ok' : 'error'

  const extFiles = extRes.status === 'fulfilled' && Array.isArray(extRes.value) ? extRes.value : []
  sources.extensions = extRes.status === 'fulfilled' ? 'ok' : 'error'

  const pyPacks: PyPack[] =
    pyRes.status === 'fulfilled' && Array.isArray(pyRes.value?.packs) ? pyRes.value.packs : []
  sources.backend =
    pyRes.status === 'fulfilled' ? (pyRes.value?.ok === false ? 'error' : 'ok') : 'absent'

  const lg = registeredNodeTypes()
  sources.litegraph = lg !== null
  const graph = graphNodeTypes()
  const zenPlugins: RegisteredPlugin[] = zen?.plugins.registered() ?? []
  sources.zen = !!zen

  /* packs ------------------------------------------------------------------------- */
  const packs = new Map<string, Pack>()
  const ensure = (key: string, label: string, source: PackSource): Pack => {
    let p = packs.get(key)
    if (!p) {
      p = {
        key,
        label,
        source,
        state: 'unknown',
        pythonModules: [],
        nodes: [],
        web: [],
        extensions: [],
        zen: null,
        py: null,
        issues: [],
        health: 'ok',
      }
      packs.set(key, p)
    }
    return p
  }

  // 1. every registered node, attributed by python_module
  const nodes: NodeRow[] = []
  for (const [cls, def] of Object.entries(defs)) {
    const pm = def?.python_module || 'nodes'
    const { key, label, source } = classify(pm)
    const pack = ensure(key, label, source)
    if (!pack.pythonModules.includes(pm)) pack.pythonModules.push(pm)
    const row = toRow(cls, def ?? {}, key, lg, graph)
    pack.nodes.push(row)
    nodes.push(row)
  }

  // 2. disk truth — the only source that can report a pack which failed to import
  for (const py of pyPacks) {
    const pack = ensure(py.module, py.module, 'custom')
    pack.py = py
    // /object_info attributing a node to this pack is proof it imported, whichever way the
    // backend read the loader's bookkeeping. Trust the stronger evidence rather than
    // reporting "import failed" next to a list of the nodes it registered.
    pack.state = py.state === 'failed' && pack.nodes.length ? 'loaded' : py.state
    pack.path = py.path
    pack.git = py.git
    pack.version = py.project?.version
    pack.description = py.project?.description
    if (py.project?.display_name) pack.label = py.project.display_name
    if (!pack.pythonModules.includes(py.python_module)) pack.pythonModules.push(py.python_module)
  }

  // 3. served JS → pack, by web-dir name. `/extensions/core/…` is the built-in frontend's.
  const webByDir = new Map<string, WebFile[]>()
  for (const url of extFiles) {
    const m = /^\/extensions\/([^/]+)\//.exec(url)
    if (!m) continue
    const dir = decodeURIComponent(m[1])
    const list = webByDir.get(dir) ?? []
    list.push({ url, dir })
    webByDir.set(dir, list)
  }

  // Exact first: the backend tells us which EXTENSION_WEB_DIRS names each pack owns, which
  // beats guessing — the key is the pyproject name and routinely differs from the folder.
  const claimed = new Set<string>()
  for (const py of pyPacks) {
    for (const w of py.web ?? []) {
      const files = webByDir.get(w.name)
      if (!files) continue
      packs.get(py.module)?.web.push(...files)
      claimed.add(w.name)
    }
  }
  for (const [dir, files] of webByDir) {
    if (claimed.has(dir)) continue
    if (dir === 'core') {
      ensure(FRONTEND, CORE_LABELS[FRONTEND], 'frontend').web.push(...files)
      continue
    }
    // No backend (or a dir it didn't attribute): fall back to matching the URL segment
    // against pack names. A dir we still can't place becomes a pack in its own right —
    // it IS serving code, so it belongs in the list.
    const hit = [...packs.values()].find(
      (p) => p.source === 'custom' && (bare(p.key) === bare(dir) || bare(p.label) === bare(dir)),
    )
    ;(hit ?? ensure(dir, dir, 'custom')).web.push(...files)
  }

  // 4. ZenKit ledger, by the plugin's canonical id
  for (const zp of zenPlugins) {
    const hit = [...packs.values()].find(
      (p) =>
        p.py?.project?.zenkit_id === zp.id ||
        (p.source === 'custom' && (bare(p.key) === bare(zp.id) || bare(p.label) === bare(zp.id))),
    )
    const pack = hit ?? ensure(zp.id, zp.name, 'custom')
    pack.zen = zp
    if (!pack.version) pack.version = zp.version
    if (!pack.description) pack.description = zp.description
  }

  // 5. frontend extensions that actually registered. `Comfy.*` are the built-in frontend's;
  //    the rest are matched to packs by name — a heuristic, and labelled as one in the UI.
  const aliases = new Map<string, string>() // alias → pack key ('' marks it ambiguous)
  for (const p of packs.values()) {
    if (p.source !== 'custom') continue
    const raw = [
      p.key,
      p.label,
      p.py?.project?.name,
      p.py?.project?.display_name,
      p.py?.project?.zenkit_id,
      p.zen?.id,
      p.zen?.name,
      ...p.web.map((w) => w.dir),
    ]
    for (const a of raw) {
      if (!a) continue
      for (const form of [norm(a), bare(a)]) {
        if (form.length < ALIAS_MIN) continue
        const prev = aliases.get(form)
        aliases.set(form, prev === undefined || prev === p.key ? p.key : '')
      }
    }
  }
  const orphanExtensions: string[] = []
  for (const name of extensionNames()) {
    if (name === 'Comfy' || name.startsWith('Comfy.')) {
      ensure(FRONTEND, CORE_LABELS[FRONTEND], 'frontend').extensions.push(name)
      continue
    }
    const parts = [
      norm(name),
      bare(name),
      ...name.split(/[.\-_/\s]+/).flatMap((s) => [norm(s), bare(s)]),
    ]
    let key: string | undefined
    for (const part of parts) {
      if (part.length < ALIAS_MIN) continue
      const hit = aliases.get(part)
      if (hit) {
        key = hit
        break
      }
    }
    if (key) packs.get(key)?.extensions.push(name)
    else orphanExtensions.push(name)
  }

  // 6. node types LiteGraph has that the server doesn't — Note, Reroute, PrimitiveNode and
  //    friends. Real nodes, just frontend-defined; listed so the explorer is complete.
  if (lg) {
    const fe = ensure(FRONTEND, CORE_LABELS[FRONTEND], 'frontend')
    for (const cls of lg) {
      if (cls in defs) continue
      const row: NodeRow = {
        cls,
        display: cls,
        category: '',
        description: '',
        pythonModule: '',
        pack: FRONTEND,
        inputsRequired: 0,
        inputsOptional: 0,
        outputs: [],
        outputNode: false,
        deprecated: false,
        experimental: false,
        apiNode: false,
        clientRegistered: true,
        inGraph: graph.get(cls) ?? 0,
        def: null,
      }
      fe.nodes.push(row)
      nodes.push(row)
    }
  }

  /* issues -------------------------------------------------------------------------- */
  const issues: Issue[] = []
  const add = (i: Issue) => {
    issues.push(i)
    return i
  }
  const list = (xs: string[], max = 6) =>
    xs.slice(0, max).join(', ') + (xs.length > max ? `, +${xs.length - max} more` : '')

  for (const p of packs.values()) {
    if (p.state === 'failed') {
      p.issues.push(
        add({
          level: 'error',
          pack: p.key,
          title: 'Import failed',
          detail:
            'ComfyUI tried to import this pack and it raised — none of its nodes, routes or web files are registered.',
          hint: 'The traceback is in the server log, just above "Cannot import … module for custom nodes".',
        }),
      )
    } else if (p.state === 'disabled') {
      p.issues.push(
        add({
          level: 'info',
          pack: p.key,
          title: 'Disabled',
          detail: 'The folder name ends in .disabled, so ComfyUI skips it entirely.',
        }),
      )
    }

    // Declared a class name that the registry gave to someone else.
    const shadowed = p.py?.shadowed ?? []
    if (shadowed.length) {
      const builtin = shadowed.filter((s) => !s.owner.startsWith('custom_nodes.'))
      p.issues.push(
        add({
          level: 'error',
          pack: p.key,
          title: `${shadowed.length} node class name${shadowed.length > 1 ? 's' : ''} lost to another pack`,
          detail:
            shadowed
              .slice(0, 6)
              .map((s) => `${s.class} → ${s.owner}`)
              .join(', ') + (shadowed.length > 6 ? `, +${shadowed.length - 6} more` : ''),
          hint: builtin.length
            ? 'Names that clash with a built-in are ignored outright — ComfyUI passes core class names to load_custom_node as the ignore set. Rename them.'
            : 'Two packs registered the same class name; the one that loaded last won. Rename to disambiguate.',
        }),
      )
    }

    // Server has the node, LiteGraph doesn't. Only claimable when LiteGraph was reachable.
    const unregistered = p.nodes.filter((n) => n.clientRegistered === false).map((n) => n.cls)
    if (unregistered.length) {
      p.issues.push(
        add({
          level: 'warn',
          pack: p.key,
          title: `${unregistered.length} node${unregistered.length > 1 ? 's' : ''} not registered client-side`,
          detail: list(unregistered),
          hint: 'The server will run these, but the frontend has no LiteGraph type for them — they cannot be added from the menu. Usually a frontend extension error; check the browser console.',
        }),
      )
    }

    if (p.state === 'loaded' && !p.nodes.length && !p.web.length) {
      p.issues.push(
        add({
          level: 'info',
          pack: p.key,
          title: 'Registers nothing',
          detail: 'Imported cleanly but contributes no nodes and serves no frontend files.',
          hint: 'Normal for a pack that only adds API routes or patches ComfyUI in place.',
        }),
      )
    }

    if (
      p.web.length &&
      !p.extensions.length &&
      sources.extensions === 'ok' &&
      extensionNames().length
    ) {
      p.issues.push(
        add({
          level: 'info',
          pack: p.key,
          title: 'Serves JS, but no frontend extension matched',
          detail: `${p.web.length} file${p.web.length > 1 ? 's' : ''} served; nothing in app.extensions matches this pack's name.`,
          hint: 'Attribution is by name, so this may just be an unrelated extension name — but it also looks like this if the script threw before registerExtension.',
        }),
      )
    }

    p.health = p.issues.reduce<Health>(
      (h, i) => (HEALTH_RANK[i.level] > HEALTH_RANK[h] ? i.level : h),
      'ok',
    )
  }

  // Install-wide: node types the open workflow uses that nothing provides.
  const missing = [...graph.keys()].filter((t) => !(t in defs) && !(lg?.has(t) ?? true))
  if (missing.length) {
    add({
      level: 'error',
      pack: null,
      title: `${missing.length} missing node type${missing.length > 1 ? 's' : ''} in the open workflow`,
      detail: list(missing),
      hint: 'The workflow references types no installed pack provides — the pack is missing, failed to import, or renamed its classes.',
    })
  }

  // Two packs, one display name — the search menu shows both and neither is identifiable.
  const byDisplay = new Map<string, NodeRow[]>()
  for (const n of nodes) {
    if (!n.display || n.pack === FRONTEND) continue
    const l = byDisplay.get(n.display) ?? []
    l.push(n)
    byDisplay.set(n.display, l)
  }
  const dupes = [...byDisplay.entries()].filter(
    ([, rows]) => new Set(rows.map((r) => r.pack)).size > 1,
  )
  if (dupes.length) {
    add({
      level: 'info',
      pack: null,
      title: `${dupes.length} display name${dupes.length > 1 ? 's' : ''} used by more than one pack`,
      detail: list(dupes.map(([d]) => d)),
      hint: 'Both show up under the same label in the node search — harmless, but confusing to pick between.',
    })
  }

  /* order + stats ------------------------------------------------------------------- */
  const SOURCE_ORDER: Record<PackSource, number> = { custom: 0, core: 1, frontend: 2 }
  const out = [...packs.values()].sort(
    (a, b) =>
      SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
      HEALTH_RANK[b.health] - HEALTH_RANK[a.health] ||
      a.label.localeCompare(b.label),
  )
  for (const p of out) p.nodes.sort((a, b) => a.cls.localeCompare(b.cls))
  nodes.sort((a, b) => a.cls.localeCompare(b.cls))

  const custom = out.filter((p) => p.source === 'custom')
  return {
    packs: out,
    nodes,
    issues: issues.sort((a, b) => level(b.level) - level(a.level)),
    orphanExtensions,
    sources,
    stats: {
      packs: out.length,
      custom: custom.length,
      nodes: nodes.length,
      customNodes: custom.reduce((n, p) => n + p.nodes.length, 0),
      failed: custom.filter((p) => p.state === 'failed').length,
      errors: issues.filter((i) => i.level === 'error').length,
      warnings: issues.filter((i) => i.level === 'warn').length,
    },
    scannedAt: Date.now(),
  }
}

const level = (l: IssueLevel) => HEALTH_RANK[l]
