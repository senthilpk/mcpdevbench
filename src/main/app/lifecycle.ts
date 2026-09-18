import { app, BrowserWindow } from 'electron';
import { createMainWindow } from '@/main/app/create-main-window';
import { registerHealthIpc } from '@/main/ipc/register-health-ipc';

export const startApplication = async (): Promise<void> => {
  await app.whenReady();
  registerHealthIpc();
  createMainWindow();

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
