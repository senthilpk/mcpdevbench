import type { CallbackOutcome, CallbackServerLike } from '@/main/oauth/loopback-callback-server';
import { LoopbackCallbackServer } from '@/main/oauth/loopback-callback-server';
import { McpOAuthProvider, type OAuthRecordStoreLike } from '@/main/oauth/oauth-provider';

export type AuthorizationAttemptErrorCode =
  | 'authorization_busy'
  | 'callback_port_unavailable'
  | 'no_active_authorization'
  | 'invalid_authorization_url';

/** Stable, typed error for every coordinator-level authorization failure that isn't an SDK/OAuth error. */
export class AuthorizationAttemptError extends Error {
  override readonly name = 'AuthorizationAttemptError';
  readonly code: AuthorizationAttemptErrorCode;

  constructor(code: AuthorizationAttemptErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

export type AuthorizationAttemptOutcome =
  | { status: 'authorized' }
  | { status: 'failed'; reason: 'oauth_error' | 'completion_failed' }
  | { status: 'timeout' }
  | { status: 'cancelled' };

export interface BeginInteractiveAttemptInput {
  connectionId: string;
  resourceUrl: string;
  recordStore: OAuthRecordStoreLike;
  /** Wraps the owning transport's `finishAuth(params)`. */
  finishAuth: (params: URLSearchParams) => Promise<void>;
  clientMetadataUrl?: string;
  timeoutMs?: number;
}

export interface BeginInteractiveAttemptResult {
  provider: McpOAuthProvider;
  /** Resolves once the attempt reaches a terminal state and cleanup has finished. */
  completion: Promise<AuthorizationAttemptOutcome>;
}

export interface OAuthCoordinatorOptions {
  /** Only ever called with an `https:` authorization URL -- enforced before every call. */
  openBrowser: (url: string) => Promise<void>;
  createCallbackServer?: () => CallbackServerLike;
  defaultClientMetadataUrl?: string;
  defaultTimeoutMs?: number;
}

interface ActiveAttempt {
  connectionId: string;
  provider: McpOAuthProvider;
  server: CallbackServerLike;
  authorizationUrl: string | undefined;
  finishAuth: (params: URLSearchParams) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Owns at most one interactive authorization attempt application-wide (the hosted CIMD
 * registration fixes one loopback port). Wires `McpOAuthProvider` and
 * `LoopbackCallbackServer` together: starts the listener before any browser navigation,
 * enforces `https:` on the SDK-produced authorization URL, correlates the eventual
 * callback with the owning connection, and cleans up on every terminal path.
 */
export class OAuthCoordinator {
  private readonly openBrowser: (url: string) => Promise<void>;
  private readonly createCallbackServer: () => CallbackServerLike;
  private readonly defaultClientMetadataUrl: string | undefined;
  private readonly defaultTimeoutMs: number;
  private active: ActiveAttempt | undefined;

  constructor(options: OAuthCoordinatorOptions) {
    this.openBrowser = options.openBrowser;
    this.createCallbackServer = options.createCallbackServer ?? (() => new LoopbackCallbackServer());
    this.defaultClientMetadataUrl = options.defaultClientMetadataUrl;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async beginInteractiveAttempt(input: BeginInteractiveAttemptInput): Promise<BeginInteractiveAttemptResult> {
    if (this.active !== undefined) {
      throw new AuthorizationAttemptError(
        'authorization_busy',
        'Another interactive OAuth authorization is already in progress; finish or cancel it first.',
      );
    }

    const server = this.createCallbackServer();

    // Referenced (not called) by `redirectToAuthorization` below before it's assigned --
    // safe because that closure only runs later, once `attempt` is fully built.
    let attempt: ActiveAttempt;

    const clientMetadataUrl = input.clientMetadataUrl ?? this.defaultClientMetadataUrl;
    const provider = new McpOAuthProvider({
      resourceUrl: input.resourceUrl,
      recordStore: input.recordStore,
      redirectToAuthorization: (url) => this.handleRedirect(attempt, url),
      ...(clientMetadataUrl !== undefined ? { clientMetadataUrl } : {}),
    });

    attempt = {
      connectionId: input.connectionId,
      provider,
      server,
      authorizationUrl: undefined,
      finishAuth: input.finishAuth,
    };

    // Reserve the slot synchronously, before any `await` below. Everything from the
    // busy-check above to this assignment runs in one uninterrupted synchronous stretch
    // (nothing here is awaited), so a second call issued before this call's first `await`
    // can never observe `this.active === undefined` and slip past the busy-check too.
    // `attempt` already has a real `provider`/`server` at this point (only `authorizationUrl`
    // is still unset), so `reopenAuthorization`/`cancelAuthorization` behave correctly even
    // if invoked during the brief window before the listener has finished binding.
    this.active = attempt;

    const { ready, outcome } = server.start({
      getExpectedState: () => provider.expectedState(),
      timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
    });

    try {
      await ready;
    } catch (error) {
      // Roll back the reservation -- a failed bind must not leave the coordinator
      // permanently "busy".
      if (this.active === attempt) {
        this.active = undefined;
      }
      throw new AuthorizationAttemptError(
        'callback_port_unavailable',
        'The OAuth loopback callback port is unavailable.',
        { cause: error },
      );
    }

    const completion = outcome.then((result) => this.handleOutcome(attempt, result));

    return { provider, completion };
  }

  async reopenAuthorization(connectionId: string): Promise<void> {
    const attempt = this.requireOwnedAttempt(connectionId);
    if (attempt.authorizationUrl === undefined) {
      throw new AuthorizationAttemptError(
        'invalid_authorization_url',
        'No authorization URL is available yet for this attempt.',
      );
    }
    await this.openBrowser(attempt.authorizationUrl);
  }

  async cancelAuthorization(connectionId: string): Promise<void> {
    const attempt = this.requireOwnedAttempt(connectionId);
    attempt.server.cancel();
  }

  private requireOwnedAttempt(connectionId: string): ActiveAttempt {
    if (this.active === undefined || this.active.connectionId !== connectionId) {
      throw new AuthorizationAttemptError(
        'no_active_authorization',
        'There is no active interactive authorization for this connection.',
      );
    }
    return this.active;
  }

  private async handleRedirect(attempt: ActiveAttempt, authorizationUrl: URL): Promise<void> {
    if (authorizationUrl.protocol !== 'https:') {
      throw new AuthorizationAttemptError(
        'invalid_authorization_url',
        'Refusing to open a non-https authorization URL.',
      );
    }
    // Recorded before navigating so a browser-open failure still leaves a reopenable URL.
    attempt.authorizationUrl = authorizationUrl.toString();
    await this.openBrowser(attempt.authorizationUrl);
  }

  private async handleOutcome(
    attempt: ActiveAttempt,
    result: CallbackOutcome,
  ): Promise<AuthorizationAttemptOutcome> {
    try {
      if (result.ok) {
        try {
          await attempt.finishAuth(result.params);
          return { status: 'authorized' };
        } catch {
          return { status: 'failed', reason: 'completion_failed' };
        }
      }
      if (result.reason === 'timeout') return { status: 'timeout' };
      if (result.reason === 'cancelled') return { status: 'cancelled' };
      // 'oauth_error' and the (here-unreachable, since a bind error precedes `this.active`
      // ever being set) 'bind_error' both surface as a generic failed outcome.
      return { status: 'failed', reason: 'oauth_error' };
    } finally {
      await attempt.server.stop();
      if (this.active === attempt) {
        this.active = undefined;
      }
    }
  }
}
