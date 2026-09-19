import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => electron.handlers.set(channel, handler)),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  exposeInMainWorld: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: electron.handle },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener },
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
}));

import { registerServerIpc } from '@/main/ipc/register-server-ipc';
import { createMcpDevBenchApi } from '@/preload/api';
import { serverChannels } from '@/shared/contracts/servers';

describe('registerServerIpc', () => {
  beforeEach(() => {
    electron.handlers.clear();
    electron.handle.mockClear();
  });

  it('registers commands, validates save input, and returns parsed output', async () => {
    const store = {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn(async (input) => ({ ...input, id: 'p1' })),
      delete: vi.fn(),
    };
    const connections = createConnections();
    registerServerIpc({ store, connections, webContents: { getAllWebContents: () => [] } });
    expect(electron.handlers.size).toBe(7);
    await expect(electron.handlers.get(serverChannels.profilesSave)?.({}, {
      name: 'unsafe', transport: 'stdio', command: 'node server.js', args: [], env: { TOKEN: 'x' },
    })).rejects.toThrow();
    await expect(electron.handlers.get(serverChannels.profilesSave)?.({}, {
      name: 'safe', transport: 'stdio', command: 'node', args: [],
    })).resolves.toMatchObject({ id: 'p1' });
  });

  it('disconnects a profile before deleting it', async () => {
    const order: string[] = [];
    const store = { list: vi.fn(), save: vi.fn(), delete: vi.fn(async () => { order.push('delete'); }) };
    const connections = createConnections();
    connections.disconnectProfile = vi.fn(async () => { order.push('disconnect'); });
    registerServerIpc({ store, connections, webContents: { getAllWebContents: () => [] } });
    await electron.handlers.get(serverChannels.profilesDelete)?.({}, 'p1');
    expect(order).toEqual(['disconnect', 'delete']);
  });

  it('broadcasts validated connection snapshots', () => {
    const send = vi.fn();
    const connections = createConnections();
    registerServerIpc({
      store: { list: vi.fn(), save: vi.fn(), delete: vi.fn() },
      connections,
      webContents: { getAllWebContents: () => [{ send }] },
    });
    connections.emit([]);
    expect(send).toHaveBeenCalledWith(serverChannels.connectionsChanged, []);
  });
});

describe('preload server API', () => {
  it('removes the exact wrapped event listener', () => {
    const api = createMcpDevBenchApi();
    const unsubscribe = api.onConnectionsChanged(vi.fn());
    const wrapped = electron.on.mock.calls.at(-1)?.[1];
    unsubscribe();
    expect(electron.removeListener).toHaveBeenCalledWith(serverChannels.connectionsChanged, wrapped);
  });
});

function createConnections() {
  let listener: ((snapshots: unknown[]) => void) | undefined;
  return {
    list: vi.fn(() => []), connect: vi.fn(), disconnect: vi.fn(), refresh: vi.fn(),
    disconnectProfile: vi.fn(), closeAll: vi.fn(),
    subscribe: vi.fn((next: (snapshots: unknown[]) => void) => { listener = next; return vi.fn(); }),
    emit: (snapshots: unknown[]) => listener?.(snapshots),
  };
}
