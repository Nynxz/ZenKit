<script setup lang="ts">
// Where a message is written: attachments waiting to go, messages queued behind the running
// reply, the approval the agent is waiting on, the text, and send / queue / stop. The panel's is one compact row; the Chat app's (`chat`) a card
// with a row under the text for its `actions` slot (the model picker).
import { ZenButton, ZenIconButton } from '@nynxz/zenkit-ui'
import { nextTick, onMounted, ref } from 'vue'

import { useConversation } from '../lib/conversation'
import AgentThumb from './AgentThumb.vue'

const { chat = false, placeholder = 'Ask about or change your workflow…' } = defineProps<{
  chat?: boolean
  placeholder?: string
}>()
const { draft, attachments, detach, busy, awaiting, queue, unqueue, sendNext, send, stop } =
  useConversation()

const root = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)

function resize(): void {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, chat ? 280 : 180)}px`
}
onMounted(resize)

async function submit(): Promise<void> {
  const text = draft.value
  if (!text.trim() && !attachments.value.length) return
  draft.value = ''
  void nextTick(resize)
  await send(text)
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void submit()
  }
}

/** Scroll to the approval card the turn is waiting on and focus it. */
function review(): void {
  const surface = root.value?.closest('[data-agent-surface]') ?? document
  const card = surface.querySelector<HTMLElement>('[data-approval]')
  card?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  card?.focus({ preventScroll: true })
}

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <div ref="root" class="zc-wrap" :class="{ chat }">
    <TransitionGroup v-if="attachments.length" tag="div" name="zc-chip" class="zc-attached">
      <div v-for="a in attachments" :key="a.ref" class="zc-chip" :title="a.ref">
        <AgentThumb :media="a" />
        <button class="zc-chip-x" title="Remove" @click="detach(a.ref)">
          <i class="mdi mdi-close" />
        </button>
      </div>
    </TransitionGroup>
    <div v-if="awaiting.length" class="zc-waiting" role="status">
      <i class="mdi mdi-hand-back-left-outline" aria-hidden="true" />
      <span>The agent is waiting for your approval.</span>
      <ZenButton size="sm" variant="ghost" @click="review">Review</ZenButton>
    </div>
    <TransitionGroup v-if="queue.length" tag="ol" name="zc-chip" class="zc-queue">
      <li v-for="(q, i) in queue" :key="q.id">
        <span class="zc-qn">{{ i + 1 }}</span>
        <span class="zc-qt" :title="q.text">{{ q.text || 'Attached media' }}</span>
        <button title="Remove from the queue" @click="unqueue(q.id)">
          <i class="mdi mdi-close" />
        </button>
      </li>
      <li v-if="!busy" key="resume" class="zc-qresume">
        <span>The queue is paused.</span>
        <button @click="sendNext()">Send the next one</button>
      </li>
    </TransitionGroup>
    <div class="zc">
      <textarea
        ref="input"
        v-model="draft"
        rows="1"
        :placeholder="placeholder"
        @input="resize"
        @keydown="onKey"
      />
      <div class="zc-row">
        <slot v-if="chat" name="actions" />
        <span class="zc-grow" />
        <ZenIconButton
          v-if="busy && (draft.trim() || attachments.length)"
          icon="mdi mdi-tray-plus"
          title="Queue: send after this reply (Enter)"
          class="zc-send zc-queue-btn"
          @click="submit()"
        />
        <ZenIconButton v-if="busy" icon="mdi mdi-stop" title="Stop" class="zc-send" @click="stop" />
        <ZenIconButton
          v-else
          icon="mdi mdi-arrow-up"
          title="Send (Enter)"
          class="zc-send"
          :disabled="!draft.trim() && !attachments.length"
          @click="submit()"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.zc-wrap {
  flex: 0 0 auto;
}
.zc-attached {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 8px -2px;
}
.zc-chip {
  position: relative;
  width: 52px;
  height: 52px;
}
.zc-chip-x {
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
.zc-chip:hover .zc-chip-x {
  opacity: 1;
}
.zc-chip-enter-active,
.zc-chip-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.zc-chip-enter-from,
.zc-chip-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
.zc-waiting {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 8px 0;
  padding: 4px 4px 4px 10px;
  border-radius: var(--zen-radius);
  background: color-mix(in srgb, var(--zen-accent) 12%, transparent);
  font-size: 11.5px;
}
.zc-waiting span {
  flex: 1;
}
.zc-waiting .mdi {
  color: var(--zen-accent);
}
/* The panel's composer: one row, text then send. */
.zc {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  margin: 8px;
  padding: 6px 6px 6px 10px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: calc(var(--zen-radius) + 4px);
  background: var(--zen-field-bg, var(--zen-input));
}
.zc:focus-within {
  border-color: var(--zen-accent);
}
.zc textarea {
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
.zc-row {
  display: contents;
}
.zc-grow {
  display: none;
}
.zc-send {
  flex: 0 0 auto;
}
/* The Chat app's: a card on ZenKit's glass, the text over a row of actions and send. */
/* Everything above the card spans the same column as it (and as the transcript). */
.chat .zc-attached,
.chat .zc-waiting,
.chat .zc-queue {
  margin: 0 0 8px;
}
.chat .zc-waiting {
  padding: 6px 6px 6px 14px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: calc(var(--zen-radius-surface, 12px) + 2px);
  background: var(--zen-surface);
  font-size: 12.5px;
}
.chat .zc-queue li {
  padding: 6px 8px 6px 14px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: calc(var(--zen-radius-surface, 12px) + 2px);
  background: var(--zen-surface);
  font-size: 12.5px;
}
.chat .zc {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  margin: 0;
  padding: 12px 12px 10px 16px;
  border-color: var(--zen-surface-border, var(--zen-border));
  border-radius: calc(var(--zen-radius-surface, 12px) + 8px);
  background: var(--zen-glass, var(--zen-surface));
  backdrop-filter: blur(16px);
  box-shadow: var(--zen-shadow-pop, 0 10px 30px rgb(0 0 0 / 35%));
  transition: border-color 0.15s ease;
}
.chat .zc:focus-within {
  border-color: var(--ring, var(--zen-accent));
}
.chat .zc textarea {
  max-height: 280px;
  padding: 4px 0;
  font-size: 14.5px;
  line-height: 1.55;
}
.chat .zc-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.chat .zc-grow {
  display: block;
  flex: 1;
}
.chat .zc-send {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--zen-accent);
  color: var(--zen-accent-text);
}
.chat .zc-send:disabled {
  background: var(--zen-surface-2);
  color: var(--zen-muted);
}
.chat .zc-queue-btn {
  background: var(--zen-surface-2);
  color: var(--zen-text);
}
.zc-queue {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0 8px 6px;
  padding: 0;
  list-style: none;
}
.zc-queue li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 6px 5px 8px;
  border: 1px dashed color-mix(in srgb, var(--zen-border) 80%, transparent);
  border-radius: 10px;
  font-size: 12px;
}
.zc-qn {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--zen-accent) 22%, transparent);
  color: var(--zen-accent);
  font-size: 10.5px;
  font-weight: 700;
}
.zc-qt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: color-mix(in srgb, var(--zen-text) 80%, transparent);
}
.zc-queue button {
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--zen-muted);
  font: inherit;
  cursor: pointer;
}
.zc-queue button:hover {
  color: var(--zen-text);
}
.zc-qresume {
  justify-content: space-between;
  border-style: solid !important;
  color: var(--zen-muted);
}
.zc-qresume button {
  color: var(--zen-accent);
  font-weight: 600;
}
</style>
