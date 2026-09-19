import { describe, expect, it, vi } from 'vitest';
import type { OAuthDiscoveryState, StoredOAuthTokens } from '@modelcontextprotocol/client';
import { DEFAULT_CLIENT_METADATA_URL, McpOAuthProvider, type OAuthRecordStoreLike } from '@/main/oauth/oauth-provider';
import { LOOPBACK_REDIRECT_URI } from '@/main/oauth/loopback-callback-server';

const RESOURCE_URL = 'https://mcp.example.test/mcp';
const ISSUER = 'https://issuer.example.test';

type FakeRecordStore = OAuthRecordStoreLike & {
  getClientInformation: ReturnType<typeof vi.fn>;
  getTokens: ReturnType<typeof vi.fn>;
  saveTokens: ReturnType<typeof vi.fn>;
  getCodeVerifier: ReturnType<typeof vi.fn>;
  saveCodeVerifier: ReturnType<typeof vi.fn>;
  getDiscoveryState: ReturnType<typeof vi.fn>;
  saveDiscoveryState: ReturnType<typeof vi.fn>;
  invalidate: ReturnType<typeof vi.fn>;
};

function fakeRecordStore(): FakeRecordStore {
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

function createProvider(overrides?: {
  recordStore?: FakeRecordStore;
  redirectToAuthorization?: (url: URL) => Promise<void>;
  clientMetadataUrl?: string;
}) {
  const recordStore = overrides?.recordStore ?? fakeRecordStore();
  const redirectToAuthorization = overrides?.redirectToAuthorization ?? vi.fn().mockResolvedValue(undefined);
  const provider = new McpOAuthProvider({
    resourceUrl: RESOURCE_URL,
    recordStore,
    redirectToAuthorization,
    ...(overrides?.clientMetadataUrl !== undefined ? { clientMetadataUrl: overrides.clientMetadataUrl } : {}),
  });
  return { provider, recordStore, redirectToAuthorization };
}

describe('McpOAuthProvider', () => {
  it('uses the exact loopback redirect URI', () => {
    const { provider } = createProvider();
    expect(provider.redirectUrl).toBe('http://127.0.0.1:51782/__mcpdevbench_oauth_v1/callback');
    expect(provider.redirectUrl).toBe(LOOPBACK_REDIRECT_URI);
  });

  it('defaults clientMetadataUrl to the hosted CIMD document', () => {
    const { provider } = createProvider();
    expect(provider.clientMetadataUrl).toBe(DEFAULT_CLIENT_METADATA_URL);
    expect(provider.clientMetadataUrl).toBe('https://senthilpk.github.io/mcpdevbench/oauth/client-id.json');
  });

  it('accepts a constructor-injected clientMetadataUrl override', () => {
    const { provider } = createProvider({ clientMetadataUrl: 'https://fake.example.test/client-id.json' });
    expect(provider.clientMetadataUrl).toBe('https://fake.example.test/client-id.json');
  });

  it('declares native public-client metadata accepted by OAuthClientMetadataSchema', () => {
    const { provider } = createProvider();
    const metadata = provider.clientMetadata;
    expect(metadata.redirect_uris).toEqual([LOOPBACK_REDIRECT_URI]);
    expect(metadata.token_endpoint_auth_method).toBe('none');
    expect(metadata.application_type).toBe('native');
    expect(metadata.grant_types).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']));
    expect(metadata.response_types).toEqual(['code']);
  });

  it('does not implement saveClientInformation -- the CIMD/DCR gate', () => {
    const { provider } = createProvider();
    expect(provider.saveClientInformation).toBeUndefined();
  });

  it('delegates clientInformation() to the record store, scoped by resource and issuer', async () => {
    const { provider, recordStore } = createProvider();
    const result = await provider.clientInformation({ issuer: ISSUER });
    expect(recordStore.getClientInformation).toHaveBeenCalledWith(RESOURCE_URL, ISSUER);
    expect(result).toBeUndefined();
  });

  it('delegates clientInformation() with no context', async () => {
    const { provider, recordStore } = createProvider();
    await provider.clientInformation();
    expect(recordStore.getClientInformation).toHaveBeenCalledWith(RESOURCE_URL, undefined);
  });

  it('resolves tokens() with no context to the active grant, not undefined, when one is saved', async () => {
    const stored: StoredOAuthTokens = { access_token: 'abc', token_type: 'Bearer' };
    const { provider, recordStore } = createProvider();
    recordStore.getTokens.mockResolvedValueOnce(stored);
    const result = await provider.tokens();
    expect(recordStore.getTokens).toHaveBeenCalledWith(RESOURCE_URL, undefined);
    expect(result).toBe(stored);
  });

  it('delegates tokens() with an issuer context', async () => {
    const { provider, recordStore } = createProvider();
    await provider.tokens({ issuer: ISSUER });
    expect(recordStore.getTokens).toHaveBeenCalledWith(RESOURCE_URL, ISSUER);
  });

  it('saves tokens scoped to resource and the resolved issuer', async () => {
    const { provider, recordStore } = createProvider();
    const tokens: StoredOAuthTokens = { access_token: 'abc', token_type: 'Bearer' };
    await provider.saveTokens(tokens, { issuer: ISSUER });
    expect(recordStore.saveTokens).toHaveBeenCalledWith(RESOURCE_URL, ISSUER, tokens);
  });

  it('rejects rather than silently discarding tokens saved with no issuer context', async () => {
    const { provider, recordStore } = createProvider();
    const tokens: StoredOAuthTokens = { access_token: 'abc', token_type: 'Bearer' };
    await expect(provider.saveTokens(tokens)).rejects.toThrow();
    expect(recordStore.saveTokens).not.toHaveBeenCalled();
  });

  it('rejects codeVerifier() when none has been saved, per the non-optional return type', async () => {
    const { provider } = createProvider();
    await expect(provider.codeVerifier()).rejects.toThrow();
  });

  it('round-trips the PKCE code verifier through the record store', async () => {
    const { provider, recordStore } = createProvider();
    await provider.saveCodeVerifier('verifier-value');
    expect(recordStore.saveCodeVerifier).toHaveBeenCalledWith(RESOURCE_URL, 'verifier-value');

    recordStore.getCodeVerifier.mockResolvedValueOnce('verifier-value');
    await expect(provider.codeVerifier()).resolves.toBe('verifier-value');
  });

  it('persists and reads discovery state scoped to the resource', async () => {
    const { provider, recordStore } = createProvider();
    const state: OAuthDiscoveryState = { authorizationServerUrl: 'https://issuer.example.test/' };
    await provider.saveDiscoveryState(state);
    expect(recordStore.saveDiscoveryState).toHaveBeenCalledWith(RESOURCE_URL, state);

    recordStore.getDiscoveryState.mockResolvedValueOnce(state);
    await expect(provider.discoveryState()).resolves.toBe(state);
  });

  it('delegates invalidateCredentials(scope) to the record store unchanged', async () => {
    const { provider, recordStore } = createProvider();
    await provider.invalidateCredentials('tokens');
    expect(recordStore.invalidate).toHaveBeenCalledWith(RESOURCE_URL, 'tokens');

    await provider.invalidateCredentials('all');
    expect(recordStore.invalidate).toHaveBeenCalledWith(RESOURCE_URL, 'all');
  });

  it('delegates redirectToAuthorization() to the injected coordinator seam, never touching a browser itself', async () => {
    const { provider, redirectToAuthorization } = createProvider();
    const url = new URL('https://issuer.example.test/authorize?state=abc');
    await provider.redirectToAuthorization(url);
    expect(redirectToAuthorization).toHaveBeenCalledWith(url);
    expect(redirectToAuthorization).toHaveBeenCalledTimes(1);
  });

  it('generates a fresh cryptographically random state per call and exposes it via expectedState()', () => {
    const { provider } = createProvider();
    expect(provider.expectedState()).toBeUndefined();

    const first = provider.state();
    expect(provider.expectedState()).toBe(first);
    expect(first.length).toBeGreaterThan(16);

    const second = provider.state();
    expect(second).not.toBe(first);
    expect(provider.expectedState()).toBe(second);
  });
});
