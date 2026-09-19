# SDK-Native OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect MCPDevBench to CIMD-compatible OAuth-protected Streamable HTTP MCP servers through the system browser while keeping credentials in the Electron main process.

**Architecture:** The existing connection manager remains the workflow owner and the MCP adapter remains the SDK boundary. New focused modules provide encrypted issuer-bound records, an SDK `OAuthClientProvider`, and a single-attempt loopback coordinator; typed IPC projects only safe lifecycle state into the Vue server table.

**Tech Stack:** Electron 44 `safeStorage` and `shell`, TypeScript 5.9, `@modelcontextprotocol/client` 2.0, Vue 3, shadcn-vue, Zod 4, Vitest 5, Node HTTP.

**Spec:** `docs/superpowers/specs/2026-09-19-sdk-native-oauth-design.md`

## Global Constraints

- OAuth logic, callback parameters, authorization URLs, tokens, verifiers, and discovery metadata stay in Electron's main process.
- Use `https://senthilpk.github.io/mcpdevbench/oauth/client-id.json` as the default client metadata URL.
- Use exactly `http://127.0.0.1:51782/__mcpdevbench_oauth_v1/callback` as the redirect URI.
- Support CIMD only in this slice; do not add silent DCR or pre-registered-client fallback.
- Persist credentials only when Electron `safeStorage` is available and, on Linux, its selected backend is not `basic_text`; otherwise use memory for the application session.
- Public Streamable HTTP and STDIO behavior must remain unchanged.
- Do not add a product dependency; use Node and Electron facilities plus the installed MCP SDK.
- Leave visual tokens and the Systems Light design language intact.

## Review Focus

- A forged or stale loopback callback must fail before `finishAuth`, without exposing callback parameters.
- Two profiles requesting interactive authorization must not share, replace, or corrupt one another's attempt.
- Tokens for one resource or issuer must never be returned for another resource or issuer.
- Corrupt encrypted persistence must be visible and must not be silently replaced during Connect.
- Sign out must clear local credentials even when revocation is unavailable, times out, or fails.

---

### Task 1: Authorization Domain And IPC Contracts

**Files:**
- Modify: `src/shared/domain/servers.ts`
- Modify: `src/shared/contracts/servers.ts`
- Test: `tests/shared/server-contracts.test.ts`

**Interfaces:**
- Produces: `AuthorizationSnapshot`, `SignOutResult`, new authorization lifecycle states, `reopenAuthorization`, `cancelAuthorization`, and `signOut` channel constants and Zod schemas.
- Consumes: Existing `ConnectionSnapshot`, `ConnectionState`, and server channel conventions.

- [ ] **Step 1: Write failing contract tests**

Add tests proving that a waiting authorization snapshot with `storage`, `canReopenBrowser`, and `canCancel` parses; that unknown or sensitive fields such as `authorizationUrl` are rejected; that all three new lifecycle states parse; and that each `SignOutResult` revocation outcome parses.

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `npm test -- tests/shared/server-contracts.test.ts`

Expected: FAIL because the authorization types and schemas do not exist.

- [ ] **Step 3: Add the minimal shared model and schemas**

Add:

```ts
type AuthorizationStorage = 'persistent' | 'session-only';
type AuthorizationSnapshot = {
  status: 'required' | 'waiting' | 'completing' | 'authorized';
  storage: AuthorizationStorage;
  canReopenBrowser: boolean;
  canCancel: boolean;
  warning?: string;
};
type SignOutResult = {
  localCredentialsRemoved: true;
  revocation: 'revoked' | 'unavailable' | 'failed';
  warning?: string;
};
```

Extend `ConnectionState` with `authorization-required`, `authorizing`, and `completing-authorization`; add optional `authorization` to `ConnectionSnapshot`; export strict Zod schemas and the three channel names.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- tests/shared/server-contracts.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/domain/servers.ts src/shared/contracts/servers.ts tests/shared/server-contracts.test.ts
git commit -m "feat: define OAuth connection contracts"
```

### Task 2: Secure OAuth Record Persistence

**Files:**
- Create: `src/main/oauth/oauth-record-store.ts`
- Create: `src/main/oauth/secret-store.ts`
- Test: `tests/main/oauth-record-store.test.ts`
- Test: `tests/main/secret-store.test.ts`

**Interfaces:**
- Produces: `SecretStore`, `ElectronSecretStore`, `OAuthRecordStore`, `OAuthGrantRecord`, `AuthorizationStorageMode`.
- Consumes: Electron-compatible encryption and filesystem dependency objects supplied at construction.

- [ ] **Step 1: Write failing SecretStore tests**

Cover encrypted atomic write/read, missing-file empty state, corrupt ciphertext as `OAuthStorageError`, unavailable encryption as in-memory `session-only`, and Linux `basic_text` as `session-only`. Assert that the persisted file does not contain sample tokens or verifiers.

- [ ] **Step 2: Run SecretStore tests and verify RED**

Run: `npm test -- tests/main/secret-store.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement SecretStore**

Define a narrow dependency interface around `safeStorage`, platform, `readFile`, `writeFile`, and `rename`. Store `{ version: 1, ciphertext: string }`, write to a sibling temporary path before rename, and keep one memory value when persistence is unavailable. Export `storageMode(): 'persistent' | 'session-only'` and a stable session-only warning.

- [ ] **Step 4: Run SecretStore tests and verify GREEN**

Run: `npm test -- tests/main/secret-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing OAuthRecordStore tests**

Cover independent resource records, independent issuers under one resource, active-issuer token lookup, issuer-bound client information, verifier/discovery persistence, scoped invalidation, clearing all grants for one resource, and corrupt-document propagation.

- [ ] **Step 6: Run OAuthRecordStore tests and verify RED**

Run: `npm test -- tests/main/oauth-record-store.test.ts`

Expected: FAIL because `OAuthRecordStore` does not exist.

- [ ] **Step 7: Implement the versioned issuer-bound record store**

Expose focused methods used by the provider:

```ts
getClientInformation(resourceUrl: string, issuer?: string): Promise<StoredOAuthClientInformation | undefined>;
saveClientInformation(resourceUrl: string, issuer: string, value: StoredOAuthClientInformation): Promise<void>;
getTokens(resourceUrl: string, issuer?: string): Promise<StoredOAuthTokens | undefined>;
saveTokens(resourceUrl: string, issuer: string, value: StoredOAuthTokens): Promise<void>;
getCodeVerifier(resourceUrl: string): Promise<string | undefined>;
saveCodeVerifier(resourceUrl: string, value: string): Promise<void>;
getDiscoveryState(resourceUrl: string): Promise<OAuthDiscoveryState | undefined>;
saveDiscoveryState(resourceUrl: string, value: OAuthDiscoveryState): Promise<void>;
invalidate(resourceUrl: string, scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void>;
getGrants(resourceUrl: string): Promise<OAuthGrantRecord[]>;
clearResource(resourceUrl: string): Promise<void>;
```

Canonicalize resource and issuer URLs by parsing and serializing `URL`; never merge one issuer's values into another.

- [ ] **Step 8: Run storage tests and typecheck**

Run: `npm test -- tests/main/secret-store.test.ts tests/main/oauth-record-store.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/oauth/secret-store.ts src/main/oauth/oauth-record-store.ts tests/main/secret-store.test.ts tests/main/oauth-record-store.test.ts
git commit -m "feat: store OAuth grants securely"
```

### Task 3: SDK Provider And Loopback Authorization Coordinator

**Files:**
- Create: `src/main/oauth/oauth-provider.ts`
- Create: `src/main/oauth/loopback-callback-server.ts`
- Create: `src/main/oauth/oauth-coordinator.ts`
- Test: `tests/main/oauth-provider.test.ts`
- Test: `tests/main/loopback-callback-server.test.ts`
- Test: `tests/main/oauth-coordinator.test.ts`

**Interfaces:**
- Produces: `McpOAuthProvider implements OAuthClientProvider`, `LoopbackCallbackServer`, `OAuthCoordinator`, `AuthorizationAttemptError`.
- Consumes: `OAuthRecordStore`; a coordinator navigation dependency shaped as `(url: string) => Promise<void>`; transport completion shaped as `(params: URLSearchParams) => Promise<void>`.

- [ ] **Step 1: Write failing provider tests**

Assert the exact redirect URI, hosted `clientMetadataUrl`, native public-client metadata, CIMD client information `{ client_id: clientMetadataUrl }`, issuer-aware token/client reads, required no-context active-token behavior, verifier failure when absent, discovery persistence, scoped invalidation, and coordinator delegation from `redirectToAuthorization`.

- [ ] **Step 2: Run provider tests and verify RED**

Run: `npm test -- tests/main/oauth-provider.test.ts`

Expected: FAIL because the provider does not exist.

- [ ] **Step 3: Implement the SDK provider**

Use the installed SDK's `OAuthClientProvider`, `OAuthClientMetadata`, `OAuthTokens`, `OAuthDiscoveryState`, and client-information types. Do not implement `saveClientInformation`, which prevents DCR. Generate a cryptographically random state once per attempt, expose it to the coordinator for callback comparison, and pass `clientMetadataUrl` for SDK CIMD validation.

- [ ] **Step 4: Run provider tests and verify GREEN**

Run: `npm test -- tests/main/oauth-provider.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing callback-server tests**

Use an injectable Node HTTP server factory. Cover loopback host/port/path binding, GET-only handling, host-header validation, exact state comparison before completion, one terminal callback, OAuth error response, timeout, cancellation, stale callback, generic browser HTML, and no callback query values in response text or thrown messages.

- [ ] **Step 6: Run callback-server tests and verify RED**

Run: `npm test -- tests/main/loopback-callback-server.test.ts`

Expected: FAIL because the server does not exist.

- [ ] **Step 7: Implement the callback server**

Bind `127.0.0.1:51782`; accept only the registered path; compare `state` with constant-time-safe byte comparison when lengths match; return `URLSearchParams` only after validation; and guarantee listener/timer cleanup from success, failure, timeout, cancel, and bind-error paths.

- [ ] **Step 8: Write failing coordinator tests**

Cover listener-before-navigation ordering, `https:` enforcement, reopen, cancel, single-attempt `authorization_busy`, callback completion through `finishAuth(searchParams)`, and cleanup after browser-open or completion failure.

- [ ] **Step 9: Run coordinator tests and verify RED**

Run: `npm test -- tests/main/oauth-coordinator.test.ts`

Expected: FAIL because the coordinator does not exist.

- [ ] **Step 10: Implement the coordinator and run the task suite**

Run: `npm test -- tests/main/oauth-provider.test.ts tests/main/loopback-callback-server.test.ts tests/main/oauth-coordinator.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/main/oauth tests/main/oauth-provider.test.ts tests/main/loopback-callback-server.test.ts tests/main/oauth-coordinator.test.ts
git commit -m "feat: coordinate SDK OAuth authorization"
```

### Task 4: OAuth-Aware MCP Connection Lifecycle

**Files:**
- Modify: `src/main/mcp/client/mcp-client-port.ts`
- Modify: `src/main/mcp/client/mcp-client-adapter.ts`
- Modify: `src/main/mcp/connections/connection-manager.ts`
- Create: `src/main/oauth/revoke-grant.ts`
- Test: `tests/main/mcp-client-adapter.test.ts`
- Test: `tests/main/connection-manager.test.ts`
- Test: `tests/main/revoke-grant.test.ts`

**Interfaces:**
- Produces: an adapter auth-required result, `finishAuthorization(params)`, fresh transport recreation, connection commands `reopenAuthorization`, `cancelAuthorization`, and `signOut`.
- Consumes: `McpOAuthProvider`, `OAuthCoordinator`, `OAuthRecordStore`, and Task 1 snapshots.

- [ ] **Step 1: Write failing adapter tests**

Prove STDIO receives no provider; HTTP transport receives the provider; `UnauthorizedError` is distinguished from transport failure; callback completion forwards all validated search parameters; and reconnect creates a new client/transport bundle while preserving the provider.

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `npm test -- tests/main/mcp-client-adapter.test.ts`

Expected: FAIL because the adapter has no OAuth boundary.

- [ ] **Step 3: Extend the client port and adapter**

Represent authorization-required as a branded application error or typed connect result that does not leak SDK objects. Keep `McpClientAdapter` as the sole transport constructor and add a factory dependency that can recreate the HTTP bundle after successful `finishAuth`.

- [ ] **Step 4: Run adapter tests and verify GREEN**

Run: `npm test -- tests/main/mcp-client-adapter.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing manager lifecycle tests**

Cover states `initializing -> authorization-required -> authorizing -> completing-authorization -> discovering -> ready`; fresh adapter creation after completion; cancel to disconnected; reopen only for the owning attempt; specific failures for occupied port, CIMD unsupported, authorization busy, timeout, and browser-open failure; disconnect during authorization cancellation; token reuse without interactive state; and unchanged public/STDIO flows.

- [ ] **Step 6: Run manager tests and verify RED**

Run: `npm test -- tests/main/connection-manager.test.ts`

Expected: FAIL because the manager does not orchestrate OAuth.

- [ ] **Step 7: Implement authorization orchestration**

Inject an `AuthorizationService` into `ConnectionManager`. Keep the current quick-return Connect behavior and publish each transition asynchronously. On callback success, mark completion, finish SDK auth, close the partial adapter, create a fresh adapter, connect, and discover. Map typed authorization errors to stable sanitized codes and messages from the design.

- [ ] **Step 8: Write failing revocation and sign-out tests**

Cover refresh-token preference, access-token fallback, form encoding, advertised endpoint requirement, timeout, HTTP failure, all issuer-bound grants, disconnect-before-clear, and unconditional local clearing.

- [ ] **Step 9: Run revocation tests and verify RED**

Run: `npm test -- tests/main/revoke-grant.test.ts tests/main/connection-manager.test.ts`

Expected: FAIL because revocation and sign out do not exist.

- [ ] **Step 10: Implement bounded RFC 7009 revocation and sign out**

Use injected `fetch`, `AbortSignal.timeout`, stored issuer metadata, and CIMD client ID. Return `revoked`, `unavailable`, or `failed`; never retain local records because the remote call failed.

- [ ] **Step 11: Run the lifecycle task suite and typecheck**

Run: `npm test -- tests/main/mcp-client-adapter.test.ts tests/main/connection-manager.test.ts tests/main/revoke-grant.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/main/mcp src/main/oauth/revoke-grant.ts tests/main/mcp-client-adapter.test.ts tests/main/connection-manager.test.ts tests/main/revoke-grant.test.ts
git commit -m "feat: authorize protected MCP connections"
```

### Task 5: Electron Composition And Validated IPC

**Files:**
- Modify: `src/main/app/lifecycle.ts`
- Modify: `src/main/ipc/register-server-ipc.ts`
- Modify: `src/preload/api.ts`
- Modify: `src/renderer/env.d.ts`
- Test: `tests/main/server-ipc.test.ts`
- Test: `tests/main/create-main-window.test.ts`

**Interfaces:**
- Produces: renderer-safe API methods `reopenAuthorization`, `cancelAuthorization`, and `signOut`; application shutdown that cancels OAuth before closing connections.
- Consumes: Task 1 channel schemas and Task 4 manager methods.

- [ ] **Step 1: Write failing IPC tests**

Prove IDs are validated, manager methods receive only IDs, snapshots and sign-out results are parsed before crossing IPC, malformed results are rejected, and connection events contain no sensitive OAuth fields.

- [ ] **Step 2: Run IPC tests and verify RED**

Run: `npm test -- tests/main/server-ipc.test.ts`

Expected: FAIL because the handlers do not exist.

- [ ] **Step 3: Add IPC and preload methods**

Follow the existing handler and preload patterns. Extend `MCPDevBenchApi` and the renderer window type without exposing a generic invoke method.

- [ ] **Step 4: Write failing lifecycle composition tests**

Assert `ElectronSecretStore` uses `app.getPath('userData')`, `shell.openExternal` is injected into the coordinator, the hosted CIMD default can be overridden only by a valid `https:` `MCPDEVBENCH_CLIENT_METADATA_URL`, and shutdown cancels authorization before closing connections.

- [ ] **Step 5: Run lifecycle tests and verify RED**

Run: `npm test -- tests/main/create-main-window.test.ts`

Expected: FAIL until services are composed.

- [ ] **Step 6: Compose services and verify the task**

Construct one record store and one coordinator after `app.whenReady()`, create resource-scoped providers/adapters through the connection factory, and preserve the existing E2E user-data override.

Run: `npm test -- tests/main/server-ipc.test.ts tests/main/create-main-window.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/app/lifecycle.ts src/main/ipc/register-server-ipc.ts src/preload/api.ts src/renderer/env.d.ts tests/main/server-ipc.test.ts tests/main/create-main-window.test.ts
git commit -m "feat: expose OAuth workflow through Electron"
```

### Task 6: Systems Light Authorization UX

**Files:**
- Modify: `src/renderer/components/domain/ConnectionStatus.vue`
- Modify: `src/renderer/components/domain/ServerTable.vue`
- Modify: `src/renderer/features/servers/use-server-workspace.ts`
- Modify: `src/renderer/features/servers/ServerDashboard.vue`
- Test: `tests/renderer/ApplicationStatus.test.ts`
- Test: `tests/renderer/ServerTable.test.ts`
- Test: `tests/renderer/ServerDashboard.test.ts`

**Interfaces:**
- Produces: visible authorization states, reopen/cancel actions, session-only warning, and confirmed sign out.
- Consumes: Task 1 snapshots and Task 5 preload methods.

- [ ] **Step 1: Write failing state-projection tests**

Assert the three authorization lifecycle states map to distinct readable labels, row data carries authorization controls and warnings, and secrets or authorization URLs cannot be represented.

- [ ] **Step 2: Run renderer tests and verify RED**

Run: `npm test -- tests/renderer/ApplicationStatus.test.ts tests/renderer/ServerTable.test.ts tests/renderer/ServerDashboard.test.ts`

Expected: FAIL because the renderer does not support authorization states.

- [ ] **Step 3: Implement the row workflow**

Use Lucide `ExternalLink`, `X`, and `LogOut` icons with accessible names and tooltips. Show **Open browser again** and **Cancel** only while waiting. Show the session-only warning beneath the connection status. Keep action cells stable and preserve existing Connect, Refresh, Disconnect, and Delete behavior.

- [ ] **Step 4: Add sign-out confirmation behavior**

Use a native confirmation boundary injected or wrapped for testability; successful local clearing updates through normal connection events, while revocation failure displays the sanitized warning without treating local sign-out as failed.

- [ ] **Step 5: Run renderer tests and typecheck**

Run: `npm test -- tests/renderer/ApplicationStatus.test.ts tests/renderer/ServerTable.test.ts tests/renderer/ServerDashboard.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer tests/renderer/ApplicationStatus.test.ts tests/renderer/ServerTable.test.ts tests/renderer/ServerDashboard.test.ts
git commit -m "feat: add browser authorization UX"
```

### Task 7: Local OAuth Integration Fixture And End-To-End Verification

**Files:**
- Create: `tests/fixtures/oauth/protected-mcp-server.mjs`
- Create: `tests/main/oauth-connection.integration.test.ts`
- Modify: `tests/e2e/app.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-19-sdk-native-oauth-design.md`

**Interfaces:**
- Produces: deterministic proof of challenge discovery, callback completion, authenticated discovery, reconnect, refresh, and sign out.
- Consumes: the complete main-process and renderer implementation.

- [ ] **Step 1: Write the failing integration test**

Start loopback protected-resource, authorization-server, token, revocation, and MCP endpoints in one fixture. The test must verify RFC 9728 discovery, CIMD client ID, PKCE challenge, resource parameter, state callback, authenticated catalog discovery, refresh or stored-token reconnect, and revocation on sign out without public network access.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `npm test -- tests/main/oauth-connection.integration.test.ts`

Expected: FAIL until the fixture and complete flow agree.

- [ ] **Step 3: Complete only the integration wiring needed for GREEN**

Adjust application-owned seams, not SDK protocol internals. Preserve the fixture as test code and keep production endpoints configurable only through existing validated inputs.

- [ ] **Step 4: Add renderer E2E coverage**

Stub external navigation at the main-process dependency boundary, drive Connect to **Waiting for browser**, verify reopen/cancel controls, complete a fixture callback, verify Connected, then Sign out. Capture updated 1280x800 and 960x640 screenshots only if visual state changes make the existing baselines obsolete.

- [ ] **Step 5: Update spec status and run full verification**

Change the spec status to `Implemented` only after all completion criteria are met.

Run: `npm test && npm run typecheck && npm run package && npm run test:e2e`

Expected: all commands PASS; packaged Electron launches; OAuth tests use only loopback services.

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/oauth tests/main/oauth-connection.integration.test.ts tests/e2e/app.spec.ts docs/superpowers/specs/2026-09-19-sdk-native-oauth-design.md tests/e2e/screenshots
git commit -m "test: verify SDK-native OAuth workflow"
```
