# MCPDevBench SDK-Native OAuth Design

Status: Implemented

Date: 2026-09-19

## 1. Objective

Add interoperable OAuth authorization to Streamable HTTP MCP profiles without exposing credentials or protocol machinery to the renderer. A developer must be able to connect to an OAuth-protected MCP server, complete authorization in the system browser, reconnect with SDK-managed tokens, preserve authorization securely across application restarts where the operating system permits it, and explicitly sign out.

The implementation uses the MCP TypeScript SDK's native OAuth flow and MCPDevBench's hosted Client ID Metadata Document (CIMD):

`https://senthilpk.github.io/mcpdevbench/oauth/client-id.json`

The design follows the useful boundaries in the official MCP Inspector while avoiding its multi-client storage complexity. It adopts MCPJam Inspector's client-metadata validation and observable authorization workflow, but not its browser proxy, renderer storage, custom OAuth state machines, or custom URI callback.

## 2. User Workflow

1. The user selects **Connect** on a Streamable HTTP profile.
2. MCPDevBench attempts a normal SDK connection. Public servers continue to connect without OAuth.
3. If the SDK reports that authorization is required, the row changes to **Authorization required** and then **Waiting for browser**.
4. MCPDevBench starts its loopback callback listener and opens the SDK-produced authorization URL in the system browser.
5. The row offers **Open browser again** and **Cancel** while authorization is pending.
6. After the callback is validated, the SDK exchanges the authorization code, MCPDevBench creates a fresh client and transport, and normal capability discovery runs.
7. **Disconnect** closes only the MCP session and preserves authorization. A later Connect may reuse or refresh stored tokens without browser interaction.
8. **Sign out** disconnects the profile, attempts standards-based token revocation when advertised, and removes locally stored OAuth state even if remote revocation fails.

STDIO profiles are unchanged and never display OAuth actions.

## 3. Standards And Compatibility

The connection path delegates protected-resource discovery, authorization-server discovery, PKCE, token exchange, refresh, resource indicators, and SDK-defined error handling to `@modelcontextprotocol/client` 2.0.0.

MCPDevBench supplies its hosted metadata URL as the `client_id` only when the discovered authorization server advertises `client_id_metadata_document_supported: true`. The hosted document remains the authoritative declaration of application name, native application type, grant and response types, token authentication method, and exact redirect URI.

MCPDevBench does not silently fall back to Dynamic Client Registration in this slice. A server that requires OAuth but does not support CIMD receives a specific compatibility failure explaining that its authorization server does not accept MCPDevBench's client identity. Pre-registered client credentials, DCR, enterprise-managed authorization, DPoP, and legacy protocol compatibility modes are deferred.

The authorization request uses scopes discovered through the MCP challenge and server metadata. MCPDevBench does not append product-specific scopes. Refresh-token behavior remains SDK- and authorization-server-driven; the application does not independently force `offline_access`.

## 4. Trust Boundary

All OAuth behavior runs in Electron's main process. The renderer receives only sanitized authorization state and invokes narrow commands. It never receives access tokens, refresh tokens, authorization codes, PKCE verifiers, authorization URLs, client secrets, discovered authorization-server metadata, or encrypted storage blobs.

Only an SDK-produced `https:` authorization URL may be sent to `shell.openExternal`. The URL remains in the main-process authorization attempt and is reopened through an IPC command that takes only a connection ID.

The callback server binds only to `127.0.0.1:51782` and accepts only `GET /__mcpdevbench_oauth_v1/callback`. It validates the request host, expected state through the SDK completion flow, and the single active attempt. It returns a small generic success or failure page with no token, code, state, issuer, or resource details. It closes after one terminal callback, cancellation, or timeout.

## 5. Main-Process Architecture

### MCP Client Adapter

`McpClientAdapter` remains the only module that imports the MCP client and transport implementations. For Streamable HTTP profiles it receives an `McpOAuthProvider` when creating `StreamableHTTPClientTransport`. Authorization causes the current connection attempt to stop at a typed boundary. After authorization completes, the adapter creates a fresh SDK client and transport rather than reusing a partially initialized transport.

STDIO construction remains unchanged.

### OAuth Coordinator

`OAuthCoordinator` owns at most one interactive authorization attempt because the hosted metadata registers one fixed loopback port. It:

- Starts the callback listener before browser navigation.
- Retains the authorization URL only in main-process memory.
- Opens and reopens the system browser.
- Correlates the callback with the owning connection and provider.
- Applies a bounded timeout and supports cancellation.
- Calls the provider's SDK completion method with callback parameters.
- Cleans up the callback server and pending state on every terminal path.

If another profile requests interactive authorization while one is active, it fails with a stable `authorization_busy` error rather than replacing or confusing the active flow. Non-interactive token reuse and refresh do not require coordinator ownership.

### MCP OAuth Provider

`McpOAuthProvider` implements the SDK's `OAuthClientProvider` contract. It supplies:

- Redirect URL `http://127.0.0.1:51782/__mcpdevbench_oauth_v1/callback`.
- Native public-client metadata with `token_endpoint_auth_method: none`.
- Hosted CIMD client information after confirming CIMD support.
- Issuer-aware client information, tokens, code verifier, and discovery state through `OAuthRecordStore`.
- Authorization navigation through `OAuthCoordinator` rather than directly opening a browser.

The provider is scoped to one resource URL and one connection attempt. Persistent data is not scoped to transient connection IDs.

### OAuth Record Store

`OAuthRecordStore` is keyed by a canonical MCP resource URL and authorization-server issuer. A resource record contains an active issuer pointer and issuer-bound grants. Each issuer record may contain SDK client information, tokens, authorization-server metadata needed for refresh or revocation, and short-lived authorization state such as the PKCE verifier.

The store exposes typed operations rather than a generic key-value API. Writes replace one encrypted versioned document atomically. Corrupt or undecryptable persistent data is reported as an authorization-storage failure and is never silently overwritten during Connect.

The hosted CIMD registration contains no secret, but it remains in the same issuer-bound record to prevent a grant from being associated with the wrong client identity.

### Secret Store

`SecretStore` owns persistence under Electron's `userData` directory and uses `safeStorage.encryptString` and `safeStorage.decryptString`. The file contains only a format version and encoded ciphertext.

On macOS and Windows, persistent authorization is available when `safeStorage.isEncryptionAvailable()` is true. On Linux, MCPDevBench also checks `safeStorage.getSelectedStorageBackend()` and rejects insecure fallback backends such as `basic_text`. When secure storage is unavailable, authorization records remain in memory for the application session and the renderer receives a visible `session-only` storage warning. Tokens are never written in plaintext.

### Revocation

Sign out snapshots the issuer-bound grant, disconnects the active MCP session, and attempts RFC 7009 revocation when the stored authorization-server metadata advertises a revocation endpoint. It prefers the refresh token, then the access token. The operation has a short network timeout. Local credentials are cleared regardless of endpoint availability or revocation failure; a sanitized warning tells the user when the remote grant may remain active.

## 6. Connection Lifecycle And IPC

`ConnectionState` adds:

- `authorization-required`: the server requires OAuth and the interactive flow is being prepared.
- `authorizing`: the callback listener is active and the browser has been opened.
- `completing-authorization`: the callback was accepted and token exchange is running.

`ConnectionSnapshot` adds an optional authorization summary:

```ts
type AuthorizationSnapshot = {
  status: 'required' | 'waiting' | 'completing' | 'authorized';
  storage: 'persistent' | 'session-only';
  canReopenBrowser: boolean;
  canCancel: boolean;
  warning?: string;
};
```

No sensitive URL or protocol value appears in this object.

Renderer commands add:

```ts
reopenAuthorization(connectionId: string): Promise<ConnectionSnapshot>;
cancelAuthorization(connectionId: string): Promise<ConnectionSnapshot>;
signOut(profileId: string): Promise<SignOutResult>;
```

`SignOutResult` reports whether local authorization was removed and whether remote revocation succeeded, was unavailable, or failed. Inputs are parsed in main and outputs are parsed in preload using Zod, matching the existing IPC boundary.

Cancellation closes the pending callback listener and returns the session to `disconnected` without deleting previously valid tokens. A failed fresh authorization must not destroy an older usable grant unless the authorization server has already invalidated it.

## 7. Renderer Experience

The existing server row remains the primary surface. During authorization it shows explicit state text and a restrained progress indicator. **Open browser again** is available only while the same attempt is waiting. **Cancel** ends that attempt. Actions are stable-width controls so state changes do not shift the table layout.

Connected OAuth profiles expose **Disconnect** through the existing primary row action and **Sign out** in the row's secondary actions. Sign out is visually distinct from disconnect and requires confirmation because it removes reusable authorization. A revocation failure appears as a non-blocking warning after local sign-out succeeds.

When secure persistence is unavailable, the row or connection status area says that authorization lasts only until MCPDevBench closes. It does not imply that the authorization server's remote grant is automatically revoked on application exit.

Failures use actionable copy:

- CIMD unsupported: the authorization server cannot accept MCPDevBench's hosted client identity.
- Callback port unavailable: another application is using port 51782.
- Authorization busy: finish or cancel the other browser authorization.
- Callback rejected or timed out: authorization was not completed; Connect can retry.
- Secure storage unavailable: the current session can continue, but credentials will not persist.

## 8. Configuration

The default CIMD URL is a build-time application constant. An advanced global setting may override it for forks and development builds after validating that it is an absolute `https:` URL. It is not configured per server because the URL represents the identity of the MCPDevBench application, not a property of an MCP resource.

The first implementation may expose the override through a documented environment variable or main-process configuration seam rather than adding a settings screen. The default user workflow requires no configuration.

## 9. Error And Concurrency Behavior

- Public and STDIO connections remain unaffected by OAuth services.
- One profile still owns at most one connection session.
- One interactive OAuth attempt exists application-wide.
- Closing or disconnecting an authorizing connection cancels its callback listener.
- Application shutdown cancels authorization before closing MCP clients.
- Browser-open failure leaves the listener available briefly and exposes retry and cancel actions.
- A callback with an error parameter becomes a sanitized authorization failure.
- Unknown paths, methods, hosts, stale callbacks, and mismatched attempts receive an error response without mutating authorization state.
- Refresh-token failure may trigger a new interactive flow through the same state machine; it never loops automatically without a user-visible transition.
- Logs and errors redact authorization headers, tokens, callback query values, and encrypted records.

## 10. Testing

Unit tests cover:

- CIMD support detection and preconfigured client identity.
- Provider persistence by resource and issuer.
- Secure, session-only, corrupt, and unavailable storage behavior.
- Callback binding, exact path/method/host checks, single completion, timeout, cancellation, and occupied port.
- Browser URL scheme validation and reopen behavior.
- Connection lifecycle transitions through authorization and fresh transport creation.
- Concurrent interactive authorization rejection.
- Disconnect preservation versus Sign out deletion.
- Best-effort revocation and mandatory local clearing.
- Zod validation for every new snapshot and IPC payload.

Integration tests run a local Streamable HTTP MCP fixture with protected-resource metadata and a local authorization-server fixture. They exercise challenge discovery, PKCE redirect, callback completion, token use, refresh where supported, reconnect without a browser, and sign out. Tests do not use the public internet or a real identity provider.

Renderer tests cover waiting, reopening, cancellation, completion, session-only warning, sign-out confirmation, and sanitized failures. Electron end-to-end coverage verifies that the system-browser command is requested through a stubbed main-process boundary; automated tests do not drive a real external browser login.

## 11. Completion Criteria

- The existing protected LocalMCP profile can complete SDK-native browser authorization using the hosted CIMD URL and discover its MCP catalogs.
- Public Streamable HTTP and STDIO profiles behave as before.
- Tokens and verifiers never cross into the renderer or plaintext persistence.
- Secure platforms reuse authorization after application restart.
- Insecure Linux storage falls back to session-only authorization with visible copy.
- Callback handling is loopback-only, single-use, cancellable, and time-bounded.
- Disconnect preserves authorization; Sign out clears it and attempts revocation.
- Unsupported CIMD and OAuth failures produce specific, sanitized diagnostics.
- Unit, integration, renderer, typecheck, and Electron packaging verification pass.

## 12. Deferred Work

- Dynamic Client Registration and manually pre-registered OAuth clients.
- Enterprise-managed authorization and identity-provider policy.
- DPoP-bound access tokens.
- Per-operation step-up authorization after tool, resource, or prompt calls are implemented.
- Custom URI-scheme callbacks and ephemeral callback ports.
- A general OAuth protocol debugger or multi-version conformance mode.
- Renderer-visible authorization-server metadata and token inspection.
