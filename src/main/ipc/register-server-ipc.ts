import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import type { ProfileStore } from '@/main/profiles/profile-store';
import {
  callToolRequestSchema,
  callToolResponseSchema,
  cancelAuthorizationResponseSchema,
  connectionSnapshotSchema,
  connectionSnapshotsSchema,
  reopenAuthorizationResponseSchema,
  saveServerProfileInputSchema,
  serverChannels,
  serverProfileSchema,
  serverProfilesSchema,
  signOutResponseSchema,
} from '@/shared/contracts/servers';
import type { ConnectionSnapshot, SignOutResult, ToolCallResult } from '@/shared/domain/servers';

const idSchema = z.string().min(1);

type ConnectionService = {
  list(): ConnectionSnapshot[];
  connect(profileId: string): Promise<ConnectionSnapshot>;
  disconnect(connectionId: string): Promise<ConnectionSnapshot>;
  refresh(connectionId: string): Promise<ConnectionSnapshot>;
  callTool(connectionId: string, name: string, args?: Record<string, unknown>): Promise<ToolCallResult>;
  disconnectProfile(profileId: string): Promise<void>;
  reopenAuthorization(connectionId: string): Promise<ConnectionSnapshot>;
  cancelAuthorization(connectionId: string): Promise<ConnectionSnapshot>;
  signOut(profileId: string): Promise<SignOutResult>;
  subscribe(listener: (snapshots: ConnectionSnapshot[]) => void): () => void;
};

type WebContentsSource = { getAllWebContents(): Array<Pick<WebContents, 'send'>> };

export function registerServerIpc({
  store,
  connections,
  webContents,
}: {
  store: ProfileStore;
  connections: ConnectionService;
  webContents: WebContentsSource;
}): () => void {
  ipcMain.handle(serverChannels.profilesList, async () => serverProfilesSchema.parse(await store.list()));
  ipcMain.handle(serverChannels.profilesSave, async (_event, value: unknown) => {
    const input = saveServerProfileInputSchema.parse(value);
    return serverProfileSchema.parse(await store.save(input));
  });
  ipcMain.handle(serverChannels.profilesDelete, async (_event, value: unknown) => {
    const profileId = idSchema.parse(value);
    await connections.disconnectProfile(profileId);
    await store.delete(profileId);
  });
  ipcMain.handle(serverChannels.connectionsList, () => connectionSnapshotsSchema.parse(connections.list()));
  ipcMain.handle(serverChannels.connect, async (_event, value: unknown) =>
    connectionSnapshotSchema.parse(await connections.connect(idSchema.parse(value))));
  ipcMain.handle(serverChannels.disconnect, async (_event, value: unknown) =>
    connectionSnapshotSchema.parse(await connections.disconnect(idSchema.parse(value))));
  ipcMain.handle(serverChannels.refresh, async (_event, value: unknown) =>
    connectionSnapshotSchema.parse(await connections.refresh(idSchema.parse(value))));
  ipcMain.handle(serverChannels.callTool, async (_event, value: unknown) => {
    const { connectionId, name, arguments: toolArguments } = callToolRequestSchema.parse(value);
    return callToolResponseSchema.parse(await connections.callTool(connectionId, name, toolArguments));
  });
  ipcMain.handle(serverChannels.reopenAuthorization, async (_event, value: unknown) =>
    reopenAuthorizationResponseSchema.parse(await connections.reopenAuthorization(idSchema.parse(value))));
  ipcMain.handle(serverChannels.cancelAuthorization, async (_event, value: unknown) =>
    cancelAuthorizationResponseSchema.parse(await connections.cancelAuthorization(idSchema.parse(value))));
  ipcMain.handle(serverChannels.signOut, async (_event, value: unknown) =>
    signOutResponseSchema.parse(await connections.signOut(idSchema.parse(value))));

  return connections.subscribe((snapshots) => {
    const payload = connectionSnapshotsSchema.parse(snapshots);
    for (const target of webContents.getAllWebContents()) {
      target.send(serverChannels.connectionsChanged, payload);
    }
  });
}
