// zen.chrome — ZenKit's chrome preferences as one settings object, over the setters that
// already persist and apply each one (the panel store, the app router, the taskbar widgets and
// the log). Zen Settings writes the same setters, so `onChange` sees its edits too.
import { watch } from 'vue'
import type { AppStore } from './appStore'
import { debugOn, setDebug } from './log'
import type { PanelStore } from './panelStore'
import { CANVAS_CONTROLS_WIDGET, isWidgetOn, setWidgetOn } from './taskbarWidgets'
import type { ChromeSettings, ZenKitApi } from './types'

export function createChrome(store: PanelStore, appStore: AppStore): ZenKitApi['chrome'] {
  const get = (): ChromeSettings => ({
    taskbarPos: store.state.taskbarPos,
    floatingTaskbar: store.state.taskbarFloating,
    absorbComfyButtons: store.state.absorbComfyButtons,
    absorbCanvasControls: isWidgetOn(CANVAS_CONTROLS_WIDGET),
    appUrlSync: appStore.state.urlSync,
    sidebarAutohide: store.state.sidebarAutohide,
    floatingSidebar: store.state.floatingSidebar,
    debug: debugOn.value,
  })

  function set(patch: Partial<ChromeSettings>) {
    const on = (v: unknown) => typeof v === 'boolean'
    if (patch.taskbarPos === 'top' || patch.taskbarPos === 'bottom')
      store.setTaskbarPos(patch.taskbarPos)
    if (on(patch.floatingTaskbar)) store.setTaskbarFloating(patch.floatingTaskbar!)
    if (on(patch.absorbComfyButtons)) store.setAbsorbComfyButtons(patch.absorbComfyButtons!)
    if (on(patch.absorbCanvasControls))
      setWidgetOn(CANVAS_CONTROLS_WIDGET, patch.absorbCanvasControls!)
    if (on(patch.appUrlSync)) appStore.setUrlSync(patch.appUrlSync!)
    if (on(patch.sidebarAutohide)) store.setSidebarAutohide(patch.sidebarAutohide!)
    if (on(patch.floatingSidebar)) store.setFloatingSidebar(patch.floatingSidebar!)
    if (on(patch.debug)) setDebug(patch.debug!)
  }

  return {
    get,
    set,
    onChange: (cb) =>
      watch(
        () => JSON.stringify(get()),
        () => cb(get()),
      ),
  }
}
