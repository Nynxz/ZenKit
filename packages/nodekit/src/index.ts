// Frontend machinery for a ComfyUI node pack. Components live in @nynxz/zenkit-ui.
// A pack binds this once via createNodekit and imports from that module.

export { createNodekit, type Nodekit } from './nodekit'
export { makeIdentity, type Identity, type PackManifest } from './identity'

export { componentName, type WidgetFileExports, type WidgetOptions } from './discoverWidgets'
export { defineNode, type NodeDef, type NodeWidgetDef, type SlotLinkDef } from './defineNode'
export {
  useDragSurface,
  type DragContext,
  type DragSurface,
  type DragSurfaceOptions,
} from './useDragSurface'
export { viewUrl } from './viewUrl'

// Optional ZenKit integration — each a no-op or fallback without the runtime.
export { registerSlotLink } from './zenGraph'
export { openViewer, type ViewerItem } from './zenViewer'
export { openZenPanel, hasZenPanels, type ZenPanelSpec, type ZenPanelHandle } from './zenPanel'

// Prefer the identity-bound versions from createNodekit over these.
export { registerNodes, discoverNodes } from './registerNodes'
export { mountWidget, type DOMWidget, type MountOptions } from './mountWidget'
export {
  addNodeHeaderButton,
  type NodeHeaderButtonHandle,
  type NodeHeaderButtonOptions,
} from './nodeHeaderButton'
