import { ipcMain, type WebContents } from 'electron';
import { z } from 'zod';
import type { ProfileStore } from '@/main/profiles/profile-store';
import {
  connectionSnapshotSchema,
  connectionSnapshotsSchema,
  saveServerProfileInputSchema,
  serverChannels,
  serverProfileSchema,
  serverProfilesSchema,
} from '@/shared/contracts/servers';
import type { ConnectionSnapshot } from '@/shared/domain/servers';

const idSchema = z.string().min(1);

type ConnectionService = {
  list(): ConnectionSnapshot[];
  connect(profileId: string): Promise<ConnectionSnapshot>;
  disconnect(connectionId: string): Promise<ConnectionSnapshot>;
  refresh(connectionId: string): Promise<ConnectionSnapshot>;
  disconnectProfile(profileId: string): Promise<void>;
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

  return connections.subscribe((snapshots) => {
    const payload = connectionSnapshotsSchema.parse(snapshots);
    for (const target of webContents.getAllWebContents()) {
      target.send(serverChannels.connectionsChanged, payload);
    }
  });
}
