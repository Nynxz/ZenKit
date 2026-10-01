// Shift-hover peek and the details view, shared by every LoRA thumb. Both overlays mount once
// into <body> on first use, so a graph full of LoRA widgets still has one of each.

import { createApp, type Component } from 'vue'

import LoraPeek from './LoraPeek.vue'
import LoraDetailModal from './LoraDetailModal.vue'
import { detailModalOpen, detailName, peekTarget, shiftHeld } from './loraState'

const mounted = new Set<Component>()

function mountOnce(component: Component): void {
  if (mounted.has(component) || typeof document === 'undefined') return
  mounted.add(component)
  const el = document.createElement('div')
  document.body.appendChild(el)
  createApp(component).mount(el)
}

// --- peek ----------------------------------------------------------------------------------

let listening = false
function listen(): void {
  if (listening) return
  listening = true
  const sync = (e: KeyboardEvent) => (shiftHeld.value = e.shiftKey)
  window.addEventListener('keydown', sync, true)
  window.addEventListener('keyup', sync, true)
  window.addEventListener('blur', () => (shiftHeld.value = false))
  mountOnce(LoraPeek)
}

export function hoverStart(name: string, el: HTMLElement, shift = false): void {
  listen()
  shiftHeld.value = shift
  peekTarget.value = name ? { name, el } : null
}

export function hoverEnd(el: HTMLElement): void {
  if (peekTarget.value?.el === el) peekTarget.value = null
}

// --- details -------------------------------------------------------------------------------

type DetailOpener = (name: string) => boolean
let opener: DetailOpener | null = null

/** Host hook for showing details (e.g. a ZenKit panel). Return false to use the modal. */
export function setLoraDetailOpener(fn: DetailOpener | null): void {
  opener = fn
}

export function openLoraDetail(name: string): void {
  if (!name) return
  peekTarget.value = null
  detailName.value = name
  if (opener?.(name)) return
  mountOnce(LoraDetailModal)
  detailModalOpen.value = true
}
