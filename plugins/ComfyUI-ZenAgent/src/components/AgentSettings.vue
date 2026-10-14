<script setup lang="ts">
// Where the agent's model lives, and how far it may go. The connection is checked as you type
// (the endpoint and key as typed, not yet saved), so you know it works before you save it.
import { ZenButton, ZenField, ZenInput, ZenSelect, ZenSwitch } from '@nynxz/zenkit-ui'
import { computed, onMounted, ref, watch } from 'vue'

import { agentApi } from '../lib/api'
import { capabilityTools } from '../lib/capabilityTools'
import { useConversation } from '../lib/conversation'

const emit = defineEmits<{ saved: [] }>()
const { pluginTools } = useConversation()

const llmUrl = ref('')
const model = ref('')
const apiKey = ref('')
const hasKey = ref(false)
const maxTokens = ref(2048)
const maxSteps = ref(50)
const maxRuns = ref(4)
const askFirst = ref(true)
const alwaysAllow = ref<string[]>([])
const vision = ref<'auto' | 'on' | 'off'>('auto')
const savedUrl = ref('')

/** scheme://host:port, which a saved key is bound to on the server. */
function origin(url: string): string | null {
  try {
    const u = new URL(url.trim())
    return /^https?:$/.test(u.protocol) ? `${u.protocol}//${u.host}` : null
  } catch {
    return null
  }
}
// A new host drops the saved key unless a key is typed with it (the server enforces this).
const dropsKey = computed(
  () => hasKey.value && !apiKey.value && origin(llmUrl.value) !== origin(savedUrl.value),
)

// --- the connection, checked as typed --------------------------------------------------------

type Check =
  | { state: 'idle' | 'testing' }
  | { state: 'ok'; models: string[]; context: number | null; baseTokens: number }
  | { state: 'error'; error: string }
const check = ref<Check>({ state: 'idle' })
const models = computed(() => (check.value.state === 'ok' ? check.value.models : []))
let checks = 0

async function test(): Promise<void> {
  const url = llmUrl.value.trim()
  if (!origin(url)) {
    check.value = { state: 'error', error: 'Enter an http:// or https:// address.' }
    return
  }
  const mine = ++checks
  check.value = { state: 'testing' }
  try {
    const r = await agentApi.testSettings(url, apiKey.value || undefined, model.value || undefined)
    if (mine !== checks) return
    check.value = r.ok
      ? { state: 'ok', models: r.models, context: r.context, baseTokens: r.base_tokens }
      : { state: 'error', error: r.error ?? '' }
  } catch (error) {
    if (mine === checks)
      check.value = {
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
  }
}
let timer: ReturnType<typeof setTimeout> | undefined
let loaded = false
watch([llmUrl, apiKey, model], () => {
  if (!loaded) return
  clearTimeout(timer)
  timer = setTimeout(test, 600)
})

// --- what a request costs against the context the model was loaded with ---------------------

const CHARS_PER_TOKEN = 3.5
// The workflow summary and a short conversation, on top of the fixed part.
const CONVERSATION_TOKENS = 1500
const pluginTokens = Math.round(JSON.stringify(capabilityTools()).length / CHARS_PER_TOKEN)
const need = computed(() =>
  check.value.state === 'ok'
    ? check.value.baseTokens + CONVERSATION_TOKENS + (pluginTools.value ? pluginTokens : 0)
    : 0,
)
const context = computed(() => (check.value.state === 'ok' ? check.value.context : null))
const tight = computed(() => !!context.value && need.value > context.value * 0.8)
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

// --- saving ----------------------------------------------------------------------------------

const saving = ref(false)
const saved = ref(false)
const failure = ref('')

onMounted(async () => {
  const s = await agentApi.settings()
  llmUrl.value = s.llm_url
  savedUrl.value = s.llm_url
  model.value = s.model ?? ''
  hasKey.value = s.has_key
  maxTokens.value = s.max_tokens
  maxSteps.value = s.max_steps
  maxRuns.value = s.max_runs
  askFirst.value = s.ask_before_actions
  alwaysAllow.value = s.always_allow
  vision.value = s.vision
  loaded = true
  await test()
})

async function save(): Promise<void> {
  if (saving.value) return
  saving.value = true
  failure.value = ''
  try {
    const s = await agentApi.saveSettings({
      llm_url: llmUrl.value.trim(),
      model: model.value || null,
      max_tokens: Number(maxTokens.value),
      max_steps: Number(maxSteps.value),
      max_runs: Number(maxRuns.value),
      vision: vision.value,
      ask_before_actions: askFirst.value,
      always_allow: alwaysAllow.value,
      ...(apiKey.value ? { api_key: apiKey.value } : {}),
    })
    hasKey.value = s.has_key
    savedUrl.value = s.llm_url
    llmUrl.value = s.llm_url
    apiKey.value = ''
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error)
    return
  } finally {
    saving.value = false
  }
  saved.value = true
  setTimeout(() => {
    saved.value = false
    emit('saved')
  }, 900)
}

/** Enter in a text field saves, as in any form. */
function onEnter(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.isComposing && (e.target as HTMLElement).tagName === 'INPUT')
    void save()
}
</script>

<template>
  <div class="za-settings" @keydown="onEnter">
    <div class="za-settings-h">Connection</div>
    <ZenField label="Endpoint" stack>
      <ZenInput v-model="llmUrl" placeholder="http://127.0.0.1:1234/v1" />
    </ZenField>
    <ZenField label="API key" stack>
      <ZenInput
        v-model="apiKey"
        type="password"
        :placeholder="hasKey ? 'Saved — type to replace' : 'Optional'"
      />
    </ZenField>
    <div class="za-check" :class="check.state" role="status">
      <i
        class="mdi"
        :class="{
          'mdi-loading mdi-spin': check.state === 'testing',
          'mdi-check-circle': check.state === 'ok',
          'mdi-alert-circle': check.state === 'error',
          'mdi-circle-outline': check.state === 'idle',
        }"
      />
      <span v-if="check.state === 'testing'">Checking…</span>
      <span v-else-if="check.state === 'ok'">
        Connected · {{ check.models.length }} model{{ check.models.length === 1 ? '' : 's' }}
        <template v-if="context">· {{ k(context) }} context</template>
      </span>
      <span v-else-if="check.state === 'error'">{{ check.error }}</span>
      <span v-else>Not checked yet</span>
      <ZenButton size="sm" variant="ghost" :disabled="check.state === 'testing'" @click="test">
        Test
      </ZenButton>
    </div>
    <div v-if="tight" class="za-check error">
      <i class="mdi mdi-alert" />
      <span>
        Each request needs about {{ k(need) }} tokens, but the model is loaded with
        {{ k(context ?? 0) }} of context, so it won't see your messages. In LM Studio, load it with
        a context length of 16k or more{{ pluginTools ? ', or turn off plugin tools below' : '' }}.
      </span>
    </div>
    <div v-if="dropsKey" class="za-settings-note">
      The saved key belongs to the old endpoint, so saving clears it. Type it again to keep using it
      here.
    </div>

    <div class="za-settings-h">Model</div>
    <ZenSelect
      v-model="model"
      :options="[
        { value: '', label: 'Loaded / first available' },
        ...(model && !models.includes(model) ? [{ value: model, label: model }] : []),
        ...models.map((m) => ({ value: m, label: m })),
      ]"
    />

    <div class="za-settings-h">Replies</div>
    <div class="za-limits">
      <ZenField label="Max tokens" stack>
        <ZenInput v-model="maxTokens" type="number" :min="64" :step="256" />
      </ZenField>
      <ZenField label="Steps" stack>
        <ZenInput v-model="maxSteps" type="number" :min="1" :max="100" :step="5" />
      </ZenField>
      <ZenField label="Runs" stack>
        <ZenInput v-model="maxRuns" type="number" :min="1" :max="20" :step="1" />
      </ZenField>
    </div>
    <ZenField
      label="Plugin tools"
      :hint="`Your plugins' actions, offered to the model: about ${k(pluginTokens)} tokens a request.`"
    >
      <ZenSwitch v-model="pluginTools" aria-label="Plugin tools" />
    </ZenField>
    <ZenField label="Ask before actions">
      <ZenSwitch v-model="askFirst" aria-label="Ask before actions" />
    </ZenField>
    <div v-if="askFirst && alwaysAllow.length" class="za-allowed">
      <span class="za-allowed-label">Always allowed</span>
      <span v-for="name in alwaysAllow" :key="name" class="za-allowed-chip">
        {{ name.replace(/_/g, ' ') }}
        <button
          :title="`Ask again before ${name.replace(/_/g, ' ')}`"
          @click="alwaysAllow = alwaysAllow.filter((n) => n !== name)"
        >
          <i class="mdi mdi-close" />
        </button>
      </span>
    </div>
    <div v-if="!askFirst" class="za-settings-note">
      The agent will edit and run your workflow without asking. Text in a workflow you didn't write
      can steer it.
    </div>
    <ZenField label="Vision (send the model images)" stack>
      <ZenSelect
        v-model="vision"
        :options="[
          { value: 'auto', label: 'Auto — when LM Studio says the model can see' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]"
      />
    </ZenField>

    <div v-if="failure" class="za-check error">
      <i class="mdi mdi-alert-circle" />
      <span>Couldn't save: {{ failure }}</span>
    </div>
    <ZenButton
      variant="primary"
      :icon="saved ? 'mdi mdi-check' : saving ? 'mdi mdi-loading mdi-spin' : undefined"
      :disabled="saving"
      @click="save"
    >
      {{ saved ? 'Saved' : 'Save' }}
    </ZenButton>
  </div>
</template>

<style scoped>
.za-settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 300px;
  padding: 12px;
}
.za-settings-h {
  margin-top: 6px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: var(--zen-muted);
}
.za-settings-h:first-child {
  margin-top: 0;
}
.za-check {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: 7px 6px 7px 10px;
  border-radius: var(--zen-radius);
  background: color-mix(in srgb, var(--zen-text) 6%, transparent);
  color: var(--zen-muted);
  font-size: 12px;
  line-height: 1.4;
}
.za-check .mdi {
  margin-top: 1px;
}
.za-check span {
  flex: 1;
  padding-top: 1px;
}
.za-check.ok {
  color: var(--zen-ok, var(--zen-text));
  background: color-mix(in srgb, var(--zen-ok, #2e9e5b) 12%, transparent);
}
.za-check.error {
  color: var(--zen-danger);
  background: color-mix(in srgb, var(--zen-danger) 10%, transparent);
}
.za-limits {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.za-allowed {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.za-allowed-label {
  width: 100%;
  color: var(--zen-muted);
  font-size: 11.5px;
}
.za-allowed-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 2px 2px 8px;
  border: 1px solid var(--zen-surface-border, var(--zen-border));
  border-radius: 999px;
  font-size: 11.5px;
}
.za-allowed-chip button {
  display: inline-flex;
  padding: 1px 3px;
  border: 0;
  border-radius: 999px;
  background: none;
  color: var(--zen-muted);
  cursor: pointer;
}
.za-allowed-chip button:hover {
  background: var(--zen-surface-2);
  color: var(--zen-text);
}
.za-settings-note {
  color: var(--zen-warn, var(--zen-muted));
  font-size: 11.5px;
}
</style>
