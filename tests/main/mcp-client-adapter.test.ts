import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '@modelcontextprotocol/client';
import { McpClientAdapter, type AdapterDependencies } from '@/main/mcp/client/mcp-client-adapter';
import { McpAuthorizationRequiredError, McpCimdUnsupportedError } from '@/main/mcp/client/mcp-client-port';

function fakeSdkClient(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    connect: vi.fn(),
    close: vi.fn(),
    getServerCapabilities: () => ({}),
    getServerVersion: () => undefined,
    getNegotiatedProtocolVersion: () => undefined,
    getInstructions: () => undefined,
    listTools: async () => ({ tools: [] }),
    listResources: async () => ({ resources: [] }),
    listResourceTemplates: async () => ({ resourceTemplates: [] }),
    listPrompts: async () => ({ prompts: [] }),
    ...overrides,
  };
}

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

  it('never forwards an authProvider to STDIO transport construction', () => {
    const create = vi.fn<AdapterDependencies['create']>(() => ({ client: fakeSdkClient(), transport: {} as never }));
    const deps: AdapterDependencies = { create };
    const authProvider = { tokens: vi.fn(), clientInformation: vi.fn() } as never;
    new McpClientAdapter({ id: 'p1', name: 'x', transport: 'stdio', command: 'node', args: [] }, deps, authProvider);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('forwards a supplied authProvider to HTTP transport construction', () => {
    const create = vi.fn<AdapterDependencies['create']>(() => ({ client: fakeSdkClient(), transport: {} as never }));
    const deps: AdapterDependencies = { create };
    const authProvider = { tokens: vi.fn(), clientInformation: vi.fn() } as never;
    new McpClientAdapter({ id: 'p1', name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp' }, deps, authProvider);
    expect(create.mock.calls[0]?.[1]).toBe(authProvider);
  });

  it('constructs HTTP transports with no provider when none is supplied', () => {
    const create = vi.fn<AdapterDependencies['create']>(() => ({ client: fakeSdkClient(), transport: {} as never }));
    const deps: AdapterDependencies = { create };
    new McpClientAdapter({ id: 'p1', name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp' }, deps);
    expect(create.mock.calls[0]?.[1]).toBeUndefined();
  });

  it('distinguishes an SDK UnauthorizedError from a generic connection failure', async () => {
    const client = fakeSdkClient({ connect: vi.fn().mockRejectedValue(new UnauthorizedError()) });
    const deps: AdapterDependencies = { create: () => ({ client, transport: {} as never }) };
    const adapter = new McpClientAdapter({ id: 'p1', name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp' }, deps);
    await expect(adapter.connect()).rejects.toBeInstanceOf(McpAuthorizationRequiredError);
  });

  it('maps the SDK CIMD-unsupported message to a typed error without leaking it verbatim as a generic failure', async () => {
    const client = fakeSdkClient({
      connect: vi.fn().mockRejectedValue(new Error('OAuth client information must be saveable for dynamic registration')),
    });
    const deps: AdapterDependencies = { create: () => ({ client, transport: {} as never }) };
    const adapter = new McpClientAdapter({ id: 'p1', name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp' }, deps);
    await expect(adapter.connect()).rejects.toBeInstanceOf(McpCimdUnsupportedError);
  });

  it('leaves a generic connection failure untouched', async () => {
    const client = fakeSdkClient({ connect: vi.fn().mockRejectedValue(new Error('boom')) });
    const deps: AdapterDependencies = { create: () => ({ client, transport: {} as never }) };
    const adapter = new McpClientAdapter({ id: 'p1', name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp' }, deps);
    await expect(adapter.connect()).rejects.toThrow('boom');
  });

  it('forwards every validated search parameter to transport.finishAuth', async () => {
    const finishAuth = vi.fn().mockResolvedValue(undefined);
    const client = fakeSdkClient();
    const deps: AdapterDependencies = {
      create: () => ({ client, transport: {} as never, finishAuth }),
    };
    const adapter = new McpClientAdapter({ id: 'p1', name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp' }, deps, {} as never);
    const params = new URLSearchParams({ code: 'abc', state: 'xyz', iss: 'https://issuer.test' });
    await adapter.finishAuthorization(params);
    expect(finishAuth).toHaveBeenCalledWith(params);
  });

  it('rejects finishAuthorization when the bundle has no finishAuth (e.g. no provider was supplied)', async () => {
    const client = fakeSdkClient();
    const deps: AdapterDependencies = { create: () => ({ client, transport: {} as never }) };
    const adapter = new McpClientAdapter({ id: 'p1', name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp' }, deps);
    await expect(adapter.finishAuthorization(new URLSearchParams())).rejects.toThrow('finishAuthorization');
  });

  it('reconnect creates a fresh client/transport bundle while preserving the same provider reference', () => {
    const create = vi.fn<AdapterDependencies['create']>(() => ({ client: fakeSdkClient(), transport: {} as never }));
    const deps: AdapterDependencies = { create };
    const authProvider = { tokens: vi.fn(), clientInformation: vi.fn() } as never;
    const profile = { id: 'p1', name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp' } as const;

    new McpClientAdapter(profile, deps, authProvider);
    new McpClientAdapter(profile, deps, authProvider);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[1]).toBe(authProvider);
    expect(create.mock.calls[1]?.[1]).toBe(authProvider);
    expect(create.mock.calls[0]?.[1]).toBe(create.mock.calls[1]?.[1]);
  });
});
