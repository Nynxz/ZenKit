<template>
  <div ref="rootEl" class="zsync">
    <div v-if="showOpts" class="zsync-panel">
      <!-- compact: channel + publish on one row -->
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ZenInput, ZenSwitch } from '@nynxz/zenkit-ui'
import { addNodeHeaderButton, type NodeHeaderButtonHandle } from '@/lib/headerButton'

interface Widget {
  value: unknown
  callback?: (v: unknown) => void
}
interface NodeLike {
  setDirtyCanvas?: (a: boolean, b: boolean) => void
  graph?: { setDirtyCanvas?: (a: boolean, b: boolean) => void }
}
const props = defineProps<{ node: NodeLike; channelWidget: Widget; enableWidget: Widget }>()

const rootEl = ref<HTMLElement | null>(null)
const showOpts = ref(false)
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

let cog: NodeHeaderButtonHandle | null = null
onMounted(() => {
  resync()
  requestAnimationFrame(resync)
  cog = addNodeHeaderButton(props.node, rootEl.value, {
    icon: 'mdi mdi-cog',
    text: '⚙',
    title: 'Sync settings (channel / publish)',
    onClick: () => {
      showOpts.value = !showOpts.value
    },
  })
  cog.setActive(showOpts.value)
})
watch(showOpts, (v) => cog?.setActive(v))
onBeforeUnmount(() => cog?.destroy())
</script>

<style scoped>
.zsync {
  width: 100%;
  box-sizing: border-box;
  font-size: 12px;
  color: var(--zen-text, #e5e5ea);
}
.zsync-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 4px 4px;
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
