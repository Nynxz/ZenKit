<script setup lang="ts">
// ZenField — a labelled control. The other shape every consumer had hand-rolled (`.ov-field`,
// `.etk-res__field`, and friends): a short caption beside or above a control, sized so the
// control gets the room and the label doesn't wrap mid-word.
//
//   <ZenRow :min="150">
//     <ZenField label="Steps" data-grow><ZenNumber v-model="steps" /></ZenField>
//   </ZenRow>
//
// `tip` puts an ⓘ beside the label that explains the field on hover or focus: help that doesn't
// cost a line under every control. `hint` stays for the short, always-visible kind.
//
// `stack` puts the label above instead of beside — worth it below roughly 140px of width, where
// an inline label eats more than it explains.
import ZenTip from '../primitives/ZenTip.vue'

withDefaults(
  defineProps<{
    label?: string
    /** Label above the control instead of beside it. */
    stack?: boolean
    /** Dim helper text under the control. */
    hint?: string
    /** Help behind an ⓘ beside the label (hover or focus): for anything longer than a few words. */
    tip?: string
  }>(),
  { stack: false },
)
</script>

<template>
  <div class="zen-field" :class="{ stack }">
    <div class="zf-row">
      <span v-if="label" class="zf-label-wrap">
        <label class="zf-label">{{ label }}</label>
        <ZenTip v-if="tip" :text="tip" :label="`About ${label}`" />
      </span>
      <div class="zf-control"><slot /></div>
    </div>
    <span v-if="hint" class="zf-hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
/* The hint gets its own line under the label and control, never squeezing in beside them. */
.zen-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.zf-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.zen-field.stack .zf-row {
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
}

.zf-label-wrap {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.zf-label {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--zen-muted, #9aa0aa);
  white-space: nowrap;
}

/* The control takes the remaining room. `min-width: 0` lets it shrink to the field's own floor
   rather than the label + control's combined intrinsic width. */
.zf-control {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  /* Neutralise the components' own width floor for anything living in a field — the same thing
     ZenRow does for its `data-grow` children, but one level deeper, because a control nested in
     a field is where the floor actually bites. Without this, a ZenSelect's `min-width:
     var(--zen-control-min, 90px)` sets an intrinsic floor that the field can't shrink past, and
     a narrow row overflows its node instead of wrapping. Custom properties inherit, so setting
     the token here reaches the control without a specificity fight. */
  --zen-control-min: 0px;
}
.zf-control > :deep(*) {
  flex: 1 1 auto;
  min-width: 0;
}

.zf-hint {
  font-size: 10px;
  color: var(--zen-muted, #9aa0aa);
  opacity: 0.8;
}
</style>
