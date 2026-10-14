// The @nynxz/zenkit-client code nodekit shares, so the two can't drift: one `whenZen`, one viewer
// fallback, one media-kind rule, one set of drag MIME types. nodekit's build bundles this source
// (the client is not an external), so a pack gets it without depending on the client; vue stays
// external as always. Imported by relative path so the emitted .d.ts files resolve inside nodekit's
// own dist, with no package for the pack to install.

export {
  COMFY_ASSET_MIME,
  getZenKit,
  mediaKind,
  parseMediaRef,
  openViewer,
  useAppLocation,
  whenZen,
  ZEN_MEDIA_LIST_MIME,
  ZEN_MEDIA_MIME,
} from '../../client/src/index'
export type {
  AppContext,
  AppLocation,
  AppRegistration,
  AppRouter,
  PanelHandle,
  SlotMatch,
  ViewerHandle,
  ViewerItem,
  ViewerOpenOptions,
  ZenKitApi,
} from '../../client/src/contract'
