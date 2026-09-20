import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  healthChannels,
  healthStatusSchema,
  type HealthStatusContract,
} from '@/shared/contracts/health';
import {
  cancelAuthorizationResponseSchema,
  connectionSnapshotSchema,
  connectionSnapshotsSchema,
  reopenAuthorizationResponseSchema,
  serverChannels,
  serverProfileSchema,
  serverProfilesSchema,
  signOutResponseSchema,
} from '@/shared/contracts/servers';
import type {
  ConnectionSnapshot,
  SaveServerProfileInput,
  ServerProfile,
  SignOutResult,
} from '@/shared/domain/servers';

export type MCPDevBenchApi = {
  getHealth(): Promise<HealthStatusContract>;
  listProfiles(): Promise<ServerProfile[]>;
  saveProfile(input: SaveServerProfileInput): Promise<ServerProfile>;
  deleteProfile(profileId: string): Promise<void>;
  listConnections(): Promise<ConnectionSnapshot[]>;
  connect(profileId: string): Promise<ConnectionSnapshot>;
  disconnect(connectionId: string): Promise<ConnectionSnapshot>;
  refresh(connectionId: string): Promise<ConnectionSnapshot>;
  reopenAuthorization(connectionId: string): Promise<ConnectionSnapshot>;
  cancelAuthorization(connectionId: string): Promise<ConnectionSnapshot>;
  signOut(profileId: string): Promise<SignOutResult>;
  onConnectionsChanged(listener: (snapshots: ConnectionSnapshot[]) => void): () => void;
};

export const createMcpDevBenchApi = (): MCPDevBenchApi => ({
  getHealth: async () => healthStatusSchema.parse(await ipcRenderer.invoke(healthChannels.get)),
  listProfiles: async () => serverProfilesSchema.parse(await ipcRenderer.invoke(serverChannels.profilesList)),
  saveProfile: async (input) => serverProfileSchema.parse(await ipcRenderer.invoke(serverChannels.profilesSave, input)),
  deleteProfile: async (profileId) => { await ipcRenderer.invoke(serverChannels.profilesDelete, profileId); },
  listConnections: async () => connectionSnapshotsSchema.parse(await ipcRenderer.invoke(serverChannels.connectionsList)),
  connect: async (profileId) => connectionSnapshotSchema.parse(await ipcRenderer.invoke(serverChannels.connect, profileId)),
  disconnect: async (connectionId) => connectionSnapshotSchema.parse(await ipcRenderer.invoke(serverChannels.disconnect, connectionId)),
  refresh: async (connectionId) => connectionSnapshotSchema.parse(await ipcRenderer.invoke(serverChannels.refresh, connectionId)),
  reopenAuthorization: async (connectionId) =>
    reopenAuthorizationResponseSchema.parse(await ipcRenderer.invoke(serverChannels.reopenAuthorization, connectionId)),
  cancelAuthorization: async (connectionId) =>
    cancelAuthorizationResponseSchema.parse(await ipcRenderer.invoke(serverChannels.cancelAuthorization, connectionId)),
  signOut: async (profileId) =>
    signOutResponseSchema.parse(await ipcRenderer.invoke(serverChannels.signOut, profileId)),
  onConnectionsChanged(listener) {
    const wrapped = (_event: IpcRendererEvent, value: unknown) => {
      listener(connectionSnapshotsSchema.parse(value));
    };
    ipcRenderer.on(serverChannels.connectionsChanged, wrapped);
    return () => ipcRenderer.removeListener(serverChannels.connectionsChanged, wrapped);
  },
});

contextBridge.exposeInMainWorld('mcpdevbench', createMcpDevBenchApi());
