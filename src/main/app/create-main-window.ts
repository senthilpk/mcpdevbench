import type {
  BrowserWindow as BrowserWindowInstance,
  BrowserWindowConstructorOptions,
} from 'electron';
import path from 'node:path';

export const createMainWindowOptions = (
  preloadPath: string,
): BrowserWindowConstructorOptions => ({
  width: 1280,
  height: 800,
  minWidth: 960,
  minHeight: 640,
  backgroundColor: '#f5f6f7',
  show: false,
  webPreferences: {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});

export const createMainWindow = (): BrowserWindowInstance => {
  const { BrowserWindow } = require('electron') as typeof import('electron');
  const window = new BrowserWindow(
    createMainWindowOptions(path.join(__dirname, 'preload.js')),
  );

  window.once('ready-to-show', () => window.show());

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  return window;
};
