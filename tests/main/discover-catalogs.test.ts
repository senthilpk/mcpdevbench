import { describe, expect, it, vi } from 'vitest';
import { discoverCatalogs } from '@/main/mcp/discovery/discover-catalogs';
import type { McpClientPort } from '@/main/mcp/client/mcp-client-port';

function fakeClient(options: { capabilities: Record<string, unknown>; promptsError?: Error }): McpClientPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    connect: vi.fn(), close: vi.fn(),
    metadata: () => ({ capabilities: options.capabilities }),
    listTools: async () => { calls.push('listTools'); return [{ name: 'echo', inputSchema: {} }]; },
    listResources: async () => { calls.push('listResources'); return []; },
    listResourceTemplates: async () => { calls.push('listResourceTemplates'); return []; },
    listPrompts: async () => {
      calls.push('listPrompts');
      if (options.promptsError) throw options.promptsError;
      return [];
    },
  };
}

describe('discoverCatalogs', () => {
  it('never calls unsupported catalogs', async () => {
    const client = fakeClient({ capabilities: { tools: {} } });
    const result = await discoverCatalogs(client);
    expect(client.calls).toEqual(['listTools']);
    expect(result.resources.status).toBe('unsupported');
  });

  it('retains successful catalogs when one catalog fails', async () => {
    const client = fakeClient({ capabilities: { tools: {}, prompts: {} }, promptsError: new Error('secret detail') });
    const result = await discoverCatalogs(client);
    expect(result.tools).toMatchObject({ status: 'ready', items: [{ name: 'echo' }] });
    expect(result.prompts).toEqual({ status: 'failed', items: [], message: 'Unable to discover prompts' });
  });
});
