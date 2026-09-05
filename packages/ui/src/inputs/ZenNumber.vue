<script setup lang="ts">
// ZenNumber — compact numeric control (v-model). A real, always-present <input> so it's
// fully keyboard-accessible (Tab in/out, ↑/↓ to step, type to edit); drag the field to
// scrub, or use the −/+ steppers. Fixed height so it lines up with ZenCombo etc.
//
// The steppers are role="button" <span>s, NOT <button>s, on purpose: <button> is a
// "labelable" element, so if a consumer wraps ZenNumber in a <label> the label binds to
// the first stepper and every click in the field fires it (the number silently steps).
// Spans aren't labelable, so the label correctly binds to the <input> instead.
import { computed, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    precision?: number
    disabled?: boolean
    bare?: boolean
  }>(),
  { step: 0.05, disabled: false, bare: false },
)
const emit = defineEmits<{ 'update:modelValue': [number] }>()

const el = ref<HTMLInputElement | null>(null)
const focused = ref(false)
// Edit buffer used WHILE focused — the input binds to this, not modelValue, so neither a
// hover re-render nor a parent update wipes in-progress typing. When blurred it shows the
// formatted modelValue instead.
const text = ref('')
// Which stepper is hovered (−1 / +1 / 0). Tracked in JS rather than CSS :hover, because
// :hover sticks under litegraph's repainting/zoom-transformed canvas — you'd hover + and
// the − would stay lit too. pointerenter/leave is event-driven, so only one is ever hot.
const hover = ref<-1 | 0 | 1>(0)
// Decimals = explicit `precision`, else the step's decimal count (so an integer step like
// 16 → 0 decimals: a pixel count shows "1024", not "1024.00").
const prec = computed(() => props.precision ?? String(props.step).split('.')[1]?.length ?? 0)
const display = computed(() =>
  (Number.isFinite(props.modelValue) ? props.modelValue : 0).toFixed(prec.value),
)
// How many characters the value box must ALWAYS be able to show, from the widest string this
// control can ever display — its own bounds at its own precision. Reserving that is the whole
// difference between a floor that keeps the STEPPERS and a floor that keeps the NUMBER: chrome is
// a constant, but "-4.00" is five characters and "1024" is four, and only the consumer's min/max
// knows which. Derived from the bounds rather than from the current value on purpose — sizing to
// what is displayed right now would make the control resize as you scrub it, and shove every
// sibling in the row sideways while you drag.
const chars = computed(() => {
  const bounds = [props.min, props.max].filter((v): v is number => v != null && Number.isFinite(v))
  // Unbounded: nothing to derive from, so a fixed, generous default — anything value-derived
  // would jitter. Six fits "-99.99" and "123456".
  if (!bounds.length) return 6
  return Math.max(3, ...bounds.map((v) => v.toFixed(prec.value).length))
})

function clamp(v: number) {
  if (props.min != null) v = Math.max(props.min, v)
  if (props.max != null) v = Math.min(props.max, v)
  const p = Math.pow(10, prec.value)
  return Math.round(v * p) / p
}
function set(v: number) {
  if (Number.isFinite(v)) emit('update:modelValue', clamp(v))
}
function bump(dir: number) {
  if (props.disabled) return
  const v = clamp((props.modelValue || 0) + dir * props.step)
  set(v)
  if (focused.value) text.value = v.toFixed(prec.value) // keep the focused field in sync
}

function onFocus() {
  focused.value = true
  text.value = display.value
  requestAnimationFrame(() => el.value?.select())
}
function onBlur() {
  focused.value = false
  commit()
}
function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value
}
function commit() {
  const v = parseFloat(text.value)
  if (Number.isFinite(v)) set(v)
}
function revert() {
  text.value = display.value
  el.value?.blur()
}

// drag-to-scrub — only while NOT focused (the input is pointer-events:none then, so these
// pointer events land on the wrapper). A non-moving press focuses the input for typing.
let scrubbing = false,
  moved = false,
  startX = 0,
  startVal = 0
function onDown(e: PointerEvent) {
  if (props.disabled || focused.value) return
  scrubbing = true
  moved = false
  startX = e.clientX
  startVal = props.modelValue || 0
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onMove(e: PointerEvent) {
  if (!scrubbing) return
  const dx = e.clientX - startX
  if (Math.abs(dx) > 3) moved = true
  if (moved) {
    e.preventDefault()
    set(startVal + (dx / 4) * props.step)
  }
}
function onUp(e: PointerEvent) {
  if (!scrubbing) return
  scrubbing = false
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    /* not captured */
  }
  if (!moved) el.value?.focus()
}
</script>

<template>
  <div
    class="zen-num"
    :class="{ disabled, bare }"
    :style="{ '--zn-chars': chars }"
    @pointerleave="hover = 0"
  >
    <span
      v-if="!bare"
      role="button"
      aria-label="Decrease"
      class="zn-step"
      :class="{ hot: hover === -1 }"
      tabindex="-1"
      :aria-disabled="disabled || undefined"
      @pointerenter="hover = -1"
      @pointerleave="hover = 0"
      @pointerdown.prevent
      @click="bump(-1)"
    >
      <i class="mdi mdi-minus" aria-hidden="true" />
    </span>
    <div class="zn-val" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp">
      <input
        ref="el"
        class="zn-input"
        :class="{ live: focused }"
        type="text"
        inputmode="decimal"
        size="1"
        :value="focused ? text : display"
        :disabled="disabled"
        @focus="onFocus"
        @blur="onBlur"
        @input="onInput"
        @keydown.up.prevent="bump(1)"
        @keydown.down.prevent="bump(-1)"
        @keydown.enter.prevent="el?.blur()"
        @keydown.esc.prevent="revert"
      />
    </div>
    <span
      v-if="!bare"
      role="button"
      aria-label="Increase"
      class="zn-step"
      :class="{ hot: hover === 1 }"
      tabindex="-1"
      :aria-disabled="disabled || undefined"
      @pointerenter="hover = 1"
      @pointerleave="hover = 0"
      @pointerdown.prevent
      @click="bump(1)"
    >
      <i class="mdi mdi-plus" aria-hidden="true" />
    </span>
  </div>
</template>

<style scoped>
.zen-num {
  display: inline-flex;
  align-items: stretch;
  height: 28px;
  box-sizing: border-box;
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 6px);
  background: var(--zen-input, #1b1b20);
  overflow: hidden;
  user-select: none;
  /* `ch` is the advance of "0", and tabular figures make every digit that same advance — so a
     ch-based floor measures the actual font at the actual size rather than guessing a px width.
     Both live HERE, on the container, so `1ch` resolves identically in the box and the input.
     `.` and `-` are usually narrower than a digit, so counting them as full digits over-reserves
     by a pixel or two, which is the safe direction. */
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  /* The control's own content floor, so it can't be squashed to the point of CLIPPING. The
     constant is pure chrome — two 21px steppers, 2px of dividers, 1px of border either side and
     the value box's 2px of padding either side — and `--zn-chars` is what the NUMBER needs, set
     from the bounds in script. A floor derived from chrome alone kept the steppers and clipped the
     digits, which is the wrong half to protect.
     This is also the intrinsic (max-content) width, since `size="1"` collapses the input's own:
     a consumer that just says `flex: none` gets exactly the right width and never has to guess
     one. A floor is a promise the LAYOUT has to keep, so it stays as tight as the parts allow —
     pair it with a stacked ZenField (label above, not beside) when a row has to survive a ~200px
     node body. */
  min-width: calc(50px + var(--zn-chars, 4) * 1ch);
}
/* bare has no steppers, dividers or value padding — its chrome is the border alone */
.zen-num.bare {
  min-width: calc(2px + var(--zn-chars, 4) * 1ch);
}
.zen-num:focus-within {
  border-color: var(--zen-accent, #6366f1);
}
.zen-num.disabled {
  opacity: 0.5;
  pointer-events: none;
}
.zn-step {
  flex: none;
  width: 21px;
  border: none;
  background: none;
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.zn-step.hot {
  color: var(--zen-text, #e5e5ea);
  background: color-mix(in srgb, var(--zen-text, #fff) 9%, transparent);
}
.zn-step .mdi {
  font-size: 13px;
}
.zn-val {
  flex: 1;
  /* A floor, not a size — `flex: 1` grows it wherever there's room. It has to repeat the digit
     reservation rather than inherit the container's: an explicit min-width on a flex item
     overrides its automatic content-based minimum, so without this the box would happily shrink
     below its own text and clip it from the inside while the container stayed the right size. */
  min-width: calc(var(--zn-chars, 4) * 1ch);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: ew-resize;
  border-left: 1px solid var(--zen-border, #34343c);
  border-right: 1px solid var(--zen-border, #34343c);
  padding: 0 2px;
}
/* bare: no ±steppers — just a scrub/type value box (for tight inline use, e.g. ZenDimensions) */
.zen-num.bare .zn-val {
  border-left: none;
  border-right: none;
}
/* The input IS the value display: pointer-events off while blurred so the wrapper handles
   drag-scrub; on when focused so the caret/selection work. line-height:normal decouples
   from ComfyUI's inherited (small) line-height.
   `size="1"` in the template is load-bearing, not cosmetic: an input's INTRINSIC width comes
   from its `size` attribute — 20 characters, ~180px — and `width: 100%` does NOT change what it
   contributes to its parent's max-content width. Any layout that sizes to content (a ZenRow's
   fixed child, a stacked ZenField, plain `width: auto`) therefore inherited a ~220px control,
   which is how these ended up hanging outside a node body. With size="1" the intrinsic width
   collapses and CSS decides: `min-width` is the floor, `flex: 1` on .zn-val does the growing.
   Consumers used to paper over this with an explicit `width`; they no longer have to. */
.zn-input {
  width: 100%;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: var(--zen-text, #e5e5ea);
  font: inherit;
  line-height: normal;
  text-align: center;
  pointer-events: none;
  cursor: ew-resize;
}
.zn-input.live {
  pointer-events: auto;
  cursor: text;
}
.zn-input:disabled {
  color: var(--zen-muted, #9aa0aa);
}
</style>
