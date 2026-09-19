import { describe, expect, it } from 'vitest';
import type { StoredOAuthClientInformation, StoredOAuthTokens, OAuthDiscoveryState } from '@modelcontextprotocol/client';
import { OAuthRecordStore } from '@/main/oauth/oauth-record-store';
import { OAuthStorageError, type SecretStoreLike } from '@/main/oauth/secret-store';

function fakeSecretStore(): SecretStoreLike & { value: string | undefined } {
  return {
    value: undefined,
    async read() {
      return this.value;
    },
    async write(value: string) {
      this.value = value;
    },
  };
}

function clientInfo(clientId: string): StoredOAuthClientInformation {
  return { client_id: clientId, redirect_uris: ['http://127.0.0.1:51782/callback'] };
}

function tokens(accessToken: string): StoredOAuthTokens {
  return { access_token: accessToken, token_type: 'Bearer', refresh_token: `${accessToken}-refresh` };
}

function discoveryState(authorizationServerUrl: string, revocationEndpoint?: string): OAuthDiscoveryState {
  return {
    authorizationServerUrl,
    ...(revocationEndpoint !== undefined
      ? {
          authorizationServerMetadata: {
            issuer: authorizationServerUrl,
            authorization_endpoint: `${authorizationServerUrl}authorize`,
            token_endpoint: `${authorizationServerUrl}token`,
            response_types_supported: ['code'],
            revocation_endpoint: revocationEndpoint,
          },
        }
      : {}),
  };
}

const RESOURCE = 'https://mcp.example.test/mcp';
const ISSUER_A = 'https://issuer-a.example.test';
const ISSUER_B = 'https://issuer-b.example.test';

describe('OAuthRecordStore', () => {
  it('keeps records for different resources independent', async () => {
    const store = new OAuthRecordStore(fakeSecretStore());
    await store.saveTokens('https://one.example.test/mcp', ISSUER_A, tokens('one'));
    await store.saveTokens('https://two.example.test/mcp', ISSUER_A, tokens('two'));

    expect((await store.getTokens('https://one.example.test/mcp'))?.access_token).toBe('one');
    expect((await store.getTokens('https://two.example.test/mcp'))?.access_token).toBe('two');
  });

  it('never merges two issuers under the same resource', async () => {
    const store = new OAuthRecordStore(fakeSecretStore());
    await store.saveClientInformation(RESOURCE, ISSUER_A, clientInfo('client-a'));
    await store.saveTokens(RESOURCE, ISSUER_A, tokens('token-a'));

    await store.saveClientInformation(RESOURCE, ISSUER_B, clientInfo('client-b'));
    await store.saveTokens(RESOURCE, ISSUER_B, tokens('token-b'));

    expect((await store.getClientInformation(RESOURCE, ISSUER_A))?.client_id).toBe('client-a');
    expect((await store.getTokens(RESOURCE, ISSUER_A))?.access_token).toBe('token-a');
    expect((await store.getClientInformation(RESOURCE, ISSUER_B))?.client_id).toBe('client-b');
    expect((await store.getTokens(RESOURCE, ISSUER_B))?.access_token).toBe('token-b');

    const grants = await store.getGrants(RESOURCE);
    expect(grants).toHaveLength(2);
    expect(grants.map((g) => g.tokens?.access_token).sort()).toEqual(['token-a', 'token-b']);
  });

  it('resolves a no-issuer lookup to the currently active issuer', async () => {
    const store = new OAuthRecordStore(fakeSecretStore());
    await store.saveTokens(RESOURCE, ISSUER_A, tokens('token-a'));
    await store.saveTokens(RESOURCE, ISSUER_B, tokens('token-b'));

    expect((await store.getTokens(RESOURCE))?.access_token).toBe('token-b');
    expect((await store.getClientInformation(RESOURCE))).toBeUndefined();

    await store.saveClientInformation(RESOURCE, ISSUER_B, clientInfo('client-b'));
    expect((await store.getClientInformation(RESOURCE))?.client_id).toBe('client-b');
  });

  it('canonicalizes resource and issuer URLs so equivalent forms share one record', async () => {
    const store = new OAuthRecordStore(fakeSecretStore());
    await store.saveTokens('https://mcp.example.test/mcp', 'https://issuer.example.test', tokens('token-a'));

    expect((await store.getTokens('https://mcp.example.test/mcp/'))).toBeUndefined();
    expect((await store.getTokens('https://mcp.example.test:443/mcp'))?.access_token).toBe('token-a');
    expect((await store.getTokens('https://mcp.example.test/mcp', 'https://issuer.example.test/'))?.access_token)
      .toBe('token-a');
  });

  it('persists a code verifier and discovery state per resource', async () => {
    const store = new OAuthRecordStore(fakeSecretStore());
    await store.saveCodeVerifier(RESOURCE, 'verifier-123');
    await store.saveDiscoveryState(RESOURCE, discoveryState(ISSUER_A));

    expect(await store.getCodeVerifier(RESOURCE)).toBe('verifier-123');
    expect((await store.getDiscoveryState(RESOURCE))?.authorizationServerUrl).toBe(ISSUER_A);
  });

  it('makes the revocation endpoint from discovery state retrievable per issuer grant', async () => {
    const store = new OAuthRecordStore(fakeSecretStore());
    await store.saveTokens(RESOURCE, ISSUER_A, tokens('token-a'));
    await store.saveDiscoveryState(RESOURCE, discoveryState(ISSUER_A, 'https://issuer-a.example.test/revoke'));

    const grants = await store.getGrants(RESOURCE);
    const grantA = grants.find((g) => g.issuer === new URL(ISSUER_A).toString());
    expect(grantA?.authorizationServerMetadata?.revocation_endpoint).toBe('https://issuer-a.example.test/revoke');
  });

  it.each([
    ['client', { clientInformation: undefined, tokens: tokens('t'), codeVerifier: 'v', hasDiscovery: true }],
    ['tokens', { clientInformation: clientInfo('c'), tokens: undefined, codeVerifier: 'v', hasDiscovery: true }],
    ['verifier', { clientInformation: clientInfo('c'), tokens: tokens('t'), codeVerifier: undefined, hasDiscovery: true }],
    ['discovery', { clientInformation: clientInfo('c'), tokens: tokens('t'), codeVerifier: 'v', hasDiscovery: false }],
    ['all', { clientInformation: undefined, tokens: undefined, codeVerifier: undefined, hasDiscovery: false }],
  ] as const)('invalidate(%s) clears only that scope', async (scope, expected) => {
    const store = new OAuthRecordStore(fakeSecretStore());
    await store.saveClientInformation(RESOURCE, ISSUER_A, clientInfo('c'));
    await store.saveTokens(RESOURCE, ISSUER_A, tokens('t'));
    await store.saveCodeVerifier(RESOURCE, 'v');
    await store.saveDiscoveryState(RESOURCE, discoveryState(ISSUER_A));

    await store.invalidate(RESOURCE, scope);

    expect((await store.getClientInformation(RESOURCE, ISSUER_A))?.client_id).toBe(expected.clientInformation?.client_id);
    expect((await store.getTokens(RESOURCE, ISSUER_A))?.access_token).toBe(expected.tokens?.access_token);
    expect(await store.getCodeVerifier(RESOURCE)).toBe(expected.codeVerifier);
    expect(await store.getDiscoveryState(RESOURCE) !== undefined).toBe(expected.hasDiscovery);
  });

  it('invalidating the active issuer leaves other issuers under the same resource untouched', async () => {
    const store = new OAuthRecordStore(fakeSecretStore());
    await store.saveClientInformation(RESOURCE, ISSUER_A, clientInfo('client-a'));
    await store.saveTokens(RESOURCE, ISSUER_A, tokens('token-a'));
    // Issuer B is saved last, so it becomes the active issuer.
    await store.saveClientInformation(RESOURCE, ISSUER_B, clientInfo('client-b'));
    await store.saveTokens(RESOURCE, ISSUER_B, tokens('token-b'));

    await store.invalidate(RESOURCE, 'client');
    await store.invalidate(RESOURCE, 'tokens');

    const grants = await store.getGrants(RESOURCE);
    const grantA = grants.find((g) => g.issuer === new URL(ISSUER_A).toString());
    const grantB = grants.find((g) => g.issuer === new URL(ISSUER_B).toString());

    expect(grantB?.clientInformation).toBeUndefined();
    expect(grantB?.tokens).toBeUndefined();
    expect(grantA?.clientInformation?.client_id).toBe('client-a');
    expect(grantA?.tokens?.access_token).toBe('token-a');
  });

  it('clearResource removes every grant for that resource only', async () => {
    const store = new OAuthRecordStore(fakeSecretStore());
    await store.saveTokens(RESOURCE, ISSUER_A, tokens('token-a'));
    await store.saveTokens(RESOURCE, ISSUER_B, tokens('token-b'));
    await store.saveTokens('https://other.example.test/mcp', ISSUER_A, tokens('other'));

    await store.clearResource(RESOURCE);

    expect(await store.getGrants(RESOURCE)).toEqual([]);
    expect(await store.getCodeVerifier(RESOURCE)).toBeUndefined();
    expect((await store.getTokens('https://other.example.test/mcp'))?.access_token).toBe('other');
  });

  it('propagates a corrupt-storage error instead of swallowing it', async () => {
    const failingSecretStore: SecretStoreLike = {
      read: async () => {
        throw new OAuthStorageError('boom');
      },
      write: async () => {},
    };
    const store = new OAuthRecordStore(failingSecretStore);

    await expect(store.getTokens(RESOURCE)).rejects.toBeInstanceOf(OAuthStorageError);
    await expect(store.saveTokens(RESOURCE, ISSUER_A, tokens('t'))).rejects.toBeInstanceOf(OAuthStorageError);
  });

  it('a read issued right after an unawaited write observes the write, not stale data', async () => {
    const delayedSecretStore: SecretStoreLike & { value: string | undefined } = {
      value: undefined,
      async read() {
        return this.value;
      },
      async write(value: string) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        this.value = value;
      },
    };
    const store = new OAuthRecordStore(delayedSecretStore);

    const writePromise = store.saveTokens(RESOURCE, ISSUER_A, tokens('fresh'));
    const result = await store.getTokens(RESOURCE, ISSUER_A);

    expect(result?.access_token).toBe('fresh');
    await writePromise;
  });
});
