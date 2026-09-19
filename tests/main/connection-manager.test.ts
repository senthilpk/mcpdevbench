import { describe, expect, it, vi } from 'vitest';
import { ConnectionManager } from '@/main/mcp/connections/connection-manager';
import type { McpClientPort } from '@/main/mcp/client/mcp-client-port';
import type { ProfileStore } from '@/main/profiles/profile-store';
import type { ServerProfile } from '@/shared/domain/servers';

const profiles: ServerProfile[] = [
  { id: 'p1', name: 'One', transport: 'stdio', command: 'node', args: [] },
  { id: 'p2', name: 'Two', transport: 'streamable-http', url: 'https://example.test/mcp' },
];

function createStore(): ProfileStore {
  return { list: vi.fn().mockResolvedValue(profiles), save: vi.fn(), delete: vi.fn() };
}

function createClient(capabilities: Record<string, unknown> = { tools: {} }) {
  let closeCalled = false;
  const client: McpClientPort & { readonly closeCalled: boolean } = {
    connect: vi.fn(),
    close: vi.fn(async () => { closeCalled = true; }),
    get closeCalled() { return closeCalled; },
    metadata: () => ({ serverName: 'Fixture', serverVersion: '1.0.0', capabilities }),
    listTools: vi.fn().mockResolvedValue([{ name: 'echo', inputSchema: {} }]),
    listResources: vi.fn().mockResolvedValue([]),
    listResourceTemplates: vi.fn().mockResolvedValue([]),
    listPrompts: vi.fn().mockResolvedValue([]),
  };
  return client;
}

describe('ConnectionManager', () => {
  it('deduplicates rapid connects for one profile', async () => {
    const client = createClient();
    const factory = vi.fn(() => client);
    const manager = new ConnectionManager(createStore(), factory);
    const [first, second] = await Promise.all([manager.connect('p1'), manager.connect('p1')]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(first.connectionId).toBe(second.connectionId);
  });

  it('publishes the lifecycle through ready with discovered tools', async () => {
    const manager = new ConnectionManager(createStore(), () => createClient());
    const states: string[] = [];
    manager.subscribe((snapshots) => {
      const state = snapshots[0]?.state;
      if (state) states.push(state);
    });
    await manager.connect('p1');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('ready'));
    expect(states).toEqual(expect.arrayContaining(['connecting', 'initializing', 'discovering', 'ready']));
    expect(manager.list()[0]?.tools).toMatchObject({ status: 'ready', items: [{ name: 'echo' }] });
  });

  it('marks transport failures without exposing raw details', async () => {
    const client = createClient();
    vi.mocked(client.connect).mockRejectedValueOnce(new Error('token=secret'));
    const manager = new ConnectionManager(createStore(), () => client);
    await manager.connect('p1');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('failed'));
    expect(manager.list()[0]?.failure).toEqual({ code: 'connection_failed', message: 'Unable to connect to the MCP server' });
  });

  it('disconnects and refreshes only known ready connections', async () => {
    const client = createClient();
    const manager = new ConnectionManager(createStore(), () => client);
    const started = await manager.connect('p1');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('ready'));
    await manager.refresh(started.connectionId);
    expect(client.listTools).toHaveBeenCalledTimes(2);
    const stopped = await manager.disconnect(started.connectionId);
    expect(stopped.state).toBe('disconnected');
    expect(manager.list()).toEqual([]);
    await expect(manager.refresh('missing')).rejects.toThrow('Connection not found');
  });

  it('makes repeated disconnects idempotent', async () => {
    const client = createClient();
    const manager = new ConnectionManager(createStore(), () => client);
    const started = await manager.connect('p1');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('ready'));

    const [first, second] = await Promise.all([
      manager.disconnect(started.connectionId),
      manager.disconnect(started.connectionId),
    ]);
    const third = await manager.disconnect(started.connectionId);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('closes every client during shutdown', async () => {
    const allClients = [createClient(), createClient()];
    const pendingClients = [...allClients];
    const manager = new ConnectionManager(createStore(), () => pendingClients.shift()!);
    await manager.connect('p1');
    await manager.connect('p2');
    await manager.closeAll();
    expect(allClients.every((client) => client.closeCalled)).toBe(true);
    expect(manager.list()).toEqual([]);
  });
});
