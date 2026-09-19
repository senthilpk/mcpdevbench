import { describe, expect, it, vi } from 'vitest';
import { ConnectionManager, type AuthorizationService } from '@/main/mcp/connections/connection-manager';
import { McpAuthorizationRequiredError, McpCimdUnsupportedError, type McpClientFactory, type McpClientPort } from '@/main/mcp/client/mcp-client-port';
import { AuthorizationAttemptError, type AuthorizationAttemptOutcome } from '@/main/oauth/oauth-coordinator';
import type { ProfileStore } from '@/main/profiles/profile-store';
import type { ServerProfile } from '@/shared/domain/servers';

const profiles: ServerProfile[] = [
  { id: 'p1', name: 'One', transport: 'stdio', command: 'node', args: [] },
  { id: 'p2', name: 'Two', transport: 'streamable-http', url: 'https://example.test/mcp' },
];

const oauthProfiles: ServerProfile[] = [
  ...profiles,
  { id: 'p3', name: 'Protected', transport: 'streamable-http', url: 'https://protected.test/mcp' },
];

function createStore(list: ServerProfile[] = profiles): ProfileStore {
  return { list: vi.fn().mockResolvedValue(list), save: vi.fn(), delete: vi.fn() };
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
    finishAuthorization: vi.fn(),
  };
  return client;
}

function queuedFactory(...clients: McpClientPort[]): McpClientFactory {
  const queue = [...clients];
  return vi.fn((_profile, _authProvider) => {
    const next = queue.shift();
    if (!next) throw new Error('queuedFactory ran out of queued clients');
    return next;
  });
}

function createAuthService(overrides: Partial<AuthorizationService> = {}): AuthorizationService {
  return {
    recordStore: { getGrants: vi.fn().mockResolvedValue([]), clearResource: vi.fn() } as never,
    beginInteractiveAttempt: vi.fn().mockRejectedValue(new Error('beginInteractiveAttempt should not have been called')),
    reopenAuthorization: vi.fn().mockResolvedValue(undefined),
    cancelAuthorization: vi.fn().mockResolvedValue(undefined),
    storageMode: () => 'persistent',
    sessionOnlyWarning: () => undefined,
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
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

describe('ConnectionManager OAuth', () => {
  it('reuses stored credentials without ever entering an interactive authorization state', async () => {
    const client = createClient();
    const factory = queuedFactory(client);
    const authService = createAuthService();
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    const states: string[] = [];
    manager.subscribe((snapshots) => {
      const state = snapshots.find((snapshot) => snapshot.profileId === 'p3')?.state;
      if (state && state !== states[states.length - 1]) states.push(state);
    });

    await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('ready'));

    expect(states).toEqual(['connecting', 'initializing', 'discovering', 'ready']);
    expect(authService.beginInteractiveAttempt).not.toHaveBeenCalled();
    expect(manager.list()[0]?.authorization).toBeUndefined();
  });

  it('leaves STDIO and public HTTP connections unaffected even when an authorization service is configured', async () => {
    const stdioClient = createClient();
    const httpClient = createClient();
    const factory: McpClientFactory = vi.fn((profile) => (profile.id === 'p1' ? stdioClient : httpClient));
    const authService = createAuthService();
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    const stdioStates: string[] = [];
    const httpStates: string[] = [];
    manager.subscribe((snapshots) => {
      const stdioState = snapshots.find((snapshot) => snapshot.profileId === 'p1')?.state;
      if (stdioState && stdioState !== stdioStates[stdioStates.length - 1]) stdioStates.push(stdioState);
      const httpState = snapshots.find((snapshot) => snapshot.profileId === 'p2')?.state;
      if (httpState && httpState !== httpStates[httpStates.length - 1]) httpStates.push(httpState);
    });

    await manager.connect('p1');
    await manager.connect('p2');
    await vi.waitFor(() => {
      expect(manager.list().find((snapshot) => snapshot.profileId === 'p1')?.state).toBe('ready');
      expect(manager.list().find((snapshot) => snapshot.profileId === 'p2')?.state).toBe('ready');
    });

    expect(stdioStates).toEqual(['connecting', 'initializing', 'discovering', 'ready']);
    expect(httpStates).toEqual(['connecting', 'initializing', 'discovering', 'ready']);
    // STDIO must never receive a provider, regardless of an authorization service being configured.
    const stdioCall = vi.mocked(factory).mock.calls.find((call) => call[0].id === 'p1');
    expect(stdioCall?.[1]).toBeUndefined();
    expect(authService.beginInteractiveAttempt).not.toHaveBeenCalled();
  });

  it('completes the full interactive lifecycle and connects a fresh adapter that preserves the provider', async () => {
    const probeClient = createClient();
    vi.mocked(probeClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const interactiveClient = createClient();
    vi.mocked(interactiveClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const finalClient = createClient();
    const factory = queuedFactory(probeClient, interactiveClient, finalClient);

    const fakeProvider = { marker: 'fake-provider' } as never;
    const completionDeferred = deferred<AuthorizationAttemptOutcome>();
    let capturedFinishAuth: ((params: URLSearchParams) => Promise<void>) | undefined;
    const beginInteractiveAttempt = vi.fn(async (input: Parameters<AuthorizationService['beginInteractiveAttempt']>[0]) => {
      capturedFinishAuth = input.finishAuth;
      return { provider: fakeProvider, completion: completionDeferred.promise };
    });
    const authService = createAuthService({ beginInteractiveAttempt });
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    const states: string[] = [];
    manager.subscribe((snapshots) => {
      const state = snapshots.find((snapshot) => snapshot.profileId === 'p3')?.state;
      if (state && state !== states[states.length - 1]) states.push(state);
    });

    const started = await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('authorizing'));

    expect(beginInteractiveAttempt).toHaveBeenCalledTimes(1);
    expect(beginInteractiveAttempt.mock.calls[0]?.[0]).toMatchObject({
      connectionId: started.connectionId,
      resourceUrl: 'https://protected.test/mcp',
    });
    expect(manager.list()[0]?.authorization).toMatchObject({ status: 'waiting', canReopenBrowser: true, canCancel: true });

    const params = new URLSearchParams({ code: 'abc', state: 'xyz' });
    await capturedFinishAuth!(params);
    expect(interactiveClient.finishAuthorization).toHaveBeenCalledWith(params);
    expect(manager.list()[0]?.state).toBe('completing-authorization');

    completionDeferred.resolve({ status: 'authorized' });
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('ready'));

    expect(states).toEqual([
      'connecting',
      'initializing',
      'authorization-required',
      'authorizing',
      'completing-authorization',
      'discovering',
      'ready',
    ]);

    expect(factory).toHaveBeenCalledTimes(3);
    expect(vi.mocked(factory).mock.calls[1]?.[1]).toBe(fakeProvider);
    expect(vi.mocked(factory).mock.calls[2]?.[1]).toBe(fakeProvider);
    expect(interactiveClient.close).toHaveBeenCalled();

    expect(manager.list()[0]?.authorization).toMatchObject({
      status: 'authorized', storage: 'persistent', canReopenBrowser: false, canCancel: false,
    });
  });

  it('maps a busy coordinator to the sanitized authorization_busy failure', async () => {
    const probeClient = createClient();
    vi.mocked(probeClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const factory = queuedFactory(probeClient);
    const authService = createAuthService({
      beginInteractiveAttempt: vi.fn().mockRejectedValue(
        new AuthorizationAttemptError('authorization_busy', 'Another interactive OAuth authorization is already in progress.'),
      ),
    });
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('failed'));
    expect(manager.list()[0]?.failure).toEqual({
      code: 'authorization_busy',
      message: 'Finish or cancel the other browser authorization.',
    });
  });

  it('maps an occupied callback port to the sanitized callback_port_unavailable failure', async () => {
    const probeClient = createClient();
    vi.mocked(probeClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const factory = queuedFactory(probeClient);
    const authService = createAuthService({
      beginInteractiveAttempt: vi.fn().mockRejectedValue(
        new AuthorizationAttemptError('callback_port_unavailable', 'The OAuth loopback callback port is unavailable.'),
      ),
    });
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('failed'));
    expect(manager.list()[0]?.failure).toEqual({
      code: 'callback_port_unavailable',
      message: 'Another application is using port 51782.',
    });
  });

  it('maps a CIMD-unsupported authorization server to the sanitized cimd_unsupported failure without ever contacting the coordinator', async () => {
    const probeClient = createClient();
    vi.mocked(probeClient.connect).mockRejectedValue(new McpCimdUnsupportedError());
    const factory = queuedFactory(probeClient);
    const authService = createAuthService();
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('failed'));
    expect(manager.list()[0]?.failure?.code).toBe('cimd_unsupported');
    expect(authService.beginInteractiveAttempt).not.toHaveBeenCalled();
  });

  it('maps a timed-out interactive attempt to a retryable authorization_timeout failure', async () => {
    const probeClient = createClient();
    vi.mocked(probeClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const interactiveClient = createClient();
    vi.mocked(interactiveClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const factory = queuedFactory(probeClient, interactiveClient);
    const authService = createAuthService({
      beginInteractiveAttempt: vi.fn().mockResolvedValue({
        provider: {} as never,
        completion: Promise.resolve<AuthorizationAttemptOutcome>({ status: 'timeout' }),
      }),
    });
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('failed'));
    expect(manager.list()[0]?.failure).toEqual({
      code: 'authorization_timeout',
      message: 'Authorization was not completed; Connect can retry.',
    });
  });

  it('maps an unexpected failure opening the interactive attempt to authorization_browser_failed', async () => {
    const probeClient = createClient();
    vi.mocked(probeClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const interactiveClient = createClient();
    vi.mocked(interactiveClient.connect).mockRejectedValue(new Error('spawn failed: could not open system browser'));
    const factory = queuedFactory(probeClient, interactiveClient);
    const authService = createAuthService({
      beginInteractiveAttempt: vi.fn().mockResolvedValue({ provider: {} as never, completion: new Promise(() => {}) }),
    });
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('failed'));
    expect(manager.list()[0]?.failure?.code).toBe('authorization_browser_failed');
    expect(manager.list()[0]?.failure?.message).not.toContain('spawn failed');
  });

  it('cancelAuthorization delegates to the coordinator and settles the owning connection as disconnected', async () => {
    const probeClient = createClient();
    vi.mocked(probeClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const interactiveClient = createClient();
    vi.mocked(interactiveClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const factory = queuedFactory(probeClient, interactiveClient);
    const completionDeferred = deferred<AuthorizationAttemptOutcome>();
    const authService = createAuthService({
      beginInteractiveAttempt: vi.fn().mockResolvedValue({ provider: {} as never, completion: completionDeferred.promise }),
      cancelAuthorization: vi.fn(async () => {
        completionDeferred.resolve({ status: 'cancelled' });
      }),
    });
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    const started = await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('authorizing'));

    await manager.cancelAuthorization(started.connectionId);
    expect(authService.cancelAuthorization).toHaveBeenCalledWith(started.connectionId);
    await vi.waitFor(() => expect(manager.list()).toEqual([]));

    const disconnected = await manager.disconnect(started.connectionId);
    expect(disconnected.state).toBe('disconnected');
    expect(disconnected.failure).toBeUndefined();
  });

  it('reopenAuthorization delegates to the coordinator, which enforces per-connection ownership', async () => {
    const probeClient = createClient();
    vi.mocked(probeClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const interactiveClient = createClient();
    vi.mocked(interactiveClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const factory = queuedFactory(probeClient, interactiveClient);
    const reopenAuthorization = vi.fn().mockResolvedValue(undefined);
    const authService = createAuthService({
      beginInteractiveAttempt: vi.fn().mockResolvedValue({ provider: {} as never, completion: new Promise(() => {}) }),
      reopenAuthorization,
    });
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    const started = await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('authorizing'));

    await manager.reopenAuthorization(started.connectionId);
    expect(reopenAuthorization).toHaveBeenCalledWith(started.connectionId);

    reopenAuthorization.mockRejectedValueOnce(new AuthorizationAttemptError('no_active_authorization', 'not the owner'));
    await expect(manager.reopenAuthorization(started.connectionId)).rejects.toThrow('not the owner');
  });

  it('disconnecting mid-authorization cancels the callback listener via the coordinator', async () => {
    const probeClient = createClient();
    vi.mocked(probeClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const interactiveClient = createClient();
    vi.mocked(interactiveClient.connect).mockRejectedValue(new McpAuthorizationRequiredError());
    const factory = queuedFactory(probeClient, interactiveClient);
    const authService = createAuthService({
      beginInteractiveAttempt: vi.fn().mockResolvedValue({ provider: {} as never, completion: new Promise(() => {}) }),
    });
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService);

    const started = await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('authorizing'));

    const disconnected = await manager.disconnect(started.connectionId);
    expect(disconnected.state).toBe('disconnected');
    expect(authService.cancelAuthorization).toHaveBeenCalledWith(started.connectionId);
    expect(interactiveClient.close).toHaveBeenCalled();
  });

  it('signOut disconnects any active session before revoking, and always clears local credentials even when revocation fails', async () => {
    const client = createClient();
    const factory = queuedFactory(client);
    const order: string[] = [];
    vi.mocked(client.close).mockImplementation(async () => { order.push('disconnect'); });
    const recordStore = {
      getGrants: vi.fn().mockImplementation(async () => {
        order.push('getGrants');
        return [{
          issuer: 'https://issuer.test',
          tokens: { access_token: 'at' },
          authorizationServerMetadata: { revocation_endpoint: 'https://issuer.test/revoke' },
        }];
      }),
      clearResource: vi.fn().mockImplementation(async () => { order.push('clear'); }),
    };
    const fetchImpl = vi.fn().mockImplementation(async () => {
      order.push('revoke-network');
      return { ok: false } as Response;
    });
    const authService = createAuthService({ recordStore: recordStore as never });
    const manager = new ConnectionManager(createStore(oauthProfiles), factory, authService, fetchImpl as never);

    await manager.connect('p3');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('ready'));

    const result = await manager.signOut('p3');

    expect(order).toEqual(['disconnect', 'getGrants', 'revoke-network', 'clear']);
    expect(result.localCredentialsRemoved).toBe(true);
    expect(result.revocation).toBe('failed');
    expect(result.warning).toBeDefined();
  });
});
