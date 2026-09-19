import { describe, expect, it } from 'vitest';
import {
  connectionSnapshotSchema,
  saveServerProfileInputSchema,
} from '@/shared/contracts/servers';

describe('server contracts', () => {
  it('rejects secret-bearing and shell-shaped profile input', () => {
    expect(() => saveServerProfileInputSchema.parse({
      name: 'unsafe',
      transport: 'stdio',
      command: 'node server.js',
      args: [],
      env: { TOKEN: 'secret' },
    })).toThrow();
  });

  it('accepts only absolute HTTP endpoints', () => {
    expect(() => saveServerProfileInputSchema.parse({
      name: 'x', transport: 'streamable-http', url: '/mcp',
    })).toThrow();
    expect(saveServerProfileInputSchema.parse({
      name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp',
    })).toMatchObject({ transport: 'streamable-http' });
  });

  it('distinguishes unsupported, empty, and failed catalogs', () => {
    const base = {
      connectionId: 'c1', profileId: 'p1', state: 'ready',
      tools: { status: 'ready', items: [] },
      resources: { status: 'unsupported', items: [] },
      resourceTemplates: { status: 'failed', items: [], message: 'bad template catalog' },
      prompts: { status: 'ready', items: [] },
    };
    expect(connectionSnapshotSchema.parse(base).resourceTemplates.status).toBe('failed');
  });
});
