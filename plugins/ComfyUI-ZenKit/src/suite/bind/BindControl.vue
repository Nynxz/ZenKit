<template>
  <div class="bc" :class="kind">
    <template v-if="kind === 'number'">
      <ZenNumber
        size="sm"
        :model-value="Number(value) || 0"
        :min="spec.min"
        :max="spec.max"
        :step="spec.step"
        :precision="spec.precision"
        @update:model-value="write"
      />
      <ZenIconButton
        v-if="seed"
        size="sm"
        icon="mdi mdi-dice-5-outline"
        title="New random seed"
        @click="write(randomSeed(target.widget))"
      />
    </template>
    <ZenCombo
      v-else-if="kind === 'combo'"
      size="sm"
      searchable
      :model-value="comboValue"
      :items="items"
      @update:model-value="write"
    />
    <ZenSwitch v-else-if="kind === 'toggle'" :model-value="!!value" @update:model-value="write" />
    <ZenInput
      v-else-if="kind === 'text'"
      sm
      :model-value="String(value ?? '')"
      @update:model-value="write(String($event ?? ''))"
    />
    <ZenInput
      v-else-if="kind === 'multiline'"
      type="textarea"
      :rows="3"
      autosize
      sm
      :model-value="String(value ?? '')"
      @update:model-value="write(String($event ?? ''))"
    />
  </div>
</template>

<script setup lang="ts">
/** The control for one bound widget, chosen by the widget's type. Edits go to the widget itself. */
import { computed } from 'vue'
import { ZenCombo, ZenIconButton, ZenInput, ZenNumber, ZenSwitch } from '@nynxz/zenkit-ui'

import { comboValues, controlKind, isSeed, numberSpec, randomSeed } from './bindings'
import { writeWidget, type Target } from './store'

const props = defineProps<{ target: Target; value: unknown }>()

const kind = computed(() => controlKind(props.target.widget))
const spec = computed(() => numberSpec(props.target.widget))
const seed = computed(() => isSeed(props.target.widget))
const comboValue = computed(() =>
  typeof props.value === 'number' ? props.value : String(props.value ?? ''),
)
const items = computed(() =>
  comboValues(props.target.widget, props.target.node).map((v) => ({
    value: v as string | number,
    label: String(v),
  })),
)

function write(value: unknown) {
  writeWidget(props.target, value)
}
</script>

<style scoped>
.bc {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.bc > :first-child {
  flex: 1;
  min-width: 0;
}
.bc.toggle > :first-child {
  flex: none;
}
</style>
