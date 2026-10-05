<script setup lang="ts">
import { ref } from 'vue'

import type { Item } from '../lib/conversation'
import { focusNode } from '../lib/graphTools'

type ToolItem = Extract<Item, { kind: 'tool' }>

const { steps } = defineProps<{ steps: ToolItem[] }>()
const open = ref<string | null>(null)

const ICONS: Record<string, string> = {
  read_workflow: 'mdi-file-tree-outline',
  find_node_types: 'mdi-magnify',
  add_node: 'mdi-plus-box-outline',
  set_widget: 'mdi-tune-variant',
  connect: 'mdi-vector-link',
  disconnect: 'mdi-link-variant-off',
  remove_node: 'mdi-trash-can-outline',
  move_node: 'mdi-cursor-move',
  check_layout: 'mdi-view-dashboard-outline',
  queue_prompt: 'mdi-play-circle-outline',
  wait_for_runs: 'mdi-timer-sand',
  use_as_input: 'mdi-image-move',
  look_at: 'mdi-eye-outline',
  view_layout: 'mdi-sitemap-outline',
  resize_node: 'mdi-resize',
  tidy_layout: 'mdi-auto-fix',
  viewer_show: 'mdi-image-multiple-outline',
  viewer_merge: 'mdi-merge',
  media_view: 'mdi-fullscreen',
  media_list: 'mdi-folder-image',
  workflows_list: 'mdi-file-tree-outline',
  workflows_open: 'mdi-swap-horizontal',
  workflows_new: 'mdi-file-plus-outline',
  workflows_templates: 'mdi-view-gallery-outline',
  workflows_open_template: 'mdi-file-document-plus-outline',
  stash_search: 'mdi-magnify',
  stash_show: 'mdi-database-eye-outline',
  panels_list: 'mdi-view-grid-outline',
  panels_open: 'mdi-application-outline',
  panels_arrange: 'mdi-arrange-bring-forward',
  panels_command: 'mdi-console-line',
}

const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))
const short = (v: unknown) => {
  const s = str(v)
  return s.length > 40 ? `${s.slice(0, 40)}…` : s
}

function runsDetail(list: unknown[]): string {
  const done = list.filter((run) => (run as { status?: unknown }).status === 'done').length
  return `${done}/${list.length} done`
}

/** One line saying what a step did, in the user's terms, from its arguments and result. */
function phrase(step: ToolItem): { text: string; detail?: string } {
  const a = step.args ?? {}
  const r = (step.result?.ok ? step.result.result : undefined) as
    Record<string, unknown> | undefined
  switch (step.name) {
    case 'read_workflow':
      return {
        text: 'Read the workflow',
        detail: Array.isArray(r?.nodes) ? `${r.nodes.length} nodes` : undefined,
      }
    case 'find_node_types':
      return {
        text: `Searched nodes for “${str(a.query)}”`,
        detail: Array.isArray(r) ? `${r.length} found` : undefined,
      }
    case 'add_node':
      return { text: `Added ${str(a.type)}`, detail: r?.id != null ? `#${str(r.id)}` : undefined }
    case 'set_widget':
      return {
        text: `${str(a.name)} on ${r?.node ? str(r.node) : `#${str(a.node_id)}`}`,
        detail: r ? `${short(r.from)} → ${short(r.to)}` : short(a.value),
      }
    case 'connect':
      return {
        text: `Connected ${str(a.output)} → ${str(a.input)}`,
        detail: r ? `${str(r.from)} → ${str(r.to)}` : undefined,
      }
    case 'disconnect':
      return { text: `Disconnected ${str(a.input)}`, detail: `#${str(a.node_id)}` }
    case 'remove_node':
      return { text: `Removed ${r?.removed ? str(r.removed) : `#${str(a.node_id)}`}` }
    case 'move_node':
      return { text: `Moved #${str(a.node_id)}`, detail: `${str(a.x)}, ${str(a.y)}` }
    case 'check_layout':
      return {
        text: 'Checked the layout',
        detail: Array.isArray(r?.overlaps) ? `${r.overlaps.length} overlaps` : undefined,
      }
    case 'queue_prompt': {
      const count = Array.isArray(a.variations) && a.variations.length > 1 ? a.variations.length : 1
      const text = count > 1 ? `Ran ${count} variations` : 'Ran the workflow'
      if (Array.isArray(r?.queued))
        return { text: count > 1 ? `Queued ${count} variations` : 'Queued the workflow' }
      if (Array.isArray(r?.runs)) return { text, detail: runsDetail(r.runs) }
      return { text, detail: r ? `${str(r.status)} · ${str(r.seconds)}s` : undefined }
    }
    case 'wait_for_runs':
      return {
        text: 'Waited for the runs',
        detail: Array.isArray(r?.runs) ? runsDetail(r.runs) : undefined,
      }
    case 'resize_node':
      return {
        text: `Resized ${r?.node ? str(r.node) : `#${str(a.node_id)}`}`,
        detail: Array.isArray(r?.size) ? r.size.join(' × ') : undefined,
      }
    case 'view_layout':
      return {
        text: 'Looked at the layout',
        detail: r?.nodes != null ? `${str(r.nodes)} nodes` : undefined,
      }
    case 'tidy_layout':
      return {
        text: 'Tidied the layout',
        detail: r?.arranged != null ? `${str(r.arranged)} nodes` : undefined,
      }
    case 'look_at':
      return {
        text: `Looked at ${Array.isArray(a.media) ? a.media.length : 1} image${Array.isArray(a.media) && a.media.length > 1 ? 's' : ''}`,
        detail: Array.isArray(a.media) ? a.media.map(short).join(', ') : short(a.media),
      }
    case 'use_as_input':
      return {
        text: `Loaded ${r?.to ? short(r.to) : short(a.media)} into ${r?.node ? str(r.node) : `#${str(a.node_id)}`}`,
      }
    case 'viewer_show':
      if (Array.isArray(r?.viewers)) return { text: `Opened ${r.viewers.length} Media Viewers` }
      return {
        text: `Showed media in ${r?.title ? str(r.title) : 'a Media Viewer'}`,
        detail: r?.shown != null ? `${str(r.shown)} items` : undefined,
      }
    case 'viewer_merge':
      return {
        text: 'Merged the Media Viewers',
        detail: r
          ? `${str(r.moved)} moved · ${Array.isArray(r.closed) ? r.closed.length : 0} closed`
          : undefined,
      }
    case 'workflows_list':
      return {
        text: 'Looked at the workflows',
        detail: Array.isArray(r?.open) ? `${r.open.length} open` : undefined,
      }
    case 'workflows_open':
      return {
        text: `Switched to ${r?.active ? str(r.active) : str(a.workflow)}`,
        detail: r?.nodes != null ? `${str(r.nodes)} nodes` : undefined,
      }
    case 'workflows_new':
      return { text: `Opened a new workflow${r?.active ? `: ${str(r.active)}` : ''}` }
    case 'workflows_templates':
      return {
        text: a.query ? `Searched templates for “${str(a.query)}”` : 'Browsed templates',
        detail: r ? `${str(r.total)} found` : undefined,
      }
    case 'workflows_open_template':
      return {
        text: `Opened template ${r?.active ? str(r.active) : str(a.template)}`,
        detail: r?.nodes != null ? `${str(r.nodes)} nodes` : undefined,
      }
    case 'media_list':
      return {
        text: `Listed recent ${str(a.folder ?? 'output')} files`,
        detail: Array.isArray(r?.media) ? `${r.media.length} of ${str(r.total)}` : undefined,
      }
    case 'stash_search':
      return {
        text: a.query
          ? `Searched Stash for “${str(a.query)}”`
          : `Browsed Stash ${str(a.kind ?? 'images')}`,
        detail: r ? `${str(r.total)} found` : undefined,
      }
    case 'stash_show':
      return {
        text: a.id
          ? `Opened ${str(a.kind ?? 'item')} ${str(a.id)} in Stash`
          : `Showed “${str(a.query ?? '')}” in Stash`,
      }
    case 'media_view':
      return { text: 'Showed media full screen' }
    case 'panels_list':
      return { text: 'Looked at the panels' }
    case 'panels_open':
      return {
        text: `Opened ${str(a.title ?? a.type)}`,
        detail: r?.panel_id ? str(r.panel_id) : undefined,
      }
    case 'panels_arrange':
      return {
        text: `${typeof a.action === 'string' ? a.action[0]!.toUpperCase() + a.action.slice(1) : 'Arranged'} ${str(a.panel_id)}`,
        detail: typeof a.dock === 'string' ? a.dock : undefined,
      }
    case 'panels_command':
      return { text: `${str(a.command)} on ${str(a.panel_id)}` }
    default:
      return { text: step.name.replace(/_/g, ' ') }
  }
}

/** The node a step is about, so clicking it can show the node on the canvas. */
function nodeOf(step: ToolItem): number | null {
  const a = step.args ?? {}
  const r = (step.result?.ok ? step.result.result : undefined) as
    Record<string, unknown> | undefined
  const id = a.node_id ?? a.to_node ?? r?.id
  return typeof id === 'number'
    ? id
    : typeof id === 'string' && /^\d+$/.test(id)
      ? Number(id)
      : null
}

function onClick(step: ToolItem): void {
  const id = nodeOf(step)
  if (id !== null && step.status === 'done') focusNode(id)
  open.value = open.value === step.callId ? null : step.callId
}
</script>

<template>
  <ol class="zs">
    <li v-for="step in steps" :key="step.callId" class="zs-step" :class="step.status">
      <button class="zs-row" @click="onClick(step)">
        <span class="zs-icon">
          <i class="mdi" :class="ICONS[step.name] ?? 'mdi-wrench-outline'" />
        </span>
        <span class="zs-text">{{ phrase(step).text }}</span>
        <span v-if="phrase(step).detail" class="zs-detail">{{ phrase(step).detail }}</span>
        <Transition name="zs-pop" mode="out-in">
          <i v-if="step.status === 'running'" key="r" class="mdi mdi-loading mdi-spin zs-state" />
          <i v-else-if="step.status === 'done'" key="d" class="mdi mdi-check zs-state" />
          <i v-else key="e" class="mdi mdi-alert-circle-outline zs-state" />
        </Transition>
      </button>
      <div v-if="step.result && !step.result.ok && open !== step.callId" class="zs-error">
        {{ step.result.error }}
      </div>
      <div v-if="open === step.callId" class="zs-body">
        <pre>{{ JSON.stringify(step.args, null, 2) }}</pre>
        <pre v-if="step.result">{{
          step.result.ok ? JSON.stringify(step.result.result, null, 2) : step.result.error
        }}</pre>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.zs {
  position: relative;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* The timeline thread that joins the steps' icons. */
.zs::before {
  content: '';
  position: absolute;
  top: 14px;
  bottom: 14px;
  left: 13px;
  width: 1px;
  background: var(--zen-surface-border, var(--zen-border));
}
.zs-step {
  position: relative;
  animation: zs-in 0.24s ease both;
}
.zs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 28px;
  padding: 2px 6px 2px 0;
  border: 0;
  border-radius: var(--zen-radius);
  background: none;
  color: var(--zen-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.zs-row:hover {
  background: color-mix(in srgb, var(--zen-text) 5%, transparent);
}
.zs-icon {
  position: relative;
  display: inline-flex;
  flex: 0 0 26px;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: 50%;
  background: var(--zen-bg);
  color: var(--zen-muted);
  font-size: 14px;
  transition:
    color 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease;
}
.zs-step.running .zs-icon {
  border-color: var(--zen-accent);
  color: var(--zen-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--zen-accent) 18%, transparent);
}
.zs-step.done .zs-icon {
  color: var(--zen-text);
}
.zs-step.error .zs-icon {
  border-color: color-mix(in srgb, var(--zen-danger) 60%, transparent);
  color: var(--zen-danger);
}
.zs-text {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zs-step.running .zs-text {
  background: linear-gradient(
      90deg,
      var(--zen-muted) 0%,
      var(--zen-text) 50%,
      var(--zen-muted) 100%
    )
    0 0 / 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: zs-shimmer 1.4s linear infinite;
}
.zs-detail {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--zen-muted);
  font-family: var(--zen-mono);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zs-state {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--zen-muted);
}
.zs-step.done .zs-state {
  color: var(--zen-ok);
}
.zs-step.error .zs-state,
.zs-error {
  color: var(--zen-danger);
}
.zs-error {
  display: -webkit-box;
  margin: 0 6px 4px 34px;
  overflow: hidden;
  font-size: 11.5px;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.zs-body {
  margin: 2px 6px 6px 34px;
}
.zs-body pre {
  max-height: 200px;
  margin: 0 0 4px;
  padding: 6px 8px;
  overflow: auto;
  border-radius: 6px;
  background: color-mix(in srgb, var(--zen-text) 6%, transparent);
  font-family: var(--zen-mono);
  font-size: 11px;
  white-space: pre-wrap;
}
.zs-pop-enter-active,
.zs-pop-leave-active {
  transition:
    transform 0.18s ease,
    opacity 0.18s ease;
}
.zs-pop-enter-from {
  transform: scale(0.4);
  opacity: 0;
}
.zs-pop-leave-to {
  transform: scale(1.4);
  opacity: 0;
}
@keyframes zs-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
@keyframes zs-shimmer {
  to {
    background-position: -200% 0;
  }
}
</style>
