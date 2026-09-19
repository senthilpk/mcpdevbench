import { describe, expect, it, vi } from 'vitest';
import { McpClientAdapter, type AdapterDependencies } from '@/main/mcp/client/mcp-client-adapter';

describe('McpClientAdapter', () => {
  it('rejects unsupported HTTP protocols before transport creation', () => {
    expect(() => new McpClientAdapter({
      id: 'p1', name: 'bad', transport: 'streamable-http', url: 'file:///tmp/mcp',
    })).toThrow('HTTP profile URL');
  });

  it('normalizes negotiated metadata and catalog entries', async () => {
    const client = {
      connect: vi.fn(), close: vi.fn(),
      getServerCapabilities: () => ({ tools: {} }),
      getServerVersion: () => ({ name: 'fixture', version: '1.2.3' }),
      getNegotiatedProtocolVersion: () => '2025-11-25',
      getInstructions: () => 'Use carefully',
      listTools: async () => ({ tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' }, annotations: { ignored: true } }] }),
      listResources: async () => ({ resources: [] }),
      listResourceTemplates: async () => ({ resourceTemplates: [] }),
      listPrompts: async () => ({ prompts: [] }),
    };
    const deps: AdapterDependencies = { create: () => ({ client, transport: {} as never }) };
    const adapter = new McpClientAdapter({ id: 'p1', name: 'x', transport: 'stdio', command: 'node', args: [] }, deps);
    await adapter.connect();
    expect(adapter.metadata()).toMatchObject({ serverName: 'fixture', protocolVersion: '2025-11-25' });
    expect(await adapter.listTools()).toEqual([{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }]);
  });

  it('terminates an HTTP session before closing the client', async () => {
    const order: string[] = [];
    const client = {
      connect: vi.fn(), close: async () => { order.push('close'); },
      getServerCapabilities: () => ({}), getServerVersion: () => undefined,
      getNegotiatedProtocolVersion: () => undefined, getInstructions: () => undefined,
      listTools: async () => ({ tools: [] }), listResources: async () => ({ resources: [] }),
      listResourceTemplates: async () => ({ resourceTemplates: [] }), listPrompts: async () => ({ prompts: [] }),
    };
    const deps: AdapterDependencies = { create: () => ({ client, transport: {} as never, terminateSession: async () => { order.push('terminate'); } }) };
    const adapter = new McpClientAdapter({ id: 'p1', name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp' }, deps);
    await adapter.close();
    expect(order).toEqual(['terminate', 'close']);
  });
});
