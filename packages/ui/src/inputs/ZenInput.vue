<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
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
    /** `sm` 24px, `md` (default) 28px — the shared control heights (one-line inputs). */
    size?: 'sm' | 'md'
    /** Same as size="sm". */
    sm?: boolean
    /** textarea only: grow with the text instead of scrolling (from `rows` up). */
    autosize?: boolean
  }>(),
  { type: 'text', rows: 4, disabled: false, size: 'md', sm: false, autosize: false },
)
const area = ref<HTMLTextAreaElement | null>(null)
function fit() {
  const el = area.value
  if (!props.autosize || !el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + 2}px`
}
watch(
  () => props.modelValue,
  () => nextTick(fit),
)
onMounted(fit)
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
    ref="area"
    class="zen-input area"
    :class="{ sm: sm || size === 'sm', auto: autosize }"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :value="modelValue"
    @input="onInput"
  />
  <input
    v-else
    class="zen-input"
    :class="{ sm: sm || size === 'sm' }"
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
  /* line-height: normal decouples from ComfyUI's inherited (small) line-height. A one-line input
     has the shared control height and centres its text itself; a textarea pads instead. */
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 12px;
  line-height: normal;
  background: var(--zen-field-bg, var(--zen-input, #1b1b20));
  color: var(--zen-text, #e5e5ea);
  border: 1px solid var(--zen-control-border, var(--zen-border, #34343c));
  border-radius: var(--zen-radius, 7px);
  height: var(--zen-control-h, 28px);
  padding: 0 9px;
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
  opacity: 0.45;
  cursor: not-allowed;
}
.zen-input.sm {
  height: var(--zen-control-h-sm, 24px);
  padding: 0 8px;
  font-size: 11px;
}
.zen-input.area {
  height: auto;
  padding: 7px 9px;
  resize: vertical;
  min-height: 64px;
  line-height: 1.45;
}
.zen-input.area.auto {
  resize: none;
  min-height: 0;
  overflow: hidden;
}
</style>
