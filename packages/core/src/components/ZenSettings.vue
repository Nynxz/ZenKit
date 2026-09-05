<script setup lang="ts">
// Zen Settings — ZenKit control center. Plugins (enable/disable + versions), Logs/issues
// (the log ring-buffer + window errors), and the ZenKit prefs in one place.
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { ZenIcon, ZenInput, ZenSelect, ZenSwitch } from '@nynxz/zenkit-ui'
import { COMFY_BRAND, STORE_KEY, type PanelStore } from '../panelStore'
import { APP_STORE_KEY, type AppStore } from '../appStore'
import { theme } from '../theme'
import { logEntries, onLog, setDebug, type LogEntry } from '../log'
import { orderedWidgets, isWidgetOn, setWidgetOn, moveWidget } from '../taskbarWidgets'

const store = inject(STORE_KEY) as PanelStore
const appStore = inject(APP_STORE_KEY) as AppStore
const tab = ref<'plugins' | 'logs' | 'settings'>('plugins')
const tbWidgets = computed(() => orderedWidgets())

// The graph background's controls live in ComfyUI's own settings dialog (ZenKit → Canvas),
// registered by ComfyUI-ZenKit's backgroundSettings.ts. Kept out of this panel deliberately:
// two toggles writing two different stores would drift.

// --- plugins: group the registry by owning plugin ---
interface PluginRow {
  plugin: string
  logo?: string
  version?: string
  count: number
  core: boolean // ZenKit's own panels (no `plugin`) — can't be disabled
}
const plugins = computed<PluginRow[]>(() => {
  const by = new Map<string, PluginRow>()
  for (const r of store.state.registry) {
    const key = r.plugin || 'ZenKit'
    if (!by.has(key))
      by.set(key, { plugin: key, logo: r.logo, version: r.version, count: 0, core: !r.plugin })
    const g = by.get(key)!
    if (!r.spawnOnly) g.count++
    if (r.version && !g.version) g.version = r.version
    if (r.logo && !g.logo) g.logo = r.logo
  }
  return [...by.values()]
    .filter((g) => g.core || g.count > 0)
    .sort((a, b) => (a.core ? -1 : b.core ? 1 : a.plugin.localeCompare(b.plugin)))
})

// --- logs ---
const logs = ref<LogEntry[]>(logEntries())
const issuesOnly = ref(false)
let offLog: (() => void) | null = null
const shownLogs = computed(() => {
  const list = issuesOnly.value
    ? logs.value.filter((e) => e.level === 'warn' || e.level === 'error')
    : logs.value
  return list.slice().reverse() // newest first
})
function fmtTime(ts: number) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

// --- settings ---
const packOptions = theme.packs().map((id) => ({ value: id, label: theme.packLabel(id) }))
const curPack = ref(theme.current())
const dark = ref(theme.currentMode() === 'dark')
const debug = ref(false)
// keep in sync when the theme changes from elsewhere (the taskbar footer, etc.)
const offTheme = theme.onChange(() => {
  curPack.value = theme.current()
  dark.value = theme.currentMode() === 'dark'
})
onBeforeUnmount(offTheme)
function pickPack(id: string) {
  theme.setPack(id)
  curPack.value = theme.current()
}
function setDark(on: boolean) {
  dark.value = on
  theme.setMode(on ? 'dark' : 'light')
}
function setDebugOn(on: boolean) {
  debug.value = on
  setDebug(on)
}

onMounted(() => {
  offLog = onLog((e) => {
    logs.value.push(e)
    if (logs.value.length > 400) logs.value.shift()
  })
})
onBeforeUnmount(() => offLog?.())
</script>

<template>
  <div class="zse">
    <div class="zse-tabs">
      <button :class="{ on: tab === 'plugins' }" @click="tab = 'plugins'">
        <i class="mdi mdi-puzzle-outline" />
        Plugins
      </button>
      <button :class="{ on: tab === 'logs' }" @click="tab = 'logs'">
        <i class="mdi mdi-text-box-outline" />
        Logs
      </button>
      <button :class="{ on: tab === 'settings' }" @click="tab = 'settings'">
        <i class="mdi mdi-cog-outline" />
        Settings
      </button>
    </div>

    <!-- PLUGINS -->
    <div v-if="tab === 'plugins'" class="zse-body">
      <p class="zse-note">
        Toggle ZenKit plugins on/off — disabling hides a plugin's panels from the launcher and
        closes any it has open (it stays installed; this doesn't unload the Python).
      </p>
      <div v-for="g in plugins" :key="g.plugin" class="zse-plugin">
        <ZenIcon class="zse-plogo" :icon="g.logo || 'mdi mdi-puzzle-outline'" />
        <div class="zse-pmeta">
          <span class="zse-pname">
            {{ g.plugin }}
            <span v-if="g.core" class="zse-core">core</span>
          </span>
          <span class="zse-psub">
            {{ g.count }} panel{{ g.count === 1 ? '' : 's' }} · {{ g.version || '—' }}
          </span>
        </div>
        <ZenSwitch
          v-if="!g.core"
          :model-value="store.pluginEnabled(g.plugin)"
          @update:model-value="(v) => store.setPluginEnabled(g.plugin, v)"
        />
        <span v-else class="zse-always">always on</span>
      </div>
    </div>

    <!-- LOGS -->
    <div v-else-if="tab === 'logs'" class="zse-body zse-logs">
      <div class="zse-logbar">
        <label class="zse-chk">
          <ZenSwitch :model-value="issuesOnly" @update:model-value="(v) => (issuesOnly = v)" />
          Issues only
        </label>
        <span class="zse-grow" />
        <span class="zse-count">{{ shownLogs.length }}</span>
      </div>
      <div class="zse-logstream">
        <div v-if="!shownLogs.length" class="zse-empty">
          {{ issuesOnly ? 'No warnings or errors.' : 'No log entries yet.' }}
        </div>
        <div v-for="(e, i) in shownLogs" :key="i" class="zse-log" :class="e.level">
          <span class="zse-lvl">{{ e.level }}</span>
          <span class="zse-lt">{{ fmtTime(e.ts) }}</span>
          <span class="zse-lmsg">
            {{ e.msg }}
            <span v-if="e.args && e.args.length" class="zse-largs">
              {{
                e.args
                  .filter((a) => a !== '')
                  .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
                  .join(' ')
              }}
            </span>
          </span>
        </div>
      </div>
    </div>

    <!-- SETTINGS -->
    <div v-else class="zse-body">
      <div class="zse-set">
        <span class="zse-slbl">Theme</span>
        <ZenSelect
          :model-value="curPack"
          :options="packOptions"
          @update:model-value="(v) => pickPack(String(v))"
        />
      </div>
      <div class="zse-set">
        <div>
          <span class="zse-slbl">Dark mode</span>
          <small>drives ComfyUI's .dark-theme</small>
        </div>
        <ZenSwitch :model-value="dark" @update:model-value="setDark" />
      </div>
      <div class="zse-set">
        <div><span class="zse-slbl">Taskbar edge</span></div>
        <ZenSelect
          :model-value="store.state.taskbarPos"
          :options="[
            { value: 'bottom', label: 'Bottom' },
            { value: 'top', label: 'Top' },
          ]"
          @update:model-value="(v) => store.setTaskbarPos(String(v) === 'top' ? 'top' : 'bottom')"
        />
      </div>

      <!-- white-label the taskbar's Start button -->
      <div class="zse-brand">
        <div class="zse-slbl">
          Start button
          <small>white-label the taskbar opener — leave a field blank for the default</small>
        </div>
        <div class="zse-bfield">
          <span class="zse-blbl">Name</span>
          <ZenInput
            sm
            :model-value="store.state.brandingUser.title"
            :placeholder="store.state.brandingBase.title || COMFY_BRAND.title"
            @update:model-value="(v) => store.setBrandingOverride({ title: String(v) })"
          />
        </div>
        <div class="zse-bfield">
          <span class="zse-blbl">Icon</span>
          <ZenInput
            sm
            :model-value="store.state.brandingUser.logo"
            placeholder="mdi mdi-rocket-launch — or an image URL"
            @update:model-value="(v) => store.setBrandingOverride({ logo: String(v) })"
          />
        </div>
        <div class="zse-bfoot">
          <span class="zse-bprev" title="How the Start button reads now">
            <ZenIcon
              class="zse-bico"
              :icon="store.state.branding.logo"
              fallback="mdi-hexagon-multiple"
            />
            {{ store.state.branding.title }}
          </span>
          <span class="zse-grow" />
          <button
            class="zse-breset"
            :disabled="!store.state.brandingUser.title && !store.state.brandingUser.logo"
            @click="store.setBrandingOverride({ title: '', logo: '' })"
          >
            Reset
          </button>
        </div>
      </div>
      <div class="zse-set">
        <div>
          <span class="zse-slbl">Absorb ComfyUI buttons</span>
          <small>settings/help/etc. into the taskbar menu</small>
        </div>
        <ZenSwitch
          :model-value="store.state.absorbComfyButtons"
          @update:model-value="(v) => store.setAbsorbComfyButtons(v)"
        />
      </div>
      <div class="zse-set">
        <div>
          <span class="zse-slbl">ZenKit themes in ComfyUI menu</span>
          <small>
            experimental — takes over ComfyUI's logo → Theme menu with a 1.0/2.0 + light/dark
            switcher
          </small>
        </div>
        <ZenSwitch
          :model-value="store.state.comfyThemeMenu"
          @update:model-value="(v) => store.setComfyThemeMenu(v)"
        />
      </div>
      <div class="zse-set">
        <div>
          <span class="zse-slbl">Sync app routes to URL</span>
          <small>
            mirror the open app's route into the address bar (#zen=…) — shareable links + browser
            back/forward
          </small>
        </div>
        <ZenSwitch
          :model-value="appStore.state.urlSync"
          @update:model-value="(v) => appStore.setUrlSync(v)"
        />
      </div>
      <div class="zse-set">
        <div>
          <span class="zse-slbl">Auto-hide ComfyUI sidebar</span>
          <small>
            the left toolbar slides away; hover the left edge to reveal (stays while a tab is open)
          </small>
        </div>
        <ZenSwitch
          :model-value="store.state.sidebarAutohide"
          @update:model-value="(v) => store.setSidebarAutohide(v)"
        />
      </div>
      <div class="zse-set">
        <div>
          <span class="zse-slbl">Restyle sidebar</span>
          <small>pop the opened sidebar out as a glassy rounded card, blended resize gutter</small>
        </div>
        <ZenSwitch
          :model-value="store.state.floatingSidebar"
          @update:model-value="(v) => store.setFloatingSidebar(v)"
        />
      </div>
      <div class="zse-set">
        <div>
          <span class="zse-slbl">Debug logging</span>
          <small>verbose zdebug output</small>
        </div>
        <ZenSwitch :model-value="debug" @update:model-value="setDebugOn" />
      </div>

      <div class="zse-widgets">
        <div class="zse-slbl">
          Taskbar widgets
          <small>toggle on/off and reorder</small>
        </div>
        <div v-for="(w, i) in tbWidgets" :key="w.id" class="zse-widget">
          <i v-if="w.icon" :class="w.icon" class="zse-wic" />
          <span class="zse-wname">{{ w.label }}</span>
          <span class="zse-wgrow" />
          <button
            class="zse-wbtn"
            :disabled="i === 0"
            title="Move left"
            @click="moveWidget(w.id, -1)"
          >
            <i class="mdi mdi-chevron-left" />
          </button>
          <button
            class="zse-wbtn"
            :disabled="i === tbWidgets.length - 1"
            title="Move right"
            @click="moveWidget(w.id, 1)"
          >
            <i class="mdi mdi-chevron-right" />
          </button>
          <ZenSwitch
            :model-value="isWidgetOn(w.id)"
            @update:model-value="(v) => setWidgetOn(w.id, v)"
          />
        </div>
        <div v-if="!tbWidgets.length" class="zse-wempty">No taskbar widgets registered yet.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.zse {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--zen-text, #e5e5e8);
  font-size: 13px;
  font-family: var(--p-font-family, system-ui, sans-serif);
}
.zse-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--zen-border, #34343c);
}
.zse-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: none;
  color: var(--zen-muted, #9a9aa2);
  font: inherit;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: var(--zen-radius, 7px);
  cursor: pointer;
}
.zse-tabs button:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 7%, transparent);
}
.zse-tabs button.on {
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 18%, transparent);
  color: var(--zen-text, #e5e5e8);
}
.zse-tabs .mdi {
  font-size: 14px;
}
.zse-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  scrollbar-gutter: stable;
}
.zse-note {
  margin: 0 0 4px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--zen-muted, #9a9aa2);
}

.zse-plugin {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--zen-border, #2c2c33);
  border-radius: var(--zen-radius, 10px);
  background: var(--zen-surface-2, #1f1f25);
}
.zse-plogo {
  font-size: 20px;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  color: var(--zen-accent, #8b8bf5);
}
.zse-pmeta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.zse-pname {
  font-weight: 600;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 7px;
}
.zse-core {
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 5px;
  border-radius: var(--zen-radius, 4px);
  background: color-mix(in srgb, var(--zen-text, #fff) 12%, transparent);
  color: var(--zen-muted, #b8b8bf);
}
.zse-psub {
  font-size: 11px;
  color: var(--zen-muted, #76767e);
}
.zse-always {
  font-size: 10px;
  color: var(--zen-muted, #76767e);
}

.zse-logs {
  padding: 0;
}
.zse-logbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  border-bottom: 1px solid var(--zen-border, #2c2c33);
}
.zse-chk {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--zen-muted, #b8b8bf);
  cursor: pointer;
}
.zse-grow {
  flex: 1;
}
.zse-count {
  font-size: 11px;
  color: var(--zen-muted, #76767e);
}
.zse-logstream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px 0;
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.zse-empty {
  padding: 22px;
  text-align: center;
  color: var(--zen-muted, #76767e);
}
.zse-log {
  display: flex;
  gap: 8px;
  padding: 3px 11px;
  align-items: baseline;
}
.zse-log:hover {
  background: color-mix(in srgb, var(--zen-text, #fff) 5%, transparent);
}
.zse-lvl {
  flex: 0 0 42px;
  text-transform: uppercase;
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--zen-muted, #76767e);
}
.zse-log.warn .zse-lvl {
  color: #f59e0b;
}
.zse-log.error .zse-lvl {
  color: #f87171;
}
.zse-lt {
  flex: 0 0 auto;
  color: var(--zen-muted, #76767e);
}
.zse-lmsg {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}
.zse-log.error .zse-lmsg {
  color: #fca5a5;
}
.zse-largs {
  color: var(--zen-muted, #76767e);
}

.zse-set {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 2px;
}
.zse-set > div {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.zse-set > div:first-child {
  flex: 1;
}
.zse-slbl {
  font-size: 12.5px;
}
.zse-set small {
  font-size: 10px;
  color: var(--zen-muted, #76767e);
}
/* fixed-width selects so the theme dropdown doesn't grow/shrink with the pack name —
   the trigger fills the width and long labels ellipsize instead */
.zse-set :deep(.zen-select) {
  flex: 0 0 168px;
  width: 168px;
}
.zse-set :deep(.zs-trigger) {
  width: 100%;
  box-sizing: border-box;
}
/* taskbar widgets list */
/* Start-button branding: a titled block of labelled text fields + a live preview chip. */
.zse-brand {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0;
  padding: 10px 0;
  border-top: 1px solid var(--zen-border, #34343c);
  border-bottom: 1px solid var(--zen-border, #34343c);
}
.zse-bfield {
  display: flex;
  align-items: center;
  gap: 10px;
}
.zse-blbl {
  flex: 0 0 44px;
  font-size: 11.5px;
  color: var(--zen-muted, #9a9aa2);
}
.zse-bfield :deep(.zen-input) {
  flex: 1;
  min-width: 0;
}
.zse-bfoot {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* mirrors the taskbar's own Start button, so what you type is what you'll see */
.zse-bprev {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 60%;
  padding: 4px 10px;
  border-radius: var(--zen-radius, 7px);
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 16%, transparent);
  color: var(--zen-accent, #6366f1);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.03em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zse-bprev :deep(.mdi) {
  font-size: 17px;
}
/* `img.` outweighs ZenIcon's own `.zen-ico-img { width: 1em }` (same as the taskbar's logo) */
img.zse-bico {
  width: 18px;
  height: 18px;
  border-radius: var(--zen-radius, 5px);
  object-fit: contain;
}
.zse-breset {
  padding: 4px 10px;
  background: none;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 6px);
  color: var(--zen-muted, #9a9aa2);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}
.zse-breset:disabled {
  opacity: 0.35;
  cursor: default;
}
.zse-breset:not(:disabled):hover {
  color: var(--zen-text, #e5e5e8);
  border-color: var(--zen-accent, #6366f1);
}

.zse-widgets {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--zen-border, #34343c);
}
.zse-brand > .zse-slbl,
.zse-widgets > .zse-slbl {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 2px;
}
.zse-brand > .zse-slbl small,
.zse-widgets > .zse-slbl small {
  font-size: 10px;
  color: var(--zen-muted, #76767e);
}
.zse-widget {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 2px;
}
.zse-wic {
  font-size: 15px;
  color: var(--zen-accent, #6366f1);
  flex: 0 0 auto;
}
.zse-wname {
  font-size: 12px;
}
.zse-wgrow {
  flex: 1;
}
.zse-wbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: none;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 6px);
  color: var(--zen-muted, #9a9aa2);
  cursor: pointer;
}
.zse-wbtn:disabled {
  opacity: 0.35;
  cursor: default;
}
.zse-wbtn:not(:disabled):hover {
  color: var(--zen-text, #e5e5e8);
  border-color: var(--zen-accent, #6366f1);
}
.zse-wbtn .mdi {
  font-size: 15px;
}
.zse-wempty {
  font-size: 11px;
  color: var(--zen-muted, #9a9aa2);
  padding: 4px 2px;
}
</style>
