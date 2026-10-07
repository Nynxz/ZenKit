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
export {
  hasMediaDrop,
  mediaKind,
  mediaRefUrl,
  parseMediaRef,
  readMediaDrop,
  uploadMediaFile,
} from './mediaRefs'
export {
  createMediaLibrary,
  type MediaKind,
  type MediaLibrary,
  type MediaLibraryItem,
  type MediaRoot,
} from './mediaLibrary'
// thumbUrl / uploadOrReuse / mediaInfo come bound to the pack's routes from createNodekit.
export { createPackMedia, type MediaInfo, type PackMedia } from './packMedia'

// Optional ZenKit integration — each a no-op or fallback without the runtime. openViewer is the
// client's own (bundled, see zenkit.ts).
export { registerSlotLink } from './zenGraph'
export { openViewer, type ViewerHandle, type ViewerItem, type ViewerOpenOptions } from './zenkit'
export {
  openZenPanel,
  hasZenPanels,
  registerZenPanel,
  type ZenPanelEntry,
  type ZenPanelSpec,
  type ZenPanelHandle,
} from './zenPanel'
export { highlightNode, revealNode } from './highlightNode'
export { registerZenCapability, type ZenCapability } from './zenCapability'

// Prefer the identity-bound versions from createNodekit over these.
export { registerNodes, discoverNodes } from './registerNodes'
export { mountWidget, type DOMWidget, type MountOptions } from './mountWidget'
export {
  addNodeHeaderButton,
  type NodeHeaderButtonHandle,
  type NodeHeaderButtonOptions,
} from './nodeHeaderButton'
