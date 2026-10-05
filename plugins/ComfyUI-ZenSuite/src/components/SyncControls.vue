<template>
  <div class="zsync">
    <div class="zsync-row">
      <ZenInput
        class="zsync-channel"
        :model-value="channel"
        placeholder="channel"
        sm
        @update:model-value="setChannel(String($event))"
      />
      <ZenSwitch
        :model-value="enable"
        title="Publish to this channel"
        on-icon="mdi mdi-access-point"
        off-icon="mdi mdi-access-point-off"
        @update:model-value="setEnable"
      />
    </div>
    <p class="zsync-hint">
      {{ enable ? 'Publishing to' : 'Not publishing to' }} channel “{{ channel || 'default' }}”.
    </p>
  </div>
</template>

<script setup lang="ts">
// A Sync / Save node's channel and publish switch, shown in a popover from the node's header
// cog (see lib/headerPopover.ts). The values live in the node's hidden widgets.
import { onMounted, ref } from 'vue'
import { ZenInput, ZenSwitch } from '@nynxz/zenkit-ui'

interface Widget {
  value: unknown
  callback?: (v: unknown) => void
}
interface NodeLike {
  setDirtyCanvas?: (a: boolean, b: boolean) => void
  graph?: { setDirtyCanvas?: (a: boolean, b: boolean) => void }
}
const props = defineProps<{ node: NodeLike; channelWidget: Widget; enableWidget: Widget }>()

const channel = ref(
  typeof props.channelWidget.value === 'string' ? props.channelWidget.value : 'default',
)
const enable = ref(props.enableWidget.value !== false)

function redraw() {
  ;(props.node.setDirtyCanvas ?? props.node.graph?.setDirtyCanvas)?.(true, true)
}
function writeWidget(w: Widget, v: unknown) {
  w.value = v
  try {
    w.callback?.(v)
  } catch {
    /* widget has no callback */
  }
  redraw()
}
function setChannel(v: string) {
  channel.value = v
  writeWidget(props.channelWidget, v)
}
function setEnable(v: boolean) {
  enable.value = v
  writeWidget(props.enableWidget, v)
}

// Re-read after a frame so values restored by node.configure() (loading a saved
// workflow) land in the refs even if they arrive just after mount.
function resync() {
  if (typeof props.channelWidget.value === 'string') channel.value = props.channelWidget.value
  enable.value = props.enableWidget.value !== false
}

onMounted(() => {
  resync()
  requestAnimationFrame(resync)
})
</script>

<style scoped>
.zsync {
  width: 100%;
  box-sizing: border-box;
  font-size: 12px;
  color: var(--zen-text, #e5e5ea);
}
.zsync {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.zsync-hint {
  margin: 0;
  color: var(--zen-muted, #9aa0aa);
  font-size: 11px;
}
.zsync-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.zsync-channel {
  flex: 1;
  min-width: 0;
}
</style>
