<script setup lang="ts">
import { ZenButton } from '@nynxz/zenkit-ui'
import { computed, nextTick, onMounted, ref, useId } from 'vue'

import type { Decision } from '../lib/api'
import { summarize } from '../lib/approval'
import type { Item } from '../lib/conversation'
import { useConversation } from '../lib/conversation'

// The inline card a call waits on: what the model wants to do, in plain words, and the user's
// answer. The turn on the server waits until one is given (or Stop).
const { step } = defineProps<{ step: Extract<Item, { kind: 'tool' }> }>()
const { decide } = useConversation()

const summary = computed(() => summarize(step.name, step.args))
const tool = computed(() => step.name.replace(/_/g, ' '))
const sending = computed(() => step.approval?.sending ?? false)
const titleId = useId()
const card = ref<HTMLElement | null>(null)

function answer(decision: Decision): void {
  void decide(step.callId, decision)
}

const isTyping = (el: Element | null) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLElement && el.isContentEditable)

// Bring the card into view and give it focus, so Tab reaches its buttons and screen readers read
// it; never while the user is typing, and never onto a button, so a stray Enter can't approve.
onMounted(() => {
  void nextTick(() => {
    card.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    if (!isTyping(document.activeElement)) card.value?.focus({ preventScroll: true })
  })
})
</script>

<template>
  <div
    ref="card"
    class="za-approval"
    role="group"
    :aria-labelledby="titleId"
    tabindex="-1"
    data-approval
    @keydown.esc.stop.prevent="answer('deny')"
  >
    <div class="za-approval-head">
      <i class="mdi mdi-shield-alert-outline" aria-hidden="true" />
      <span :id="titleId" class="za-approval-title">{{ summary.title }}?</span>
    </div>
    <dl v-if="summary.lines.length" class="za-approval-lines">
      <template v-for="(line, i) in summary.lines" :key="i">
        <dt>{{ line.label }}</dt>
        <dd>{{ line.value }}</dd>
      </template>
    </dl>
    <div v-if="summary.warning" class="za-approval-warn">
      <i class="mdi mdi-alert-outline" aria-hidden="true" />
      {{ summary.warning }}
    </div>
    <div class="za-approval-actions">
      <ZenButton
        variant="primary"
        size="sm"
        icon="mdi mdi-check"
        :disabled="sending"
        @click="answer('approve')"
      >
        Approve
      </ZenButton>
      <ZenButton
        size="sm"
        icon="mdi mdi-close"
        :disabled="sending"
        title="Deny (Esc)"
        @click="answer('deny')"
      >
        Deny
      </ZenButton>
      <ZenButton
        variant="ghost"
        size="sm"
        :disabled="sending"
        :title="`Approve this, and run further ${tool} calls without asking until this reply ends`"
        :aria-label="`Allow ${tool} for the rest of this reply`"
        @click="answer('allow_turn')"
      >
        Allow for this reply
      </ZenButton>
    </div>
    <details class="za-approval-args">
      <summary>{{ step.name }} arguments</summary>
      <pre>{{ JSON.stringify(step.args, null, 2) }}</pre>
    </details>
  </div>
</template>

<style scoped>
.za-approval {
  margin: 4px 6px 8px 34px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--zen-accent) 55%, transparent);
  border-radius: calc(var(--zen-radius) + 2px);
  background: color-mix(in srgb, var(--zen-accent) 9%, var(--zen-surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--zen-accent) 12%, transparent);
  animation: za-approval-in 0.22s ease both;
}
.za-approval:focus-visible {
  outline: 2px solid var(--zen-accent);
  outline-offset: 2px;
}
.za-approval-head {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  font-weight: 600;
}
.za-approval-head .mdi {
  color: var(--zen-accent);
  font-size: 15px;
  line-height: 1.2;
}
.za-approval-title {
  min-width: 0;
  overflow-wrap: anywhere;
}
.za-approval-lines {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 10px;
  margin: 8px 0 0;
  font-size: 11.5px;
}
.za-approval-lines dt {
  color: var(--zen-muted);
}
.za-approval-lines dd {
  min-width: 0;
  margin: 0;
  font-family: var(--zen-mono);
  overflow-wrap: anywhere;
}
.za-approval-warn {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  color: var(--zen-warn, var(--zen-muted));
  font-size: 11.5px;
}
.za-approval-args {
  margin-top: 8px;
  color: var(--zen-muted);
  font-size: 11px;
}
.za-approval-args summary {
  cursor: pointer;
}
.za-approval-args pre {
  max-height: 160px;
  margin: 4px 0 0;
  padding: 6px 8px;
  overflow: auto;
  border-radius: 6px;
  background: color-mix(in srgb, var(--zen-text) 6%, transparent);
  color: var(--zen-text);
  font-family: var(--zen-mono);
  white-space: pre-wrap;
}
.za-approval-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
@keyframes za-approval-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .za-approval {
    animation: none;
  }
}
</style>
