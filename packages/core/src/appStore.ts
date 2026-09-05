// App router store: full-screen apps that cover the graph + a built-in namespaced
// router. Sibling to panelStore (the window manager); this is the "which app/route
// is showing" model. One global location (the graph is the root); apps register
// async as their plugin bundle loads, so a saved location restores on register —
// the same pattern panelStore.register() uses for panels.
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

const APPS_LS = 'zenkit.apps.v1' // the active location (full path), for restore
const STATE_LS = 'zenkit.appstate.v1' // per-app persisted blob (RouteContext.state)
const URLSYNC_LS = 'zenkit.appurlsync.v1' // opt-in: mirror the route into location.hash

const GRAPH: AppLocation = { app: null, path: '', params: {}, query: {} }

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
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(segs[i])
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

export function createAppStore(bus: ZenBus) {
  const state = reactive({
    registry: [] as AppRegistration[],
    active: { ...GRAPH } as AppLocation,
    /** The app we dropped out of, if any — what the taskbar chip restores. */
    minimized: null as AppLocation | null,
    urlSync: false, // OFF by default — routing is internal; no URL hash (ComfyUI owns it)
  })
  try {
    // Explicit opt-in only, and never when the host owns the hash.
    if (!hashOwnedByHost() && localStorage.getItem(URLSYNC_LS) === '1') state.urlSync = true
  } catch {
    /* ignore */
  }

  // Internal history (authoritative unless urlSync is ON — then the browser's own hash
  // history is the stack and back/forward defer to it).
  let stack: string[] = ['']
  let sIndex = 0

  // A target we want to be at but whose app isn't registered yet (restore, or a navigate
  // that raced ahead of the plugin). Resolved in register().
  const hashPath = (): string | null => {
    const m = /^#zen=(.*)$/.exec(location.hash)
    return m ? decodeURIComponent(m[1]) : null
  }
  const loadSaved = (): string | null => {
    try {
      return (JSON.parse(localStorage.getItem(APPS_LS) || 'null') || {}).path || null
    } catch {
      return null
    }
  }
  let pending: string | null = (state.urlSync && hashPath()) || loadSaved() || null

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

  const saveActive = () => {
    try {
      const reg = state.active.app
        ? state.registry.find((r) => keyOf(r) === state.active.app)
        : null
      if (state.active.app && reg && reg.persist === false) localStorage.removeItem(APPS_LS)
      else localStorage.setItem(APPS_LS, JSON.stringify({ path: locToPath(state.active) }))
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

  function setActive(loc: AppLocation) {
    // Remember where we were before dropping to the graph, so the taskbar can offer the app
    // back. Without this, closing an app erased every trace of it: the chip's `v-if` went
    // false, the chip vanished, and the only way back was the launcher — starting over at the
    // app's home route. A taskbar whose entries disappear when you click them isn't a switcher.
    if (state.active.app && !loc.app) state.minimized = { ...state.active }
    // Entering an app (or a different one) clears the memo — it's a "you left this" marker,
    // not a history.
    if (loc.app) state.minimized = null
    state.active = loc
    saveActive()
    bus.emit('app:change', loc)
  }

  /** Go back into the app the user last dropped out of, at the route they left. */
  function restore(): boolean {
    const m = state.minimized
    if (!m?.app) return false
    navigate(locToPath(m))
    return true
  }

  // Resolve a full path into the active location. `record` controls the internal stack
  // (used when urlSync is off); 'none' = don't touch it (back/forward + hash echoes).
  function applyLocation(fullPath: string, record: 'push' | 'replace' | 'none') {
    if (record === 'push') {
      stack = stack.slice(0, sIndex + 1)
      stack.push(fullPath)
      sIndex = stack.length - 1
    } else if (record === 'replace') {
      stack[sIndex] = fullPath
    }
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
      setActive({ app: segs[0] ?? '', path: segs.slice(1).join('/'), params: {}, query })
      return
    }
    pending = null
    const key = keyOf(found.reg)
    // exact route match, else fall back to the app's home route; if neither matches we
    // still set the path (ZenApp shows a "route not found" notice).
    const exact = matchRoute(found.reg.routes, found.rest)
    const fallback = exact ? null : matchRoute(found.reg.routes, found.reg.home ?? '')
    setActive({
      app: key,
      path: exact ? found.rest : fallback ? (found.reg.home ?? '') : found.rest,
      params: (exact ?? fallback)?.params ?? {},
      query,
    })
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
    applyLocation(hashPath() ?? '', 'none')
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
        applyLocation(norm, 'none')
      } else {
        const next = norm ? '#zen=' + encodeURIComponent(norm) : ''
        if (location.hash === next)
          applyLocation(norm, 'none') // no hashchange when unchanged
        else location.hash = next
      }
    } else {
      applyLocation(norm, opts?.replace ? 'replace' : 'push')
    }
  }

  function makeRouter(appKey: string): AppRouter {
    return {
      go: (p, opts) => navigate(resolveFor(appKey, p), opts),
      back,
      forward,
      location: () => ({ ...state.active }),
      on: (cb) =>
        bus.on('app:change', (x) => {
          const loc = x as AppLocation
          if (loc.app === appKey) cb(loc)
        }),
    }
  }

  function makeHandle(appKey: string): AppHandle {
    return { id: appKey, router: makeRouter(appKey), close }
  }

  // Open by app id OR full key. Bare ids resolve to their (unique) key for ergonomics.
  function open(
    idOrKey: string,
    opts?: { path?: string; query?: Record<string, string> },
  ): AppHandle {
    const reg =
      state.registry.find((r) => keyOf(r) === idOrKey) ??
      state.registry.find((r) => r.id === idOrKey)
    const key = reg ? keyOf(reg) : idOrKey
    const route = opts?.path ?? reg?.home ?? ''
    navigate(resolveFor(key, route.replace(/^\//, '')), { query: opts?.query })
    return makeHandle(key)
  }

  function close() {
    navigate('')
  }

  function back() {
    if (state.urlSync) {
      window.history.back()
      return
    }
    if (sIndex > 0) {
      sIndex--
      applyLocation(stack[sIndex], 'none')
    }
  }
  function forward() {
    if (state.urlSync) {
      window.history.forward()
      return
    }
    if (sIndex < stack.length - 1) {
      sIndex++
      applyLocation(stack[sIndex], 'none')
    }
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
    const fresh = !state.registry.some((r) => keyOf(r) === keyOf(reg))
    if (fresh) state.registry.push(markRaw(reg))
    if (fresh)
      zlog(`registered app "${reg.title}" — ${keyOf(reg)}` + (reg.plugin ? ` · ${reg.plugin}` : ''))
    bus.emit('app:registry')

    // Restore: a saved/pending location targeting this app resolves now that it's here.
    if (reg.persist !== false && pending) {
      const found = resolveApp(splitQuery(pending).base)
      if (found && keyOf(found.reg) === keyOf(reg)) {
        const target = pending
        applyLocation(target, state.urlSync ? 'none' : 'push')
        if (state.urlSync) syncHashSilently(target) // reflect without a second nav
      }
    }
    return () => {
      const i = state.registry.findIndex((r) => keyOf(r) === keyOf(reg))
      if (i >= 0) state.registry.splice(i, 1)
      bus.emit('app:registry')
      if (state.active.app === keyOf(reg)) close()
      if (state.minimized?.app === keyOf(reg)) state.minimized = null
    }
  }

  return {
    state,
    register,
    registered: () => state.registry.slice(),
    open,
    close,
    restore,
    minimized: (): AppLocation | null => (state.minimized ? { ...state.minimized } : null),
    current: () => state.active.app,
    navigate: (p: string, opts?: { query?: Record<string, string>; replace?: boolean }) =>
      navigate(p, opts),
    back,
    forward,
    location: (): AppLocation => ({ ...state.active }),
    on: (cb: (loc: AppLocation) => void) => bus.on('app:change', (x) => cb(x as AppLocation)),
    setUrlSync,
    // internal helpers for the Vue surface
    keyOf,
    makeRouter,
    getState,
    setState,
  }
}
