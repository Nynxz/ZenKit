<script setup lang="ts">
import { ZenIconButton, ZenMenuItem, ZenPopover } from '@nynxz/zenkit-ui'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import type { Item } from '../lib/conversation'
import { useConversation } from '../lib/conversation'
import { hasImageDragData, readImageDragData, readMediaDrop, ZEN_MEDIA_LIST_MIME } from '@nynxz/zenkit-client'

import type { Attachment } from '../lib/vision'
import { resolveMedia, uploadLocal } from '../lib/vision'
import AgentMarkdown from './AgentMarkdown.vue'
import AgentThumb from './AgentThumb.vue'
import AgentRunCard from './AgentRunCard.vue'
import AgentSettings from './AgentSettings.vue'
import AgentSteps from './AgentSteps.vue'

const { title, draft, attachments, attach, detach, items, busy, threads, threadId, send, stop, open, newChat, remove, refreshThreads } =
  useConversation()

type ToolItem = Extract<Item, { kind: 'tool' }>
type Block = { key: string; steps: ToolItem[] } | { key: string; item: Exclude<Item, ToolItem> }

/** Rows to draw: consecutive tool calls fold into one step timeline. */
const blocks = computed(() => {
  const out: Block[] = []
  items.value.forEach((item, i) => {
    if (item.kind === 'tool') {
      const last = out.at(-1)
      if (last && 'steps' in last) last.steps.push(item)
      else out.push({ key: `steps-${i}`, steps: [item] })
    } else out.push({ key: `${item.kind}-${i}`, item })
  })
  return out
})
const isLive = (block: Block) => busy.value && block === blocks.value.at(-1)

const list = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)

const SUGGESTIONS = [
  'Explain what this workflow does',
  'Set the sampler to 30 steps',
  'Add a LoRA loader to this workflow',
  'Why might this workflow fail?',
]

// Follow the conversation as it streams, unless the user has scrolled up to read.
let pinned = true
function onScroll(): void {
  const el = list.value
  if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}
watch(
  items,
  () =>
    void nextTick(() => {
      if (pinned && list.value) list.value.scrollTop = list.value.scrollHeight
    }),
  { deep: true },
)

onMounted(() => {
  if (list.value) list.value.scrollTop = list.value.scrollHeight
  resize()
})

function resize(): void {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

async function submit(text = draft.value): Promise<void> {
  if ((!text.trim() && !attachments.value.length) || busy.value) return
  draft.value = ''
  pinned = true
  void nextTick(resize)
  await send(text)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void submit()
  }
}

// Media dropped on the panel (from a viewer, the Asset Browser, Stash, the desktop) is attached to
// the next message, as refs the agent can use and pictures a vision model can see.
const dropping = ref(false)
function onDragOver(e: DragEvent): void {
  if (!hasImageDragData(e)) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dropping.value = true
}
function onDragLeave(e: DragEvent): void {
  const to = e.relatedTarget as Node | null
  if (!to || !(e.currentTarget as HTMLElement).contains(to)) dropping.value = false
}
async function onDrop(e: DragEvent): Promise<void> {
  dropping.value = false
  const isList = e.dataTransfer?.types.includes(ZEN_MEDIA_LIST_MIME) ?? false
  if (!isList && !readImageDragData(e).length) return
  e.preventDefault()
  e.stopPropagation()
  const { items: dropped } = await readMediaDrop(e)
  const media = await Promise.all(
    dropped.slice(0, 8).map(async (it): Promise<Attachment | null> => {
      try {
        if (!it.objectUrl) return { ref: it.ref ?? it.url, url: it.url, kind: it.kind ?? 'image', label: it.filename }
        const ref = await uploadLocal(it.url, it.filename)
        URL.revokeObjectURL(it.url)
        return await resolveMedia(ref)
      } catch {
        return null
      }
    }),
  )
  attach(media.filter((m) => m !== null))
  input.value?.focus()
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <div class="za" :class="{ dropping }" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
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
              <ZenIconButton icon="mdi mdi-delete-outline" title="Delete" @click.stop="remove(t.id)" />
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

    <div ref="list" class="za-list" @scroll="onScroll">
      <div v-if="!items.length" class="za-welcome">
        <i class="mdi mdi-creation-outline za-welcome-icon" />
        <div class="za-welcome-title">What should we build?</div>
        <div class="za-welcome-sub">I can read, edit and run the workflow on your canvas.</div>
        <button v-for="s in SUGGESTIONS" :key="s" class="za-suggestion" @click="submit(s)">{{ s }}</button>
      </div>
      <TransitionGroup name="za-row">
        <div v-for="block in blocks" :key="block.key" class="za-block">
          <AgentSteps v-if="'steps' in block" :steps="block.steps" />
          <div v-else-if="block.item.kind === 'user'" class="za-user">
            <div v-if="block.item.attachments?.length" class="za-user-media">
              <AgentThumb v-for="a in block.item.attachments" :key="a.ref" :media="a" />
            </div>
            <span v-if="block.item.text">{{ block.item.text }}</span>
          </div>
          <AgentMarkdown
            v-else-if="block.item.kind === 'text'"
            :text="block.item.text"
            :class="{ 'za-streaming': isLive(block) }"
          />
          <details v-else-if="block.item.kind === 'thinking'" class="za-thinking">
            <summary :class="{ 'za-shimmer': isLive(block) }">
              <i class="mdi mdi-brain" /> {{ isLive(block) ? 'Thinking…' : 'Thought process' }}
            </summary>
            <div>{{ block.item.text }}</div>
          </details>
          <AgentRunCard v-else-if="block.item.kind === 'run'" :prompt-ids="block.item.promptIds" />
          <div v-else-if="block.item.kind === 'notice'" class="za-notice">
            <i class="mdi mdi-information-outline" /> {{ block.item.text }}
          </div>
          <div v-else class="za-error"><i class="mdi mdi-alert-circle-outline" /> {{ block.item.text }}</div>
        </div>
      </TransitionGroup>
      <div v-if="busy && items.at(-1)?.kind === 'user'" class="za-pending">
        <span class="za-dots"><i /><i /><i /></span>
      </div>
    </div>

    <TransitionGroup v-if="attachments.length" tag="div" name="za-chip" class="za-attached">
      <div v-for="a in attachments" :key="a.ref" class="za-chip" :title="a.ref">
        <AgentThumb :media="a" />
        <button class="za-chip-x" title="Remove" @click="detach(a.ref)"><i class="mdi mdi-close" /></button>
      </div>
    </TransitionGroup>
    <div class="za-composer">
      <textarea
        ref="input"
        v-model="draft"
        rows="1"
        placeholder="Ask about or change your workflow…"
        @input="resize"
        @keydown="onKey"
      />
      <ZenIconButton
        v-if="busy"
        icon="mdi mdi-stop"
        title="Stop"
        class="za-send"
        @click="stop"
      />
      <ZenIconButton
        v-else
        icon="mdi mdi-arrow-up"
        title="Send (Enter)"
        class="za-send"
        :disabled="!draft.trim() && !attachments.length"
        @click="submit()"
      />
    </div>
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
.za-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 12px;
  overflow-y: auto;
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
.za-user-media {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  margin-bottom: 4px;
}
.za-user-media > * {
  width: 72px;
  height: 72px;
}
.za-attached {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 8px -2px;
}
.za-chip {
  position: relative;
  width: 52px;
  height: 52px;
}
.za-chip-x {
  position: absolute;
  top: -5px;
  right: -5px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--zen-surface-2, var(--zen-surface));
  color: var(--zen-text);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.za-chip:hover .za-chip-x {
  opacity: 1;
}
.za-chip-enter-active,
.za-chip-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.za-chip-enter-from,
.za-chip-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
.za-user {
  align-self: flex-end;
  max-width: 85%;
  padding: 7px 11px;
  border-radius: 12px 12px 4px 12px;
  background: color-mix(in srgb, var(--zen-accent) 18%, var(--zen-surface));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.za-row-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.za-row-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.za-streaming :deep(> :last-child)::after {
  content: '';
  display: inline-block;
  width: 7px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -0.15em;
  border-radius: 1px;
  background: var(--zen-accent);
  animation: za-blink 1s steps(2) infinite;
}
.za-thinking {
  color: var(--zen-muted);
  font-size: 11.5px;
}
.za-thinking summary {
  cursor: pointer;
  list-style: none;
}
.za-thinking summary::-webkit-details-marker {
  display: none;
}
.za-shimmer {
  background: linear-gradient(90deg, var(--zen-muted) 0%, var(--zen-text) 50%, var(--zen-muted) 100%) 0 0 / 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: za-shimmer 1.4s linear infinite;
}
.za-dots {
  display: inline-flex;
  gap: 4px;
  padding: 6px 2px;
}
.za-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--zen-muted);
  animation: za-bounce 1.2s ease-in-out infinite;
}
.za-dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.za-dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes za-blink {
  to {
    visibility: hidden;
  }
}
@keyframes za-shimmer {
  to {
    background-position: -200% 0;
  }
}
@keyframes za-bounce {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-3px);
  }
}
.za-thinking div {
  max-height: 200px;
  margin-top: 4px;
  padding-left: 10px;
  overflow-y: auto;
  border-left: 2px solid var(--zen-surface-border, var(--zen-border));
  white-space: pre-wrap;
}
.za-error {
  color: var(--zen-danger);
}
.za-notice {
  color: var(--zen-muted);
  font-size: 11.5px;
}
.za-pending {
  color: var(--zen-muted);
}
.za-composer {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  margin: 8px;
  padding: 6px 6px 6px 10px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: calc(var(--zen-radius) + 4px);
  background: var(--zen-field-bg, var(--zen-input));
}
.za-composer:focus-within {
  border-color: var(--zen-accent);
}
.za-composer textarea {
  flex: 1;
  min-height: 22px;
  max-height: 180px;
  padding: 3px 0;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--zen-text);
  font: inherit;
  line-height: 1.45;
}
.za-send {
  flex: 0 0 auto;
}
</style>
