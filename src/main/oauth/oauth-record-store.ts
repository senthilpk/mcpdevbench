import { z } from 'zod';
import type {
  AuthorizationServerMetadata,
  OAuthDiscoveryState,
  StoredOAuthClientInformation,
  StoredOAuthTokens,
} from '@modelcontextprotocol/client';
import { OAuthStorageError, type SecretStoreLike } from '@/main/oauth/secret-store';

export type InvalidationScope = 'all' | 'client' | 'tokens' | 'verifier' | 'discovery';

/** One authorization-server-bound grant under a resource, as needed by revocation (Task 4). */
export interface OAuthGrantRecord {
  issuer: string;
  clientInformation?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  authorizationServerMetadata?: AuthorizationServerMetadata;
}

interface IssuerRecord {
  issuer: string;
  clientInformation?: StoredOAuthClientInformation;
  tokens?: StoredOAuthTokens;
  authorizationServerMetadata?: AuthorizationServerMetadata;
}

interface ResourceRecord {
  activeIssuer?: string;
  codeVerifier?: string;
  discoveryState?: OAuthDiscoveryState;
  issuers: Record<string, IssuerRecord>;
}

interface OAuthDocument {
  version: 1;
  resources: Record<string, ResourceRecord>;
}

const issuerRecordSchema = z.object({
  issuer: z.string(),
  clientInformation: z.unknown().optional(),
  tokens: z.unknown().optional(),
  authorizationServerMetadata: z.unknown().optional(),
}).strict();

const resourceRecordSchema = z.object({
  activeIssuer: z.string().optional(),
  codeVerifier: z.string().optional(),
  discoveryState: z.unknown().optional(),
  issuers: z.record(z.string(), issuerRecordSchema),
}).strict();

const oauthDocumentSchema = z.object({
  version: z.literal(1),
  resources: z.record(z.string(), resourceRecordSchema),
}).strict();

/**
 * Issuer-bound OAuth persistence on top of an injected {@link SecretStoreLike}.
 * Knows nothing about Electron or the filesystem -- all encryption/persistence
 * is delegated to the secret store.
 */
export class OAuthRecordStore {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly secretStore: SecretStoreLike) {}

  async getClientInformation(resourceUrl: string, issuer?: string): Promise<StoredOAuthClientInformation | undefined> {
    const document = await this.loadDocument();
    return this.resolveIssuerRecord(document, resourceUrl, issuer)?.clientInformation;
  }

  async saveClientInformation(
    resourceUrl: string,
    issuer: string,
    value: StoredOAuthClientInformation,
  ): Promise<void> {
    await this.mutate((document) => {
      const resource = getOrCreateResource(document, canonicalize(resourceUrl));
      const issuerKey = canonicalize(issuer);
      getOrCreateIssuer(resource, issuerKey).clientInformation = value;
      resource.activeIssuer = issuerKey;
    });
  }

  async getTokens(resourceUrl: string, issuer?: string): Promise<StoredOAuthTokens | undefined> {
    const document = await this.loadDocument();
    return this.resolveIssuerRecord(document, resourceUrl, issuer)?.tokens;
  }

  async saveTokens(resourceUrl: string, issuer: string, value: StoredOAuthTokens): Promise<void> {
    await this.mutate((document) => {
      const resource = getOrCreateResource(document, canonicalize(resourceUrl));
      const issuerKey = canonicalize(issuer);
      getOrCreateIssuer(resource, issuerKey).tokens = value;
      resource.activeIssuer = issuerKey;
    });
  }

  async getCodeVerifier(resourceUrl: string): Promise<string | undefined> {
    const document = await this.loadDocument();
    return document.resources[canonicalize(resourceUrl)]?.codeVerifier;
  }

  async saveCodeVerifier(resourceUrl: string, value: string): Promise<void> {
    await this.mutate((document) => {
      getOrCreateResource(document, canonicalize(resourceUrl)).codeVerifier = value;
    });
  }

  async getDiscoveryState(resourceUrl: string): Promise<OAuthDiscoveryState | undefined> {
    const document = await this.loadDocument();
    return document.resources[canonicalize(resourceUrl)]?.discoveryState;
  }

  async saveDiscoveryState(resourceUrl: string, value: OAuthDiscoveryState): Promise<void> {
    await this.mutate((document) => {
      const resource = getOrCreateResource(document, canonicalize(resourceUrl));
      resource.discoveryState = value;
      // Mirror the authorization-server metadata onto its issuer-bound grant so
      // revocation (Task 4) can find a revocation endpoint per issuer, without
      // ever attributing it to a different issuer's grant.
      if (value.authorizationServerMetadata !== undefined) {
        const issuerKey = canonicalize(value.authorizationServerUrl);
        getOrCreateIssuer(resource, issuerKey).authorizationServerMetadata = value.authorizationServerMetadata;
      }
    });
  }

  async invalidate(resourceUrl: string, scope: InvalidationScope): Promise<void> {
    await this.mutate((document) => {
      const resource = document.resources[canonicalize(resourceUrl)];
      if (!resource) return;

      if (scope === 'verifier' || scope === 'all') delete resource.codeVerifier;
      if (scope === 'discovery' || scope === 'all') delete resource.discoveryState;

      const issuerRecord = resource.activeIssuer !== undefined ? resource.issuers[resource.activeIssuer] : undefined;
      if (!issuerRecord) return;

      if (scope === 'client' || scope === 'all') delete issuerRecord.clientInformation;
      if (scope === 'tokens' || scope === 'all') delete issuerRecord.tokens;
    });
  }

  async getGrants(resourceUrl: string): Promise<OAuthGrantRecord[]> {
    const document = await this.loadDocument();
    const resource = document.resources[canonicalize(resourceUrl)];
    if (!resource) return [];
    return Object.values(resource.issuers).map((issuerRecord) => ({ ...issuerRecord }));
  }

  async clearResource(resourceUrl: string): Promise<void> {
    await this.mutate((document) => {
      delete document.resources[canonicalize(resourceUrl)];
    });
  }

  private resolveIssuerRecord(
    document: OAuthDocument,
    resourceUrl: string,
    issuer: string | undefined,
  ): IssuerRecord | undefined {
    const resource = document.resources[canonicalize(resourceUrl)];
    if (!resource) return undefined;
    const issuerKey = issuer !== undefined ? canonicalize(issuer) : resource.activeIssuer;
    if (issuerKey === undefined) return undefined;
    return resource.issuers[issuerKey];
  }

  private async loadDocument(): Promise<OAuthDocument> {
    const raw = await this.secretStore.read();
    if (raw === undefined) return { version: 1, resources: {} };

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new OAuthStorageError('OAuth record store contains a corrupt document', { cause: error });
    }

    const result = oauthDocumentSchema.safeParse(parsedJson);
    if (!result.success) {
      throw new OAuthStorageError('OAuth record store contains a corrupt document', { cause: result.error });
    }
    return result.data as OAuthDocument;
  }

  private async mutate(mutator: (document: OAuthDocument) => void): Promise<void> {
    await this.enqueue(async () => {
      const document = await this.loadDocument();
      mutator(document);
      await this.secretStore.write(JSON.stringify(document));
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function canonicalize(url: string): string {
  return new URL(url).toString();
}

function getOrCreateResource(document: OAuthDocument, resourceKey: string): ResourceRecord {
  const existing = document.resources[resourceKey];
  if (existing) return existing;
  const created: ResourceRecord = { issuers: {} };
  document.resources[resourceKey] = created;
  return created;
}

function getOrCreateIssuer(resource: ResourceRecord, issuerKey: string): IssuerRecord {
  const existing = resource.issuers[issuerKey];
  if (existing) return existing;
  const created: IssuerRecord = { issuer: issuerKey };
  resource.issuers[issuerKey] = created;
  return created;
}
