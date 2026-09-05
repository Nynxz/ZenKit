<script setup lang="ts">
// ZenIconButton — compact icon-only button (panel headers, toolbars).
withDefaults(
  defineProps<{ icon: string; danger?: boolean; active?: boolean; disabled?: boolean }>(),
  { danger: false, active: false, disabled: false },
)
</script>

<template>
  <button class="zen-iconbtn" :class="{ danger, active }" :disabled="disabled">
    <i :class="icon" />
  </button>
</template>

<style scoped>
.zen-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: var(--zen-radius, 6px);
  background: none;
  color: var(--zen-muted, #9aa0aa);
  cursor: pointer;
  transition:
    background 0.1s ease,
    color 0.1s ease;
}
.zen-iconbtn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--zen-text, #fff) 12%, transparent);
  color: var(--zen-text, #e5e5ea);
}
.zen-iconbtn.active {
  color: var(--zen-accent, #3b82f6);
}
.zen-iconbtn.danger:hover:not(:disabled) {
  background: #b91c1c;
  color: #fff;
}
.zen-iconbtn:disabled {
  opacity: 0.4;
  cursor: default;
}
.zen-iconbtn .mdi {
  font-size: 16px;
}
</style>
