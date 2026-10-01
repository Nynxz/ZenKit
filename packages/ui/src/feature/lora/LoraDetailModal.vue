<!-- Details fallback when the host registers no opener (see setLoraDetailOpener). -->
<template>
  <ZenModal v-model:open="detailModalOpen" title="LoRA details" width="640px" height="82vh">
    <LoraDetail v-if="detailName" :name="detailName" />
  </ZenModal>
</template>

<script setup lang="ts">
import ZenModal from '../../overlays/ZenModal.vue'

import LoraDetail from './LoraDetail.vue'
import { detailModalOpen, detailName } from './loraState'
</script>
