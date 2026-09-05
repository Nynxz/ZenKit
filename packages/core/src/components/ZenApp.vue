<script setup lang="ts">
// The full-screen app surface. ZenHost mounts this whenever an app is active
// (appStore.state.active.app != null); it covers the graph (the "desktop") while the
// taskbar + floating panels stay above. The active route's render() fills the body —
// the same render(container, ctx) => cleanup contract panels use — re-running on every
// route change. The body is shaped like a docked/floating panel's body (a sized flex
// child) so routes built to fill their container render identically here.
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ZenIcon, ZenIconButton } from '@nynxz/zenkit-ui'
import { APP_STORE_KEY, matchRoute, type AppStore } from '../appStore'
import { STORE_KEY, type PanelStore } from '../panelStore'
import { TASKBAR_H } from '../tiling'
import type { RouteContext } from '../types'

const store = inject(APP_STORE_KEY) as AppStore
const panels = inject(STORE_KEY) as PanelStore

// Reserve the permanent taskbar strip so app content isn't hidden behind it (the taskbar
// floats above us at a much higher z-index). The taskbar docks top or bottom; when top it
// sits just below ComfyUI's menu (topbarH), so reserve down to its bottom edge.
const surfaceStyle = computed(() =>
  panels.state.taskbarPos === 'top'
    ? { top: panels.state.topbarH + TASKBAR_H + 'px', bottom: '0' }
    : { top: '0', bottom: TASKBAR_H + 'px' },
)

const active = computed(() => store.state.active)
// active.app is the routing key ('<namespace>/<id>'); resolve the registration by key.
const reg = computed(
  () => store.state.registry.find((r) => store.keyOf(r) === active.value.app) || null,
)
const match = computed(() => {
  const r = reg.value
  if (!r) return null
  return matchRoute(r.routes, active.value.path) ?? matchRoute(r.routes, r.home ?? '')
})
const showChrome = computed(() => reg.value?.chrome !== false)
const title = computed(() => {
  const m = match.value
  const t = m?.route.title
  if (typeof t === 'function') return t(m!.params)
  return (t as string | undefined) ?? reg.value?.title ?? active.value.app ?? ''
})

// Re-key on app + path + query (a route change) AND on the registration appearing
// (restore navigates to an app before its plugin registers — re-mount once it lands).
const locKey = computed(
  () => `${active.value.app}|${active.value.path}|${JSON.stringify(active.value.query)}`,
)

const bodyRef = ref<HTMLElement | null>(null)
let cleanup: (() => void) | null = null

function mountRoute() {
  if (cleanup) {
    try {
      cleanup()
    } catch {
      /* ignore */
    }
    cleanup = null
  }
  const el = bodyRef.value
  if (!el) return
  el.replaceChildren()
  const r = reg.value
  if (!r) return // app not registered yet — show an empty surface until it arrives
  const m = match.value
  if (!m) {
    el.innerHTML = `<div class="zen-app-msg">Route “${active.value.path}” not found in ${r.title}.</div>`
    return
  }
  const key = active.value.app as string // routing key ('<namespace>/<id>')
  const ctx: RouteContext = {
    app: r.id, // the app's own id (route code sees the bare id, not the namespaced key)
    route: m.route.path,
    params: m.params,
    query: active.value.query,
    router: store.makeRouter(key),
    state: store.getState(key),
    setState: (s) => store.setState(key, s),
  }
  try {
    const ret = m.route.render(el, ctx)
    if (typeof ret === 'function') cleanup = ret
  } catch (e) {
    console.error('[ZenKit] app route render failed', key, m.route.path, e)
    el.innerHTML = `<div class="zen-app-msg">This screen failed to load.</div>`
  }
}

onMounted(mountRoute)
watch([locKey, reg], () => mountRoute())
onBeforeUnmount(() => {
  if (cleanup) {
    try {
      cleanup()
    } catch {
      /* ignore */
    }
    cleanup = null
  }
})
</script>

<template>
  <div class="zen-app" :style="surfaceStyle">
    <div v-if="showChrome" class="zen-app-bar">
      <ZenIconButton icon="mdi mdi-home-outline" title="Back to graph" @click="store.close()" />
      <ZenIconButton icon="mdi mdi-arrow-left" title="Back" @click="store.back()" />
      <ZenIconButton icon="mdi mdi-arrow-right" title="Forward" @click="store.forward()" />
      <span class="zen-app-sep" />
      <ZenIcon v-if="reg?.icon" :icon="reg.icon" class="zen-app-icon" />
      <span class="zen-app-title">{{ title }}</span>
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
  left: 0;
  right: 0;
  /* top/bottom set inline (surfaceStyle) to reserve the taskbar strip */
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
  background: var(--zen-surface, #202026);
  border-bottom: 1px solid var(--zen-border, #3a3a44);
}
.zen-app-sep {
  width: 1px;
  align-self: stretch;
  margin: 2px 6px;
  background: var(--zen-border, #3a3a44);
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
