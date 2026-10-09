// The taskbar's notifications inbox: ComfyUI's toasts, collected while a workspace is open.
import { createApp } from 'vue'
import { startComfyToasts } from './comfyToasts'
import { registerTaskbarWidget } from './taskbarWidgets'
import ZenInboxWidget from './components/ZenInboxWidget.vue'

export function registerInboxWidget(): void {
  startComfyToasts()
  registerTaskbarWidget({
    id: 'zenkit:inbox',
    label: 'Notifications',
    icon: 'mdi mdi-bell-outline',
    order: 95,
    defaultOn: true,
    render: (el) => {
      const widget = createApp(ZenInboxWidget)
      widget.mount(el)
      return () => widget.unmount()
    },
  })
}
