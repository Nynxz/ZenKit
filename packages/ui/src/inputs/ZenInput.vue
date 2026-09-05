<script setup lang="ts">
// ZenInput — themed text/number/textarea field (v-model). type='textarea' renders a
// resizable <textarea>; otherwise a single-line <input :type>. Emits numbers for type='number'.
const props = withDefaults(
  defineProps<{
    modelValue: string | number
    type?: 'text' | 'number' | 'password' | 'textarea'
    placeholder?: string
    rows?: number
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    sm?: boolean
  }>(),
  { type: 'text', rows: 4, disabled: false, sm: false },
)
const emit = defineEmits<{ 'update:modelValue': [string | number] }>()

function onInput(e: Event) {
  const v = (e.target as HTMLInputElement | HTMLTextAreaElement).value
  if (props.type === 'number') {
    const n = Number(v)
    emit('update:modelValue', v === '' || Number.isNaN(n) ? 0 : n)
  } else {
    emit('update:modelValue', v)
  }
}
</script>

<template>
  <textarea
    v-if="type === 'textarea'"
    class="zen-input area"
    :class="{ sm }"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :value="modelValue"
    @input="onInput"
  />
  <input
    v-else
    class="zen-input"
    :class="{ sm }"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :min="min"
    :max="max"
    :step="step"
    :value="modelValue"
    @input="onInput"
  />
</template>

<style scoped>
.zen-input {
  /* line-height: normal decouples from ComfyUI's inherited (small) line-height; the
     asymmetric padding (1px more top than bottom) optically centres the glyphs, which
     otherwise sit a touch high inside the field (line-height alone can't fix that). */
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 12px;
  line-height: normal;
  background: var(--zen-input, #1b1b20);
  color: var(--zen-text, #e5e5ea);
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 7px);
  padding: 8px 9px 6px;
  transition: border-color 0.12s ease;
}
.zen-input::placeholder {
  color: var(--zen-muted, #9aa0aa);
}
.zen-input:focus {
  outline: none;
  border-color: var(--zen-accent, #6366f1);
}
.zen-input:disabled {
  opacity: 0.5;
  cursor: default;
}
.zen-input.sm {
  padding: 6px 8px 4px;
  font-size: 11px;
}
.zen-input.area {
  resize: vertical;
  min-height: 64px;
  line-height: 1.45;
}
</style>
