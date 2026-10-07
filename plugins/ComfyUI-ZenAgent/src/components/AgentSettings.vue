<script setup lang="ts">
import { ZenButton, ZenField, ZenInput, ZenSelect, ZenSwitch } from '@nynxz/zenkit-ui'
import { computed, onMounted, ref } from 'vue'

import { agentApi } from '../lib/api'

const emit = defineEmits<{ saved: [] }>()

const llmUrl = ref('')
const model = ref('')
const apiKey = ref('')
const hasKey = ref(false)
const maxTokens = ref(2048)
const maxSteps = ref(50)
const maxRuns = ref(4)
const askFirst = ref(true)
const vision = ref<'auto' | 'on' | 'off'>('auto')
const models = ref<string[]>([])
const status = ref('')
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

async function loadModels(): Promise<void> {
  models.value = await agentApi.models().catch(() => [])
  status.value = models.value.length ? '' : 'No models found at this endpoint.'
}

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
  vision.value = s.vision
  await loadModels()
})

async function save(): Promise<void> {
  try {
    const s = await agentApi.saveSettings({
      llm_url: llmUrl.value.trim(),
      model: model.value || null,
      max_tokens: Number(maxTokens.value),
      max_steps: Number(maxSteps.value),
      max_runs: Number(maxRuns.value),
      vision: vision.value,
      ask_before_actions: askFirst.value,
      ...(apiKey.value ? { api_key: apiKey.value } : {}),
    })
    hasKey.value = s.has_key
    savedUrl.value = s.llm_url
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error)
    return
  }
  apiKey.value = ''
  await loadModels()
  emit('saved')
}
</script>

<template>
  <div class="za-settings">
    <ZenField label="Endpoint" stack>
      <ZenInput v-model="llmUrl" placeholder="http://127.0.0.1:1234/v1" />
    </ZenField>
    <ZenField label="Model" stack>
      <ZenSelect
        v-model="model"
        :options="[
          { value: '', label: 'Loaded / first available' },
          ...models.map((m) => ({ value: m, label: m })),
        ]"
      />
    </ZenField>
    <ZenField label="API key" stack>
      <ZenInput
        v-model="apiKey"
        type="password"
        :placeholder="hasKey ? 'Saved — type to replace' : 'Optional'"
      />
    </ZenField>
    <div v-if="dropsKey" class="za-settings-note">
      The saved key belongs to the old endpoint, so saving clears it. Type it again to keep using it
      here.
    </div>
    <ZenField label="Max tokens" stack>
      <ZenInput v-model="maxTokens" type="number" :min="64" :step="256" />
    </ZenField>
    <ZenField label="Max steps per reply" stack>
      <ZenInput v-model="maxSteps" type="number" :min="1" :max="100" :step="5" />
    </ZenField>
    <ZenField label="Max runs per reply" stack>
      <ZenInput v-model="maxRuns" type="number" :min="1" :max="20" :step="1" />
    </ZenField>
    <ZenField label="Ask before actions">
      <ZenSwitch v-model="askFirst" aria-label="Ask before actions" />
    </ZenField>
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
    <div v-if="status" class="za-settings-status">{{ status }}</div>
    <ZenButton variant="primary" @click="save">Save</ZenButton>
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
.za-settings-status,
.za-settings-note {
  color: var(--zen-muted);
  font-size: 11.5px;
}
.za-settings-note {
  color: var(--zen-warn, var(--zen-muted));
}
</style>
