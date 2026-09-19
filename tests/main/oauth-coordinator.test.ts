import { describe, expect, it, vi } from 'vitest';
import type { CallbackOutcome, CallbackServerLike, LoopbackCallbackServerStartOptions } from '@/main/oauth/loopback-callback-server';
import { AuthorizationAttemptError, OAuthCoordinator } from '@/main/oauth/oauth-coordinator';
import type { OAuthRecordStoreLike } from '@/main/oauth/oauth-provider';

function fakeRecordStore(): OAuthRecordStoreLike {
  return {
    getClientInformation: vi.fn().mockResolvedValue(undefined),
    getTokens: vi.fn().mockResolvedValue(undefined),
    saveTokens: vi.fn().mockResolvedValue(undefined),
    getCodeVerifier: vi.fn().mockResolvedValue(undefined),
    saveCodeVerifier: vi.fn().mockResolvedValue(undefined),
    getDiscoveryState: vi.fn().mockResolvedValue(undefined),
    saveDiscoveryState: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn().mockResolvedValue(undefined),
  };
}

interface FakeServerInstance {
  server: CallbackServerLike;
  startOptions: LoopbackCallbackServerStartOptions | undefined;
  resolveOutcome: (outcome: CallbackOutcome) => void;
  startSpy: ReturnType<typeof vi.fn>;
  cancelSpy: ReturnType<typeof vi.fn>;
  stopSpy: ReturnType<typeof vi.fn>;
}

function createFakeServerFactory(callLog: string[]) {
  const instances: FakeServerInstance[] = [];

  const createCallbackServer = (): CallbackServerLike => {
    let resolveOutcome!: (outcome: CallbackOutcome) => void;
    const outcome = new Promise<CallbackOutcome>((resolve) => {
      resolveOutcome = resolve;
    });

    const startSpy = vi.fn((options: LoopbackCallbackServerStartOptions) => {
      callLog.push('server.start');
      instance.startOptions = options;
      return { ready: Promise.resolve(), outcome };
    });
    const cancelSpy = vi.fn(() => {
      callLog.push('server.cancel');
      resolveOutcome({ ok: false, reason: 'cancelled' });
    });
    const stopSpy = vi.fn(() => {
      callLog.push('server.stop');
      return Promise.resolve();
    });

    const server: CallbackServerLike = {
      start: startSpy as unknown as CallbackServerLike['start'],
      cancel: cancelSpy,
      stop: stopSpy,
    };

    const instance: FakeServerInstance = {
      server,
      startOptions: undefined,
      resolveOutcome,
      startSpy,
      cancelSpy,
      stopSpy,
    };
    instances.push(instance);
    return server;
  };

  return { createCallbackServer, instances };
}

function createOpenBrowser(callLog: string[], impl?: (url: string) => Promise<void>) {
  return vi.fn(async (url: string) => {
    callLog.push('openBrowser');
    if (impl) await impl(url);
  });
}

const RESOURCE_URL = 'https://mcp.example.test/mcp';

describe('OAuthCoordinator', () => {
  it('starts the callback listener before navigating to the authorization URL', async () => {
    const callLog: string[] = [];
    const { createCallbackServer } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    const { provider } = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    expect(callLog).toEqual(['server.start']);

    await provider.redirectToAuthorization(new URL('https://issuer.example.test/authorize?state=abc'));

    expect(callLog).toEqual(['server.start', 'openBrowser']);
    expect(openBrowser).toHaveBeenCalledWith('https://issuer.example.test/authorize?state=abc');
  });

  it('enforces https: on the authorization URL before ever calling the navigation dependency', async () => {
    const callLog: string[] = [];
    const { createCallbackServer } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    const { provider } = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    await expect(provider.redirectToAuthorization(new URL('http://insecure.example.test/authorize'))).rejects.toThrow();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('reopens the same attempt by re-invoking navigation without restarting the listener', async () => {
    const callLog: string[] = [];
    const { createCallbackServer, instances } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    const { provider } = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });
    await provider.redirectToAuthorization(new URL('https://issuer.example.test/authorize?state=abc'));

    await coordinator.reopenAuthorization('conn-1');

    expect(openBrowser).toHaveBeenCalledTimes(2);
    expect(openBrowser).toHaveBeenNthCalledWith(2, 'https://issuer.example.test/authorize?state=abc');
    expect(instances[0]?.startSpy).toHaveBeenCalledTimes(1);
  });

  it('refuses to reopen a different connection`s attempt', async () => {
    const callLog: string[] = [];
    const { createCallbackServer } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    await expect(coordinator.reopenAuthorization('conn-2')).rejects.toThrow(AuthorizationAttemptError);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('cancels the active attempt, cleans up, and returns to a clean idle state', async () => {
    const callLog: string[] = [];
    const { createCallbackServer, instances } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    const { completion } = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    await coordinator.cancelAuthorization('conn-1');
    await expect(completion).resolves.toEqual({ status: 'cancelled' });
    expect(instances[0]?.cancelSpy).toHaveBeenCalled();
    expect(instances[0]?.stopSpy).toHaveBeenCalled();

    // Coordinator is idle again: a new attempt can start without "authorization_busy".
    const second = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-2',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });
    expect(second.provider).toBeDefined();
  });

  it('rejects cancelling a different connection`s attempt without disturbing the active one', async () => {
    const callLog: string[] = [];
    const { createCallbackServer, instances } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    await expect(coordinator.cancelAuthorization('conn-2')).rejects.toThrow(AuthorizationAttemptError);
    expect(instances[0]?.cancelSpy).not.toHaveBeenCalled();
  });

  it('fails a second sequential interactive attempt with a stable authorization_busy error, leaving the first untouched', async () => {
    const callLog: string[] = [];
    const { createCallbackServer, instances } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    let caught: unknown;
    try {
      await coordinator.beginInteractiveAttempt({
        connectionId: 'conn-2',
        resourceUrl: RESOURCE_URL,
        recordStore: fakeRecordStore(),
        finishAuth: vi.fn().mockResolvedValue(undefined),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthorizationAttemptError);
    expect((caught as AuthorizationAttemptError).code).toBe('authorization_busy');
    expect(instances).toHaveLength(1);
    expect(instances[0]?.stopSpy).not.toHaveBeenCalled();
    expect(instances[0]?.cancelSpy).not.toHaveBeenCalled();
  });

  it('reserves the attempt slot synchronously, so a second call issued before the first is awaited also fails busy (true concurrency, not just sequential reuse)', async () => {
    const callLog: string[] = [];
    const { createCallbackServer, instances } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    // Deliberately NOT awaited before the second call: both promises are created back to
    // back, so if the busy-check-then-reserve weren't atomic, both calls could pass the
    // check before either finishes binding.
    const firstPromise = coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });
    const secondPromise = coordinator.beginInteractiveAttempt({
      connectionId: 'conn-2',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    const first = await firstPromise;
    let secondError: unknown;
    try {
      await secondPromise;
    } catch (error) {
      secondError = error;
    }

    expect(first.provider).toBeDefined();
    expect(secondError).toBeInstanceOf(AuthorizationAttemptError);
    expect((secondError as AuthorizationAttemptError).code).toBe('authorization_busy');
    // Only one callback server was ever created -- the second call never got as far as
    // constructing its own server/provider.
    expect(instances).toHaveLength(1);
  });

  it('rolls back the busy reservation when the bind fails, so a subsequent attempt is not stuck busy', async () => {
    const callLog: string[] = [];
    let callCount = 0;
    const createCallbackServer = (): CallbackServerLike => {
      callCount += 1;
      const shouldFail = callCount === 1;
      return {
        start: () =>
          shouldFail
            ? { ready: Promise.reject(new Error('EADDRINUSE')), outcome: Promise.resolve({ ok: false, reason: 'bind_error' }) }
            : { ready: Promise.resolve(), outcome: new Promise<CallbackOutcome>(() => {}) },
        cancel: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    };
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    await expect(
      coordinator.beginInteractiveAttempt({
        connectionId: 'conn-1',
        resourceUrl: RESOURCE_URL,
        recordStore: fakeRecordStore(),
        finishAuth: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toMatchObject({ code: 'callback_port_unavailable' });

    // Not stuck "busy": a fresh attempt right after a failed bind must not throw authorization_busy.
    const retry = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-2',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });
    expect(retry.provider).toBeDefined();
  });

  it('reopenAuthorization rejects when no authorization URL has been produced yet', async () => {
    const callLog: string[] = [];
    const { createCallbackServer } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    await expect(coordinator.reopenAuthorization('conn-1')).rejects.toBeInstanceOf(AuthorizationAttemptError);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('cancelAuthorization is safe to call twice for the same attempt', async () => {
    const callLog: string[] = [];
    const { createCallbackServer, instances } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    const { completion } = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    await coordinator.cancelAuthorization('conn-1');
    await completion;

    // The attempt is gone after cancellation completes; a second cancel for the same
    // (now stale) connection id must fail cleanly rather than resurrecting/corrupting state.
    await expect(coordinator.cancelAuthorization('conn-1')).rejects.toBeInstanceOf(AuthorizationAttemptError);
    expect(instances[0]?.cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('calls finishAuth with the callback params on a successful outcome, then cleans up', async () => {
    const callLog: string[] = [];
    const { createCallbackServer, instances } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });
    const finishAuth = vi.fn().mockResolvedValue(undefined);

    const { completion } = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth,
    });

    const params = new URLSearchParams('code=abc&state=xyz');
    instances[0]?.resolveOutcome({ ok: true, params });

    await expect(completion).resolves.toEqual({ status: 'authorized' });
    expect(finishAuth).toHaveBeenCalledWith(params);
    expect(instances[0]?.stopSpy).toHaveBeenCalled();
  });

  it('leaves the listener available after a browser-open failure, so retry and cancel remain possible', async () => {
    const callLog: string[] = [];
    const { createCallbackServer, instances } = createFakeServerFactory(callLog);
    let shouldFail = true;
    const openBrowser = createOpenBrowser(callLog, async () => {
      if (shouldFail) throw new Error('shell.openExternal failed');
    });
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    const { provider } = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    await expect(
      provider.redirectToAuthorization(new URL('https://issuer.example.test/authorize?state=abc')),
    ).rejects.toThrow('shell.openExternal failed');

    // Listener was not torn down by the browser-open failure.
    expect(instances[0]?.stopSpy).not.toHaveBeenCalled();

    // Retry via reopen succeeds once the navigation dependency recovers.
    shouldFail = false;
    await coordinator.reopenAuthorization('conn-1');
    expect(openBrowser).toHaveBeenCalledTimes(2);

    // Cancel still works afterwards.
    await coordinator.cancelAuthorization('conn-1');
    expect(instances[0]?.cancelSpy).toHaveBeenCalled();
  });

  it('cleans up after the completion (finishAuth) step fails', async () => {
    const callLog: string[] = [];
    const { createCallbackServer, instances } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });
    const finishAuth = vi.fn().mockRejectedValue(new Error('token exchange failed'));

    const { completion } = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth,
    });

    const params = new URLSearchParams('code=abc&state=xyz');
    instances[0]?.resolveOutcome({ ok: true, params });

    await expect(completion).resolves.toEqual({ status: 'failed', reason: 'completion_failed' });
    expect(instances[0]?.stopSpy).toHaveBeenCalled();

    const second = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-2',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });
    expect(second.provider).toBeDefined();
  });

  it('maps a callback timeout outcome to a stable coordinator result and cleans up', async () => {
    const callLog: string[] = [];
    const { createCallbackServer, instances } = createFakeServerFactory(callLog);
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    const { completion } = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-1',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });

    instances[0]?.resolveOutcome({ ok: false, reason: 'timeout' });

    await expect(completion).resolves.toEqual({ status: 'timeout' });
    expect(instances[0]?.stopSpy).toHaveBeenCalled();
  });

  it('maps a bind-error on start() to a stable callback_port_unavailable error', async () => {
    const callLog: string[] = [];
    let callCount = 0;
    const createCallbackServer = (): CallbackServerLike => {
      callCount += 1;
      const shouldFail = callCount === 1;
      return {
        start: () =>
          shouldFail
            ? { ready: Promise.reject(new Error('EADDRINUSE')), outcome: Promise.resolve({ ok: false, reason: 'bind_error' }) }
            : { ready: Promise.resolve(), outcome: new Promise<CallbackOutcome>(() => {}) },
        cancel: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
      };
    };
    const openBrowser = createOpenBrowser(callLog);
    const coordinator = new OAuthCoordinator({ openBrowser, createCallbackServer });

    let caught: unknown;
    try {
      await coordinator.beginInteractiveAttempt({
        connectionId: 'conn-1',
        resourceUrl: RESOURCE_URL,
        recordStore: fakeRecordStore(),
        finishAuth: vi.fn().mockResolvedValue(undefined),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthorizationAttemptError);
    expect((caught as AuthorizationAttemptError).code).toBe('callback_port_unavailable');

    // Bind failure must not leave the coordinator stuck "busy".
    const retry = await coordinator.beginInteractiveAttempt({
      connectionId: 'conn-2',
      resourceUrl: RESOURCE_URL,
      recordStore: fakeRecordStore(),
      finishAuth: vi.fn().mockResolvedValue(undefined),
    });
    expect(retry.provider).toBeDefined();
  });
});
