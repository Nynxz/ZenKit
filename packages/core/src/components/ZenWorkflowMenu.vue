<template>
  <ZenPopover
    :open="open"
    :anchor="anchor"
    placement="top-start"
    :offset="6"
    role="dialog"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="zwm" aria-label="Workflows">
      <div v-if="searchable" class="zwm-q">
        <i class="mdi mdi-magnify" />
        <input
          ref="qEl"
          v-model="q"
          placeholder="Search workflows"
          spellcheck="false"
          aria-label="Search workflows"
        />
      </div>
      <div class="zwm-list zen-scroll">
        <template v-for="r in openRows" :key="r.key">
          <div class="zwm-row" :class="{ current: r.current }">
            <button
              v-if="r.spaces.length"
              type="button"
              class="zwm-caret"
              :aria-expanded="isExpanded(r.key)"
              :title="isExpanded(r.key) ? 'Hide its workspaces' : 'Show its workspaces'"
              @click="toggle(r.key)"
            >
              <i
                class="mdi"
                :class="isExpanded(r.key) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
              />
            </button>
            <span v-else class="zwm-caret" />
            <button
              type="button"
              class="zwm-main"
              :title="r.current ? `${r.name} · current workflow` : `Switch to ${r.name}`"
              @click="go(r.key)"
            >
              <span class="zwm-name">{{ r.name }}</span>
              <span v-if="r.modified" class="zwm-dot" title="Unsaved changes" />
              <i v-if="r.running" class="mdi mdi-play-circle-outline zwm-run" title="Running" />
            </button>
            <button
              type="button"
              class="zwm-pin"
              :class="{ on: isPinned(r.key) }"
              :aria-pressed="isPinned(r.key)"
              :title="isPinned(r.key) ? 'Unpin' : 'Pin to the taskbar'"
              @click="pinWorkflow(r.key, !isPinned(r.key))"
            >
              <i class="mdi" :class="isPinned(r.key) ? 'mdi-pin' : 'mdi-pin-outline'" />
            </button>
          </div>
          <template v-if="isExpanded(r.key) || (searching && r.matchedSpaces.length)">
            <button
              v-for="s in searching && !isExpanded(r.key) ? r.matchedSpaces : r.spaces"
              :key="s.id"
              type="button"
              class="zwm-space"
              :class="{ current: r.current && ws.active === s.id }"
              :title="`Show ${s.name}`"
              @click="jump(r.key, s.id)"
            >
              <i class="mdi mdi-view-dashboard-outline" />
              <span class="zwm-name">{{ s.name }}</span>
            </button>
          </template>
        </template>
        <div v-if="!openRows.length" class="zwm-empty">
          {{ searching ? 'No open workflow matches' : 'No workflows open' }}
        </div>
        <template v-if="savedRows.length">
          <button
            type="button"
            class="zwm-disclose"
            :aria-expanded="savedShown"
            @click="savedOpen = !savedOpen"
          >
            <i class="mdi" :class="savedShown ? 'mdi-chevron-down' : 'mdi-chevron-right'" />
            <span>Saved</span>
            <span class="zwm-n">{{ savedRows.length }}</span>
          </button>
          <template v-if="savedShown">
            <div v-for="s in savedRows.slice(0, SAVED_MAX)" :key="s.key" class="zwm-row saved">
              <span class="zwm-caret" />
              <button type="button" class="zwm-main" :title="`Open ${s.name}`" @click="go(s.key)">
                <span class="zwm-name">{{ s.name }}</span>
              </button>
              <button
                type="button"
                class="zwm-pin"
                :class="{ on: isPinned(s.key) }"
                :aria-pressed="isPinned(s.key)"
                :title="isPinned(s.key) ? 'Unpin' : 'Pin to the taskbar'"
                @click="pinWorkflow(s.key, !isPinned(s.key))"
              >
                <i class="mdi" :class="isPinned(s.key) ? 'mdi-pin' : 'mdi-pin-outline'" />
              </button>
            </div>
            <div v-if="savedRows.length > SAVED_MAX" class="zwm-empty">
              {{ savedRows.length - SAVED_MAX }} more · search to find them
            </div>
          </template>
        </template>
      </div>
    </div>
  </ZenPopover>
</template>

<script setup lang="ts">
// The workflow menu, opened from the workflow name in the taskbar: the open workflows (current
// first), each expandable to its workspaces, then the saved ones under a disclosure. Each row
// can be pinned to the taskbar. Global workspaces aren't listed: their pills are on the bar.
// Names are rendered as text.
import { computed, nextTick, ref, watch } from 'vue'
import { ZenPopover } from '@nynxz/zenkit-ui'
import {
  activeWorkflow,
  isPinned,
  openWorkflows,
  pinWorkflow,
  savedWorkflows,
  switchToWorkflow,
  wf,
  type ComfyWorkflowLike,
} from '../comfyWorkflows'
import { activate, landOnAfterSwitch, workspacesOfWorkflow, ws } from '../workspaces'

const props = defineProps<{ open: boolean; anchor: HTMLElement | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

/** Search shows up once the list is long enough to need it. */
const SEARCH_FROM = 7
const SAVED_MAX = 40

const q = ref('')
const qEl = ref<HTMLInputElement | null>(null)
const expanded = ref(new Set<string>())
const savedOpen = ref(false)
// ComfyUI's store isn't reactive here: take a snapshot each time the menu opens.
const tabs = ref<ComfyWorkflowLike[]>([])
const saved = ref<{ key: string; name: string }[]>([])

const needle = computed(() => q.value.trim().toLowerCase())
const searching = computed(() => !!needle.value)
const match = (s: string) => !needle.value || s.toLowerCase().includes(needle.value)
const searchable = computed(() => tabs.value.length + saved.value.length >= SEARCH_FROM)
const isExpanded = (key: string) => expanded.value.has(key)
const savedShown = computed(() => savedOpen.value || searching.value)

const openRows = computed(() => {
  const byKey = new Map(tabs.value.map((w) => [w.path, w]))
  // The current workflow first, then the others in ComfyUI's tab order.
  const entries = [...wf.open].sort((a, b) => +b.active - +a.active)
  return entries.flatMap((e) => {
    const w = byKey.get(e.key)
    const spaces = w ? workspacesOfWorkflow(w) : []
    const matchedSpaces = searching.value ? spaces.filter((s) => match(s.name)) : []
    if (!match(e.name) && !matchedSpaces.length) return []
    return [
      {
        key: e.key,
        name: e.name,
        current: e.active,
        modified: e.modified,
        running: e.running,
        spaces,
        matchedSpaces,
      },
    ]
  })
})
const savedRows = computed(() => saved.value.filter((s) => match(s.name)))

function toggle(key: string) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}
const close = () => emit('update:open', false)

function go(key: string) {
  close()
  if (activeWorkflow()?.path !== key) void switchToWorkflow(key)
}
function jump(key: string, id: string) {
  close()
  if (activeWorkflow()?.path === key) return activate(id)
  landOnAfterSwitch(key, id)
  void switchToWorkflow(key)
}

watch(
  () => props.open,
  async (on) => {
    if (!on) return
    q.value = ''
    expanded.value = new Set()
    savedOpen.value = false
    tabs.value = openWorkflows()
    saved.value = savedWorkflows()
    await nextTick()
    qEl.value?.focus()
  },
)
</script>

<style>
/* Not scoped: the content renders inside ZenPopover's teleported surface. */
.zwm {
  display: flex;
  flex-direction: column;
  width: 248px;
  max-width: 100%;
  color: var(--zen-text, #e5e5ea);
  font-size: 12px;
}
.zwm-q {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 4px;
  padding: 0 6px;
  height: 26px;
  border-radius: calc(var(--zen-radius, 6px) - 1px);
  background: color-mix(in srgb, var(--zen-text, #fff) 6%, transparent);
}
.zwm-q .mdi {
  color: var(--zen-muted, #9aa0aa);
  font-size: 14px;
}
.zwm-q input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: none;
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  font-size: 12px;
}
.zwm-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: min(60vh, 420px);
  overflow-x: hidden;
  overflow-y: auto;
}
.zwm-row {
  display: flex;
  align-items: center;
  min-height: 26px;
  border-radius: calc(var(--zen-radius, 6px) - 1px);
}
.zwm-row:hover,
.zwm-row:focus-within,
.zwm-space:hover,
.zwm-space:focus-visible,
.zwm-disclose:hover,
.zwm-disclose:focus-visible {
  background: color-mix(in srgb, var(--zen-text, #fff) 8%, transparent);
}
/* Resets at zero specificity, so the rules below win. */
:where(.zwm-row button, .zwm-space, .zwm-disclose) {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  outline: none;
}
.zwm-caret {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 22px;
  padding: 0;
  color: var(--zen-muted, #9aa0aa);
  font-size: 14px;
}
.zwm-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 26px;
  padding: 0 4px 0 2px;
  color: var(--zen-text, #e5e5ea);
  font-size: 12px;
  text-align: left;
}
.zwm-row.current .zwm-main {
  font-weight: 600;
}
.zwm-row.saved .zwm-main {
  color: var(--zen-muted, #9aa0aa);
}
.zwm-row.saved:hover .zwm-main {
  color: var(--zen-text, #e5e5ea);
}
.zwm-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zwm-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
}
.zwm-run {
  flex: none;
  color: var(--zen-accent, #6366f1);
  font-size: 12px;
}
/* The pin shows on hover or focus; a pinned row keeps a quiet filled pin. */
.zwm-pin {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 22px;
  padding: 0;
  color: var(--zen-muted, #9aa0aa);
  font-size: 13px;
  opacity: 0;
}
.zwm-pin .mdi {
  transform: rotate(35deg);
}
.zwm-pin.on,
.zwm-row:hover .zwm-pin,
.zwm-row:focus-within .zwm-pin {
  opacity: 1;
}
.zwm-pin:hover,
.zwm-pin:focus-visible {
  color: var(--zen-text, #e5e5ea);
}
.zwm-space {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  padding: 0 8px 0 22px;
  border-radius: calc(var(--zen-radius, 6px) - 1px);
  color: var(--zen-muted, #9aa0aa);
  font-size: 11.5px;
  text-align: left;
}
.zwm-space .mdi {
  font-size: 13px;
}
.zwm-space:hover,
.zwm-space.current {
  color: var(--zen-text, #e5e5ea);
}
.zwm-space.current .mdi {
  color: var(--zen-accent, #6366f1);
}
.zwm-disclose {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 24px;
  margin-top: 4px;
  padding: 0;
  border-top: 1px solid var(--zen-border, #3a3a44);
  border-radius: 0;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
  font-weight: 600;
}
.zwm-disclose .mdi {
  width: 18px;
  font-size: 14px;
}
.zwm-n {
  margin-left: 4px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}
.zwm-empty {
  padding: 6px 8px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
</style>
