import { app } from '@comfy/app'
import { createApp, type Component } from 'vue'
// The pack version, read from package.json so it cannot drift from what ships.
import { version } from '../package.json'
import { registerZenPlugin, type ZenPanelDef, type PanelContext } from '@nynxz/zenkit-client'
import MediaViewer from '@/components/MediaViewer.vue'
import AssetBrowser from '@/components/AssetBrowser.vue'
import TimerPanel from '@/components/TimerPanel.vue'
import SyncControls from '@/components/SyncControls.vue'
import ChannelPreview from '@/components/ChannelPreview.vue'
import { mountNodeControls } from '@/lib/mountControls'

// Mount a Vue component into a panel body; `withCtx` forwards the panel's persisted
// PanelContext as a `ctx` prop (multi-instance panels use it for per-instance state).
function mounter(component: Component, withCtx = false) {
  return (el: HTMLElement, ctx?: PanelContext) => {
    const a = createApp(component, withCtx ? { ctx } : undefined)
    a.mount(el)
    return () => a.unmount()
  }
}

// ZenSuite — the ZenKit core panel pack. Panels are registered (discoverable in the
// Start menu) but none auto-open; users launch what they want.
const PANELS: ZenPanelDef[] = [
  {
    id: 'zensuite:viewer',
    title: 'Media Viewer',
    icon: 'mdi mdi-image-multiple-outline',
    render: mounter(MediaViewer, true),
    width: 560,
    height: 600,
    minWidth: 320,
    minHeight: 280,
    multi: true,
  },
  {
    id: 'zensuite:assets',
    title: 'Asset Browser',
    icon: 'mdi mdi-folder-multiple-image',
    render: mounter(AssetBrowser),
    width: 980,
    height: 660,
    minWidth: 460,
    minHeight: 320,
  },
  {
    id: 'zensuite:timer',
    title: 'Timer',
    icon: 'mdi mdi-timer-outline',
    render: mounter(TimerPanel),
    width: 360,
    height: 640,
    minWidth: 260,
    minHeight: 300,
  },
]

// Hide a widget on both ComfyUI renderers (1.0 reads `.hidden`, Vue 2.0 reads
// `.options.hidden`). Without the options side, hidden widgets stay visible on 2.0.
function hideWidget(w: any) {
  if (!w) return
  w.hidden = true
  w.options = w.options || {}
  w.options.hidden = true
}

app.registerExtension({
  name: 'nynxz.zensuite',
  setup() {
    void registerZenPlugin({
      id: 'zensuite',
      plugin: 'ZenSuite',
      version,
      panels: PANELS,
    })
  },
  // Replace a node's raw widgets with a cog-toggled ZenKit control mounted on the node
  // body. Originals are hidden (not removed) so they still serialise to Python. Uses the
  // `nodeCreated` hook (not beforeRegisterNodeDef): litegraph populates the widgets first
  // and fires nodeCreated afterwards, so this.widgets is ready here.
  nodeCreated(node: any) {
    const cls = node?.comfyClass ?? node?.type
    if (cls === 'zen.Channel.SyncImage') {
      try {
        const channelW = node.widgets?.find((w: any) => w.name === 'channel')
        const enableW = node.widgets?.find((w: any) => w.name === 'enable')
        // Hide on BOTH renderers: litegraph 1.0 reads `widget.hidden`; the Vue Nodes 2.0
        // manager reads `widget.options.hidden` — set both or it stays visible on 2.0.
        hideWidget(channelW)
        hideWidget(enableW)
        if (channelW && enableW) {
          mountNodeControls(node, 'zsync_controls', SyncControls, {
            channelWidget: channelW,
            enableWidget: enableW,
          })
        }
      } catch (e) {
        console.error('[ZenSuite] ZenSyncImage widget setup failed', e)
      }
    } else if (cls === 'zen.Channel.Preview') {
      // Display-only node: hide the raw channel/count/layout widgets and mount the live wall.
      try {
        const channelW = node.widgets?.find((w: any) => w.name === 'channel')
        const countW = node.widgets?.find((w: any) => w.name === 'count')
        const skipW = node.widgets?.find((w: any) => w.name === 'skip')
        const layoutW = node.widgets?.find((w: any) => w.name === 'layout')
        const rowHeightW = node.widgets?.find((w: any) => w.name === 'row_height')
        hideWidget(channelW)
        hideWidget(countW)
        hideWidget(skipW)
        hideWidget(layoutW)
        hideWidget(rowHeightW)
        // A sensible starting viewport — in fill mode nothing will resize the node afterwards,
        // so this is the size the user starts dragging from rather than a transient guess.
        try {
          const w = Math.max(node.size?.[0] ?? 0, 300)
          node.setSize?.([w, Math.max(node.size?.[1] ?? 0, 320)])
        } catch {
          /* size not ready */
        }
        if (channelW && countW) {
          // fill: the node's height is the user's, and the grid scrolls inside it. Must match
          // `<ZenWidget fill>` in the component.
          mountNodeControls(
            node,
            'zcp_controls',
            ChannelPreview,
            {
              channelWidget: channelW,
              countWidget: countW,
              skipWidget: skipW,
              layoutWidget: layoutW,
            },
            { fill: true, minHeight: 160 },
          )
        }
      } catch (e) {
        console.error('[ZenSuite] ZenChannelPreview widget setup failed', e)
      }
    }
  },
} as never)
