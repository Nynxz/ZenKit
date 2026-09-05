// The Inspector's data model — one normalized shape over five disagreeing sources
// (/object_info, /extensions, /zeninspector/inspect, the live page, ZenKit's ledger).
// See scan.ts for how they're joined.
import type { RegisteredPlugin } from '@nynxz/zenkit-client'

/** Where a pack's code comes from. Drives the top-level source filter. */
export type PackSource = 'custom' | 'core' | 'frontend'

/** Worst issue level found on a pack. `ok` means nothing to report. */
export type Health = 'ok' | 'info' | 'warn' | 'error'

/** Import outcome, as reported by the backend route. `unknown` = backend unavailable. */
export type PackState = 'loaded' | 'failed' | 'disabled' | 'unknown'

export const HEALTH_RANK: Record<Health, number> = { ok: 0, info: 1, warn: 2, error: 3 }

/* ── nodes ─────────────────────────────────────────────────────────────────────────── */

/** One entry of `/object_info`, plus what the live page knows about it. */
export interface NodeRow {
  cls: string
  display: string
  category: string
  description: string
  pythonModule: string
  pack: string
  inputsRequired: number
  inputsOptional: number
  outputs: string[]
  outputNode: boolean
  deprecated: boolean
  experimental: boolean
  apiNode: boolean
  /** Present in `LiteGraph.registered_node_types`. `null` when LiteGraph is unreachable
   *  — an unknown, which must NOT be rendered as a failure. */
  clientRegistered: boolean | null
  /** Instances of this type in the currently open workflow. */
  inGraph: number
  /** Raw `/object_info` entry, for the Raw tab. */
  def: unknown
}

/* ── issues ────────────────────────────────────────────────────────────────────────── */

export type IssueLevel = 'error' | 'warn' | 'info'

export interface Issue {
  level: IssueLevel
  /** Owning pack key, or null for install-wide issues. */
  pack: string | null
  title: string
  detail: string
  /** What to do about it. Shown as the dimmed second line. */
  hint?: string
}

/* ── packs ─────────────────────────────────────────────────────────────────────────── */

/** A JS file served for a pack, as returned by `/extensions`. */
export interface WebFile {
  /** URL path, e.g. `/extensions/ComfyUI-ZenKit/main.js`. */
  url: string
  /** The `/extensions/<dir>/…` segment — the EXTENSION_WEB_DIRS key. */
  dir: string
}

/** Backend `/zeninspector/inspect` pack record. */
export interface PyPack {
  module: string
  python_module: string
  path: string
  kind: 'dir' | 'file'
  state: Exclude<PackState, 'unknown'>
  web: { name: string; path: string }[]
  project: {
    name?: string
    version?: string
    description?: string
    publisher?: string
    display_name?: string
    zenkit_id?: string
    error?: string
  }
  git: { branch?: string; commit?: string; repo?: string }
  /** Class names the pack's own NODE_CLASS_MAPPINGS declares. */
  declared: string[]
  /** Class names the global registry actually attributes to it. */
  nodes: string[]
  /** Declared but won by someone else — a name collision. */
  shadowed: { class: string; owner: string }[]
  /** Owned but never declared. Only computed for `v1` packs. */
  undeclared: string[]
  /** Which registration API the pack used: NODE_CLASS_MAPPINGS (`v1`) or
   *  `comfy_entrypoint` / `get_node_list()` (`v3`). `none` = registers no nodes. */
  style: 'v1' | 'v3' | 'none'
}

/** One nodepack / extension, joined across every source. */
export interface Pack {
  /** Canonical key: the custom_nodes folder name, or a `@`-prefixed synthetic. */
  key: string
  label: string
  source: PackSource
  state: PackState
  /** Every `python_module` value seen for this pack (core buckets have many). */
  pythonModules: string[]
  nodes: NodeRow[]
  web: WebFile[]
  /** Frontend extension names (`app.extensions`) matched to this pack by name. */
  extensions: string[]
  zen: RegisteredPlugin | null
  py: PyPack | null
  issues: Issue[]
  health: Health
  version?: string
  description?: string
  path?: string
  git?: PyPack['git']
}

/* ── snapshot ──────────────────────────────────────────────────────────────────────── */

export type SourceState = 'ok' | 'absent' | 'error'

export interface Snapshot {
  packs: Pack[]
  nodes: NodeRow[]
  issues: Issue[]
  /** Frontend extensions we could not attribute to any pack. */
  orphanExtensions: string[]
  sources: {
    objectInfo: SourceState
    extensions: SourceState
    backend: SourceState
    /** LiteGraph reachable — gates every "registered client-side" claim. */
    litegraph: boolean
    zen: boolean
  }
  stats: {
    packs: number
    custom: number
    nodes: number
    customNodes: number
    failed: number
    errors: number
    warnings: number
  }
  scannedAt: number
}

export const EMPTY_SNAPSHOT: Snapshot = {
  packs: [],
  nodes: [],
  issues: [],
  orphanExtensions: [],
  sources: {
    objectInfo: 'absent',
    extensions: 'absent',
    backend: 'absent',
    litegraph: false,
    zen: false,
  },
  stats: { packs: 0, custom: 0, nodes: 0, customNodes: 0, failed: 0, errors: 0, warnings: 0 },
  scannedAt: 0,
}
