import { join } from 'node:path';
import { app, BrowserWindow, shell, webContents } from 'electron';
import { createMainWindow } from '@/main/app/create-main-window';
import { registerHealthIpc } from '@/main/ipc/register-health-ipc';
import { registerServerIpc } from '@/main/ipc/register-server-ipc';
import { createMcpClient } from '@/main/mcp/client/mcp-client-adapter';
import type { McpClientFactory } from '@/main/mcp/client/mcp-client-port';
import { ConnectionManager, type AuthorizationService } from '@/main/mcp/connections/connection-manager';
import type { CallbackServerLike } from '@/main/oauth/loopback-callback-server';
import { OAuthCoordinator } from '@/main/oauth/oauth-coordinator';
import { OAuthRecordStore } from '@/main/oauth/oauth-record-store';
import { ElectronSecretStore, type AuthorizationStorageMode, type SecretStoreLike } from '@/main/oauth/secret-store';
import { JsonProfileStore } from '@/main/profiles/json-profile-store';
import type { ProfileStore } from '@/main/profiles/profile-store';

/** The narrow surface `composeServices` needs from a `SecretStore`/`ElectronSecretStore`. */
type SecretStoreDependency = SecretStoreLike & {
  storageMode(): AuthorizationStorageMode;
  sessionOnlyWarning(): string | undefined;
};

/**
 * Explicit dependency object for {@link composeServices}. Every Electron-touching value
 * (the user-data directory, the `shell.openExternal`-shaped navigator, the environment
 * record) is passed in rather than read directly, so tests can supply fakes without
 * booting a real Electron `app`/`shell`. `createSecretStore`/`createClient`/
 * `createCallbackServer` are test-only seams; production callers omit them and get the
 * real `ElectronSecretStore`, `createMcpClient`, and `LoopbackCallbackServer`.
 */
export interface ComposeServicesDeps {
  userDataPath: string;
  profileStore: ProfileStore;
  shell: { openExternal: (url: string) => Promise<void> };
  env: Record<string, string | undefined>;
  createSecretStore?: (filePath: string) => SecretStoreDependency;
  createClient?: McpClientFactory;
  createCallbackServer?: () => CallbackServerLike;
}

export interface ComposedServices {
  store: ProfileStore;
  connections: ConnectionManager;
  authService: AuthorizationService;
}

/**
 * `MCPDEVBENCH_CLIENT_METADATA_URL` overrides the hosted CIMD default (design spec
 * section 8) only when it is a valid, absolute `https:` URL. Anything else -- unset,
 * `http:`, malformed, empty -- silently falls back to `McpOAuthProvider`'s own
 * `DEFAULT_CLIENT_METADATA_URL`: a bad env var must never throw or crash startup.
 */
function validateClientMetadataUrlOverride(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The pure(ish), testable half of Electron composition -- the counterpart to
 * `createMainWindowOptions` for services rather than the window. Constructs exactly one
 * `OAuthRecordStore` and one `OAuthCoordinator`, wires `shell.openExternal` (or its fake)
 * as the coordinator's `openBrowser`, and builds the single `ConnectionManager` used for
 * the lifetime of the application. Never touches `electron`, `process.env`, or the
 * filesystem directly -- everything comes from `deps`.
 */
export function composeServices(deps: ComposeServicesDeps): ComposedServices {
  const createSecretStore = deps.createSecretStore ?? ((filePath: string) => new ElectronSecretStore(filePath));
  const secretStore = createSecretStore(join(deps.userDataPath, 'oauth-secrets.json'));
  const recordStore = new OAuthRecordStore(secretStore);

  const clientMetadataUrl = validateClientMetadataUrlOverride(deps.env.MCPDEVBENCH_CLIENT_METADATA_URL);

  const coordinator = new OAuthCoordinator({
    openBrowser: (url) => deps.shell.openExternal(url),
    ...(deps.createCallbackServer ? { createCallbackServer: deps.createCallbackServer } : {}),
    ...(clientMetadataUrl !== undefined ? { defaultClientMetadataUrl: clientMetadataUrl } : {}),
  });

  const authService: AuthorizationService = {
    recordStore,
    ...(clientMetadataUrl !== undefined ? { clientMetadataUrl } : {}),
    beginInteractiveAttempt: (input) => coordinator.beginInteractiveAttempt(input),
    reopenAuthorization: (connectionId) => coordinator.reopenAuthorization(connectionId),
    cancelAuthorization: (connectionId) => coordinator.cancelAuthorization(connectionId),
    storageMode: () => secretStore.storageMode(),
    sessionOnlyWarning: () => secretStore.sessionOnlyWarning(),
  };

  const connections = new ConnectionManager(deps.profileStore, deps.createClient ?? createMcpClient, authService);

  return { store: deps.profileStore, connections, authService };
}

export const startApplication = async (): Promise<void> => {
  const e2eUserData = process.env.MCPDEVBENCH_E2E_USER_DATA;
  if (e2eUserData) app.setPath('userData', e2eUserData);
  await app.whenReady();

  const userDataPath = app.getPath('userData');
  const profileStore = new JsonProfileStore(join(userDataPath, 'server-profiles.json'));
  const { store, connections } = composeServices({
    userDataPath,
    profileStore,
    shell: { openExternal: (url) => shell.openExternal(url) },
    env: process.env,
  });

  registerHealthIpc();
  registerServerIpc({ store, connections, webContents });
  createMainWindow();

  let quittingAfterCleanup = false;
  app.on('before-quit', (event) => {
    if (quittingAfterCleanup) return;
    event.preventDefault();
    quittingAfterCleanup = true;
    void connections.closeAll().finally(() => app.quit());
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
};
