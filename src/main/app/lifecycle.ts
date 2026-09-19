import { join } from 'node:path';
import { app, BrowserWindow, webContents } from 'electron';
import { createMainWindow } from '@/main/app/create-main-window';
import { registerHealthIpc } from '@/main/ipc/register-health-ipc';
import { registerServerIpc } from '@/main/ipc/register-server-ipc';
import { createMcpClient } from '@/main/mcp/client/mcp-client-adapter';
import { ConnectionManager } from '@/main/mcp/connections/connection-manager';
import { JsonProfileStore } from '@/main/profiles/json-profile-store';

export const startApplication = async (): Promise<void> => {
  const e2eUserData = process.env.MCPDEVBENCH_E2E_USER_DATA;
  if (e2eUserData) app.setPath('userData', e2eUserData);
  await app.whenReady();

  const store = new JsonProfileStore(join(app.getPath('userData'), 'server-profiles.json'));
  const connections = new ConnectionManager(store, createMcpClient);
  registerHealthIpc();
  registerServerIpc({ store, connections, webContents });
  createMainWindow();

  let quittingAfterCleanup = false;
  app.on('before-quit', (event) => {
    if (quittingAfterCleanup) return;
    event.preventDefault();
    quittingAfterCleanup = true;
    void connections.closeAll().finally(() => app.quit());
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
};
