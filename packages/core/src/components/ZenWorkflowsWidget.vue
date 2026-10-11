<template>
  <div v-if="wfName || chips.length" class="zww">
    <!-- The current workflow: click for the workflow menu. -->
    <button
      v-if="wfName"
      ref="pill"
      type="button"
      class="zww-b zww-pill"
      :class="{ on: menuOpen }"
      :title="`${wfName} · its workspaces are saved in the workflow · click to switch workflow`"
      aria-haspopup="dialog"
      :aria-expanded="menuOpen"
      @click="menuOpen = !menuOpen"
    >
      <i class="mdi mdi-sitemap-outline" />
      <span class="zww-name">{{ wfName }}</span>
      <i class="mdi mdi-chevron-up zww-chev" />
    </button>
    <!-- Pinned workflows, as chips. -->
    <button
      v-for="c in chips"
      :key="c.key"
      type="button"
      class="zww-b zww-chip"
      :title="`${c.name}${c.modified ? ' · unsaved changes' : ''} · ${c.open ? 'click to switch' : 'click to open'} · right-click to unpin`"
      @click="switchToWorkflow(c.key)"
      @contextmenu.prevent.stop="openChipMenu($event, c.key)"
    >
      <span class="zww-name">{{ c.name }}</span>
      <span v-if="c.modified" class="zww-dot" />
    </button>
    <ZenContextMenu ref="chipMenu" :items="chipMenuItems" />
    <ZenWorkflowMenu v-model:open="menuOpen" :anchor="pill" />
  </div>
</template>

<script setup lang="ts">
// Built-in taskbar widget: the current workflow's name (opens the workflow menu), followed by
// the pinned workflows as chips. Names are rendered as text.
import { computed, ref } from 'vue'
import { ZenContextMenu, type ContextMenuItem } from '@nynxz/zenkit-ui'
import { pinWorkflow, switchToWorkflow, wf, workflowLabel } from '../comfyWorkflows'
import { currentWorkflowName } from '../workspaces'
import ZenWorkflowMenu from './ZenWorkflowMenu.vue'

const wfName = computed(() => currentWorkflowName())
const menuOpen = ref(false)
const pill = ref<HTMLElement | null>(null)

const MAX_CHIPS = 5
const chips = computed(() =>
  wf.pinned
    .filter((key) => key !== wf.current)
    .map((key) => {
      const e = wf.open.find((x) => x.key === key)
      return { key, name: workflowLabel(key), modified: !!e?.modified, open: !!e }
    })
    .filter((c): c is typeof c & { name: string } => !!c.name)
    .slice(0, MAX_CHIPS),
)

const chipMenu = ref<InstanceType<typeof ZenContextMenu> | null>(null)
const chipMenuFor = ref<string | null>(null)
const chipMenuItems = computed<ContextMenuItem[]>(() => {
  const key = chipMenuFor.value
  if (!key) return []
  return [
    { heading: workflowLabel(key) ?? key },
    { label: 'Switch to it', icon: 'mdi mdi-arrow-right', run: () => switchToWorkflow(key) },
    { label: 'Unpin', icon: 'mdi mdi-pin-off-outline', run: () => pinWorkflow(key, false) },
  ]
})
function openChipMenu(e: MouseEvent, key: string) {
  chipMenuFor.value = key
  // Beside the taskbar (above a bottom one), never over it.
  const bar = (e.currentTarget as HTMLElement | null)?.closest('[data-zen-taskbar]')
  chipMenu.value?.show(e, { clear: bar?.getBoundingClientRect() })
}
</script>

<style scoped>
.zww {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  height: 24px;
}
.zww-b {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--zen-radius, 6px);
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}
.zww-b:hover,
.zww-pill.on {
  background: color-mix(in srgb, var(--zen-text, #fff) 8%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.zww-pill {
  padding: 0 8px;
  color: var(--zen-text, #e5e5ea);
  opacity: 0.85;
}
.zww-pill.on,
.zww-pill:hover {
  opacity: 1;
}
.zww-b .mdi {
  font-size: 14px;
}
.zww-chev {
  margin-left: -1px;
  font-size: 12px !important;
  opacity: 0.7;
}
.zww-name {
  max-width: 80px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zww-pill .zww-name {
  max-width: 120px;
}
.zww-dot {
  flex: none;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.6;
}
@media (prefers-reduced-motion: reduce) {
  .zww-b {
    transition: none;
  }
}
</style>
