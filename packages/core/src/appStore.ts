// App router store: full-screen apps that cover the graph + a built-in namespaced
// router. Sibling to panelStore (the window manager); this is the "which app/route
// is showing" model. Open apps run like windows: each keeps its own location and
// history and a taskbar chip, one shows at a time (or none: the graph), and a
// minimized app stays running until it is closed. Apps register async as their
// plugin bundle loads, so a saved location restores on register — the same pattern
// panelStore.register() uses for panels.
//
// Routes are PLUGIN-NAMESPACED: an app's routing key is '<namespace>/<id>' where the
// namespace is the owning plugin's (explicit `namespace`, else a slug of its display
// `plugin` name). So ZenDatasets' `datasets` app lives at 'zendatasets/datasets', and
// everything (open/navigate/restore) flows through that. Apps with no plugin namespace
// fall back to a bare '<id>' key. Resolution matches the registry (a key may be 1 or 2
// segments) rather than blindly splitting the first slash.

import { markRaw, reactive, type InjectionKey } from 'vue'
import type { ZenBus } from './bus'
import { zlog } from './log'
import type { AppLocation, AppRegistration, AppRoute, AppRouter, AppHandle } from './types'

const APPS_LS = 'zenkit.apps.v1' // the active location and the running apps (full paths)
const STATE_LS = 'zenkit.appstate.v1' // per-app persisted blob (RouteContext.state)
const URLSYNC_LS = 'zenkit.appurlsync.v1' // opt-in: mirror the route into location.hash

const GRAPH: AppLocation = { app: null, path: '', route: '', params: {}, query: {} }

// ── Namespacing ────────────────────────────────────────────────────────────
// A plugin's route namespace: explicit `namespace`, else a slug of its display `plugin`
// name ("Zen Datasets" → "zendatasets"). Empty when the app belongs to no plugin.
const slug = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
function nsOf(reg: { namespace?: string; plugin?: string }): string {
  const explicit = reg.namespace?.trim()
  return explicit || (reg.plugin ? slug(reg.plugin) : '')
}
/** The app's unique routing key: '<namespace>/<id>' (e.g. 'zendatasets/datasets'), or
 *  just '<id>' when the app has no namespace. Exported so ZenApp/ZenTaskbar resolve the
 *  same key the store uses — one definition, no divergence. */
export function keyOf(reg: { id: string; namespace?: string; plugin?: string }): string {
  const ns = nsOf(reg)
  return ns ? ns + '/' + reg.id : reg.id
}

// Split a full path into its query and the clean base (no '?...'). The base is a global
// path of the form '<namespace>/<id>/<route>' — the app prefix is resolved separately
// against the registry, since a key can be one or two segments.
function splitQuery(input: string): { base: string; query: Record<string, string> } {
  let raw = (input || '').trim()
  if (raw.startsWith('/')) raw = raw.slice(1)
  const query: Record<string, string> = {}
  const qi = raw.indexOf('?')
  if (qi >= 0) {
    new URLSearchParams(raw.slice(qi + 1)).forEach((v, k) => (query[k] = v))
    raw = raw.slice(0, qi)
  }
  return { base: raw, query }
}

// Rebuild a full path from a location (sans params). `loc.app` is the routing key.
function locToPath(loc: AppLocation): string {
  if (!loc.app) return ''
  const p = loc.app + (loc.path ? '/' + loc.path : '')
  const qs = new URLSearchParams(loc.query).toString()
  return qs ? p + '?' + qs : p
}

// A route path or ":param" segment, decoded; a malformed escape (a bad stored route or #zen=
// hash) stays raw rather than throwing during boot.
function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

// Match a clean route path (no query) against an app's route patterns. ':param'
// segments capture into params. Exported so ZenApp resolves the same AppRoute the
// store used to fill params — one matcher, no divergence.
export function matchRoute(
  routes: AppRoute[],
  path: string,
): { route: AppRoute; params: Record<string, string> } | null {
  const segs = path.split('/').filter(Boolean)
  for (const route of routes) {
    const pat = route.path.split('/').filter(Boolean)
    if (pat.length !== segs.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < pat.length; i++) {
      const p = pat[i]
      if (p.startsWith(':')) params[p.slice(1)] = decodeSegment(segs[i])
      else if (p !== segs[i]) {
        ok = false
        break
      }
    }
    if (ok) return { route, params }
  }
  return null
}

// ComfyUI's frontend (the subgraph-router release onward) claims window.location.hash for
// its own subgraph deep-linking: it watches every hashchange and treats the whole hash as
// a subgraph id, bouncing anything it doesn't recognise back to the root graph (logging
// "[subgraphNavigation] subgraph not found: …; redirecting to root graph"). So we never
// mirror into the hash there. App routing is internal by default anyway (in-memory stack +
// localStorage restore); URL sync is an explicit opt-out-of-default for standalone use.
function hashOwnedByHost(): boolean {
  try {
    const w = window as unknown as {
      comfyAPI?: unknown
      app?: { graph?: unknown; canvas?: unknown }
    }
    // comfyAPI = ComfyUI's module registry; app.graph/canvas = the live litegraph app.
    return !!(w.comfyAPI || w.app?.graph || w.app?.canvas)
  } catch {
    return false
  }
}

export type AppStore = ReturnType<typeof createAppStore>
export const APP_STORE_KEY: InjectionKey<AppStore> = Symbol('zenkit-apps')

const HISTORY_MAX = 50

/** One app's own back/forward stack of full paths. */
interface History {
  stack: string[]
  index: number
}

export function createAppStore(bus: ZenBus) {
  const state = reactive({
    registry: [] as AppRegistration[],
    active: { ...GRAPH } as AppLocation,
    /** Every open app, in taskbar order, at its current (active) or last (minimized) location. */
    running: [] as AppLocation[],
    /** Running apps whose surface has been shown this session, so it stays mounted. A restored
     *  chip mounts only when it is first shown. */
    mounted: [] as string[],
    /** The running app last minimized: what restore() with no id brings back. */
    lastMinimized: null as string | null,
    history: {} as Record<string, History>,
    urlSync: false, // OFF by default — routing is internal; no URL hash (ComfyUI owns it)
  })
  try {
    // Explicit opt-in only, and never when the host owns the hash.
    if (!hashOwnedByHost() && localStorage.getItem(URLSYNC_LS) === '1') state.urlSync = true
  } catch {
    /* ignore */
  }

  // A target we want to be at but whose app isn't registered yet (restore, or a navigate
  // that raced ahead of the plugin). Resolved in register(). Saved running apps wait the same
  // way, to come back as chips.
  const hashPath = (): string | null => {
    const m = /^#zen=(.*)$/.exec(location.hash)
    return m ? decodeSegment(m[1]) : null
  }
  const loadSaved = (): { path: string | null; running: string[] } => {
    try {
      const saved = JSON.parse(localStorage.getItem(APPS_LS) || 'null') || {}
      return {
        path: saved.path || null,
        running: Array.isArray(saved.running) ? saved.running.filter(Boolean) : [],
      }
    } catch {
      return { path: null, running: [] }
    }
  }
  const saved = loadSaved()
  let pending: string | null = (state.urlSync && hashPath()) || saved.path
  let pendingRunning: string[] = saved.running

  // Resolve a clean base path → which registered app owns it + the in-app route remainder.
  // Matches the longest registered key that is a segment-prefix of the path; falls back to
  // a unique bare-id match so open('datasets') works even though the key is 'x/datasets'.
  function resolveApp(base: string): { reg: AppRegistration; rest: string } | null {
    const segs = base.split('/').filter(Boolean)
    if (!segs.length) return null
    let best: { reg: AppRegistration; rest: string; n: number } | null = null
    for (const reg of state.registry) {
      const k = keyOf(reg).split('/').filter(Boolean)
      if (k.length > segs.length) continue
      if (k.every((s, i) => s === segs[i]) && (!best || k.length > best.n)) {
        best = { reg, rest: segs.slice(k.length).join('/'), n: k.length }
      }
    }
    if (best) return { reg: best.reg, rest: best.rest }
    const byId = state.registry.filter((r) => r.id === segs[0])
    return byId.length === 1 ? { reg: byId[0], rest: segs.slice(1).join('/') } : null
  }

  /** Apps in workspace tiles (set by workspaces): their routes move them where they are, never
   *  full screen, and opening one shows its workspace. */
  let tiles: { has(key: string): boolean; reveal(key: string): void } = {
    has: () => false,
    reveal: () => {},
  }

  const regOf = (key: string | null | undefined) =>
    key ? (state.registry.find((r) => keyOf(r) === key) ?? null) : null
  /** A routing key from a key or a bare id (unique among the registered apps). */
  const keyFor = (idOrKey: string): string => {
    const byId = state.registry.filter((r) => r.id === idOrKey)
    const reg = regOf(idOrKey) ?? (byId.length === 1 ? byId[0] : null)
    return reg ? keyOf(reg) : idOrKey
  }
  const runningOf = (key: string) => state.running.find((l) => l.app === key) ?? null

  const save = () => {
    try {
      const persists = (loc: AppLocation) => regOf(loc.app)?.persist !== false
      localStorage.setItem(
        APPS_LS,
        JSON.stringify({
          path: state.active.app && persists(state.active) ? locToPath(state.active) : null,
          running: state.running.filter(persists).map(locToPath),
        }),
      )
    } catch {
      /* ignore */
    }
  }

  const loadStates = (): Record<string, unknown> => {
    try {
      return JSON.parse(localStorage.getItem(STATE_LS) || '{}') || {}
    } catch {
      return {}
    }
  }
  const getState = (appKey: string) => loadStates()[appKey]
  const setState = (appKey: string, blob: unknown) => {
    const all = loadStates()
    all[appKey] = blob
    try {
      localStorage.setItem(STATE_LS, JSON.stringify(all))
    } catch {
      /* quota / serialization — best effort */
    }
  }

  /** Put `loc` on its running entry (adding the app to the taskbar when it is new). */
  function track(loc: AppLocation) {
    const i = state.running.findIndex((l) => l.app === loc.app)
    if (i === -1) state.running.push(loc)
    else state.running.splice(i, 1, loc)
  }

  function setActive(loc: AppLocation) {
    const left = state.active.app
    if (left && left !== loc.app && runningOf(left)) state.lastMinimized = left
    if (loc.app && runningOf(loc.app)) {
      if (!state.mounted.includes(loc.app)) state.mounted.push(loc.app)
      if (state.lastMinimized === loc.app) state.lastMinimized = null
    }
    state.active = loc
    save()
    bus.emit('app:change', loc)
  }

  /** Record `fullPath` in its app's history: push a new entry, replace the current one, or
   *  'none' when moving within the history itself (back/forward, restore). */
  function record(key: string, fullPath: string, how: 'push' | 'replace' | 'none') {
    const h = (state.history[key] ??= { stack: [], index: -1 })
    if (how === 'none' && h.index >= 0) return
    if (how === 'replace' && h.index >= 0) {
      h.stack[h.index] = fullPath
      return
    }
    if (h.stack[h.index] === fullPath) return
    h.stack = h.stack.slice(Math.max(0, h.index + 2 - HISTORY_MAX), h.index + 1)
    h.stack.push(fullPath)
    h.index = h.stack.length - 1
  }

  // Resolve a full path into the active location, recording it in its app's history.
  function applyLocation(fullPath: string, how: 'push' | 'replace' | 'none') {
    const { base, query } = splitQuery(fullPath)
    if (!base) {
      pending = null
      setActive({ ...GRAPH })
      return
    }
    const found = resolveApp(base)
    if (!found) {
      // app not loaded yet — hold the full path; register() resolves once its plugin lands.
      // Provisional active keeps the surface up and round-trips through locToPath so a save
      // during this window doesn't lose the route.
      const segs = base.split('/').filter(Boolean)
      pending = fullPath
      setActive({
        app: segs[0] ?? '',
        path: segs.slice(1).join('/'),
        route: '',
        params: {},
        query,
      })
      return
    }
    pending = null
    const key = keyOf(found.reg)
    // exact route match, else fall back to the app's home route; if neither matches we
    // still set the path (ZenApp shows a "route not found" notice).
    const exact = matchRoute(found.reg.routes, found.rest)
    const fallback = exact ? null : matchRoute(found.reg.routes, found.reg.home ?? '')
    const m = exact ?? fallback
    const loc: AppLocation = {
      app: key,
      path: exact ? found.rest : fallback ? (found.reg.home ?? '') : found.rest,
      route: m?.route.path ?? '',
      params: m?.params ?? {},
      query,
    }
    record(key, locToPath(loc), how)
    track(loc)
    if (tiles.has(key) && state.active.app !== key) {
      save()
      bus.emit('app:change', loc)
      return
    }
    setActive(loc)
  }

  // Mirror a path into the URL hash WITHOUT firing hashchange (replaceState) — used to
  // reflect state the router already applied. Only ever called when urlSync is ON.
  function syncHashSilently(path: string) {
    const h = path ? '#zen=' + encodeURIComponent(path) : ''
    try {
      window.history.replaceState(null, '', location.pathname + location.search + h)
    } catch {
      /* ignore */
    }
  }

  function onHash() {
    if (!state.urlSync) return
    applyLocation(hashPath() ?? '', 'push')
  }
  if (state.urlSync) window.addEventListener('hashchange', onHash)

  // Build the full global path for an app-relative or absolute route string. `appKey` is
  // the app's routing key ('<namespace>/<id>'); a leading '/' means an absolute global path.
  function resolveFor(appKey: string, p: string): string {
    if (p.startsWith('/')) return p.slice(1)
    return appKey + (p ? '/' + p : '')
  }

  function navigate(
    fullPath: string,
    opts?: { query?: Record<string, string>; replace?: boolean },
  ) {
    let norm = (fullPath || '').trim()
    if (norm.startsWith('/')) norm = norm.slice(1)
    if (opts?.query && Object.keys(opts.query).length) {
      const qs = new URLSearchParams(opts.query).toString()
      norm = norm.split('?')[0] + (qs ? '?' + qs : '')
    }
    if (state.urlSync) {
      // the browser's hash history is the stack: pushing the hash records an entry
      // (and fires hashchange → applyLocation); replace uses replaceState + apply.
      if (opts?.replace) {
        syncHashSilently(norm)
        applyLocation(norm, 'replace')
      } else {
        const next = norm ? '#zen=' + encodeURIComponent(norm) : ''
        if (location.hash === next)
          applyLocation(norm, 'push') // no hashchange when unchanged
        else location.hash = next
      }
    } else {
      applyLocation(norm, opts?.replace ? 'replace' : 'push')
    }
  }

  /** Step through `key`'s own history. Moving an app that isn't showing only updates where it
   *  waits on the taskbar. */
  function step(key: string, by: -1 | 1) {
    const h = state.history[key]
    if (!h || h.index + by < 0 || h.index + by >= h.stack.length) return
    h.index += by
    const path = h.stack[h.index]
    if (state.active.app === key) applyLocation(path, 'none')
    else {
      const { base, query } = splitQuery(path)
      const found = resolveApp(base)
      if (!found) return
      const m = matchRoute(found.reg.routes, found.rest)
      const loc: AppLocation = {
        app: key,
        path: found.rest,
        route: m?.route.path ?? '',
        params: m?.params ?? {},
        query,
      }
      track(loc)
      save()
      bus.emit('app:change', loc)
    }
  }
  const canStep = (key: string | null, by: -1 | 1) => {
    const h = key ? state.history[key] : undefined
    return !!h && h.index + by >= 0 && h.index + by < h.stack.length
  }

  function makeRouter(appKey: string): AppRouter {
    return {
      go: (p, opts) => navigate(resolveFor(appKey, p), opts),
      back: () => step(appKey, -1),
      forward: () => step(appKey, 1),
      location: () => ({ ...(runningOf(appKey) ?? GRAPH) }),
      on: (cb) =>
        bus.on('app:change', (x) => {
          const loc = x as AppLocation
          if (loc.app === appKey) cb(loc)
        }),
    }
  }

  function makeHandle(appKey: string): AppHandle {
    return { id: appKey, router: makeRouter(appKey), close: () => close(appKey) }
  }

  // Open by app id OR full key. Bare ids resolve to their (unique) key for ergonomics. A
  // running app comes back where it was unless a route is asked for.
  function open(
    idOrKey: string,
    opts?: { path?: string; query?: Record<string, string> },
  ): AppHandle {
    const key = keyFor(idOrKey)
    const reg = regOf(key)
    if (opts?.path === undefined && !opts?.query && restore(key)) return makeHandle(key)
    const route = opts?.path ?? reg?.home ?? ''
    navigate(resolveFor(key, route.replace(/^\//, '')), { query: opts?.query })
    if (tiles.has(key)) tiles.reveal(key)
    return makeHandle(key)
  }

  /** Back to the graph; the active app keeps running on the taskbar. */
  function minimize() {
    if (state.active.app) navigate('')
  }

  /** Show a running app at the location it was left. */
  function restore(idOrKey?: string): boolean {
    const loc = runningOf(idOrKey ? keyFor(idOrKey) : (state.lastMinimized ?? ''))
    if (!loc?.app) return false
    if (tiles.has(loc.app)) {
      tiles.reveal(loc.app)
      return true
    }
    if (state.active.app === loc.app) return true
    if (state.urlSync) navigate(locToPath(loc))
    else applyLocation(locToPath(loc), 'none')
    return true
  }

  /** Run an app in a workspace tile: running and mounted where it was (its home route when new),
   *  without showing it full screen. */
  function runTiled(key: string) {
    const reg = regOf(key)
    if (!reg) return
    if (!runningOf(key)) {
      const home = reg.home ?? ''
      const m = matchRoute(reg.routes, home)
      const loc: AppLocation = {
        app: key,
        path: home,
        route: m?.route.path ?? '',
        params: m?.params ?? {},
        query: {},
      }
      record(key, locToPath(loc), 'push')
      track(loc)
      save()
    }
    if (!state.mounted.includes(key)) state.mounted.push(key)
  }

  /** Stop an app: off the taskbar, its surface unmounted, its history dropped. */
  function close(idOrKey?: string) {
    const target = idOrKey ? keyFor(idOrKey) : state.active.app
    if (!target) return
    state.running = state.running.filter((l) => l.app !== target)
    state.mounted = state.mounted.filter((k) => k !== target)
    delete state.history[target]
    if (state.lastMinimized === target) state.lastMinimized = null
    if (state.active.app === target) navigate('')
    else save()
  }

  function back() {
    if (state.urlSync) window.history.back()
    else if (state.active.app) step(state.active.app, -1)
  }
  function forward() {
    if (state.urlSync) window.history.forward()
    else if (state.active.app) step(state.active.app, 1)
  }

  function setUrlSync(on: boolean) {
    if (on && hashOwnedByHost()) {
      zlog('app url-sync left off: the host (ComfyUI) owns location.hash')
      on = false
    }
    state.urlSync = !!on
    try {
      localStorage.setItem(URLSYNC_LS, on ? '1' : '0')
    } catch {
      /* ignore */
    }
    if (on) {
      window.addEventListener('hashchange', onHash)
      syncHashSilently(locToPath(state.active)) // reflect where we already are
    } else {
      window.removeEventListener('hashchange', onHash)
      if (/^#zen=/.test(location.hash)) {
        try {
          window.history.replaceState(null, '', location.pathname + location.search)
        } catch {
          /* ignore */
        }
      }
    }
  }

  function register(reg: AppRegistration): () => void {
    // Re-registering a key replaces it, like panels.register; each registration's unregister
    // only removes its own entry.
    const entry = markRaw(reg)
    const key = keyOf(reg)
    const existing = state.registry.findIndex((r) => keyOf(r) === key)
    if (existing === -1) {
      state.registry.push(entry)
      zlog(`registered app "${reg.title}" — ${key}` + (reg.plugin ? ` · ${reg.plugin}` : ''))
    } else {
      state.registry.splice(existing, 1, entry)
    }
    bus.emit('app:registry')

    // Restore: saved running apps come back as chips, and a saved/pending location targeting
    // this app shows it.
    if (reg.persist !== false) {
      const mine = (p: string) => {
        const found = resolveApp(splitQuery(p).base)
        return !!found && keyOf(found.reg) === key
      }
      for (const p of pendingRunning.filter(mine)) {
        const { base, query } = splitQuery(p)
        const rest = resolveApp(base)!.rest
        const m = matchRoute(reg.routes, rest)
        record(key, p, 'push')
        if (!runningOf(key))
          track({
            app: key,
            path: rest,
            route: m?.route.path ?? '',
            params: m?.params ?? {},
            query,
          })
      }
      pendingRunning = pendingRunning.filter((p) => !mine(p))
      if (pending && mine(pending)) {
        const target = pending
        applyLocation(target, 'none')
        if (state.urlSync) syncHashSilently(target) // reflect without a second nav
      }
    }
    return () => {
      const i = state.registry.indexOf(entry)
      if (i < 0) return // already replaced by a newer registration of the same key
      state.registry.splice(i, 1)
      bus.emit('app:registry')
      close(key)
    }
  }

  return {
    state,
    register,
    registered: () => state.registry.slice(),
    open,
    minimize,
    close,
    restore,
    runTiled,
    setTiles: (next: typeof tiles) => (tiles = next),
    running: (): AppLocation[] => state.running.map((l) => ({ ...l })),
    minimized: (): AppLocation | null => {
      const loc = state.lastMinimized ? runningOf(state.lastMinimized) : null
      return loc ? { ...loc } : null
    },
    current: () => state.active.app,
    navigate: (p: string, opts?: { query?: Record<string, string>; replace?: boolean }) =>
      navigate(p, opts),
    back,
    forward,
    location: (): AppLocation => ({ ...state.active }),
    on: (cb: (loc: AppLocation) => void) => bus.on('app:change', (x) => cb(x as AppLocation)),
    setUrlSync,
    // internal helpers for the Vue surfaces
    keyOf,
    regOf,
    runningOf,
    canStep,
    makeRouter,
    getState,
    setState,
  }
}
