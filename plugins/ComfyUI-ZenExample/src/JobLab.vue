<script setup lang="ts">
// Job Lab — starts test jobs so the taskbar's Jobs widget can be seen with every kind of
// progress: counted, open-ended, failing, and several at once, from the browser or the server.
import { ZenButton } from '@nynxz/zenkit-ui'
import { runInBrowser, runOnServer, type JobKind } from '@/lib/testJobs'

const KINDS: { kind: JobKind; label: string; icon: string; hint: string }[] = [
  { kind: 'counted', label: 'Counted', icon: 'mdi mdi-counter', hint: '20 steps with a total' },
  { kind: 'open', label: 'Open-ended', icon: 'mdi mdi-timer-sand', hint: 'no total, 6 seconds' },
  { kind: 'fail', label: 'Failing', icon: 'mdi mdi-alert-outline', hint: 'fails at step 7 of 12' },
  { kind: 'burst', label: 'Burst', icon: 'mdi mdi-layers-triple-outline', hint: '4 jobs at once' },
]
</script>

<template>
  <div class="lab">
    <section v-for="side in ['browser', 'server'] as const" :key="side" class="side">
      <h3>{{ side === 'browser' ? 'In the browser' : 'On the server' }}</h3>
      <p>
        {{
          side === 'browser'
            ? 'startJob() from @nynxz/zenkit-client'
            : 'Python sending zenkit.job events (jobs_api.py)'
        }}
      </p>
      <div class="grid">
        <ZenButton
          v-for="k in KINDS"
          :key="k.kind"
          :icon="k.icon"
          :title="k.hint"
          @click="side === 'browser' ? runInBrowser(k.kind) : runOnServer(k.kind)"
        >
          {{ k.label }}
        </ZenButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.lab {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  padding: 14px;
  overflow: auto;
  color: var(--zen-text);
  font-size: 12px;
}
h3 {
  margin: 0;
  font-size: 13px;
}
p {
  margin: 2px 0 8px;
  color: var(--zen-muted);
  font-family: var(--zen-mono);
  font-size: 11px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
</style>
