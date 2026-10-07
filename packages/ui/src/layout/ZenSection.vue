<script setup lang="ts">
import '../lib/motion.css'
// ZenSection — a titled, collapsible block. The "sechead" every inspector had hand-rolled: a
// chevron, a title, soft meta text on the right, and a body that folds away.
//
//   <ZenSection v-model:open="settingsOpen" title="Scene settings" variant="card">
//     <template #meta>opens the film · keyframes</template>
//     <template #actions><ZenIconButton icon="mdi-restore" title="Reset" @click="reset" /></template>
//     <ZenField label="length"><ZenNumber v-model="seconds" /></ZenField>
//   </ZenSection>
//
// `plain` is a header over a hairline divider — stacks of these make an inspector. `card` is a
// bordered box — for a list of settings groups that each want to read as one thing.
//
// Inside a <ZenSections> group, give it a `value` and the group owns open/closed (accordion or
// independent); v-model:open and `storageKey` are then ignored.
import { computed, inject, ref, useId, watch } from 'vue'
import ZenIcon from '../primitives/ZenIcon.vue'
import { SECTIONS_KEY } from '../lib/sections'

const props = withDefaults(
  defineProps<{
    title?: string
    /** MDI class ("mdi mdi-tune" or "mdi-tune") or an image URL, as everywhere in ZenKit. */
    icon?: string
    /** `false` = always open, no chevron, header is plain text. */
    collapsible?: boolean
    /** Header can't be toggled and reads as disabled. The body's controls are the host's call. */
    disabled?: boolean
    variant?: 'plain' | 'card'
    /** Remember open/closed in localStorage under this key. Ignored inside a ZenSections group. */
    storageKey?: string
    /** This section's id inside a ZenSections group. */
    value?: string
  }>(),
  { collapsible: true, disabled: false, variant: 'plain' },
)

const openModel = defineModel<boolean>('open', { default: true })

const group = inject(SECTIONS_KEY, null)
const grouped = computed(() => !!group && props.value != null)

// Storage is read once, in setup, so a persisted "closed" never flashes open. Every access is
// guarded: private windows and sandboxed iframes throw on localStorage rather than returning null.
if (!grouped.value && props.storageKey) {
  try {
    const saved = localStorage.getItem(props.storageKey)
    if (saved === '1' || saved === '0') openModel.value = saved === '1'
  } catch {
    /* storage unavailable — keep the prop's state */
  }
}
if (group && props.value != null) group.register(props.value, openModel.value)

const open = computed(
  () => !props.collapsible || (grouped.value ? group!.isOpen(props.value!) : openModel.value),
)

watch(openModel, (v) => {
  if (grouped.value || !props.storageKey) return
  try {
    localStorage.setItem(props.storageKey, v ? '1' : '0')
  } catch {
    /* storage unavailable — the state just isn't remembered */
  }
})

// While the height animates the body must clip; once open it must not, or focus rings and
// shadows at the body's edge get cut off. `animating` covers exactly the transition.
const animating = ref(false)
let settle: ReturnType<typeof setTimeout> | undefined
function toggle() {
  if (!props.collapsible || props.disabled) return
  const next = !open.value
  if (grouped.value) group!.setOpen(props.value!, next)
  else openModel.value = next
  animating.value = true
  clearTimeout(settle)
  // transitionend never fires under reduced motion (no transition); the timer is the backstop.
  settle = setTimeout(() => (animating.value = false), 400)
}
function onTransitionEnd(e: TransitionEvent) {
  if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows') {
    animating.value = false
    clearTimeout(settle)
  }
}

const uid = useId()
const headId = `${uid}-head`
const bodyId = `${uid}-body`
</script>

<template>
  <section class="zen-section" :class="[variant, { open, disabled }]">
    <div class="zs-head">
      <button
        v-if="collapsible"
        :id="headId"
        type="button"
        class="zs-toggle"
        :aria-expanded="open"
        :aria-controls="bodyId"
        :disabled="disabled"
        @click="toggle"
      >
        <i class="mdi mdi-chevron-right zs-chev" aria-hidden="true" />
        <ZenIcon v-if="icon" class="zs-icon" :icon="icon" aria-hidden="true" />
        <span class="zs-title">
          <slot name="title">{{ title }}</slot>
        </span>
        <span v-if="$slots.meta" class="zs-meta"><slot name="meta" /></span>
      </button>
      <div v-else :id="headId" class="zs-toggle static">
        <ZenIcon v-if="icon" class="zs-icon" :icon="icon" aria-hidden="true" />
        <span class="zs-title">
          <slot name="title">{{ title }}</slot>
        </span>
        <span v-if="$slots.meta" class="zs-meta"><slot name="meta" /></span>
      </div>
      <!-- Outside the toggle button (a button can't contain buttons), and .stop so a host that
           listens for clicks on the whole section doesn't see an action as a toggle either. -->
      <div v-if="$slots.actions" class="zs-actions" @click.stop @pointerdown.stop>
        <slot name="actions" />
      </div>
    </div>
    <div
      :id="bodyId"
      class="zs-wrap"
      role="region"
      :aria-labelledby="headId"
      :inert="!open || undefined"
      @transitionend="onTransitionEnd"
    >
      <div class="zs-clip" :class="{ clipped: !open || animating }">
        <div class="zs-body"><slot /></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.zen-section {
  display: flex;
  flex-direction: column;
  min-width: 0;
  color: var(--zen-text, #e5e5ea);
}

/* plain: consecutive sections are separated by a hairline — an inspector's rhythm. */
.zen-section.plain + .zen-section.plain {
  border-top: 1px solid var(--zen-border, #34343c);
}

/* card: the whole section is one bordered box. */
.zen-section.card {
  border: 1px solid var(--zen-border, #34343c);
  border-radius: var(--zen-radius, 7px);
  background: var(--zen-surface, #202026);
}

.zs-head {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
}
.zen-section.plain > .zs-head {
  padding: 4px 0;
}
.zen-section.card > .zs-head {
  padding: 3px 4px 3px 8px;
}

/* The toggle takes the whole row bar the actions, so the hit area is the header, not the text. */
.zs-toggle {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
  border: 0;
  border-radius: var(--zen-radius, 4px);
  background: none;
  color: inherit;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.zs-toggle.static {
  cursor: default;
}
.zs-toggle:focus-visible {
  outline: 2px solid
    var(--zen-focus-ring, color-mix(in srgb, var(--zen-accent, #6366f1) 60%, transparent));
  outline-offset: 1px;
}
.zs-toggle:disabled {
  cursor: default;
}
.zen-section.disabled > .zs-head {
  opacity: 0.5;
}

.zs-chev {
  flex: 0 0 auto;
  font-size: 14px;
  color: var(--zen-muted, #9aa0aa);
  transition: transform var(--zen-dur, 0.2s) ease;
}
.zen-section.open > .zs-head .zs-chev {
  transform: rotate(90deg);
}
.zs-icon {
  flex: 0 0 auto;
  font-size: 14px;
  color: var(--zen-muted, #9aa0aa);
}
.zs-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zs-meta {
  margin-left: auto;
  padding-left: 8px;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 400;
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
}
.zs-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
}

/* Height animation without measuring: a one-row grid whose track goes 0fr → 1fr. The clip is the
   grid item; `min-height: 0` lets it collapse below its content. Every state rule reaches only the
   section's own parts (`>`): a section nested in an open one must still fold. */
.zs-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--zen-dur, 0.2s) ease;
}
.zen-section.open > .zs-wrap {
  grid-template-rows: 1fr;
}
.zs-clip {
  min-height: 0;
  min-width: 0;
}
.zs-clip.clipped {
  overflow: hidden;
}
.zen-section:not(.open) > .zs-wrap > .zs-clip {
  visibility: hidden;
  transition: visibility 0s var(--zen-dur, 0.2s);
}

.zs-body {
  display: flex;
  flex-direction: column;
  gap: var(--zen-section-gap, 8px);
}
.zen-section.plain > .zs-wrap > .zs-clip > .zs-body {
  padding: 2px 0 10px;
}
.zen-section.card > .zs-wrap > .zs-clip > .zs-body {
  padding: 2px 8px 8px;
}

@media (prefers-reduced-motion: reduce) {
  .zs-chev,
  .zs-wrap,
  .zen-section:not(.open) > .zs-wrap > .zs-clip {
    transition: none;
  }
}
</style>
