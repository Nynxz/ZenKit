// ComfyUI's notifications while a workspace covers the graph. They would pop up over the
// workspace, so ComfyUI is asked to hold them — its toast store's `held`, the same switch it uses
// while you pick nodes — and they collect in the taskbar's inbox instead. On the graph they show
// as ComfyUI draws them.
//
// ZenKit runs its own Vue, so its watchers can't see ComfyUI's state: the store is followed
// through Pinia's `$subscribe`, which runs on ComfyUI's side.
import { reactive, watch } from 'vue'
import { ws } from './workspaces'

type ToastKind = 'error' | 'info' | 'loading' | 'success' | 'warning'
interface ComfyToast {
  id: string
  instance: symbol
  kind: ToastKind
  title: string
  description?: string
  action?: { label: string; onClick: () => unknown }
}
interface ToastStore {
  held: boolean
  toasts: ComfyToast[]
  dismiss(id: string): boolean
  $subscribe(callback: () => void, options?: { detached?: boolean }): () => void
}
interface PiniaHost {
  __vue_app__?: { config: { globalProperties: { $pinia?: { _s: Map<string, unknown> } } } }
}

export interface InboxItem {
  id: string
  kind: Exclude<ToastKind, 'loading'>
  title: string
  description?: string
  action?: { label: string; onClick: () => unknown }
  time: number
}

/** What arrived while a workspace was up, newest last; `unread` counts the ones not yet seen. */
export const inbox = reactive({ items: [] as InboxItem[], unread: 0 })

function toastStore(): ToastStore | null {
  const host = document.getElementById('vue-app') as (HTMLElement & PiniaHost) | null
  const store = host?.__vue_app__?.config.globalProperties.$pinia?._s.get('toast')
  return store && typeof store === 'object' && 'toasts' in store ? (store as ToastStore) : null
}

/** Move the toasts ComfyUI is holding into the inbox, and out of its queue: held, they never
 *  time out, so leaving the workspace would show them all at once. A toast still loading stays
 *  queued — it settles into a success or an error under the same id, and that one comes here. */
function collect(store: ToastStore) {
  for (const t of store.toasts) {
    if (t.kind === 'loading') continue
    const item: InboxItem = {
      id: t.id,
      kind: t.kind,
      title: t.title,
      description: t.description,
      action: t.action,
      time: Date.now(),
    }
    const known = inbox.items.findIndex((i) => i.id === t.id)
    if (known >= 0) inbox.items.splice(known, 1)
    inbox.items.push(item)
    inbox.unread++
    store.dismiss(t.id)
  }
}

export function markInboxRead() {
  inbox.unread = 0
}
export function removeFromInbox(id: string) {
  inbox.items = inbox.items.filter((i) => i.id !== id)
}
export function clearInbox() {
  inbox.items = []
  inbox.unread = 0
}

let started = false
/** Start routing ComfyUI's notifications to the inbox while a workspace is up. Idempotent; waits
 *  for ComfyUI's toast store, which appears once its UI has mounted. */
export function startComfyToasts(): void {
  if (started || typeof document === 'undefined') return
  started = true
  let tries = 0
  const attach = () => {
    const store = toastStore()
    if (!store) {
      if (++tries < 120) window.setTimeout(attach, 500)
      return
    }
    store.$subscribe(
      () => {
        if (ws.active !== null) collect(store)
      },
      { detached: true },
    )
    watch(
      () => ws.active !== null,
      (covered) => {
        store.held = covered
        if (covered) collect(store)
      },
      { immediate: true },
    )
  }
  attach()
}
