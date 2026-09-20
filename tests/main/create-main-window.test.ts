import { describe, expect, it, vi } from 'vitest';
import { createMainWindowOptions } from '@/main/app/create-main-window';
import { composeServices, type ComposeServicesDeps } from '@/main/app/lifecycle';
import { McpAuthorizationRequiredError, type McpClientFactory, type McpClientPort } from '@/main/mcp/client/mcp-client-port';
import type { CallbackServerLike } from '@/main/oauth/loopback-callback-server';
import type { ProfileStore } from '@/main/profiles/profile-store';
import type { ServerProfile } from '@/shared/domain/servers';

describe('createMainWindowOptions', () => {
  it('enforces renderer isolation', () => {
    const options = createMainWindowOptions('/tmp/preload.js');

    expect(options.webPreferences).toMatchObject({
      preload: '/tmp/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });
});

function fakeSecretStore() {
  return {
    read: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
    storageMode: () => 'persistent' as const,
    sessionOnlyWarning: () => undefined,
  };
}

function fakeProfileStore(profiles: ServerProfile[] = []): ProfileStore {
  return { list: vi.fn().mockResolvedValue(profiles), save: vi.fn(), delete: vi.fn() };
}

function baseDeps(overrides: Partial<ComposeServicesDeps> = {}): ComposeServicesDeps {
  return {
    userDataPath: '/fake/user-data',
    profileStore: fakeProfileStore(),
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
    env: {},
    createSecretStore: () => fakeSecretStore(),
    ...overrides,
  };
}

function neverResolvingCallbackServer(): CallbackServerLike {
  return {
    start: vi.fn(() => ({ ready: Promise.resolve(), outcome: new Promise(() => {}) })),
    cancel: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  } as unknown as CallbackServerLike;
}

function fakeClient(): McpClientPort {
  return {
    connect: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    metadata: () => ({ capabilities: {} }),
    listTools: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue([]),
    listResourceTemplates: vi.fn().mockResolvedValue([]),
    listPrompts: vi.fn().mockResolvedValue([]),
    finishAuthorization: vi.fn(),
  };
}

function queuedFactory(...clients: McpClientPort[]): McpClientFactory {
  const queue = [...clients];
  return vi.fn((_profile, _authProvider) => {
    const next = queue.shift();
    if (!next) throw new Error('queuedFactory ran out of queued clients');
    return next;
  });
}

describe('composeServices', () => {
  it('constructs the secret store under a path derived from the injected userData path', () => {
    const createSecretStore = vi.fn(() => fakeSecretStore());
    composeServices(baseDeps({ userDataPath: '/fake/electron/userData', createSecretStore }));
    expect(createSecretStore).toHaveBeenCalledTimes(1);
    const [filePath] = createSecretStore.mock.calls[0] as [string];
    expect(filePath.startsWith('/fake/electron/userData')).toBe(true);
  });

  it('wires the injected shell-like openExternal as the coordinator openBrowser dependency', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const { authService } = composeServices(baseDeps({
      shell: { openExternal },
      createCallbackServer: neverResolvingCallbackServer,
    }));

    const { provider } = await authService.beginInteractiveAttempt({
      connectionId: 'c1',
      resourceUrl: 'https://mcp.example.test/mcp',
      recordStore: authService.recordStore,
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    expect(openExternal).not.toHaveBeenCalled();
    await provider.redirectToAuthorization(new URL('https://issuer.example.test/authorize?state=abc'));
    expect(openExternal).toHaveBeenCalledWith('https://issuer.example.test/authorize?state=abc');
  });

  it.each<[string, string | undefined, string | undefined]>([
    ['a valid https URL', 'https://forks.example.test/client-id.json', 'https://forks.example.test/client-id.json'],
    ['unset', undefined, undefined],
    ['an empty string', '', undefined],
    ['an http URL', 'http://forks.example.test/client-id.json', undefined],
    ['a malformed URL', 'not a url', undefined],
  ])('MCPDEVBENCH_CLIENT_METADATA_URL %s resolves to %s without throwing', (_label, value, expected) => {
    let authService: ReturnType<typeof composeServices>['authService'] | undefined;
    expect(() => {
      authService = composeServices(baseDeps({ env: { MCPDEVBENCH_CLIENT_METADATA_URL: value } })).authService;
    }).not.toThrow();
    expect(authService?.clientMetadataUrl).toBe(expected);
  });

  it('cancels an in-flight authorization before closing its MCP connection when shutting down', async () => {
    const profile: ServerProfile = {
      id: 'p1', name: 'Protected', transport: 'streamable-http', url: 'https://protected.test/mcp',
    };
    const probeClient = fakeClient();
    vi.mocked(probeClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const interactiveClient = fakeClient();
    vi.mocked(interactiveClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());

    const { connections, authService } = composeServices(baseDeps({
      profileStore: fakeProfileStore([profile]),
      createClient: queuedFactory(probeClient, interactiveClient),
      createCallbackServer: neverResolvingCallbackServer,
    }));

    const cancelAuthorization = vi.spyOn(authService, 'cancelAuthorization');

    const started = await connections.connect('p1');
    await vi.waitFor(() => expect(connections.list()[0]?.state).toBe('authorizing'));

    await connections.closeAll();

    expect(cancelAuthorization).toHaveBeenCalledWith(started.connectionId);
    const cancelOrder = cancelAuthorization.mock.invocationCallOrder[0];
    const closeOrder = vi.mocked(interactiveClient.close).mock.invocationCallOrder[0];
    expect(cancelOrder).toBeLessThan(closeOrder as number);
  });
});
