<template>
  <div v-if="covered" class="zrw">
    <button
      class="zrw-run"
      :title="`Run the workflow${remaining ? ` · ${remaining} queued` : ''} (Ctrl+Enter) · Shift-click to run next`"
      @click="run($event.shiftKey)"
    >
      <i class="mdi mdi-play" />
      <span>Run</span>
      <span v-if="remaining" class="zrw-count">{{ remaining }}</span>
    </button>
    <button v-if="remaining" class="zrw-stop" title="Stop the running job" @click="stop">
      <i class="mdi mdi-stop" />
    </button>
  </div>
</template>

<script setup lang="ts">
// Run controls for when the graph is covered (a workspace or a full-screen app): ComfyUI's own
// action bar floats over the canvas, so it is hidden with it. Runs ComfyUI's commands, so the
// run is exactly the one its button would make.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { app } from '@comfy/app'
import { api } from '@comfy/api'
import type { AppStore } from '../appStore'
import { ws } from '../workspaces'

const props = defineProps<{ appStore: AppStore }>()
const covered = computed(() => !!ws.active || !!props.appStore.state.active.app)
const remaining = ref(0)

type Commands = { execute(id: string): Promise<unknown> | unknown }
const commands = () =>
  (app as { extensionManager?: { command?: Commands } }).extensionManager?.command

function run(front: boolean) {
  void commands()?.execute(front ? 'Comfy.QueuePromptFront' : 'Comfy.QueuePrompt')
}
function stop() {
  void commands()?.execute('Comfy.Interrupt')
}

type StatusEvent = CustomEvent<{ exec_info?: { queue_remaining?: number } } | null>
const onStatus = (e: Event) => {
  remaining.value = (e as StatusEvent).detail?.exec_info?.queue_remaining ?? 0
}
const events = api as unknown as EventTarget
onMounted(() => events.addEventListener('status', onStatus))
onBeforeUnmount(() => events.removeEventListener('status', onStatus))
</script>

<style scoped>
.zrw {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.zrw-run,
.zrw-stop {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px 0 7px;
  border: 0;
  border-radius: var(--zen-radius, 6px);
  background: var(--zen-accent, #3b82f6);
  color: var(--zen-accent-text, #fff);
  font: inherit;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
}
.zrw-run:hover {
  filter: brightness(1.1);
}
.zrw-run .mdi,
.zrw-stop .mdi {
  font-size: 15px;
}
.zrw-count {
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgb(0 0 0 / 25%);
  font-size: 10px;
  text-align: center;
}
.zrw-stop {
  padding: 0 5px;
  background: color-mix(in srgb, var(--zen-danger, #e5484d) 85%, transparent);
}
</style>
