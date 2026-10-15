<template>
  <div class="zb" :class="{ 'in-panel': panel }">
    <div v-if="!panel && popped" class="zb-away">
      <span>{{ countText }} · in a panel</span>
      <ZenButton sm icon="mdi mdi-open-in-new" @click="popOut(node, true)">Show</ZenButton>
    </div>

    <template v-else>
      <header class="zb-bar">
        <span class="zb-count">{{ countText }}</span>
        <ZenIconButton
          size="sm"
          :icon="adding ? 'mdi mdi-check' : 'mdi mdi-plus'"
          :active="adding"
          :title="adding ? 'Done adding' : 'Bind widgets from other nodes'"
          @click="adding = !adding"
        />
        <ZenIconButton
          v-if="!panel && canPopOut()"
          size="sm"
          icon="mdi mdi-open-in-new"
          title="Open in a ZenKit panel — tile it into a workspace"
          @click="popOut(node, true)"
        />
      </header>

      <div v-if="adding" class="zb-pick">
        <ZenInput
          ref="search"
          sm
          :model-value="query"
          placeholder="Find a node or widget…"
          @update:model-value="query = String($event ?? '')"
          @keydown.escape="adding = false"
        />
        <div class="zb-scroll">
          <div v-for="n in candidates" :key="n.id" class="zb-cand">
            <div class="zb-cand-title">
              {{ n.title || n.type }}
              <span class="zb-id">#{{ n.id }}</span>
            </div>
            <div class="zb-chips">
              <button
                v-for="w in n.widgets"
                :key="w.name"
                type="button"
                class="zb-chip"
                :class="{ on: hasBinding(bindings, n.id, w.name) }"
                @click="toggle(n.id, w.name)"
              >
                {{ w.name }}
              </button>
            </div>
          </div>
          <p v-if="!candidates.length" class="zb-note">No node has a widget matching that.</p>
        </div>
      </div>

      <div class="zb-scroll zb-list">
        <div
          v-for="(b, i) in bindings"
          :key="b.id"
          class="zb-row"
          :class="{
            missing: !targets[i],
            wide: targets[i] && kindOf(i) === 'multiline',
            over: dropAt === i,
          }"
          @dragover.prevent="dragFrom !== null && (dropAt = i)"
          @drop.prevent="drop(i)"
        >
          <span
            class="zb-grip mdi mdi-drag-vertical"
            draggable="true"
            title="Drag to reorder"
            @dragstart="startDrag($event, i)"
            @dragend="dragFrom = dropAt = null"
          />
          <ZenInput
            v-if="renaming === b.id"
            ref="renameInput"
            class="zb-label"
            sm
            :model-value="b.label ?? b.widget"
            @keydown.enter="finishRename(b.id, ($event.target as HTMLInputElement).value)"
            @keydown.escape="renaming = null"
            @blur="finishRename(b.id, ($event.target as HTMLInputElement).value)"
          />
          <span
            v-else
            class="zb-label"
            :title="`${sourceName(i)} · ${b.widget} — double-click to rename`"
            @dblclick="startRename(b.id)"
          >
            {{ b.label ?? b.widget }}
            <small>{{ sourceName(i) }}</small>
          </span>
          <BindControl v-if="targets[i]" class="zb-ctl" :target="targets[i]!" :value="values[i]" />
          <span v-else class="zb-ctl zb-note">node #{{ b.node }} is gone</span>
          <span class="zb-acts">
            <ZenIconButton
              v-if="targets[i]"
              size="sm"
              icon="mdi mdi-crosshairs-gps"
              title="Show the node"
              @click="revealNode(b.node)"
            />
            <ZenIconButton size="sm" icon="mdi mdi-close" title="Unbind" @click="remove(b.id)" />
          </span>
        </div>
        <ZenEmpty v-if="!bindings.length && !adding" icon="mdi mdi-tune-variant" class="zb-empty">
          Right-click any node →
          <b>Bind to Zen Bind</b>
          , or + to pick widgets here.
        </ZenEmpty>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Zen Bind's body — on the node, or in its ZenKit panel. A list of controls for widgets of other
 * nodes, each edited in place and kept in step with the widget as it changes on the canvas.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ZenButton, ZenEmpty, ZenIconButton, ZenInput } from '@nynxz/zenkit-ui'
import { revealNode } from '@nynxz/zenkit-nodekit'

import BindControl from './BindControl.vue'
import {
  BIND_TYPE,
  bindableWidgets,
  controlKind,
  hasBinding,
  moveBinding,
  toggleBinding,
} from './bindings'
import { canPopOut, popOut } from './panel'
import { bindingsOf, graphNodes, openPanels, setBindings, targetOf, type BindNode } from './store'

const props = defineProps<{ node: BindNode; panel?: boolean }>()
const node = props.node

const list = bindingsOf(node)
const bindings = computed(() => list.value)
const popped = computed(() => openPanels.has(node))
const countText = computed(() => {
  const n = bindings.value.length
  return n ? `${n} control${n === 1 ? '' : 's'}` : 'No controls'
})

const tick = ref(0)
const targets = computed(() => {
  void tick.value
  return bindings.value.map((b) => targetOf(node, b))
})
const values = ref<unknown[]>([])
const kindOf = (i: number) => {
  const t = targets.value[i]
  return t ? controlKind(t.widget) : null
}
function sourceName(i: number) {
  const t = targets.value[i]
  return t ? t.node.title || t.node.type || `#${t.node.id}` : `#${bindings.value[i]?.node}`
}

let frame = 0
let frames = 0
function follow() {
  frame = requestAnimationFrame(follow)
  if (++frames % 30 === 0) tick.value++
  const now = targets.value.map((t) => t?.widget.value)
  if (now.length !== values.value.length || now.some((v, i) => v !== values.value[i]))
    values.value = now
}
onMounted(() => (frame = requestAnimationFrame(follow)))
onBeforeUnmount(() => cancelAnimationFrame(frame))

function save(next: typeof list.value) {
  setBindings(node, next)
}
function toggle(id: string | number, widget: string) {
  save(toggleBinding(bindings.value, id, widget))
}
function remove(id: string) {
  save(bindings.value.filter((b) => b.id !== id))
}

const adding = ref(false)
const query = ref('')
const search = ref<{ $el?: HTMLElement } | null>(null)
watch(adding, async (on) => {
  if (!on) return
  query.value = ''
  await nextTick()
  search.value?.$el?.querySelector?.('input')?.focus()
})
const candidates = computed(() => {
  void tick.value
  const q = query.value.trim().toLowerCase()
  return graphNodes(node.graph)
    .filter((n) => n.type !== BIND_TYPE)
    .map((n) => {
      const widgets = bindableWidgets(n)
      const named = `${n.title ?? ''} ${n.type ?? ''} #${n.id}`.toLowerCase()
      return {
        id: n.id,
        title: n.title,
        type: n.type,
        widgets:
          !q || named.includes(q)
            ? widgets
            : widgets.filter((w) => w.name.toLowerCase().includes(q)),
      }
    })
    .filter((n) => n.widgets.length)
})

const renaming = ref<string | null>(null)
const renameInput = ref<{ $el?: HTMLElement }[]>([])
async function startRename(id: string) {
  renaming.value = id
  await nextTick()
  const input = renameInput.value[0]?.$el?.querySelector?.('input')
  input?.focus()
  input?.select()
}
function finishRename(id: string, text: string) {
  if (renaming.value !== id) return
  renaming.value = null
  const label = text.trim()
  save(
    bindings.value.map((b) => {
      if (b.id !== id) return b
      const { label: _old, ...rest } = b
      return label && label !== b.widget ? { ...rest, label } : rest
    }),
  )
}

const dragFrom = ref<number | null>(null)
const dropAt = ref<number | null>(null)
function startDrag(e: DragEvent, i: number) {
  dragFrom.value = i
  e.dataTransfer?.setData('text/plain', bindings.value[i]?.id ?? '')
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function drop(i: number) {
  const from = dragFrom.value
  dragFrom.value = dropAt.value = null
  if (from !== null) save(moveBinding(bindings.value, from, i))
}
</script>

<style scoped>
.zb {
  display: flex;
  flex-direction: column;
  gap: 6px;
  height: 100%;
  min-height: 0;
  color: var(--zen-text, #e5e5ea);
  font-size: 12px;
}
.zb.in-panel {
  box-sizing: border-box;
  padding: 8px;
}
.zb-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.zb-count {
  flex: 1;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--zen-muted, #9aa0aa);
}
.zb-scroll {
  min-height: 0;
  overflow: auto;
}
.zb-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  container-type: inline-size;
}
.zb-pick {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: none;
  max-height: 55%;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--zen-border, #34343c);
}
.zb-pick .zb-scroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.zb-cand-title {
  margin-bottom: 4px;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
.zb-id {
  opacity: 0.6;
}
.zb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.zb-chip {
  height: 22px;
  padding: 0 9px;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: 999px;
  background: transparent;
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.zb-chip:hover {
  border-color: color-mix(in srgb, var(--zen-text, #fff) 30%, transparent);
}
.zb-chip.on {
  border-color: color-mix(in srgb, var(--zen-accent, #6366f1) 70%, transparent);
  background: color-mix(in srgb, var(--zen-accent, #6366f1) 20%, transparent);
}
.zb-row {
  display: grid;
  grid-template-columns: 12px minmax(64px, 34%) minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  border-radius: 6px;
}
.zb-row.wide {
  grid-template-columns: 12px minmax(0, 1fr) auto;
}
.zb-row.wide .zb-ctl {
  grid-column: 1 / -1;
  grid-row: 2;
}
@container (max-width: 340px) {
  .zb-row {
    grid-template-columns: 12px minmax(0, 1fr) auto;
    row-gap: 2px;
  }
  .zb-row .zb-label {
    flex-direction: row;
    align-items: baseline;
    gap: 6px;
  }
  .zb-row .zb-ctl {
    grid-column: 2 / -1;
    grid-row: 2;
  }
}
.zb-row.over {
  box-shadow: inset 0 2px 0 var(--zen-accent, #6366f1);
}
.zb-row.missing .zb-label {
  opacity: 0.5;
}
.zb-grip {
  color: var(--zen-muted, #9aa0aa);
  cursor: grab;
  opacity: 0.4;
}
.zb-row:hover .zb-grip {
  opacity: 1;
}
.zb-label {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: default;
}
.zb-label small {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--zen-muted, #9aa0aa);
  font-size: 10px;
}
.zb-acts {
  display: flex;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.zb-row:hover .zb-acts,
.zb-row.missing .zb-acts {
  opacity: 1;
}
.zb-note {
  margin: 0;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
.zb-empty {
  flex: 1;
}
.zb-away {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 100%;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
</style>
