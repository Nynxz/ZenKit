import { zenRuntimeConfig } from '@nynxz/zenkit-nodekit/vite'

import { workspaceAliases } from '../../workspace-aliases'

export default zenRuntimeConfig({ configUrl: import.meta.url, alias: workspaceAliases })
