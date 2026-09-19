import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  LoopbackCallbackServer,
  LOOPBACK_CALLBACK_HOST,
  LOOPBACK_CALLBACK_PATH,
  LOOPBACK_CALLBACK_PORT,
  type CallbackHttpServerLike,
  type CallbackOutcome,
  type CallbackRequestLike,
  type CallbackRequestListener,
  type CreateCallbackHttpServer,
} from '@/main/oauth/loopback-callback-server';

const EXPECTED_HOST_HEADER = `${LOOPBACK_CALLBACK_HOST}:${LOOPBACK_CALLBACK_PORT}`;

function fakeRequest(overrides: Partial<CallbackRequestLike> = {}): CallbackRequestLike {
  return {
    method: 'GET',
    url: LOOPBACK_CALLBACK_PATH,
    headers: { host: EXPECTED_HOST_HEADER },
    ...overrides,
  };
}

function fakeResponse() {
  return {
    statusCode: undefined as number | undefined,
    headers: undefined as Record<string, string> | undefined,
    body: undefined as string | undefined,
    writeHead(statusCode: number, headers?: Record<string, string>) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body?: string) {
      this.body = body;
    },
  };
}

interface FakeServerHandle {
  server: CallbackHttpServerLike;
  listenSpy: ReturnType<typeof vi.fn>;
  closeSpy: ReturnType<typeof vi.fn>;
  emitError: (error: Error) => void;
  failToBind: boolean;
}

function createFakeServerFactory(options: { failToBind?: boolean } = {}): {
  createServer: CreateCallbackHttpServer;
  getListener: () => CallbackRequestListener;
  handle: FakeServerHandle;
} {
  const errorHandlers: Array<(error: Error) => void> = [];
  let capturedListener: CallbackRequestListener | undefined;

  const listenSpy = vi.fn((_port: number, _host: string, callback: () => void) => {
    if (!options.failToBind) callback();
  });
  const closeSpy = vi.fn((callback?: () => void) => callback?.());

  const server: CallbackHttpServerLike = {
    listen: listenSpy as unknown as CallbackHttpServerLike['listen'],
    once: (event: 'error', handler: (error: Error) => void) => {
      if (event === 'error') errorHandlers.push(handler);
    },
    close: closeSpy as unknown as CallbackHttpServerLike['close'],
  };

  const createServer: CreateCallbackHttpServer = (listener) => {
    capturedListener = listener;
    return server;
  };

  const handle: FakeServerHandle = {
    server,
    listenSpy,
    closeSpy,
    failToBind: options.failToBind ?? false,
    emitError: (error: Error) => errorHandlers.forEach((handler) => handler(error)),
  };

  return { createServer, getListener: () => capturedListener!, handle };
}

describe('LoopbackCallbackServer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('binds to the exact loopback host and port', async () => {
    const { createServer, handle } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready } = server.start({ getExpectedState: () => 'state-1', timeoutMs: 60_000 });
    await ready;
    expect(handle.listenSpy).toHaveBeenCalledWith(LOOPBACK_CALLBACK_PORT, LOOPBACK_CALLBACK_HOST, expect.any(Function));
  });

  it('rejects non-GET methods without running any authorization logic, and keeps listening', async () => {
    const { createServer, getListener } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const getExpectedState = vi.fn(() => 'expected-state');
    const { ready, outcome } = server.start({ getExpectedState, timeoutMs: 60_000 });
    await ready;

    const res = fakeResponse();
    getListener()(fakeRequest({ method: 'POST' }), res);
    expect(res.statusCode).not.toBe(200);
    expect(getExpectedState).not.toHaveBeenCalled();

    // The real callback still succeeds afterwards -- the bad request did not end the attempt.
    const res2 = fakeResponse();
    getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=abc&state=expected-state` }), res2);
    await expect(outcome).resolves.toEqual({ ok: true, params: expect.any(URLSearchParams) });
  });

  it('rejects requests not addressed to 127.0.0.1:51782 via the Host header, and keeps listening', async () => {
    const { createServer, getListener } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready, outcome } = server.start({ getExpectedState: () => 'expected-state', timeoutMs: 60_000 });
    await ready;

    const res = fakeResponse();
    getListener()(fakeRequest({ headers: { host: 'evil.example.test' } }), res);
    expect(res.statusCode).not.toBe(200);

    const res2 = fakeResponse();
    getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=abc&state=expected-state` }), res2);
    await expect(outcome).resolves.toMatchObject({ ok: true });
  });

  it('rejects unknown paths, and keeps listening', async () => {
    const { createServer, getListener } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready, outcome } = server.start({ getExpectedState: () => 'expected-state', timeoutMs: 60_000 });
    await ready;

    const res = fakeResponse();
    getListener()(fakeRequest({ url: '/not-the-callback-path?state=expected-state' }), res);
    expect(res.statusCode).not.toBe(200);

    const res2 = fakeResponse();
    getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=abc&state=expected-state` }), res2);
    await expect(outcome).resolves.toMatchObject({ ok: true });
  });

  it('rejects a stale or forged state before completion, using exact byte comparison, without ending the real attempt', async () => {
    const { createServer, getListener } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready, outcome } = server.start({ getExpectedState: () => 'expected-state-value', timeoutMs: 60_000 });
    await ready;

    // Same length as expected, but wrong bytes.
    const res = fakeResponse();
    getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=x&state=expected-state-wrongg` }), res);
    expect(res.statusCode).not.toBe(200);

    // Different length than expected -- must not throw (timingSafeEqual would throw on length mismatch).
    const res2 = fakeResponse();
    expect(() => {
      getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=x&state=short` }), res2);
    }).not.toThrow();
    expect(res2.statusCode).not.toBe(200);

    // Missing state entirely.
    const res3 = fakeResponse();
    getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=x` }), res3);
    expect(res3.statusCode).not.toBe(200);

    // The real callback still completes.
    const res4 = fakeResponse();
    getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=abc&state=expected-state-value` }), res4);
    await expect(outcome).resolves.toEqual({ ok: true, params: expect.any(URLSearchParams) });
  });

  it('treats a stale callback (no active expected state) as rejected, without crashing', async () => {
    const { createServer, getListener } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready } = server.start({ getExpectedState: () => undefined, timeoutMs: 60_000 });
    await ready;

    const res = fakeResponse();
    expect(() => {
      getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=x&state=anything` }), res);
    }).not.toThrow();
    expect(res.statusCode).not.toBe(200);
  });

  it('completes successfully on a matching callback and closes the listener', async () => {
    const { createServer, getListener, handle } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready, outcome } = server.start({ getExpectedState: () => 'expected-state', timeoutMs: 60_000 });
    await ready;

    const res = fakeResponse();
    getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=secret-code-123&state=expected-state&iss=https://issuer.example.test` }), res);

    const result = await outcome;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.get('code')).toBe('secret-code-123');
      expect(result.params.get('state')).toBe('expected-state');
    }
    expect(res.statusCode).toBe(200);
    expect(handle.closeSpy).toHaveBeenCalled();
  });

  it('treats a second callback after the first terminal one as rejected, without re-triggering completion', async () => {
    const { createServer, getListener } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready, outcome } = server.start({ getExpectedState: () => 'expected-state', timeoutMs: 60_000 });
    await ready;

    const res1 = fakeResponse();
    getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=first&state=expected-state` }), res1);
    const result = await outcome;
    expect(result.ok).toBe(true);

    const res2 = fakeResponse();
    getListener()(fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=second&state=expected-state` }), res2);
    expect(res2.statusCode).not.toBe(200);
  });

  it('turns an OAuth error callback into a sanitized failure outcome without echoing error details', async () => {
    const { createServer, getListener, handle } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready, outcome } = server.start({ getExpectedState: () => 'expected-state', timeoutMs: 60_000 });
    await ready;

    const res = fakeResponse();
    getListener()(
      fakeRequest({
        url: `${LOOPBACK_CALLBACK_PATH}?error=access_denied&error_description=user+said+no&state=expected-state`,
      }),
      res,
    );

    const result = await outcome;
    expect(result).toEqual({ ok: false, reason: 'oauth_error' });
    expect(res.body).not.toContain('access_denied');
    expect(res.body).not.toContain('user said no');
    expect(res.body).not.toContain('user+said+no');
    expect(handle.closeSpy).toHaveBeenCalled();
  });

  it('times out after the configured bound and cleans up', async () => {
    const { createServer, handle } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready, outcome } = server.start({ getExpectedState: () => 'expected-state', timeoutMs: 5_000 });
    await ready;

    await vi.advanceTimersByTimeAsync(5_000);

    await expect(outcome).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(handle.closeSpy).toHaveBeenCalled();
  });

  it('supports external cancellation and cleans up', async () => {
    const { createServer, handle } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready, outcome } = server.start({ getExpectedState: () => 'expected-state', timeoutMs: 60_000 });
    await ready;

    server.cancel();

    await expect(outcome).resolves.toEqual({ ok: false, reason: 'cancelled' });
    expect(handle.closeSpy).toHaveBeenCalled();
  });

  it('cleans up on a bind error and rejects ready', async () => {
    const { createServer, handle } = createFakeServerFactory({ failToBind: true });
    const server = new LoopbackCallbackServer(createServer);
    const { ready, outcome } = server.start({ getExpectedState: () => 'expected-state', timeoutMs: 60_000 });

    const bindError = new Error('EADDRINUSE');
    handle.emitError(bindError);

    await expect(ready).rejects.toThrow('EADDRINUSE');
    await expect(outcome).resolves.toEqual({ ok: false, reason: 'bind_error' });
    expect(handle.closeSpy).toHaveBeenCalled();
  });

  it('never includes callback query values in the success or failure response body', async () => {
    const { createServer, getListener } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready } = server.start({ getExpectedState: () => 'expected-state', timeoutMs: 60_000 });
    await ready;

    const res = fakeResponse();
    getListener()(
      fakeRequest({ url: `${LOOPBACK_CALLBACK_PATH}?code=super-secret-code&state=expected-state&iss=https://issuer.example.test` }),
      res,
    );
    expect(res.body).not.toContain('super-secret-code');
    expect(res.body).not.toContain('issuer.example.test');
    expect(res.body).not.toContain('expected-state');
  });

  it('stop() is idempotent and safe to call multiple times', async () => {
    const { createServer, handle } = createFakeServerFactory();
    const server = new LoopbackCallbackServer(createServer);
    const { ready } = server.start({ getExpectedState: () => 'expected-state', timeoutMs: 60_000 });
    await ready;

    await server.stop();
    await server.stop();
    expect(handle.closeSpy).toHaveBeenCalledTimes(1);
  });
});

// Type-only compile check that the outcome union is exhaustive where used.
function _assertOutcomeShape(outcome: CallbackOutcome): void {
  if (outcome.ok) {
    outcome.params satisfies URLSearchParams;
  } else {
    outcome.reason satisfies 'timeout' | 'cancelled' | 'oauth_error' | 'bind_error';
  }
}
void _assertOutcomeShape;
