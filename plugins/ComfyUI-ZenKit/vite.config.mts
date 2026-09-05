import { zenPluginConfig } from '@nynxz/zenkit-nodekit/vite'

import { workspaceAliases } from '../../workspace-aliases'

// Workspace source, not the published dist — see workspace-aliases.ts.
export default zenPluginConfig({
  name: 'comfyui-zenkit',
  configUrl: import.meta.url,
  alias: workspaceAliases,
})
