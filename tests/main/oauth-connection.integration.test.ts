import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startProtectedMcpFixture } from '../fixtures/oauth/protected-mcp-server.mjs';
import { ConnectionManager, type AuthorizationService } from '@/main/mcp/connections/connection-manager';
import { createMcpClient } from '@/main/mcp/client/mcp-client-adapter';
import { OAuthCoordinator } from '@/main/oauth/oauth-coordinator';
import { OAuthRecordStore } from '@/main/oauth/oauth-record-store';
import { SecretStore, type SecretStoreDependencies } from '@/main/oauth/secret-store';
import type { ProfileStore } from '@/main/profiles/profile-store';
import type { ServerProfile } from '@/shared/domain/servers';

/**
 * Drives the SDK-produced authorization URL exactly the way a real system browser
 * would, using only loopback HTTP: hit the fixture's `/authorize`, follow its 302 to
 * MCPDevBench's real (already-listening) loopback callback server, and let that
 * request complete `OAuthCoordinator.beginInteractiveAttempt`'s `finishAuth` chain.
 * No browser automation tooling is used or needed -- see task-7-notes.md.
 */
async function driveBrowser(authorizationUrl: string): Promise<void> {
  // The fixture advertises its `authorization_endpoint` as `https:` purely so
  // `OAuthCoordinator`'s real "only https: may be opened" check has something genuine to
  // approve (see the matching comment in protected-mcp-server.mjs) -- the actual listener
  // is the fixture's one plain-http loopback server, so the simulated browser's real
  // network request targets that scheme instead.
  const fetchUrl = new URL(authorizationUrl);
  fetchUrl.protocol = 'http:';
  // `Connection: close` on both hops: without it, undici's keep-alive pool can hand the
  // second (loopback callback) request an already-established socket left over from a
  // PREVIOUS interactive attempt's identical `127.0.0.1:51782` origin -- routing it to that
  // earlier (already-settled) `LoopbackCallbackServer` instance instead of the current one,
  // which rejects it with 410. Each hop here must open its own fresh connection, exactly
  // like a real browser would for two unrelated navigations.
  const authorizeResponse = await fetch(fetchUrl, { redirect: 'manual', headers: { Connection: 'close' } });
  if (authorizeResponse.status < 300 || authorizeResponse.status >= 400) {
    throw new Error(`fixture /authorize did not redirect (status ${authorizeResponse.status})`);
  }
  const location = authorizeResponse.headers.get('location');
  if (!location) throw new Error('fixture /authorize redirect is missing a Location header');
  const callbackResponse = await fetch(location, { redirect: 'manual', headers: { Connection: 'close' } });
  if (!callbackResponse.ok) {
    throw new Error(`loopback callback rejected the simulated browser redirect (status ${callbackResponse.status})`);
  }
}

/** Fake in-memory filesystem + `safeStorage`, mirroring tests/main/secret-store.test.ts's pattern. */
function fakeSecretStoreDependencies(): SecretStoreDependencies {
  const files = new Map<string, string>();
  return {
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(`ENC:${Buffer.from(plainText, 'utf8').toString('base64')}`, 'utf8'),
      decryptString: (encrypted: Buffer) => {
        const text = encrypted.toString('utf8');
        if (!text.startsWith('ENC:')) throw new Error('bad ciphertext');
        return Buffer.from(text.slice('ENC:'.length), 'base64').toString('utf8');
      },
    },
    platform: 'darwin',
    readFile: async (path) => {
      const contents = files.get(path);
      if (contents === undefined) {
        const error = new Error('missing') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return contents;
    },
    writeFile: async (path, data) => {
      files.set(path, data);
    },
    rename: async (from, to) => {
      const data = files.get(from);
      if (data === undefined) throw new Error(`no such file: ${from}`);
      files.delete(from);
      files.set(to, data);
    },
  };
}

function createProfileStore(profile: ServerProfile): ProfileStore {
  return {
    list: async () => [profile],
    save: () => Promise.reject(new Error('not supported by this fixture')),
    delete: () => Promise.reject(new Error('not supported by this fixture')),
  };
}

type Harness = {
  manager: ConnectionManager;
  fixture: Awaited<ReturnType<typeof startProtectedMcpFixture>>;
  profile: ServerProfile;
  openBrowserSpy: ReturnType<typeof vi.fn>;
  capturedAuthorizationUrls: string[];
};

async function createHarness(): Promise<Harness> {
  const fixture = await startProtectedMcpFixture();
  const profile: ServerProfile = { id: 'protected-profile', name: 'Protected Fixture', transport: 'streamable-http', url: fixture.resourceUrl };

  const capturedAuthorizationUrls: string[] = [];
  const openBrowserSpy = vi.fn(async (url: string) => {
    capturedAuthorizationUrls.push(url);
    await driveBrowser(url);
  });

  const secretStore = new SecretStore('oauth-secrets.json', fakeSecretStoreDependencies());
  const recordStore = new OAuthRecordStore(secretStore);
  const coordinator = new OAuthCoordinator({ openBrowser: openBrowserSpy, defaultTimeoutMs: 10_000 });

  const authService: AuthorizationService = {
    recordStore,
    beginInteractiveAttempt: (input) => coordinator.beginInteractiveAttempt(input),
    reopenAuthorization: (connectionId) => coordinator.reopenAuthorization(connectionId),
    cancelAuthorization: (connectionId) => coordinator.cancelAuthorization(connectionId),
    storageMode: () => secretStore.storageMode(),
    sessionOnlyWarning: () => secretStore.sessionOnlyWarning(),
  };

  const manager = new ConnectionManager(createProfileStore(profile), createMcpClient, authService);
  return { manager, fixture, profile, openBrowserSpy, capturedAuthorizationUrls };
}

describe('SDK-native OAuth against a real loopback fixture', () => {
  let harness: Harness | undefined;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness?.manager.closeAll();
    await harness?.fixture.close();
    harness = undefined;
  });

  it(
    'discovers, authorizes via PKCE + CIMD, reconnects via refresh, and revokes on sign out',
    async () => {
      const { manager, fixture, profile, openBrowserSpy, capturedAuthorizationUrls } = harness!;

      // --- First connect: no stored grant, so the SDK must run the full interactive flow. ---
      await manager.connect(profile.id);
      await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('ready'), { timeout: 10_000 });

      const connectionId = manager.list()[0]!.connectionId;
      expect(openBrowserSpy).toHaveBeenCalledTimes(1);

      // RFC 9728 protected-resource discovery and RFC 8414 AS discovery both really happened.
      expect(fixture.discoveryHits.protectedResource).toBeGreaterThan(0);
      expect(fixture.discoveryHits.authorizationServer).toBeGreaterThan(0);

      // The SDK-produced authorization URL carries PKCE S256, the resource indicator, and the
      // hosted CIMD URL as client_id -- verify the real request shape, not just the outcome.
      const authorizationUrl = new URL(capturedAuthorizationUrls[0]!);
      // `OAuthCoordinator` only ever opens an `https:` URL (design spec §4) -- the fixture
      // advertises its authorize endpoint as `https:` on the same host/port to satisfy that
      // real check; see the comment on `authorization_endpoint` in the fixture.
      expect(authorizationUrl.protocol).toBe('https:');
      expect(authorizationUrl.host).toBe(new URL(fixture.origin).host);
      expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy();
      expect(authorizationUrl.searchParams.get('resource')).toBe(fixture.resourceUrl);
      expect(authorizationUrl.searchParams.get('client_id')).toMatch(/^https:\/\//);
      expect(authorizationUrl.searchParams.get('state')).toBeTruthy();

      // Authenticated MCP catalog discovery actually ran against the bearer-gated endpoint.
      const snapshot = manager.list()[0]!;
      expect(snapshot.tools).toEqual({ status: 'ready', items: [expect.objectContaining({ name: 'echo' })] });
      expect(snapshot.resources.status).toBe('ready');
      expect(snapshot.resources.items).toEqual([expect.objectContaining({ uri: 'fixture://readme' })]);
      expect(snapshot.prompts.items).toEqual([expect.objectContaining({ name: 'review-catalog' })]);

      // --- Disconnect preserves authorization; reconnect must not need the browser again. ---
      await manager.disconnect(connectionId);
      await vi.waitFor(() => expect(manager.list()).toEqual([]));

      await manager.connect(profile.id);
      await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('ready'), { timeout: 10_000 });
      expect(openBrowserSpy).toHaveBeenCalledTimes(1); // still just once: refresh/stored-token reconnect, no new browser interaction.

      const secondConnectionId = manager.list()[0]!.connectionId;

      // --- Sign out: disconnects, revokes remotely, and clears local authorization. ---
      const signOutResult = await manager.signOut(profile.id);
      expect(signOutResult.localCredentialsRemoved).toBe(true);
      expect(signOutResult.revocation).toBe('revoked');
      expect(fixture.revocationCalls.length).toBeGreaterThan(0);
      const revocationCall = fixture.revocationCalls[fixture.revocationCalls.length - 1]!;
      expect(revocationCall.token).toBeTruthy();
      expect(fixture.hasValidAccessToken(revocationCall.token)).toBe(false);
      expect(manager.list().find((entry) => entry.connectionId === secondConnectionId)).toBeUndefined();

      // Local credentials are really gone: the next connect must run the interactive flow again.
      await manager.connect(profile.id);
      await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('ready'), { timeout: 10_000 });
      expect(openBrowserSpy).toHaveBeenCalledTimes(2);
    },
    20_000,
  );
});
