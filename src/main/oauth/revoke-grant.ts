import type { OAuthGrantRecord } from '@/main/oauth/oauth-record-store';
import type { SignOutResult } from '@/shared/domain/servers';

/** The narrow surface `revokeGrant` depends on; the real `OAuthRecordStore` (Task 2) satisfies it. */
export interface RevokeGrantStore {
  getGrants(resourceUrl: string): Promise<OAuthGrantRecord[]>;
  clearResource(resourceUrl: string): Promise<void>;
}

export interface RevokeGrantDependencies {
  /** Injected so tests never make a real network call. */
  fetch: typeof fetch;
  /** Bounded network timeout for the revocation request; defaults to 5 seconds. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

const UNAVAILABLE_WARNING =
  'Sign-out removed local authorization, but this authorization server does not support remote revocation.';
const FAILED_WARNING =
  'Sign-out removed local authorization, but the remote authorization could not be revoked; it may still be active on the server.';

/**
 * Best-effort RFC 7009 token revocation, called by `ConnectionManager.signOut` after the
 * active session (if any) has already been disconnected. Local credentials are ALWAYS
 * cleared, in a `finally`, regardless of whether revocation succeeds, is unavailable, times
 * out, or fails outright -- sign-out must never leave stale local credentials behind just
 * because the remote authorization server was unreachable.
 *
 * Per the design's client-identity gotcha: this application's grants never populate
 * `OAuthGrantRecord.clientInformation` (its `McpOAuthProvider` never implements
 * `saveClientInformation`), so `client_id` is always the CIMD `clientMetadataUrl` constant
 * passed in by the caller, never read from the grant record.
 */
export async function revokeGrant(
  resourceUrl: string,
  store: RevokeGrantStore,
  clientId: string,
  deps: RevokeGrantDependencies,
): Promise<SignOutResult> {
  let revocation: SignOutResult['revocation'] = 'unavailable';
  try {
    const grants = await store.getGrants(resourceUrl);
    for (const grant of grants) {
      // `AuthorizationServerMetadata` is a union of OAuth-metadata and OIDC-provider-metadata
      // shapes; only the OAuth shape declares `revocation_endpoint`, so this is read via a
      // narrow structural cast rather than a full discriminated-union check.
      const endpoint = (grant.authorizationServerMetadata as { revocation_endpoint?: string } | undefined)
        ?.revocation_endpoint;
      const token = grant.tokens?.refresh_token ?? grant.tokens?.access_token;
      if (!endpoint || !token) continue;
      const tokenTypeHint = grant.tokens?.refresh_token ? 'refresh_token' : 'access_token';

      try {
        const response = await deps.fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token, token_type_hint: tokenTypeHint, client_id: clientId }).toString(),
          signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        if (response.ok) {
          if (revocation !== 'failed') revocation = 'revoked';
        } else {
          revocation = 'failed';
        }
      } catch {
        revocation = 'failed';
      }
    }
  } finally {
    // Unconditional: local credentials are removed even if reading grants or any
    // revocation attempt above threw.
    await store.clearResource(resourceUrl);
  }

  if (revocation === 'unavailable') return { localCredentialsRemoved: true, revocation, warning: UNAVAILABLE_WARNING };
  if (revocation === 'failed') return { localCredentialsRemoved: true, revocation, warning: FAILED_WARNING };
  return { localCredentialsRemoved: true, revocation };
}
