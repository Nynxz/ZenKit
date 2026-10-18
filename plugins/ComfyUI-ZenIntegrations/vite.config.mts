import { zenPluginConfig } from '@nynxz/zenkit-nodekit/vite'

import { workspaceAliases } from '../../workspace-aliases'

export default zenPluginConfig({
  name: 'comfyui-zenintegrations',
  configUrl: import.meta.url,
  alias: workspaceAliases,
  sharedRuntime: true,
})
