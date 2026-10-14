<script setup lang="ts">
import { ZenIconButton, ZenMenuItem, ZenPopover } from '@nynxz/zenkit-ui'
import { ref } from 'vue'

import { useConversation } from '../lib/conversation'
import { useMediaDrop } from '../lib/drop'
import AgentComposer from './AgentComposer.vue'
import AgentSettings from './AgentSettings.vue'
import AgentTranscript from './AgentTranscript.vue'

const { title, attach, threads, threadId, send, open, newChat, remove, refreshThreads } =
  useConversation()

const SUGGESTIONS = [
  'Explain what this workflow does',
  'Set the sampler to 30 steps',
  'Add a LoRA loader to this workflow',
  'Why might this workflow fail?',
]

const composer = ref<InstanceType<typeof AgentComposer> | null>(null)
const { dropping, onDragOver, onDragLeave, onDrop } = useMediaDrop((media) => {
  attach(media)
  composer.value?.focus()
})

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
</script>

<template>
  <div
    class="za"
    :class="{ dropping }"
    data-agent-surface
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <header class="za-head">
      <span class="za-title" :title="title">{{ title }}</span>
      <ZenPopover placement="bottom-end" @update:open="(o: boolean) => o && refreshThreads()">
        <template #trigger="{ toggle }">
          <ZenIconButton icon="mdi mdi-history" title="Conversations" @click="toggle" />
        </template>
        <template #default="{ close }">
          <div class="za-history">
            <div v-if="!threads.length" class="za-empty-line">No saved conversations yet.</div>
            <ZenMenuItem
              v-for="t in threads"
              :key="t.id"
              :class="{ current: t.id === threadId }"
              @click="open(t.id).then(close)"
            >
              <span class="za-history-title">{{ t.title }}</span>
              <span class="za-history-when">{{ when(t.updated_at) }}</span>
              <ZenIconButton
                icon="mdi mdi-delete-outline"
                title="Delete"
                @click.stop="remove(t.id)"
              />
            </ZenMenuItem>
          </div>
        </template>
      </ZenPopover>
      <ZenIconButton icon="mdi mdi-plus" title="New chat" @click="newChat" />
      <ZenPopover placement="bottom-end">
        <template #trigger="{ toggle }">
          <ZenIconButton icon="mdi mdi-tune-variant" title="Model settings" @click="toggle" />
        </template>
        <template #default="{ close }">
          <AgentSettings @saved="close" />
        </template>
      </ZenPopover>
    </header>

    <AgentTranscript>
      <template #empty>
        <div class="za-welcome">
          <i class="mdi mdi-creation-outline za-welcome-icon" />
          <div class="za-welcome-title">What should we build?</div>
          <div class="za-welcome-sub">I can read, edit and run the workflow on your canvas.</div>
          <button v-for="s in SUGGESTIONS" :key="s" class="za-suggestion" @click="send(s)">
            {{ s }}
          </button>
        </div>
      </template>
    </AgentTranscript>
    <AgentComposer ref="composer" />
  </div>
</template>

<style scoped>
.za {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--zen-text);
  font-size: 12.5px;
  background: var(--zen-bg);
}
.za-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px 6px 12px;
  border-bottom: 1px solid var(--zen-surface-border, var(--zen-border));
}
.za-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.za-history {
  width: 300px;
  max-height: 360px;
  overflow-y: auto;
  padding: 4px;
}
.za-history :deep(.current) {
  background: color-mix(in srgb, var(--zen-accent) 14%, transparent);
}
.za-history-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.za-history-when,
.za-empty-line {
  color: var(--zen-muted);
  font-size: 11px;
}
.za-empty-line {
  padding: 10px;
}
.za-welcome {
  margin: auto 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}
.za-welcome-icon {
  font-size: 26px;
  color: var(--zen-accent);
}
.za-welcome-title {
  font-size: 14px;
  font-weight: 600;
}
.za-welcome-sub {
  margin-bottom: 8px;
  color: var(--zen-muted);
}
.za-suggestion {
  width: 100%;
  max-width: 320px;
  padding: 7px 10px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: var(--zen-radius);
  background: var(--zen-control-bg, transparent);
  color: var(--zen-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.za-suggestion:hover {
  border-color: var(--zen-accent);
}
.za.dropping::after {
  content: 'Drop to attach';
  position: absolute;
  inset: 6px;
  display: grid;
  place-items: center;
  border: 2px dashed var(--zen-accent);
  border-radius: calc(var(--zen-radius) + 4px);
  background: color-mix(in srgb, var(--zen-accent) 12%, transparent);
  color: var(--zen-text);
  font-weight: 600;
  pointer-events: none;
}
</style>
