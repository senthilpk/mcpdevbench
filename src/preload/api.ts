import { contextBridge, ipcRenderer } from 'electron';
import {
  healthChannels,
  healthStatusSchema,
  type HealthStatusContract,
} from '@/shared/contracts/health';

export type MCPDevBenchApi = {
  getHealth(): Promise<HealthStatusContract>;
};

const api: MCPDevBenchApi = {
  getHealth: async () =>
    healthStatusSchema.parse(await ipcRenderer.invoke(healthChannels.get)),
};

contextBridge.exposeInMainWorld('mcpdevbench', api);
