import { randomUUID } from 'node:crypto';
import type { McpClientFactory, McpClientPort } from '@/main/mcp/client/mcp-client-port';
import { discoverCatalogs } from '@/main/mcp/discovery/discover-catalogs';
import type { ProfileStore } from '@/main/profiles/profile-store';
import type { ConnectionSnapshot, ServerProfile } from '@/shared/domain/servers';

type Session = {
  profile: ServerProfile;
  client: McpClientPort;
  snapshot: ConnectionSnapshot;
  closed: boolean;
};

type Subscriber = (snapshots: ConnectionSnapshot[]) => void;

const unsupportedCatalog = () => ({ status: 'unsupported' as const, items: [] as [] });

export class ConnectionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly connectionByProfile = new Map<string, string>();
  private readonly pendingByProfile = new Map<string, Promise<ConnectionSnapshot>>();
  private readonly subscribers = new Set<Subscriber>();

  constructor(
    private readonly profiles: ProfileStore,
    private readonly createClient: McpClientFactory,
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
    void operation.finally(() => this.pendingByProfile.delete(profileId));
    return operation;
  }

  async disconnect(connectionId: string): Promise<ConnectionSnapshot> {
    const session = this.requireSession(connectionId);
    session.closed = true;
    this.update(session, { state: 'closing', failure: undefined });
    let failure: ConnectionSnapshot['failure'];
    try {
      await session.client.close();
    } catch {
      failure = { code: 'close_failed', message: 'The connection closed with an error' };
    } finally {
      this.connectionByProfile.delete(session.profile.id);
      this.sessions.delete(connectionId);
    }
    const snapshot: ConnectionSnapshot = { ...session.snapshot, state: 'disconnected', failure };
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
    this.publish();
  }

  private async startConnection(profileId: string, previous?: Session): Promise<ConnectionSnapshot> {
    if (previous) await this.disconnect(previous.snapshot.connectionId);
    const profile = (await this.profiles.list()).find((candidate) => candidate.id === profileId);
    if (!profile) throw new Error('Server profile not found');

    const connectionId = randomUUID();
    const session: Session = {
      profile,
      client: this.createClient(profile),
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
      await session.client.connect();
      if (session.closed) return;
      const { capabilities: _capabilities, ...metadata } = session.client.metadata();
      this.update(session, { ...metadata, state: 'discovering' });
      const discovery = await discoverCatalogs(session.client);
      if (session.closed) return;
      this.update(session, { ...discovery, state: 'ready' });
    } catch {
      if (session.closed) return;
      this.update(session, {
        state: 'failed',
        failure: { code: 'connection_failed', message: 'Unable to connect to the MCP server' },
      });
    }
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
