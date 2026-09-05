<script setup lang="ts">
// The node table, shared by a pack's Nodes tab and the install-wide Node explorer.
// Rows expand in place for the full definition. Rendering is capped and extended on
// demand — /object_info routinely holds well over a thousand nodes, and mounting all of
// them makes the panel crawl for no benefit when a filter is two keystrokes away.
import { computed, ref, watch } from 'vue'
import { JsonTree } from '@nynxz/zenkit-ui'
import { revealNode } from '@/lib/host'
import type { NodeRow } from '@/lib/types'

const props = withDefaults(
  defineProps<{ nodes: NodeRow[]; showPack?: boolean; packLabels?: Record<string, string> }>(),
  { showPack: false, packLabels: () => ({}) },
)
const emit = defineEmits<{ gotoPack: [key: string] }>()

const PAGE = 250
const shown = ref(PAGE)
const open = ref<string | null>(null)

// A new filter result must start from the top again, not keep the previous page depth.
watch(
  () => props.nodes,
  () => {
    shown.value = PAGE
    open.value = null
  },
)

const visible = computed(() => props.nodes.slice(0, shown.value))
const flags = (n: NodeRow) =>
  [
    n.deprecated && { label: 'deprecated', cls: 'warn' },
    n.experimental && { label: 'experimental', cls: 'info' },
    n.apiNode && { label: 'api', cls: 'info' },
    n.outputNode && { label: 'output', cls: '' },
  ].filter(Boolean) as { label: string; cls: string }[]

function toggle(cls: string) {
  open.value = open.value === cls ? null : cls
}
</script>

<template>
  <div class="nt">
    <div v-if="!nodes.length" class="zi-empty">
      <i class="mdi mdi-cube-off-outline" />
      <span>No nodes.</span>
    </div>

    <template v-else>
      <div v-for="n in visible" :key="n.cls" class="nt-item">
        <!-- a div, not a button: the pack link nests inside it, and a button inside a
             button is invalid HTML that browsers silently un-nest -->
        <div
          class="nt-row"
          :class="{ on: open === n.cls }"
          role="button"
          tabindex="0"
          @click="toggle(n.cls)"
          @keydown.enter.prevent="toggle(n.cls)"
          @keydown.space.prevent="toggle(n.cls)"
        >
          <i class="nt-caret mdi" :class="open === n.cls ? 'mdi-menu-down' : 'mdi-menu-right'" />
          <!-- The one thing worth flagging inline: the server has it, the canvas doesn't. -->
          <i
            v-if="n.clientRegistered === false"
            class="mdi mdi-alert-circle-outline zi-fg-warn"
            title="Registered on the server, but LiteGraph has no type for it"
          />
          <code class="nt-cls zi-ell">{{ n.cls }}</code>
          <span v-if="n.display !== n.cls" class="nt-disp zi-ell zi-mut">{{ n.display }}</span>
          <button
            v-if="showPack"
            class="nt-pack zi-ell"
            :title="`Show ${packLabels[n.pack] ?? n.pack}`"
            @click.stop="emit('gotoPack', n.pack)"
          >
            {{ packLabels[n.pack] ?? n.pack }}
          </button>
          <span class="nt-grow" />
          <span v-if="n.inGraph" class="zi-chip on" :title="`${n.inGraph} in the open workflow`">
            ×{{ n.inGraph }}
          </span>
          <span v-for="f in flags(n)" :key="f.label" class="zi-chip" :class="f.cls">
            {{ f.label }}
          </span>
        </div>

        <div v-if="open === n.cls" class="nt-body">
          <div v-if="n.description" class="nt-desc">{{ n.description }}</div>
          <div class="nt-facts">
            <span v-if="n.category" class="zi-chip">
              <i class="mdi mdi-folder-outline" />
              {{ n.category }}
            </span>
            <span class="zi-chip">
              <i class="mdi mdi-import" />
              {{ n.inputsRequired }} req
              <template v-if="n.inputsOptional">, {{ n.inputsOptional }} opt</template>
            </span>
            <span class="zi-chip">
              <i class="mdi mdi-export" />
              {{ n.outputs.length ? n.outputs.join(', ') : 'none' }}
            </span>
            <span v-if="n.pythonModule" class="zi-chip">
              <i class="mdi mdi-language-python" />
              {{ n.pythonModule }}
            </span>
            <span v-if="n.clientRegistered === true" class="zi-chip ok">
              <i class="mdi mdi-check" />
              on canvas
            </span>
            <span v-else-if="n.clientRegistered === false" class="zi-chip warn">
              <i class="mdi mdi-close" />
              not on canvas
            </span>
            <button v-if="n.inGraph" class="nt-btn" @click="revealNode(n.cls)">
              <i class="mdi mdi-target" />
              find in workflow
            </button>
          </div>
          <details v-if="n.def" class="nt-raw">
            <summary>raw definition</summary>
            <JsonTree :data="n.def" :default-open="1" />
          </details>
        </div>
      </div>

      <button v-if="nodes.length > shown" class="nt-more" @click="shown += PAGE">
        showing {{ shown }} of {{ nodes.length }} — show
        {{ Math.min(PAGE, nodes.length - shown) }} more
      </button>
    </template>
  </div>
</template>

<style scoped>
.nt {
  display: flex;
  flex-direction: column;
}
.nt-item {
  border-bottom: 1px solid var(--zi-line);
}
.nt-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 2px;
  cursor: pointer;
  min-width: 0;
}
.nt-row:hover {
  background: var(--zi-fill);
}
.nt-row:focus-visible {
  outline: 1px solid var(--zen-accent, #3b82f6);
  outline-offset: -1px;
}
.nt-row.on {
  background: var(--zi-fill);
}
.nt-caret {
  color: var(--zen-muted, #9aa0aa);
  flex: 0 0 auto;
}
.nt-cls {
  flex: 0 1 auto;
  max-width: 42%;
}
.nt-disp {
  flex: 0 1 auto;
  max-width: 32%;
  font-size: 11px;
}
.nt-pack {
  flex: 0 1 auto;
  max-width: 30%;
  background: none;
  border: none;
  padding: 0 2px;
  font: inherit;
  font-size: 10px;
  color: var(--zen-accent, #3b82f6);
  cursor: pointer;
  text-align: left;
}
.nt-pack:hover {
  text-decoration: underline;
}
.nt-grow {
  flex: 1 1 auto;
  min-width: 4px;
}
.nt-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 2px 8px 20px;
}
.nt-desc {
  color: var(--zen-muted, #9aa0aa);
}
.nt-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.nt-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--zi-fill);
  border: 1px solid var(--zi-line);
  border-radius: var(--zen-radius, 6px);
  color: inherit;
  font: inherit;
  font-size: 11px;
  padding: 1px 7px;
  cursor: pointer;
}
.nt-btn:hover {
  border-color: var(--zen-accent, #3b82f6);
}
.nt-raw summary {
  cursor: pointer;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
.nt-more {
  margin: 8px 0;
  padding: 5px;
  background: var(--zi-fill);
  border: 1px solid var(--zi-line);
  border-radius: var(--zen-radius, 6px);
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  cursor: pointer;
}
.nt-more:hover {
  color: var(--zen-text, #fff);
  border-color: var(--zen-accent, #3b82f6);
}
</style>
