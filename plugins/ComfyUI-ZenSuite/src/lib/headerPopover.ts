// mountHeaderPopover — settings for a node in a popover from a cog in its header (both
// renderers), rather than a widget in its body. Unmounted with the node.
import { createApp, reactive, watch, type App, type Component } from 'vue'
import HeaderPopover from '@/components/HeaderPopover.vue'
import { addNodeHeaderButton } from '@/lib/headerButton'

interface NodeLike {
  id?: number | string
  onRemoved?: () => void
}

export function mountHeaderPopover(
  node: NodeLike,
  content: Component,
  contentProps: Record<string, unknown>,
  button: { icon: string; text?: string; title: string },
): void {
  const state = reactive<{ open: boolean; anchor: HTMLElement | { x: number; y: number } | null }>({
    open: false,
    anchor: null,
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  let app: App | null = createApp(HeaderPopover, {
    content,
    contentProps: { node, ...contentProps },
    state,
    'onUpdate:open': (open: boolean) => (state.open = open),
  })
  app.mount(host)

  const cog = addNodeHeaderButton(node, null, {
    ...button,
    onClick: (at) => {
      state.anchor = at
      state.open = !state.open
    },
  })
  const stopWatch = watch(
    () => state.open,
    (open) => cog.setActive(open),
  )

  const prev = node.onRemoved
  node.onRemoved = function (this: unknown) {
    prev?.call(this)
    stopWatch()
    cog.destroy()
    app?.unmount()
    app = null
    host.remove()
  }
}
