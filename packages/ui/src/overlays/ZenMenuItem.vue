<script setup lang="ts">
// ZenMenuItem — a styled action row for inside a ZenPopover. Icon + label (the default slot)
// + optional #hint / danger. Add a #submenu slot to make it a submenu trigger: the flyout
// opens on hover with a close-delay (hover-intent) so a diagonal cursor path toward it doesn't
// snap it shut — the failing of a pure CSS :hover submenu. Emits `select` on click.
import { ref, useSlots } from 'vue'
import ZenPopover from './ZenPopover.vue'

const props = withDefaults(defineProps<{ icon?: string; danger?: boolean; disabled?: boolean }>(), {
  danger: false,
  disabled: false,
})
const emit = defineEmits<{ select: [] }>()
const slots = useSlots()

const rootEl = ref<HTMLElement | null>(null)
const subOpen = ref(false)
let t: ReturnType<typeof setTimeout> | undefined
function openSub() {
  clearTimeout(t)
  subOpen.value = true
}
function scheduleClose() {
  clearTimeout(t)
  t = setTimeout(() => {
    subOpen.value = false
  }, 220)
}
function onClick() {
  if (!props.disabled) emit('select')
}
</script>

<template>
  <div
    v-if="slots.submenu"
    ref="rootEl"
    class="zmi-wrap"
    @pointerenter="openSub"
    @pointerleave="scheduleClose"
  >
    <button type="button" class="zmi" :class="{ danger, on: subOpen }" :disabled="disabled">
      <i v-if="icon" class="zmi-ico" :class="icon" />
      <span class="zmi-lbl"><slot /></span>
      <i class="mdi mdi-chevron-right zmi-caret" />
    </button>
    <ZenPopover v-model:open="subOpen" :anchor="rootEl" placement="right-start" :offset="3">
      <div class="zmi-sub" @pointerenter="openSub" @pointerleave="scheduleClose">
        <slot name="submenu" />
      </div>
    </ZenPopover>
  </div>
  <button
    v-else
    type="button"
    class="zmi"
    :class="{ danger }"
    :disabled="disabled"
    @click="onClick"
  >
    <i v-if="icon" class="zmi-ico" :class="icon" />
    <span class="zmi-lbl"><slot /></span>
    <span v-if="slots.hint" class="zmi-hint"><slot name="hint" /></span>
  </button>
</template>

<style scoped>
.zmi-wrap {
  position: relative;
}
.zmi {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  text-align: left;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 7px 9px;
  border: none;
  border-radius: max(0px, calc(var(--zen-radius, 8px) - 3px));
  background: none;
  color: var(--zen-text, #e5e5ea);
}
.zmi:hover:not(:disabled),
.zmi.on {
  background: color-mix(in srgb, var(--zen-text, #fff) 10%, transparent);
}
.zmi:disabled {
  opacity: 0.45;
  cursor: default;
}
.zmi.danger:hover:not(:disabled) {
  background: #b91c1c;
  color: #fff;
}
.zmi-ico {
  flex: 0 0 auto;
  font-size: 15px;
  color: var(--zen-muted, #9aa0aa);
}
.zmi.danger:hover:not(:disabled) .zmi-ico {
  color: #fff;
}
.zmi-lbl {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.zmi-caret {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 15px;
  color: var(--zen-muted, #9aa0aa);
}
.zmi-hint {
  margin-left: auto;
  flex: 0 0 auto;
  font-size: 10px;
  color: var(--zen-muted, #9aa0aa);
  font-variant-numeric: tabular-nums;
}
.zmi-sub {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
</style>
