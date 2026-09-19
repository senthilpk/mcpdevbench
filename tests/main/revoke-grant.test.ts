import { describe, expect, it, vi } from 'vitest';
import { revokeGrant, type RevokeGrantStore } from '@/main/oauth/revoke-grant';
import type { OAuthGrantRecord } from '@/main/oauth/oauth-record-store';

const RESOURCE_URL = 'https://protected.test/mcp';
const CLIENT_ID = 'https://senthilpk.github.io/mcpdevbench/oauth/client-id.json';

function createStore(grants: OAuthGrantRecord[]): RevokeGrantStore & { clearResource: ReturnType<typeof vi.fn> } {
  return {
    getGrants: vi.fn().mockResolvedValue(grants),
    clearResource: vi.fn().mockResolvedValue(undefined),
  };
}

function okResponse(): Response {
  return { ok: true } as Response;
}

describe('revokeGrant', () => {
  it('prefers the refresh token over the access token when both are present', async () => {
    const store = createStore([{
      issuer: 'https://issuer.test',
      tokens: { access_token: 'at', refresh_token: 'rt', token_type: 'Bearer' },
      authorizationServerMetadata: { revocation_endpoint: 'https://issuer.test/revoke' } as never,
    }]);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const result = await revokeGrant(RESOURCE_URL, store, CLIENT_ID, { fetch: fetchImpl });

    expect(result.revocation).toBe('revoked');
    const body = fetchImpl.mock.calls[0]?.[1]?.body as string;
    expect(new URLSearchParams(body).get('token')).toBe('rt');
    expect(new URLSearchParams(body).get('token_type_hint')).toBe('refresh_token');
  });

  it('falls back to the access token when no refresh token is stored', async () => {
    const store = createStore([{
      issuer: 'https://issuer.test',
      tokens: { access_token: 'at', token_type: 'Bearer' },
      authorizationServerMetadata: { revocation_endpoint: 'https://issuer.test/revoke' } as never,
    }]);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    const result = await revokeGrant(RESOURCE_URL, store, CLIENT_ID, { fetch: fetchImpl });

    expect(result.revocation).toBe('revoked');
    const body = fetchImpl.mock.calls[0]?.[1]?.body as string;
    expect(new URLSearchParams(body).get('token')).toBe('at');
    expect(new URLSearchParams(body).get('token_type_hint')).toBe('access_token');
  });

  it('sends a form-encoded RFC 7009 request with the CIMD client_id, never the grant\'s own client information', async () => {
    const store = createStore([{
      issuer: 'https://issuer.test',
      // No `clientInformation` -- this application's grants never populate it (see the design's gotcha).
      tokens: { access_token: 'at', token_type: 'Bearer' },
      authorizationServerMetadata: { revocation_endpoint: 'https://issuer.test/revoke' } as never,
    }]);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await revokeGrant(RESOURCE_URL, store, CLIENT_ID, { fetch: fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('https://issuer.test/revoke');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(new URLSearchParams(init?.body as string).get('client_id')).toBe(CLIENT_ID);
  });

  it('reports revocation as unavailable when no grant advertises a revocation endpoint', async () => {
    const store = createStore([{
      issuer: 'https://issuer.test',
      tokens: { access_token: 'at', token_type: 'Bearer' },
    }]);
    const fetchImpl = vi.fn();

    const result = await revokeGrant(RESOURCE_URL, store, CLIENT_ID, { fetch: fetchImpl });

    expect(result).toEqual({ localCredentialsRemoved: true, revocation: 'unavailable', warning: expect.any(String) });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.clearResource).toHaveBeenCalledWith(RESOURCE_URL);
  });

  it('reports revocation as unavailable when there are no stored grants at all', async () => {
    const store = createStore([]);
    const fetchImpl = vi.fn();

    const result = await revokeGrant(RESOURCE_URL, store, CLIENT_ID, { fetch: fetchImpl });

    expect(result.revocation).toBe('unavailable');
    expect(store.clearResource).toHaveBeenCalledWith(RESOURCE_URL);
  });

  it('reports revocation as failed, but still clears local credentials, on a network timeout', async () => {
    const store = createStore([{
      issuer: 'https://issuer.test',
      tokens: { access_token: 'at', token_type: 'Bearer' },
      authorizationServerMetadata: { revocation_endpoint: 'https://issuer.test/revoke' } as never,
    }]);
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    const fetchImpl = vi.fn().mockRejectedValue(abortError);

    const result = await revokeGrant(RESOURCE_URL, store, CLIENT_ID, { fetch: fetchImpl, timeoutMs: 10 });

    expect(result).toEqual({ localCredentialsRemoved: true, revocation: 'failed', warning: expect.any(String) });
    expect(store.clearResource).toHaveBeenCalledWith(RESOURCE_URL);
  });

  it('reports revocation as failed, but still clears local credentials, on a non-2xx HTTP response', async () => {
    const store = createStore([{
      issuer: 'https://issuer.test',
      tokens: { access_token: 'at', token_type: 'Bearer' },
      authorizationServerMetadata: { revocation_endpoint: 'https://issuer.test/revoke' } as never,
    }]);
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false } as Response);

    const result = await revokeGrant(RESOURCE_URL, store, CLIENT_ID, { fetch: fetchImpl });

    expect(result.revocation).toBe('failed');
    expect(store.clearResource).toHaveBeenCalledWith(RESOURCE_URL);
  });

  it('clears the whole resource record, covering every issuer-bound grant', async () => {
    const store = createStore([
      {
        issuer: 'https://issuer-a.test',
        tokens: { access_token: 'a', token_type: 'Bearer' },
        authorizationServerMetadata: { revocation_endpoint: 'https://issuer-a.test/revoke' } as never,
      },
      {
        issuer: 'https://issuer-b.test',
        tokens: { access_token: 'b', token_type: 'Bearer' },
        authorizationServerMetadata: { revocation_endpoint: 'https://issuer-b.test/revoke' } as never,
      },
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse());

    await revokeGrant(RESOURCE_URL, store, CLIENT_ID, { fetch: fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(store.clearResource).toHaveBeenCalledTimes(1);
    expect(store.clearResource).toHaveBeenCalledWith(RESOURCE_URL);
  });

  it('always clears local credentials even when reading grants itself throws', async () => {
    const store: RevokeGrantStore & { clearResource: ReturnType<typeof vi.fn> } = {
      getGrants: vi.fn().mockRejectedValue(new Error('storage is corrupt')),
      clearResource: vi.fn().mockResolvedValue(undefined),
    };
    const fetchImpl = vi.fn();

    await expect(revokeGrant(RESOURCE_URL, store, CLIENT_ID, { fetch: fetchImpl })).rejects.toThrow('storage is corrupt');

    expect(store.clearResource).toHaveBeenCalledWith(RESOURCE_URL);
  });
});
