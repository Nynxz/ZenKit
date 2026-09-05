<script setup lang="ts">
// ZenField — a labelled control. The other shape every consumer had hand-rolled (`.ov-field`,
// `.etk-res__field`, and friends): a short caption beside or above a control, sized so the
// control gets the room and the label doesn't wrap mid-word.
//
//   <ZenRow :min="150">
//     <ZenField label="Steps" data-grow><ZenNumber v-model="steps" /></ZenField>
//   </ZenRow>
//
// `stack` puts the label above instead of beside — worth it below roughly 140px of width, where
// an inline label eats more than it explains.
withDefaults(
  defineProps<{
    label?: string
    /** Label above the control instead of beside it. */
    stack?: boolean
    /** Dim helper text under the control. */
    hint?: string
  }>(),
  { stack: false },
)
</script>

<template>
  <div class="zen-field" :class="{ stack }">
    <label v-if="label" class="zf-label">{{ label }}</label>
    <div class="zf-control"><slot /></div>
    <span v-if="hint" class="zf-hint">{{ hint }}</span>
  </div>
</template>

<style scoped>
.zen-field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.zen-field.stack {
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
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
  flex: 1 1 100%;
  font-size: 10px;
  color: var(--zen-muted, #9aa0aa);
  opacity: 0.8;
}
</style>
