// Refs shared by the LoRA overlays and the components they mount.

import { ref, shallowRef } from 'vue'

/** The thumb under the pointer, if any. */
export const peekTarget = shallowRef<{ name: string; el: HTMLElement } | null>(null)
export const shiftHeld = ref(false)

/** The LoRA the details view shows. */
export const detailName = ref('')
/** Open state of the built-in modal fallback. */
export const detailModalOpen = ref(false)

/** Show examples Civitai rates R and above unblurred. */
export const revealMature = ref(false)
