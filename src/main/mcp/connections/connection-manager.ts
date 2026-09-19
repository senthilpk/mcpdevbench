import { randomUUID } from 'node:crypto';
import {
  McpAuthorizationRequiredError,
  McpCimdUnsupportedError,
  type McpClientFactory,
  type McpClientPort,
} from '@/main/mcp/client/mcp-client-port';
import { discoverCatalogs } from '@/main/mcp/discovery/discover-catalogs';
import {
  AuthorizationAttemptError,
  type AuthorizationAttemptOutcome,
  type BeginInteractiveAttemptInput,
  type BeginInteractiveAttemptResult,
} from '@/main/oauth/oauth-coordinator';
import { DEFAULT_CLIENT_METADATA_URL, McpOAuthProvider, type OAuthRecordStoreLike } from '@/main/oauth/oauth-provider';
import { revokeGrant, type RevokeGrantStore } from '@/main/oauth/revoke-grant';
import type { ProfileStore } from '@/main/profiles/profile-store';
import type {
  AuthorizationSnapshot,
  AuthorizationStorage,
  ConnectionSnapshot,
  ConnectionState,
  ServerProfile,
  SignOutResult,
} from '@/shared/domain/servers';

/**
 * The seam `ConnectionManager` depends on for OAuth orchestration. Task 5 composes the
 * real `OAuthCoordinator` + `OAuthRecordStore` + `SecretStore` behind this shape and
 * injects it; unit tests supply a fake. `ConnectionManager` never imports the concrete
 * coordinator/record-store/secret-store classes -- only this interface plus
 * `McpOAuthProvider`, which is plain application code (Task 3), not the MCP SDK.
 */
export interface AuthorizationService {
  /**
   * The record store backing every `McpOAuthProvider` this manager constructs, plus the
   * `getGrants`/`clearResource` surface `signOut`'s revocation needs. The real
   * `OAuthRecordStore` (Task 2) satisfies both.
   */
  recordStore: OAuthRecordStoreLike & RevokeGrantStore;
  /** Overrides the hosted CIMD URL; omitted uses `McpOAuthProvider`'s own default. */
  clientMetadataUrl?: string | undefined;
  /** Structurally identical to `OAuthCoordinator.beginInteractiveAttempt`. */
  beginInteractiveAttempt(input: BeginInteractiveAttemptInput): Promise<BeginInteractiveAttemptResult>;
  /** Structurally identical to `OAuthCoordinator.reopenAuthorization`. */
  reopenAuthorization(connectionId: string): Promise<void>;
  /** Structurally identical to `OAuthCoordinator.cancelAuthorization`. */
  cancelAuthorization(connectionId: string): Promise<void>;
  /** Backed by `SecretStore.storageMode()`. */
  storageMode(): AuthorizationStorage;
  /** Backed by `SecretStore.sessionOnlyWarning()`. */
  sessionOnlyWarning(): string | undefined;
}

type Session = {
  profile: ServerProfile;
  client: McpClientPort;
  snapshot: ConnectionSnapshot;
  closed: boolean;
};

type Subscriber = (snapshots: ConnectionSnapshot[]) => void;

const unsupportedCatalog = () => ({ status: 'unsupported' as const, items: [] as [] });

const AUTHORIZATION_STATES: ReadonlySet<ConnectionState> = new Set([
  'authorization-required',
  'authorizing',
  'completing-authorization',
]);

/** Sanitized, stable failure signal raised inside the OAuth connect cascade -- never a raw SDK/coordinator error. */
class AuthorizationFailureSignal extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** Raised when the in-flight interactive attempt was cancelled; the connection returns to `disconnected`, not `failed`. */
class AuthorizationCancelledSignal extends Error {}

/** Verbatim, per the design spec's section 7 copy for "Callback rejected or timed out". */
const AUTHORIZATION_NOT_COMPLETED_MESSAGE = 'Authorization was not completed; Connect can retry.';

/**
 * Placeholder assigned only for the instant between session creation and
 * `connectHttpWithAuthorization` constructing the real probe client -- that assignment
 * happens synchronously (before the first `await`) inside the same `void
 * this.runConnection(session)` call, so this placeholder is never actually used for I/O.
 * Avoids constructing (and leaking) a real, unused HTTP client up front for the OAuth path.
 */
const INERT_CLIENT: McpClientPort = {
  connect: () => Promise.reject(new Error('Connection not initialized yet')),
  close: () => Promise.resolve(),
  metadata: () => ({ capabilities: {} }),
  listTools: () => Promise.resolve([]),
  listResources: () => Promise.resolve([]),
  listResourceTemplates: () => Promise.resolve([]),
  listPrompts: () => Promise.resolve([]),
  finishAuthorization: () => Promise.reject(new Error('Connection not initialized yet')),
};

export class ConnectionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly connectionByProfile = new Map<string, string>();
  private readonly pendingByProfile = new Map<string, Promise<ConnectionSnapshot>>();
  private readonly pendingDisconnects = new Map<string, Promise<ConnectionSnapshot>>();
  private readonly disconnected = new Map<string, ConnectionSnapshot>();
  private readonly subscribers = new Set<Subscriber>();

  constructor(
    private readonly profiles: ProfileStore,
    private readonly createClient: McpClientFactory,
    private readonly authService?: AuthorizationService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  list(): ConnectionSnapshot[] {
    return [...this.sessions.values()]
      .map(({ snapshot }) => structuredClone(snapshot))
      .sort((left, right) => left.profileId.localeCompare(right.profileId));
  }

  connect(profileId: string): Promise<ConnectionSnapshot> {
    const activeId = this.connectionByProfile.get(profileId);
    const active = activeId ? this.sessions.get(activeId) : undefined;
    if (active && active.snapshot.state !== 'failed') return Promise.resolve(structuredClone(active.snapshot));

    const pending = this.pendingByProfile.get(profileId);
    if (pending) return pending;

    const operation = this.startConnection(profileId, active);
    this.pendingByProfile.set(profileId, operation);
    void operation.then(
      () => this.pendingByProfile.delete(profileId),
      () => this.pendingByProfile.delete(profileId),
    );
    return operation;
  }

  disconnect(connectionId: string): Promise<ConnectionSnapshot> {
    const completed = this.disconnected.get(connectionId);
    if (completed) return Promise.resolve(structuredClone(completed));
    const pending = this.pendingDisconnects.get(connectionId);
    if (pending) return pending;

    const operation = this.closeConnection(connectionId);
    this.pendingDisconnects.set(connectionId, operation);
    void operation.then(
      () => this.pendingDisconnects.delete(connectionId),
      () => this.pendingDisconnects.delete(connectionId),
    );
    return operation;
  }

  private async closeConnection(connectionId: string): Promise<ConnectionSnapshot> {
    const session = this.requireSession(connectionId);
    const wasAuthorizing = AUTHORIZATION_STATES.has(session.snapshot.state);
    session.closed = true;
    this.update(session, { state: 'closing', failure: undefined });
    if (wasAuthorizing) await this.authService?.cancelAuthorization(connectionId).catch(() => {});
    let failure: ConnectionSnapshot['failure'];
    try {
      await session.client.close();
    } catch {
      failure = { code: 'close_failed', message: 'The connection closed with an error' };
    } finally {
      this.connectionByProfile.delete(session.profile.id);
      this.sessions.delete(connectionId);
    }
    const snapshot: ConnectionSnapshot = { ...session.snapshot, state: 'disconnected', failure, authorization: undefined };
    this.disconnected.set(connectionId, structuredClone(snapshot));
    this.publish();
    return structuredClone(snapshot);
  }

  async disconnectProfile(profileId: string): Promise<void> {
    const connectionId = this.connectionByProfile.get(profileId);
    if (connectionId) await this.disconnect(connectionId);
  }

  async refresh(connectionId: string): Promise<ConnectionSnapshot> {
    const session = this.requireSession(connectionId);
    if (session.snapshot.state !== 'ready') throw new Error('Connection is not ready');
    this.update(session, { state: 'discovering', failure: undefined });
    const discovery = await discoverCatalogs(session.client);
    this.update(session, { ...discovery, state: 'ready' });
    return structuredClone(session.snapshot);
  }

  async reopenAuthorization(connectionId: string): Promise<ConnectionSnapshot> {
    const session = this.requireSession(connectionId);
    if (!this.authService) throw new Error('Authorization service is not configured');
    await this.authService.reopenAuthorization(connectionId);
    return structuredClone(session.snapshot);
  }

  async cancelAuthorization(connectionId: string): Promise<ConnectionSnapshot> {
    const session = this.requireSession(connectionId);
    if (!this.authService) throw new Error('Authorization service is not configured');
    await this.authService.cancelAuthorization(connectionId);
    return structuredClone(session.snapshot);
  }

  async signOut(profileId: string): Promise<SignOutResult> {
    if (!this.authService) throw new Error('Authorization service is not configured');
    await this.disconnectProfile(profileId);
    const profile = (await this.profiles.list()).find((candidate) => candidate.id === profileId);
    if (!profile || profile.transport !== 'streamable-http') {
      return { localCredentialsRemoved: true, revocation: 'unavailable' };
    }
    return revokeGrant(
      profile.url,
      this.authService.recordStore,
      this.authService.clientMetadataUrl ?? DEFAULT_CLIENT_METADATA_URL,
      { fetch: this.fetchImpl },
    );
  }

  subscribe(subscriber: Subscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.list());
    return () => this.subscribers.delete(subscriber);
  }

  async closeAll(): Promise<void> {
    const ids = [...this.sessions.keys()];
    await Promise.allSettled(ids.map((id) => this.disconnect(id)));
    this.sessions.clear();
    this.connectionByProfile.clear();
    this.pendingDisconnects.clear();
    this.disconnected.clear();
    this.publish();
  }

  private async startConnection(profileId: string, previous?: Session): Promise<ConnectionSnapshot> {
    if (previous) await this.disconnect(previous.snapshot.connectionId);
    const profile = (await this.profiles.list()).find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error('Server profile not found');

    const connectionId = randomUUID();
    const usesOAuthCascade = profile.transport === 'streamable-http' && this.authService !== undefined;
    const session: Session = {
      profile,
      client: usesOAuthCascade ? INERT_CLIENT : this.createClient(profile),
      closed: false,
      snapshot: {
        connectionId,
        profileId,
        state: 'connecting',
        tools: unsupportedCatalog(),
        resources: unsupportedCatalog(),
        resourceTemplates: unsupportedCatalog(),
        prompts: unsupportedCatalog(),
      },
    };
    this.sessions.set(connectionId, session);
    this.connectionByProfile.set(profileId, connectionId);
    this.publish();
    void this.runConnection(session);
    return structuredClone(session.snapshot);
  }

  private async runConnection(session: Session): Promise<void> {
    try {
      this.update(session, { state: 'initializing' });
      if (session.profile.transport === 'streamable-http' && this.authService) {
        await this.connectHttpWithAuthorization(session, this.authService);
      } else {
        await session.client.connect();
      }
      if (session.closed) return;
      const { capabilities: _capabilities, ...metadata } = session.client.metadata();
      this.update(session, { ...metadata, state: 'discovering' });
      const discovery = await discoverCatalogs(session.client);
      if (session.closed) return;
      this.update(session, { ...discovery, state: 'ready' });
    } catch (error) {
      if (session.closed) return;
      if (error instanceof AuthorizationCancelledSignal) {
        await this.finalizeCancelledAuthorization(session);
        return;
      }
      this.update(session, { state: 'failed', failure: this.mapConnectFailure(error) });
    }
  }

  /**
   * Drives one HTTP profile's connection through the OAuth cascade:
   *  1. A throwaway "probe" `McpOAuthProvider` (its `redirectToAuthorization` is a no-op --
   *     it exists only to let the SDK's `auth()` return "REDIRECT" normally) is attached to
   *     the first connect attempt. Reuse/refresh (the SDK's own `auth()` "AUTHORIZED" branch
   *     on a valid or refreshable stored token) and genuinely public servers both resolve
   *     here with zero interactive states and zero coordinator involvement -- this is what
   *     keeps token reuse from requiring coordinator ownership.
   *  2. Only if that attempt surfaces `McpAuthorizationRequiredError` does this method call
   *     `authService.beginInteractiveAttempt` for real, reserving the coordinator's one
   *     application-wide interactive slot, and build a second client whose provider is the
   *     one `beginInteractiveAttempt` returned -- so the SDK calls `state()` and
   *     `redirectToAuthorization()` (which the coordinator wires to the real browser-open)
   *     on the SAME provider object the coordinator's callback server validates against.
   *  3. Once the coordinator's `completion` resolves `authorized`, a brand-new client is
   *     built with the SAME provider (never reusing the transport that called `finishAuth`)
   *     and connected for the real working session.
   */
  private async connectHttpWithAuthorization(session: Session, authService: AuthorizationService): Promise<void> {
    if (session.profile.transport !== 'streamable-http') return;
    const resourceUrl = session.profile.url;
    const connectionId = session.snapshot.connectionId;

    const probeProvider = new McpOAuthProvider({
      resourceUrl,
      recordStore: authService.recordStore,
      ...(authService.clientMetadataUrl !== undefined ? { clientMetadataUrl: authService.clientMetadataUrl } : {}),
      redirectToAuthorization: async () => {},
    });

    const probeClient = this.createClient(session.profile, probeProvider);
    session.client = probeClient;

    let probeError: unknown;
    try {
      await probeClient.connect();
      return; // Reuse, refresh, or a genuinely public server: no interactive flow was ever needed.
    } catch (error) {
      probeError = error;
    }

    if (probeError instanceof McpCimdUnsupportedError) {
      throw new AuthorizationFailureSignal(
        'cimd_unsupported',
        "The authorization server cannot accept MCPDevBench's hosted client identity.",
      );
    }
    if (!(probeError instanceof McpAuthorizationRequiredError)) throw probeError;

    // Interactive authorization is genuinely required. Reserve the coordinator's one
    // application-wide slot and drive the real attempt.
    this.update(session, { state: 'authorization-required', authorization: this.authorizationSnapshot('required') });

    const clientBox: { current?: McpClientPort } = {};
    let attempt: BeginInteractiveAttemptResult;
    try {
      attempt = await authService.beginInteractiveAttempt({
        connectionId,
        resourceUrl,
        recordStore: authService.recordStore,
        ...(authService.clientMetadataUrl !== undefined ? { clientMetadataUrl: authService.clientMetadataUrl } : {}),
        finishAuth: async (params) => {
          this.update(session, { state: 'completing-authorization', authorization: this.authorizationSnapshot('completing') });
          await clientBox.current?.finishAuthorization?.(params);
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationAttemptError) throw new AuthorizationFailureSignal(...mapAttemptErrorCode(error));
      throw error;
    }
    const { provider, completion } = attempt;

    const interactiveClient = this.createClient(session.profile, provider);
    clientBox.current = interactiveClient;
    session.client = interactiveClient;

    try {
      await interactiveClient.connect();
      // Unexpected but not impossible (e.g. another process authorized this resource
      // concurrently): treat as an immediate success and release the unused reservation.
      await authService.cancelAuthorization(connectionId).catch(() => {});
      this.update(session, { authorization: this.authorizationSnapshot('authorized') });
      return;
    } catch (error) {
      if (!(error instanceof McpAuthorizationRequiredError)) {
        throw new AuthorizationFailureSignal(
          'authorization_browser_failed',
          'The system browser could not be opened for authorization.',
        );
      }
    }

    this.update(session, { state: 'authorizing', authorization: this.authorizationSnapshot('waiting') });

    const outcome = await completion;
    if (session.closed) return;
    await interactiveClient.close().catch(() => {});

    if (outcome.status === 'authorized') {
      const finalClient = this.createClient(session.profile, provider);
      session.client = finalClient;
      await finalClient.connect();
      this.update(session, { authorization: this.authorizationSnapshot('authorized') });
      return;
    }
    if (outcome.status === 'cancelled') throw new AuthorizationCancelledSignal();
    if (outcome.status === 'timeout') {
      throw new AuthorizationFailureSignal('authorization_timeout', AUTHORIZATION_NOT_COMPLETED_MESSAGE);
    }
    throw new AuthorizationFailureSignal('authorization_failed', AUTHORIZATION_NOT_COMPLETED_MESSAGE);
  }

  private authorizationSnapshot(status: AuthorizationSnapshot['status']): AuthorizationSnapshot {
    const authService = this.authService;
    const storage = authService?.storageMode() ?? 'persistent';
    const warning = status === 'authorized' ? authService?.sessionOnlyWarning() : undefined;
    return {
      status,
      storage,
      canReopenBrowser: status === 'waiting',
      canCancel: status === 'waiting',
      ...(warning !== undefined ? { warning } : {}),
    };
  }

  private async finalizeCancelledAuthorization(session: Session): Promise<void> {
    session.closed = true;
    await session.client.close().catch(() => {});
    this.connectionByProfile.delete(session.profile.id);
    this.sessions.delete(session.snapshot.connectionId);
    const snapshot: ConnectionSnapshot = { ...session.snapshot, state: 'disconnected', failure: undefined, authorization: undefined };
    session.snapshot = snapshot;
    this.disconnected.set(snapshot.connectionId, structuredClone(snapshot));
    this.publish();
  }

  private mapConnectFailure(error: unknown): ConnectionSnapshot['failure'] {
    if (error instanceof AuthorizationFailureSignal) return { code: error.code, message: error.message };
    return { code: 'connection_failed', message: 'Unable to connect to the MCP server' };
  }

  private requireSession(connectionId: string): Session {
    const session = this.sessions.get(connectionId);
    if (!session) throw new Error('Connection not found');
    return session;
  }

  private update(session: Session, changes: Partial<ConnectionSnapshot>): void {
    session.snapshot = { ...session.snapshot, ...changes };
    this.publish();
  }

  private publish(): void {
    const snapshots = this.list();
    for (const subscriber of this.subscribers) subscriber(snapshots);
  }
}

function mapAttemptErrorCode(error: AuthorizationAttemptError): [string, string] {
  switch (error.code) {
    case 'authorization_busy':
      return ['authorization_busy', 'Finish or cancel the other browser authorization.'];
    case 'callback_port_unavailable':
      return ['callback_port_unavailable', 'Another application is using port 51782.'];
    default:
      return ['authorization_failed', AUTHORIZATION_NOT_COMPLETED_MESSAGE];
  }
}
