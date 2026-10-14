<script setup lang="ts">
// The conversation as it reads: your messages, the replies streaming in, the steps the agent
// took (approvals among them) and the runs it queued. The panel shows it compact; the Chat app
// (`chat`) as a wide reading column.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { Item } from '../lib/conversation'
import { useConversation } from '../lib/conversation'
import { ZenLotus } from '@nynxz/zenkit-ui'

import AgentMarkdown from './AgentMarkdown.vue'
import AgentRunCard from './AgentRunCard.vue'
import AgentSteps from './AgentSteps.vue'
import AgentThumb from './AgentThumb.vue'

const { chat = false } = defineProps<{ chat?: boolean }>()
const { items, busy } = useConversation()

type ToolItem = Extract<Item, { kind: 'tool' }>
/** `lead`: the first row of a reply, where the chat shows who is speaking. */
type Block = { key: string; lead: boolean } & (
  { steps: ToolItem[] } | { item: Exclude<Item, ToolItem> }
)

/** Rows to draw: consecutive tool calls fold into one step timeline. */
const blocks = computed(() => {
  const out: Block[] = []
  items.value.forEach((item, i) => {
    const prev = out.at(-1)
    const lead = item.kind !== 'user' && (!prev || ('item' in prev && prev.item.kind === 'user'))
    if (item.kind === 'tool') {
      if (prev && 'steps' in prev) prev.steps.push(item)
      else out.push({ key: `steps-${i}`, lead, steps: [item] })
    } else out.push({ key: `${item.kind}-${i}`, lead, item })
  })
  return out
})
const isLive = (block: Block) => busy.value && block === blocks.value.at(-1)

const list = ref<HTMLElement | null>(null)

// Follow the conversation as it streams, unless the user has scrolled up to read. Sending a
// message always follows again.
let pinned = true
const away = ref(false)
function onScroll(): void {
  const el = list.value
  if (!el) return
  pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  away.value = el.scrollHeight - el.scrollTop - el.clientHeight > 240
}
function toLatest(): void {
  pinned = true
  list.value?.scrollTo({ top: list.value.scrollHeight, behavior: 'smooth' })
}

const copied = ref<string | null>(null)
async function copy(key: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => copied.value === key && (copied.value = null), 1400)
  } catch {
    // no clipboard here (an insecure origin); nothing to copy into
  }
}
watch(
  items,
  (now) => {
    if (now.at(-1)?.kind === 'user') pinned = true
    void nextTick(() => {
      if (pinned && list.value) list.value.scrollTop = list.value.scrollHeight
    })
  },
  { deep: true },
)
// Rows also grow without a new item (a run card's previews and outputs, images loading).
const col = ref<HTMLElement | null>(null)
const grows = new ResizeObserver(() => {
  if (pinned && list.value) list.value.scrollTop = list.value.scrollHeight
})
watch(col, (el, old) => {
  if (old) grows.unobserve(old)
  if (el) grows.observe(el)
})
onBeforeUnmount(() => grows.disconnect())

onMounted(() => {
  if (list.value) list.value.scrollTop = list.value.scrollHeight
})
</script>

<template>
  <div class="zt-wrap" :class="{ chat }">
    <div ref="list" class="zt zen-scroll" :class="{ chat }" @scroll="onScroll">
      <slot v-if="!items.length" name="empty" />
      <div v-else ref="col" class="zt-col">
        <TransitionGroup name="zt-row">
          <div v-for="block in blocks" :key="block.key" class="zt-block">
            <div v-if="chat && block.lead" class="zt-who">
              <span class="zt-avatar"><ZenLotus /></span>
              <span>Agent</span>
            </div>
            <AgentSteps v-if="'steps' in block" :steps="block.steps" />
            <div v-else-if="block.item.kind === 'user'" class="zt-user">
              <div v-if="block.item.attachments?.length" class="zt-user-media">
                <AgentThumb v-for="a in block.item.attachments" :key="a.ref" :media="a" />
              </div>
              <span v-if="block.item.text">{{ block.item.text }}</span>
            </div>
            <div v-else-if="block.item.kind === 'text'" class="zt-reply">
              <AgentMarkdown :text="block.item.text" :class="{ 'zt-streaming': isLive(block) }" />
              <div v-if="chat && !isLive(block)" class="zt-actions">
                <button
                  :title="copied === block.key ? 'Copied' : 'Copy'"
                  @click="copy(block.key, block.item.text)"
                >
                  <i class="mdi" :class="copied === block.key ? 'mdi-check' : 'mdi-content-copy'" />
                </button>
              </div>
            </div>
            <details v-else-if="block.item.kind === 'thinking'" class="zt-thinking">
              <summary :class="{ 'zt-shimmer': isLive(block) }">
                <i class="mdi mdi-brain" />
                {{ isLive(block) ? 'Thinking…' : 'Thought process' }}
                <i class="mdi mdi-chevron-down zt-chev" />
              </summary>
              <div>{{ block.item.text }}</div>
            </details>
            <AgentRunCard
              v-else-if="block.item.kind === 'run'"
              :prompt-ids="block.item.promptIds"
            />
            <div v-else-if="block.item.kind === 'notice'" class="zt-notice">
              <i class="mdi mdi-information-outline" />
              <span>{{ block.item.text }}</span>
            </div>
            <div v-else class="zt-error">
              <i class="mdi mdi-alert-circle-outline" />
              <span>{{ block.item.text }}</span>
            </div>
          </div>
        </TransitionGroup>
        <div v-if="busy && items.at(-1)?.kind === 'user'" class="zt-pending">
          <div v-if="chat" class="zt-who">
            <span class="zt-avatar"><ZenLotus /></span>
            <span>Agent</span>
          </div>
          <span class="zt-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </div>
    <Transition name="zt-fade">
      <button v-if="chat && away" class="zt-latest" title="Jump to latest" @click="toLatest">
        <i class="mdi mdi-arrow-down" />
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.zt-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.zt {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 14px 12px;
  overflow-y: auto;
}
.zt-col {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* Each row is a column, so your messages can sit on the right. */
.zt-block {
  display: flex;
  flex-direction: column;
}
.zt.chat {
  padding: 28px 24px 12px;
}
.zt.chat .zt-col {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  gap: 22px;
  font-size: 14px;
  line-height: 1.65;
}
.zt-user-media {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
  margin-bottom: 4px;
}
.zt-user-media > * {
  width: 72px;
  height: 72px;
}
.chat .zt-user-media > * {
  width: 120px;
  height: 120px;
}
.zt-user {
  align-self: flex-end;
  max-width: 85%;
  padding: 7px 11px;
  border-radius: 12px 12px 4px 12px;
  background: color-mix(in srgb, var(--zen-accent) 18%, var(--zen-surface));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.chat .zt-user {
  max-width: 78%;
  padding: 10px 16px;
  border-radius: calc(var(--zen-radius-surface, 12px) + 6px);
  border-bottom-right-radius: var(--zen-radius);
  background: var(--zen-surface-2);
  color: var(--secondary-foreground, var(--zen-text));
}
.zt-row-enter-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}
.zt-row-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.zt-streaming :deep(> :last-child)::after {
  content: '';
  display: inline-block;
  width: 7px;
  height: 1em;
  margin-left: 2px;
  vertical-align: -0.15em;
  border-radius: 1px;
  background: var(--zen-accent);
  animation: zt-blink 1s steps(2) infinite;
}
.zt-thinking {
  color: var(--zen-muted);
  font-size: 11.5px;
}
.chat .zt-thinking {
  font-size: 12.5px;
}
.zt-thinking summary {
  cursor: pointer;
  list-style: none;
}
.zt-thinking summary::-webkit-details-marker {
  display: none;
}
.zt-thinking div {
  max-height: 200px;
  margin-top: 4px;
  padding-left: 10px;
  overflow-y: auto;
  border-left: 2px solid var(--zen-surface-border, var(--zen-border));
  white-space: pre-wrap;
}
.zt-shimmer {
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
  animation: zt-shimmer 1.4s linear infinite;
}
.zt-dots {
  display: inline-flex;
  gap: 4px;
  padding: 6px 2px;
}
.zt-dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--zen-muted);
  animation: zt-bounce 1.2s ease-in-out infinite;
}
.zt-dots i:nth-child(2) {
  animation-delay: 0.15s;
}
.zt-dots i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes zt-blink {
  to {
    visibility: hidden;
  }
}
@keyframes zt-shimmer {
  to {
    background-position: -200% 0;
  }
}
@keyframes zt-bounce {
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
.zt-error {
  color: var(--zen-danger);
}
.zt-notice {
  color: var(--zen-muted);
  font-size: 11.5px;
}
.zt-pending {
  color: var(--zen-muted);
}
/* --- the Chat app's reading column -------------------------------------------------------- */
.chat .zt-col {
  gap: 18px;
}
.zt-who {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 650;
}
.zt-avatar {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: var(--zen-radius);
  background: var(--zen-surface);
  color: var(--zen-accent);
  font-size: 16px;
}
.zt-reply {
  position: relative;
}
.zt-actions {
  display: flex;
  gap: 2px;
  margin-top: 6px;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.zt-block:hover .zt-actions,
.zt-actions:focus-within {
  opacity: 1;
}
.zt-actions button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--zen-muted);
  cursor: pointer;
}
.zt-actions button:hover {
  background: var(--zen-surface-2);
  color: var(--zen-text);
}
/* A reply's prose, its code and tables. */
.chat .zt-reply :deep(.za-md) {
  line-height: 1.7;
}
.chat .zt-reply :deep(.za-md p) {
  margin-bottom: 12px;
}
.chat .zt-reply :deep(.za-md h1),
.chat .zt-reply :deep(.za-md h2),
.chat .zt-reply :deep(.za-md h3) {
  margin: 18px 0 8px;
  font-size: 15.5px;
  font-weight: 700;
}
.chat .zt-reply :deep(.za-md code) {
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 12.5px;
}
.chat .zt-reply :deep(.za-md pre) {
  margin: 10px 0 14px;
  padding: 14px 16px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: var(--zen-radius-surface, var(--zen-radius));
  background: var(--zen-surface);
  font-size: 12.5px;
  line-height: 1.6;
}
.chat .zt-reply :deep(.za-md table) {
  overflow: hidden;
  border-radius: 10px;
}
.chat .zt-reply :deep(.za-md th) {
  background: var(--zen-surface-2);
}
.chat .zt-reply :deep(.za-md blockquote) {
  border-left: 3px solid var(--zen-accent);
}
/* In the chat, an approval sits flush in its step card, and live previews read at a glance. */
.chat .zt-block :deep(.za-approval) {
  margin: 8px 0 4px;
  border-color: var(--zen-surface-border, var(--zen-border));
  background: var(--zen-surface-2, var(--zen-surface));
}
.chat .zt-block :deep(.zr-grid) {
  grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
}
/* Steps as one quiet card. */
.chat .zt-block > :deep(.zs) {
  padding: 8px 10px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: var(--zen-radius-surface, var(--zen-radius));
  background: var(--zen-surface);
}
.chat .zt-thinking {
  align-self: flex-start;
}
.chat .zt-thinking summary {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 11px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: 999px;
  font-size: 12px;
}
.zt-chev {
  display: none;
}
.chat .zt-chev {
  display: inline;
  transition: transform 0.15s ease;
}
.chat .zt-thinking[open] .zt-chev {
  transform: rotate(180deg);
}
.chat .zt-thinking div {
  margin-top: 8px;
  padding: 10px 14px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: var(--zen-radius-surface, var(--zen-radius));
  background: var(--zen-surface);
  line-height: 1.6;
}
.chat .zt-notice,
.chat .zt-error {
  border: 1px solid color-mix(in srgb, var(--zen-danger) 40%, transparent);
}
.chat .zt-notice {
  background: var(--zen-surface);
  border: 1px solid var(--zen-surface-border, var(--zen-border));
}
.chat .zt-error {
  background: color-mix(in srgb, var(--zen-danger) 10%, transparent);
}
.zt-latest {
  position: absolute;
  bottom: 14px;
  left: 50%;
  translate: -50% 0;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: 50%;
  background: var(--zen-glass, var(--zen-surface));
  backdrop-filter: blur(10px);
  box-shadow: var(--zen-shadow-pop, 0 10px 30px rgb(0 0 0 / 35%));
  color: var(--zen-text);
  font-size: 18px;
  cursor: pointer;
}
.zt-fade-enter-active,
.zt-fade-leave-active {
  transition:
    opacity 0.2s ease,
    translate 0.2s ease;
}
.zt-fade-enter-from,
.zt-fade-leave-to {
  opacity: 0;
  translate: -50% 8px;
}
</style>
