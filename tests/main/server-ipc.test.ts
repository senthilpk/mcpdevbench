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
    expect(electron.handlers.size).toBe(11);
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

describe('reopenAuthorization / cancelAuthorization / signOut IPC handlers', () => {
  it('rejects a missing or malformed connection id for reopenAuthorization', async () => {
    const connections = createConnections();
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    await expect(electron.handlers.get(serverChannels.reopenAuthorization)?.({}, '')).rejects.toThrow();
    await expect(electron.handlers.get(serverChannels.reopenAuthorization)?.({}, { connectionId: 'c1' })).rejects.toThrow();
    expect(connections.reopenAuthorization).not.toHaveBeenCalled();
  });

  it('passes only the connection id to reopenAuthorization and returns the parsed snapshot', async () => {
    const connections = createConnections();
    connections.reopenAuthorization = vi.fn(async () => makeSnapshot({ connectionId: 'c1', state: 'authorizing' }));
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    const result = await electron.handlers.get(serverChannels.reopenAuthorization)?.({}, 'c1');
    expect(connections.reopenAuthorization).toHaveBeenCalledWith('c1');
    expect(connections.reopenAuthorization).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ connectionId: 'c1', state: 'authorizing' });
  });

  it('rejects a malformed reopenAuthorization result instead of passing it through', async () => {
    const connections = createConnections();
    connections.reopenAuthorization = vi.fn(async () => ({ connectionId: 'c1' }) as never);
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    await expect(electron.handlers.get(serverChannels.reopenAuthorization)?.({}, 'c1')).rejects.toThrow();
  });

  it('rejects a missing or malformed connection id for cancelAuthorization', async () => {
    const connections = createConnections();
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    await expect(electron.handlers.get(serverChannels.cancelAuthorization)?.({}, '')).rejects.toThrow();
    expect(connections.cancelAuthorization).not.toHaveBeenCalled();
  });

  it('passes only the connection id to cancelAuthorization and returns the parsed snapshot', async () => {
    const connections = createConnections();
    connections.cancelAuthorization = vi.fn(async () => makeSnapshot({ connectionId: 'c1', state: 'disconnected' }));
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    const result = await electron.handlers.get(serverChannels.cancelAuthorization)?.({}, 'c1');
    expect(connections.cancelAuthorization).toHaveBeenCalledWith('c1');
    expect(result).toMatchObject({ connectionId: 'c1', state: 'disconnected' });
  });

  it('rejects a missing or malformed profile id for signOut', async () => {
    const connections = createConnections();
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    await expect(electron.handlers.get(serverChannels.signOut)?.({}, '')).rejects.toThrow();
    expect(connections.signOut).not.toHaveBeenCalled();
  });

  it('passes only the profile id to signOut and returns the parsed result', async () => {
    const connections = createConnections();
    connections.signOut = vi.fn(async () => ({ localCredentialsRemoved: true, revocation: 'revoked' }));
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    const result = await electron.handlers.get(serverChannels.signOut)?.({}, 'p1');
    expect(connections.signOut).toHaveBeenCalledWith('p1');
    expect(result).toEqual({ localCredentialsRemoved: true, revocation: 'revoked' });
  });

  it('rejects a malformed signOut result instead of passing it through', async () => {
    const connections = createConnections();
    connections.signOut = vi.fn(async () => ({ localCredentialsRemoved: true, revocation: 'bogus' }) as never);
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    await expect(electron.handlers.get(serverChannels.signOut)?.({}, 'p1')).rejects.toThrow();
  });

  it('validates and forwards a callTool request, and parses the response', async () => {
    const connections = createConnections();
    connections.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'hi' }] }));
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    const result = await electron.handlers.get(serverChannels.callTool)?.(
      {}, { connectionId: 'c1', name: 'echo', arguments: { message: 'hi' } },
    );
    expect(connections.callTool).toHaveBeenCalledWith('c1', 'echo', { message: 'hi' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }] });
  });

  it('rejects a malformed callTool request before it reaches the connection manager', async () => {
    const connections = createConnections();
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    await expect(electron.handlers.get(serverChannels.callTool)?.({}, { connectionId: '', name: 'echo' })).rejects.toThrow();
    expect(connections.callTool).not.toHaveBeenCalled();
  });
});

describe('connectionsChanged payload safety', () => {
  it('never forwards a snapshot carrying fields outside the strict schema (e.g. sensitive OAuth data)', () => {
    const send = vi.fn();
    const connections = createConnections();
    registerServerIpc({
      store: storeStub(),
      connections,
      webContents: { getAllWebContents: () => [{ send }] },
    });
    const sneaky = {
      ...makeSnapshot({ connectionId: 'c1', state: 'authorizing' }),
      authorization: {
        status: 'authorized', storage: 'persistent', canReopenBrowser: false, canCancel: false,
        accessToken: 'should-never-cross-ipc',
      },
    };
    expect(() => connections.emit([sneaky])).toThrow();
    expect(send).not.toHaveBeenCalled();
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

  it('parses reopenAuthorization/cancelAuthorization/signOut responses before returning them', async () => {
    const api = createMcpDevBenchApi();
    electron.invoke.mockResolvedValueOnce(makeSnapshot({ connectionId: 'c1', state: 'authorizing' }));
    await expect(api.reopenAuthorization('c1')).resolves.toMatchObject({ connectionId: 'c1' });
    expect(electron.invoke).toHaveBeenCalledWith(serverChannels.reopenAuthorization, 'c1');

    electron.invoke.mockResolvedValueOnce(makeSnapshot({ connectionId: 'c1', state: 'disconnected' }));
    await expect(api.cancelAuthorization('c1')).resolves.toMatchObject({ connectionId: 'c1' });
    expect(electron.invoke).toHaveBeenCalledWith(serverChannels.cancelAuthorization, 'c1');

    electron.invoke.mockResolvedValueOnce({ localCredentialsRemoved: true, revocation: 'revoked' });
    await expect(api.signOut('p1')).resolves.toEqual({ localCredentialsRemoved: true, revocation: 'revoked' });
    expect(electron.invoke).toHaveBeenCalledWith(serverChannels.signOut, 'p1');
  });

  it('rejects a malformed signOut response from the main process instead of returning it', async () => {
    const api = createMcpDevBenchApi();
    electron.invoke.mockResolvedValueOnce({ localCredentialsRemoved: true, revocation: 'bogus' });
    await expect(api.signOut('p1')).rejects.toThrow();
  });

  it('parses a callTool response before returning it', async () => {
    const api = createMcpDevBenchApi();
    electron.invoke.mockResolvedValueOnce({ content: [{ type: 'text', text: 'hi' }] });
    await expect(api.callTool('c1', 'echo', { message: 'hi' })).resolves.toEqual({ content: [{ type: 'text', text: 'hi' }] });
    expect(electron.invoke).toHaveBeenCalledWith(serverChannels.callTool, { connectionId: 'c1', name: 'echo', arguments: { message: 'hi' } });
  });
});

function storeStub() {
  return { list: vi.fn(), save: vi.fn(), delete: vi.fn() };
}

function makeSnapshot(overrides: { connectionId: string; state: string }) {
  return {
    connectionId: overrides.connectionId,
    profileId: 'p1',
    state: overrides.state,
    tools: { status: 'unsupported', items: [] },
    resources: { status: 'unsupported', items: [] },
    resourceTemplates: { status: 'unsupported', items: [] },
    prompts: { status: 'unsupported', items: [] },
  };
}

function createConnections() {
  let listener: ((snapshots: unknown[]) => void) | undefined;
  return {
    list: vi.fn(() => []), connect: vi.fn(), disconnect: vi.fn(), refresh: vi.fn(),
    disconnectProfile: vi.fn(), closeAll: vi.fn(),
    reopenAuthorization: vi.fn(async (connectionId: string) => makeSnapshot({ connectionId, state: 'authorizing' })),
    cancelAuthorization: vi.fn(async (connectionId: string) => makeSnapshot({ connectionId, state: 'disconnected' })),
    signOut: vi.fn(async () => ({ localCredentialsRemoved: true, revocation: 'unavailable' })),
    callTool: vi.fn(async () => ({ content: [] })),
    subscribe: vi.fn((next: (snapshots: unknown[]) => void) => { listener = next; return vi.fn(); }),
    emit: (snapshots: unknown[]) => listener?.(snapshots),
  };
}
