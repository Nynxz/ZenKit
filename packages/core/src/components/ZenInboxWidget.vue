<template>
  <ZenPopover v-model:open="open" placement="top-end" :offset="8">
    <template #trigger="{ toggle, active }">
      <button
        class="zib-chip"
        :class="{ on: active, unread: inbox.unread > 0, failed: hasError }"
        :title="summary"
        @click="toggle"
      >
        <i class="mdi" :class="inbox.items.length ? 'mdi-bell-outline' : 'mdi-bell-off-outline'" />
        <span class="zib-count" :class="{ shown: inbox.unread > 0 }">{{ inbox.unread }}</span>
      </button>
    </template>
    <div class="zib-pop">
      <div class="zib-head">
        <span>Notifications</span>
        <button
          class="zib-clear"
          :class="{ hidden: !inbox.items.length }"
          :tabindex="inbox.items.length ? 0 : -1"
          @click="clearInbox"
        >
          Clear all
        </button>
      </div>
      <div v-if="!inbox.items.length" class="zib-empty">
        Nothing yet. ComfyUI's notifications collect here while a workspace is open.
      </div>
      <div v-for="item in newestFirst" :key="item.id" class="zib-item" :class="item.kind">
        <i class="mdi zib-icon" :class="ICONS[item.kind]" />
        <span class="zib-title">{{ item.title }}</span>
        <button class="zib-x" title="Dismiss" @click="removeFromInbox(item.id)">
          <i class="mdi mdi-close" />
        </button>
        <span v-if="item.description" class="zib-desc">{{ item.description }}</span>
        <span class="zib-foot">
          <span class="zib-time">{{ ago(item.time) }}</span>
          <button v-if="item.action" class="zib-action" @click="run(item)">
            {{ item.action.label }}
          </button>
        </span>
      </div>
    </div>
  </ZenPopover>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ZenPopover } from '@nynxz/zenkit-ui'
import { clearInbox, inbox, markInboxRead, removeFromInbox, type InboxItem } from '../comfyToasts'

const ICONS: Record<InboxItem['kind'], string> = {
  success: 'mdi-check-circle-outline',
  error: 'mdi-close-circle-outline',
  info: 'mdi-information-outline',
  warning: 'mdi-alert-outline',
}

const open = ref(false)
watch(open, (now) => now && markInboxRead())
const newestFirst = computed(() => [...inbox.items].reverse())
const hasError = computed(() => inbox.unread > 0 && inbox.items.some((i) => i.kind === 'error'))
const summary = computed(() =>
  inbox.unread
    ? `${inbox.unread} new notification${inbox.unread === 1 ? '' : 's'}`
    : 'Notifications',
)

function ago(time: number): string {
  const s = Math.round((Date.now() - time) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return `${Math.round(s / 3600)} h ago`
}

function run(item: InboxItem) {
  void Promise.resolve(item.action?.onClick()).finally(() => removeFromInbox(item.id))
}
</script>

<style scoped>
.zib-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: var(--zen-radius, 8px);
  background: transparent;
  color: var(--zen-muted, #9aa0aa);
  font-size: 16px;
  cursor: pointer;
}
.zib-chip:hover,
.zib-chip.on {
  background: var(--zen-control-hover-bg, var(--zen-surface-2, #27272e));
  color: var(--zen-text, #e5e5ea);
}
.zib-chip.unread {
  color: var(--zen-text, #e5e5ea);
}
.zib-count {
  position: absolute;
  top: -2px;
  right: -3px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
  opacity: 0;
  transform: scale(0.6);
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.zib-chip.failed .zib-count {
  background: var(--zen-danger);
  color: var(--zen-danger-text, #fff);
}
.zib-count.shown {
  opacity: 1;
  transform: none;
}
.zib-pop {
  width: 340px;
  max-height: 420px;
  overflow-y: auto;
  padding: 6px;
  font-size: 12px;
  color: var(--zen-text, #e5e5ea);
}
.zib-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px 8px;
  font-weight: 600;
}
.zib-clear {
  border: 0;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  font: inherit;
  font-weight: 400;
  cursor: pointer;
}
.zib-clear.hidden {
  visibility: hidden;
}
.zib-clear:hover {
  color: var(--zen-text, #e5e5ea);
}
.zib-empty {
  padding: 10px 6px 12px;
  color: var(--zen-muted, #9aa0aa);
}
.zib-item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  column-gap: 8px;
  row-gap: 2px;
  align-items: start;
  padding: 8px 6px;
  border-top: 1px solid var(--zen-surface-border, var(--zen-border, #3a3a44));
}
.zib-icon {
  font-size: 15px;
  line-height: 18px;
  text-align: center;
}
.zib-item.success .zib-icon {
  color: var(--zen-ok);
}
.zib-item.error .zib-icon {
  color: var(--zen-danger);
}
.zib-item.warning .zib-icon {
  color: var(--zen-warn);
}
.zib-item.info .zib-icon {
  color: var(--zen-info, var(--zen-accent));
}
.zib-title {
  min-width: 0;
  font-weight: 600;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.zib-x {
  border: 0;
  background: none;
  padding: 0 2px;
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
}
.zib-x:hover {
  color: var(--zen-text, #e5e5ea);
}
.zib-desc,
.zib-foot {
  grid-column: 2 / span 2;
}
.zib-desc {
  color: var(--zen-muted, #9aa0aa);
  overflow-wrap: anywhere;
  white-space: pre-line;
}
.zib-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
}
.zib-time {
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
.zib-action {
  border: 1px solid var(--zen-control-border, transparent);
  border-radius: var(--zen-radius, 6px);
  background: var(--zen-control-bg, var(--zen-surface-2));
  color: var(--zen-text, #e5e5ea);
  padding: 3px 10px;
  font: inherit;
  cursor: pointer;
}
.zib-action:hover {
  background: var(--zen-control-hover-bg, var(--zen-surface-2));
}
</style>
