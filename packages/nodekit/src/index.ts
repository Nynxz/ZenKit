// Frontend machinery for a ComfyUI node pack. Components live in @nynxz/zenkit-ui.
// A pack binds this once in its framework.ts, which re-exports this module and adds what
// createNodekit binds to the pack's identity, and imports from there.

export { createNodekit, type Nodekit } from './nodekit'
export type { Identity, PackManifest } from './identity'

export type { WidgetFileExports, WidgetOptions } from './discoverWidgets'
export { defineNode, type NodeDef, type NodeWidgetDef, type SlotLinkDef } from './defineNode'
export {
  useDragSurface,
  type DragContext,
  type DragSurface,
  type DragSurfaceOptions,
} from './useDragSurface'
export { viewUrl } from './viewUrl'
// The drag data ZenKit's own media sources set (its Media Viewer, Asset Browser): drops into
// ComfyUI, another ZenKit surface or another app take it as that file.
export { setMediaDragData, setMediaListDragData } from '../../client/src/index'
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
export { registerZenApp, type ZenAppEntry } from './zenApp'
export { useAppLocation, type AppContext, type AppLocation, type AppRouter } from './zenkit'
export { highlightNode, revealNode } from './highlightNode'
export { registerZenCapability, type ZenCapability } from './zenCapability'

// The identity-bound helpers (registerNodes, mountWidget, addNodeHeaderButton, …) come from
// createNodekit; only their types are here.
export type { DOMWidget, MountOptions, NodeLike } from './mountWidget'
export { mirrorOf, type ZenMirror } from './widgetMirror'
export type { NodeHeaderButtonHandle, NodeHeaderButtonOptions } from './nodeHeaderButton'
