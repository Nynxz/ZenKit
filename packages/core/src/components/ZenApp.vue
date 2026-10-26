<script setup lang="ts">
// One app's full-screen surface. ZenHost keeps one per running app that has been shown, and
// shows the active one: a minimized app stays mounted (its state, a stream it is reading) until
// it is closed. It covers the graph (the "desktop") while the taskbar + floating panels stay
// above. An app with `mount` is mounted once; otherwise the matched route's render() fills the
// body and re-runs when this app's route changes — the same render(container, ctx) => cleanup
// contract panels use. The body is shaped like a docked/floating panel's body (a sized flex
// child) so content built to fill its container renders identically here.
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ZenIcon, ZenIconButton } from '@nynxz/zenkit-ui'
import { APP_STORE_KEY, matchRoute, type AppStore } from '../appStore'
import { STORE_KEY, type PanelStore } from '../panelStore'
import { TASKBAR_H, taskbarFootprint } from '../tiling'
import { appTileId, tileApp, tileRectOf, untile, untileApp } from '../workspaces'
import type { AppContext, AppRegistration, RouteContext } from '../types'

const props = defineProps<{ appKey: string }>()
const store = inject(APP_STORE_KEY) as AppStore
const panels = inject(STORE_KEY) as PanelStore

// Reserve the permanent taskbar strip so app content isn't hidden behind it (the taskbar
// floats above us at a much higher z-index). The taskbar docks top or bottom; when top it
// sits just below ComfyUI's menu (topbarH), so reserve down to its bottom edge.
// Tiled in a workspace, the app fills its tile's rect (shown while that workspace is) instead.
const tile = computed(() => tileRectOf(appTileId(props.appKey)))
const surfaceStyle = computed(() => {
  const t = tile.value
  if (t && t !== 'hidden')
    return { left: t.x + 'px', top: t.y + 'px', width: t.w + 'px', height: t.h + 'px', zIndex: 3 }
  return panels.state.taskbarPos === 'top'
    ? {
        left: '0',
        right: '0',
        top: panels.state.topbarH + (panels.state.taskbarAutohide ? 0 : TASKBAR_H) + 'px',
        bottom: '0',
      }
    : { left: '0', right: '0', top: '0', bottom: taskbarFootprint(panels) + 'px' }
})
const tiled = computed(() => !!tile.value)
const visible = computed(() =>
  tile.value ? tile.value !== 'hidden' : store.state.active.app === props.appKey,
)
const router = store.makeRouter(props.appKey)
function closeApp() {
  if (tiled.value) untile(appTileId(props.appKey))
  store.close(props.appKey)
}

// This app's location: the active one while it shows, else where it was left.
const loc = computed(() =>
  store.state.active.app === props.appKey
    ? store.state.active
    : (store.runningOf(props.appKey) ?? store.state.active),
)
const reg = computed(() => store.regOf(props.appKey))
const match = computed(() => {
  const r = reg.value
  if (!r) return null
  return matchRoute(r.routes, loc.value.path) ?? matchRoute(r.routes, r.home ?? '')
})
const showChrome = computed(() => reg.value?.chrome !== false)
const title = computed(() => {
  const m = match.value
  const t = m?.route.title
  if (typeof t === 'function') return t(m!.params)
  return (t as string | undefined) ?? reg.value?.title ?? props.appKey
})
// With URL sync the browser owns history, so its buttons can't know the ends.
const canBack = computed(() => store.state.urlSync || store.canStep(props.appKey, -1))
const canForward = computed(() => store.state.urlSync || store.canStep(props.appKey, 1))

// Per-route apps re-render on a route change (app + path + query) and when the registration
// appears or is replaced (restore can show an app before its plugin registers).
const locKey = computed(() => `${loc.value.path}|${JSON.stringify(loc.value.query)}`)

const bodyRef = ref<HTMLElement | null>(null)
let cleanup: (() => void) | null = null
let mountedReg: AppRegistration | null = null

function teardown() {
  if (cleanup) {
    try {
      cleanup()
    } catch {
      /* ignore */
    }
    cleanup = null
  }
  mountedReg = null
  bodyRef.value?.replaceChildren()
}

function fail(what: string, e: unknown) {
  console.error(`[ZenKit] app ${what} failed`, props.appKey, e)
  if (bodyRef.value)
    bodyRef.value.innerHTML = `<div class="zen-app-msg">This screen failed to load.</div>`
}

function mountApp(r: AppRegistration) {
  if (mountedReg === r) return
  teardown()
  const el = bodyRef.value
  if (!el) return
  mountedReg = r
  const key = props.appKey
  const ctx: AppContext = {
    app: r.id,
    key,
    router: store.makeRouter(key),
    get state() {
      return store.getState(key)
    },
    setState: (s) => store.setState(key, s),
  }
  try {
    const ret = r.mount!(el, ctx)
    if (typeof ret === 'function') cleanup = ret
  } catch (e) {
    fail('mount', e)
  }
}

function mountRoute(r: AppRegistration) {
  teardown()
  const el = bodyRef.value
  if (!el) return
  const m = match.value
  if (!m?.route.render) {
    // The path comes from the URL, so it is text, never HTML.
    const msg = document.createElement('div')
    msg.className = 'zen-app-msg'
    msg.textContent = `Route “${loc.value.path}” not found in ${r.title}.`
    el.replaceChildren(msg)
    return
  }
  const key = props.appKey
  const ctx: RouteContext = {
    app: r.id, // the app's own id (route code sees the bare id, not the namespaced key)
    route: m.route.path,
    params: m.params,
    query: loc.value.query,
    router: store.makeRouter(key),
    // Live, like PanelContext.state: a route that sets state and reads it back sees the update.
    get state() {
      return store.getState(key)
    },
    setState: (s) => store.setState(key, s),
  }
  try {
    const ret = m.route.render(el, ctx)
    if (typeof ret === 'function') cleanup = ret
  } catch (e) {
    fail('route render', e)
  }
}

function sync() {
  const r = reg.value
  if (!r) return teardown() // not registered yet — an empty surface until it arrives
  if (r.mount) mountApp(r)
  else mountRoute(r)
}

onMounted(sync)
watch(reg, sync)
watch(locKey, () => {
  if (reg.value && !reg.value.mount) sync()
})
onBeforeUnmount(teardown)
</script>

<template>
  <div v-show="visible" class="zen-app" :class="{ tiled }" :style="surfaceStyle">
    <div v-if="showChrome" class="zen-app-bar">
      <ZenIconButton
        icon="mdi mdi-arrow-left"
        title="Back"
        :disabled="!canBack"
        @click="router.back()"
      />
      <ZenIconButton
        icon="mdi mdi-arrow-right"
        title="Forward"
        :disabled="!canForward"
        @click="router.forward()"
      />
      <span class="zen-app-sep" />
      <ZenIcon v-if="reg?.icon" :icon="reg.icon" class="zen-app-icon" />
      <span class="zen-app-title">{{ title }}</span>
      <span class="zen-app-grow" />
      <ZenIconButton
        v-if="tiled"
        icon="mdi mdi-arrow-expand"
        title="Full screen (take it out of the workspace)"
        @click="untileApp(appKey)"
      />
      <template v-else>
        <ZenIconButton
          icon="mdi mdi-view-split-vertical"
          title="Tile into a workspace, beside your panels"
          @click="tileApp(appKey)"
        />
        <ZenIconButton
          icon="mdi mdi-window-minimize"
          title="Minimize (keeps running on the taskbar)"
          @click="store.minimize()"
        />
      </template>
      <ZenIconButton icon="mdi mdi-close" title="Close" @click="closeApp" />
    </div>
    <div ref="bodyRef" class="zen-app-body" />
  </div>
</template>

<style scoped>
/* Full viewport, inside .zen-host's z-1500 stacking context so it covers ComfyUI's
   canvas + top menu (all < 1500). z:10 sits above graph-edge chrome (dock z7) but below
   floating panels (z20+), job toasts (z80), and the taskbar (z99999),
   so those stay usable over an open app. */
.zen-app {
  position: fixed;
  /* placed inline (surfaceStyle): full width above the taskbar strip, or its tile's rect */
  z-index: 10;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--zen-bg, #1a1a1f);
  color: var(--zen-text, #e5e5ea);
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zen-app-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  background: var(--zen-chrome-bg, var(--zen-surface, #202026));
  border-bottom: 1px solid var(--zen-surface-border, var(--zen-border, #3a3a44));
}
.zen-app-sep {
  width: 1px;
  align-self: stretch;
  margin: 2px 6px;
  background: var(--zen-border, #3a3a44);
}
.zen-app-grow {
  flex: 1;
}
.zen-app-icon {
  font-size: 16px;
  color: var(--zen-accent, #3b82f6);
}
.zen-app-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* In a workspace tile it reads like a tiled panel: framed, with the theme's surface radius. */
.zen-app.tiled {
  border: 1px solid var(--zen-surface-border, var(--zen-border, #3a3a44));
  border-radius: var(--zen-radius-surface, var(--zen-radius, 8px));
}
/* The route mount: a sized flex child (like ZenPanel's .body) so routes that fill their
   container don't collapse to zero height. */
.zen-app-body {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
}
.zen-app-body :deep(.zen-app-msg) {
  padding: 24px;
  font-size: 13px;
  color: var(--zen-muted, #9aa0aa);
}
</style>
