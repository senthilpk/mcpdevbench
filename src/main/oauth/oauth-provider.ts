import { randomBytes } from 'node:crypto';
import type {
  OAuthClientInformationContext,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from '@modelcontextprotocol/client';
import type { InvalidationScope } from '@/main/oauth/oauth-record-store';
import { LOOPBACK_REDIRECT_URI } from '@/main/oauth/loopback-callback-server';

/** MCPDevBench's hosted Client ID Metadata Document. Overridable per-instance (Task 5 wires an env var). */
export const DEFAULT_CLIENT_METADATA_URL = 'https://senthilpk.github.io/mcpdevbench/oauth/client-id.json';

/**
 * The narrow surface `McpOAuthProvider` depends on; the real `OAuthRecordStore` (Task 2)
 * satisfies it, and tests can supply a fake without constructing a real record store.
 */
export interface OAuthRecordStoreLike {
  getClientInformation(resourceUrl: string, issuer?: string): Promise<StoredOAuthClientInformation | undefined>;
  getTokens(resourceUrl: string, issuer?: string): Promise<StoredOAuthTokens | undefined>;
  saveTokens(resourceUrl: string, issuer: string, value: StoredOAuthTokens): Promise<void>;
  getCodeVerifier(resourceUrl: string): Promise<string | undefined>;
  saveCodeVerifier(resourceUrl: string, value: string): Promise<void>;
  getDiscoveryState(resourceUrl: string): Promise<OAuthDiscoveryState | undefined>;
  saveDiscoveryState(resourceUrl: string, value: OAuthDiscoveryState): Promise<void>;
  invalidate(resourceUrl: string, scope: InvalidationScope): Promise<void>;
}

export interface McpOAuthProviderOptions {
  resourceUrl: string;
  recordStore: OAuthRecordStoreLike;
  /**
   * Called by `redirectToAuthorization()`. Never opens a browser itself -- this calls back
   * INTO `OAuthCoordinator`, which owns the loopback listener and the navigation dependency.
   */
  redirectToAuthorization: (authorizationUrl: URL) => Promise<void>;
  clientMetadataUrl?: string;
  /** Test-only override for `state()`'s random generator; defaults to a real CSPRNG. */
  generateState?: () => string;
}

/**
 * Implements the SDK's `OAuthClientProvider` contract for one resource URL and one
 * connection attempt. Deliberately does NOT implement `saveClientInformation`: that is
 * the SDK's own gate between "hosted CIMD client identity" and "fall back to Dynamic
 * Client Registration" (see `auth()` in `@modelcontextprotocol/client`). Implementing it
 * here would silently enable DCR, which this application does not support.
 */
export class McpOAuthProvider implements OAuthClientProvider {
  readonly clientMetadataUrl: string;

  private readonly resource: string;
  private readonly recordStore: OAuthRecordStoreLike;
  private readonly navigate: (authorizationUrl: URL) => Promise<void>;
  private readonly generateState: () => string;
  private currentState: string | undefined;

  constructor(options: McpOAuthProviderOptions) {
    this.resource = options.resourceUrl;
    this.recordStore = options.recordStore;
    this.navigate = options.redirectToAuthorization;
    this.clientMetadataUrl = options.clientMetadataUrl ?? DEFAULT_CLIENT_METADATA_URL;
    this.generateState = options.generateState ?? (() => randomBytes(32).toString('base64url'));
  }

  get redirectUrl(): string {
    return LOOPBACK_REDIRECT_URI;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [LOOPBACK_REDIRECT_URI],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      application_type: 'native',
    };
  }

  /** Generates a fresh cryptographically random state for this attempt. Called once by the SDK's `auth()`. */
  state(): string {
    this.currentState = this.generateState();
    return this.currentState;
  }

  /**
   * Not part of `OAuthClientProvider`. Lets `OAuthCoordinator` read the value the SDK's
   * `auth()` obtained from `state()` (embedded into the authorization URL by the SDK)
   * so the coordinator's callback server can validate it before `finishAuth` is ever called.
   */
  expectedState(): string | undefined {
    return this.currentState;
  }

  async clientInformation(ctx?: OAuthClientInformationContext): Promise<StoredOAuthClientInformation | undefined> {
    return this.recordStore.getClientInformation(this.resource, ctx?.issuer);
  }

  // Intentionally no `saveClientInformation` -- see the class doc comment.

  async tokens(ctx?: OAuthClientInformationContext): Promise<StoredOAuthTokens | undefined> {
    return this.recordStore.getTokens(this.resource, ctx?.issuer);
  }

  async saveTokens(tokens: StoredOAuthTokens, ctx?: OAuthClientInformationContext): Promise<void> {
    if (!ctx?.issuer) {
      throw new Error('McpOAuthProvider.saveTokens requires an authorization-server issuer context');
    }
    await this.recordStore.saveTokens(this.resource, ctx.issuer, tokens);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.navigate(authorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.recordStore.saveCodeVerifier(this.resource, codeVerifier);
  }

  async codeVerifier(): Promise<string> {
    const verifier = await this.recordStore.getCodeVerifier(this.resource);
    if (verifier === undefined) {
      throw new Error('No PKCE code verifier is saved for this authorization attempt');
    }
    return verifier;
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return this.recordStore.getDiscoveryState(this.resource);
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.recordStore.saveDiscoveryState(this.resource, state);
  }

  async invalidateCredentials(scope: InvalidationScope): Promise<void> {
    await this.recordStore.invalidate(this.resource, scope);
  }
}
