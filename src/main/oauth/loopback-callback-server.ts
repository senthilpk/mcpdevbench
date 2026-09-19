import * as http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

/** Exact loopback bind required by the hosted CIMD registration -- never configurable at runtime. */
export const LOOPBACK_CALLBACK_HOST = '127.0.0.1';
export const LOOPBACK_CALLBACK_PORT = 51782;
export const LOOPBACK_CALLBACK_PATH = '/__mcpdevbench_oauth_v1/callback';
export const LOOPBACK_REDIRECT_URI = `http://${LOOPBACK_CALLBACK_HOST}:${LOOPBACK_CALLBACK_PORT}${LOOPBACK_CALLBACK_PATH}`;

const EXPECTED_HOST_HEADER = `${LOOPBACK_CALLBACK_HOST}:${LOOPBACK_CALLBACK_PORT}`;

// Static, generic bodies only -- never interpolate anything from the request into these.
const SUCCESS_HTML =
  '<!doctype html><html><head><title>MCPDevBench</title></head><body>Authorization complete. You can close this window and return to MCPDevBench.</body></html>';
const FAILURE_HTML =
  '<!doctype html><html><head><title>MCPDevBench</title></head><body>Authorization could not be completed. You can close this window and return to MCPDevBench to try again.</body></html>';

/** The narrow request/response surface the handler needs; a real `http.IncomingMessage`/`ServerResponse` satisfies it. */
export interface CallbackRequestLike {
  method?: string | undefined;
  url?: string | undefined;
  headers: { host?: string | undefined };
}

export interface CallbackResponseLike {
  writeHead(statusCode: number, headers?: Record<string, string>): void;
  end(body?: string): void;
}

export type CallbackRequestListener = (req: CallbackRequestLike, res: CallbackResponseLike) => void;

/** The narrow `http.Server` surface used; injectable so tests never bind a real socket. */
export interface CallbackHttpServerLike {
  listen(port: number, host: string, callback: () => void): void;
  once(event: 'error', handler: (error: Error) => void): void;
  close(callback: () => void): void;
}

export type CreateCallbackHttpServer = (listener: CallbackRequestListener) => CallbackHttpServerLike;

/** Default factory backed by Node's real `http` module. */
export function createNodeHttpServer(listener: CallbackRequestListener): CallbackHttpServerLike {
  return http.createServer((req, res) => {
    listener(
      { method: req.method, url: req.url, headers: { host: req.headers.host } },
      {
        writeHead: (statusCode, headers) => {
          res.writeHead(statusCode, headers);
        },
        end: (body) => {
          res.end(body);
        },
      },
    );
  });
}

export interface LoopbackCallbackServerStartOptions {
  /** Read lazily on every request so the expected state can change (or become undefined) after `start()`. */
  getExpectedState: () => string | undefined;
  timeoutMs: number;
}

export type CallbackOutcome =
  | { ok: true; params: URLSearchParams }
  | { ok: false; reason: 'timeout' | 'cancelled' | 'oauth_error' | 'bind_error' };

export interface LoopbackCallbackServerStartResult {
  /** Resolves once the socket is bound; rejects on bind failure (e.g. the port is already in use). */
  ready: Promise<void>;
  /** Resolves exactly once with the terminal outcome: success, OAuth error, timeout, cancel, or bind error. */
  outcome: Promise<CallbackOutcome>;
}

/** The surface `OAuthCoordinator` depends on; a real or fake `LoopbackCallbackServer` satisfies it. */
export interface CallbackServerLike {
  start(options: LoopbackCallbackServerStartOptions): LoopbackCallbackServerStartResult;
  cancel(): void;
  stop(): Promise<void>;
}

/**
 * Binds exactly `127.0.0.1:51782` and accepts only `GET /__mcpdevbench_oauth_v1/callback`.
 * Knows nothing about Electron, OAuth semantics beyond `state`/`error`/`code`, or which
 * connection owns the attempt -- that correlation lives in `OAuthCoordinator`.
 */
export class LoopbackCallbackServer implements CallbackServerLike {
  private readonly createServer: CreateCallbackHttpServer;
  private server: CallbackHttpServerLike | undefined;
  private timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  private getExpectedState: (() => string | undefined) | undefined;
  private resolveOutcomeFn: ((outcome: CallbackOutcome) => void) | undefined;
  private settled = false;
  private closed = false;
  private started = false;

  constructor(createServer: CreateCallbackHttpServer = createNodeHttpServer) {
    this.createServer = createServer;
  }

  start(options: LoopbackCallbackServerStartOptions): LoopbackCallbackServerStartResult {
    if (this.started) {
      throw new Error('LoopbackCallbackServer.start must only be called once per instance');
    }
    this.started = true;
    this.getExpectedState = options.getExpectedState;

    const outcome = new Promise<CallbackOutcome>((resolve) => {
      this.resolveOutcomeFn = resolve;
    });

    const server = this.createServer((req, res) => this.handleRequest(req, res));
    this.server = server;

    const ready = new Promise<void>((resolveReady, rejectReady) => {
      server.once('error', (error) => {
        this.settle({ ok: false, reason: 'bind_error' });
        rejectReady(error);
      });
      server.listen(LOOPBACK_CALLBACK_PORT, LOOPBACK_CALLBACK_HOST, () => {
        this.timeoutHandle = setTimeout(() => {
          this.settle({ ok: false, reason: 'timeout' });
        }, options.timeoutMs);
        resolveReady();
      });
    });

    return { ready, outcome };
  }

  cancel(): void {
    this.settle({ ok: false, reason: 'cancelled' });
  }

  async stop(): Promise<void> {
    if (this.timeoutHandle !== undefined) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    if (this.server !== undefined && !this.closed) {
      this.closed = true;
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    }
  }

  private handleRequest(req: CallbackRequestLike, res: CallbackResponseLike): void {
    try {
      this.handleRequestInner(req, res);
    } catch {
      // Never let a malformed request crash the process or leak into a response.
      respond(res, 400, FAILURE_HTML);
    }
  }

  private handleRequestInner(req: CallbackRequestLike, res: CallbackResponseLike): void {
    if (req.method !== 'GET') {
      respond(res, 405, FAILURE_HTML);
      return;
    }
    if (req.headers.host !== EXPECTED_HOST_HEADER) {
      respond(res, 400, FAILURE_HTML);
      return;
    }

    const url = new URL(req.url ?? '/', `http://${EXPECTED_HOST_HEADER}`);
    if (url.pathname !== LOOPBACK_CALLBACK_PATH) {
      respond(res, 404, FAILURE_HTML);
      return;
    }

    if (this.settled) {
      respond(res, 410, FAILURE_HTML);
      return;
    }

    const expectedState = this.getExpectedState?.();
    const actualState = url.searchParams.get('state');
    if (!statesMatch(expectedState, actualState)) {
      // A forged or stale callback: reject without disturbing a still-pending, legitimate attempt.
      respond(res, 400, FAILURE_HTML);
      return;
    }

    if (url.searchParams.has('error')) {
      respond(res, 200, FAILURE_HTML);
      this.settle({ ok: false, reason: 'oauth_error' });
      return;
    }

    respond(res, 200, SUCCESS_HTML);
    this.settle({ ok: true, params: url.searchParams });
  }

  private settle(outcome: CallbackOutcome): void {
    if (this.settled) return;
    this.settled = true;
    if (this.timeoutHandle !== undefined) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = undefined;
    }
    this.resolveOutcomeFn?.(outcome);
    void this.stop();
  }
}

/** Constant-time-safe equality: rejects immediately on length mismatch instead of calling `timingSafeEqual`. */
function statesMatch(expected: string | undefined, actual: string | null): boolean {
  if (expected === undefined || actual === null) return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function respond(res: CallbackResponseLike, statusCode: number, body: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}
