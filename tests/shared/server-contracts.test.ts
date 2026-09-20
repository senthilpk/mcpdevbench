import { describe, expect, it } from 'vitest';
import {
  authorizationSnapshotSchema,
  callToolRequestSchema,
  connectionSnapshotSchema,
  saveServerProfileInputSchema,
  signOutResultSchema,
  toolCallResultSchema,
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

  it('parses a waiting authorization snapshot', () => {
    const snapshot = authorizationSnapshotSchema.parse({
      status: 'waiting',
      storage: 'persistent',
      canReopenBrowser: true,
      canCancel: true,
    });
    expect(snapshot).toMatchObject({ status: 'waiting', storage: 'persistent' });
  });

  it('rejects sensitive or unknown fields on an authorization snapshot', () => {
    expect(() => authorizationSnapshotSchema.parse({
      status: 'waiting',
      storage: 'persistent',
      canReopenBrowser: true,
      canCancel: true,
      authorizationUrl: 'https://example.test/authorize',
    })).toThrow();
  });

  it('accepts each new authorization lifecycle state on a connection snapshot', () => {
    const base = {
      connectionId: 'c1', profileId: 'p1',
      tools: { status: 'unsupported', items: [] },
      resources: { status: 'unsupported', items: [] },
      resourceTemplates: { status: 'unsupported', items: [] },
      prompts: { status: 'unsupported', items: [] },
    };
    for (const state of ['authorization-required', 'authorizing', 'completing-authorization']) {
      expect(connectionSnapshotSchema.parse({ ...base, state }).state).toBe(state);
    }
  });

  it('parses each sign-out revocation outcome', () => {
    for (const revocation of ['revoked', 'unavailable', 'failed'] as const) {
      expect(signOutResultSchema.parse({
        localCredentialsRemoved: true,
        revocation,
      })).toMatchObject({ localCredentialsRemoved: true, revocation });
    }
  });

  it('parses a text tool-call result', () => {
    const result = toolCallResultSchema.parse({
      content: [{ type: 'text', text: 'hello' }],
    });
    expect(result).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('parses every tool content block variant', () => {
    const content = [
      { type: 'text', text: 'hi' },
      { type: 'image', data: 'YWJj', mimeType: 'image/png' },
      { type: 'audio', data: 'YWJj', mimeType: 'audio/wav' },
      { type: 'resource_link', uri: 'file:///a.txt', name: 'a' },
      { type: 'resource', uri: 'file:///b.txt', text: 'contents' },
    ];
    expect(toolCallResultSchema.parse({ content }).content).toEqual(content);
  });

  it('parses structuredContent and isError on a tool-call result', () => {
    const result = toolCallResultSchema.parse({
      content: [],
      structuredContent: { count: 3 },
      isError: true,
    });
    expect(result).toEqual({ content: [], structuredContent: { count: 3 }, isError: true });
  });

  it('rejects an unknown field on a tool content block', () => {
    expect(() => toolCallResultSchema.parse({
      content: [{ type: 'text', text: 'hi', extra: 'nope' }],
    })).toThrow();
  });

  it('validates a callTool request payload', () => {
    expect(callToolRequestSchema.parse({
      connectionId: 'c1', name: 'echo', arguments: { message: 'hi' },
    })).toEqual({ connectionId: 'c1', name: 'echo', arguments: { message: 'hi' } });
    expect(callToolRequestSchema.parse({ connectionId: 'c1', name: 'echo' })).toEqual({
      connectionId: 'c1', name: 'echo',
    });
    expect(() => callToolRequestSchema.parse({ connectionId: '', name: 'echo' })).toThrow();
  });
});
