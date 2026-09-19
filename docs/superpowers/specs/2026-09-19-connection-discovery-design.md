# MCPDevBench Connection And Discovery Vertical Slice

Status: Proposed for implementation

Date: 2026-09-19

## 1. Objective

Replace the Systems Light dashboard's demonstration server data with live MCP connection sessions. A developer must be able to save a non-secret STDIO or Streamable HTTP profile, connect it, automatically discover every catalog supported by the negotiated server capabilities, refresh discovery, disconnect, and reconnect after restarting MCPDevBench.

This slice implements the first usable path from the approved v0.1 architecture. It does not implement tool calls, Inspector detail views, tracing, Connection Doctor, OAuth, bearer tokens, custom headers, environment variables, legacy SSE, or secret storage.

## 2. User Workflow

1. The Servers dashboard starts from profiles persisted in Electron's user-data directory.
2. The user chooses **Add server** and selects STDIO or Streamable HTTP.
3. STDIO accepts a name, executable command, optional arguments, and optional working directory. Streamable HTTP accepts a name and absolute `http:` or `https:` MCP endpoint URL.
4. Saving creates a disconnected profile. No process is launched merely by saving.
5. Connect creates a fresh main-process session and returns immediately with a connecting snapshot.
6. The main process performs transport connection, protocol negotiation, and capability-gated discovery.
7. The dashboard receives session updates and displays lifecycle state, negotiated server identity, and discovered tool, resource, resource-template, and prompt counts.
8. Refresh repeats capability-gated discovery on the active client. Disconnect closes the SDK client and its transport.
9. On application restart, profiles remain saved and disconnected. Sessions are never restored automatically.

## 3. Scope And Safety

Profiles in this slice contain no secret-bearing fields. STDIO environment variables and HTTP headers/authentication are deliberately absent until platform-backed secret storage and redaction exist.

STDIO commands are launched only after an explicit Connect action. MCPDevBench does not invoke a shell: the command and argument array are passed directly to the SDK transport. Streamable HTTP URLs must use `http:` or `https:`. Legacy SSE fallback is rejected rather than attempted.

The renderer never receives an MCP client, transport, child-process handle, Electron object, raw SDK error, or unrestricted filesystem capability. It receives application-owned snapshots validated with Zod at both IPC boundaries.

## 4. Shared Domain Model

`ServerProfile` is a discriminated union:

```ts
type StdioServerProfile = {
  id: string;
  name: string;
  transport: 'stdio';
  command: string;
  args: string[];
  cwd?: string;
};

type HttpServerProfile = {
  id: string;
  name: string;
  transport: 'streamable-http';
  url: string;
};

type ServerProfile = StdioServerProfile | HttpServerProfile;
```

`ConnectionSnapshot` contains:

- Opaque `connectionId` and owning `profileId`.
- Lifecycle state: `connecting`, `initializing`, `discovering`, `ready`, `closing`, `disconnected`, or `failed`.
- Server name and version when negotiation supplies them.
- Protocol version and server instructions when available.
- One catalog result for tools, resources, resource templates, and prompts.
- A sanitized failure with stable code and human-readable message.

Each catalog result is one of:

```ts
type CatalogSnapshot<T> =
  | { status: 'unsupported'; items: [] }
  | { status: 'ready'; items: T[] }
  | { status: 'failed'; items: []; message: string };
```

Normalized catalog entries retain only fields needed by future Inspector views. Tool input/output schemas remain JSON-compatible values; resources retain URI, name, description, and MIME type; templates retain URI template and descriptive fields; prompts retain name, description, and argument metadata.

## 5. Main-Process Architecture

### Profile Store

`JsonProfileStore` owns one versioned JSON document under `app.getPath('userData')`. Writes use a temporary file followed by rename. Invalid or unreadable content produces a typed load failure; it is never silently overwritten. The store validates every record before returning it.

### MCP Client Adapter

`McpClientAdapter` is the only module that imports `@modelcontextprotocol/client`. It creates `Client`, `StdioClientTransport`, or `StreamableHTTPClientTransport`, exposes negotiated metadata, performs catalog discovery, and closes the connection. A narrow adapter interface allows lifecycle tests to use deterministic fakes.

The SDK's no-argument list methods perform complete pagination with a bounded page count. MCPDevBench still capability-gates each catalog from negotiated server capabilities and represents unsupported catalogs explicitly. One catalog failure does not discard successful catalogs; the session becomes `ready` with that catalog marked `failed`. Transport or initialization failure makes the connection `failed`.

### Session Manager

`ConnectionManager` owns one active session per profile. Connecting an already active profile closes its previous session first. It publishes immutable snapshots after every lifecycle transition and catalog update. Disconnect is idempotent. Closing the application closes every active session before exit.

## 6. IPC And Preload API

Renderer requests use these typed commands:

```ts
listProfiles(): Promise<ServerProfile[]>;
saveProfile(input: SaveServerProfileInput): Promise<ServerProfile>;
deleteProfile(profileId: string): Promise<void>;
listConnections(): Promise<ConnectionSnapshot[]>;
connect(profileId: string): Promise<ConnectionSnapshot>;
disconnect(connectionId: string): Promise<ConnectionSnapshot>;
refresh(connectionId: string): Promise<ConnectionSnapshot>;
onConnectionsChanged(listener: (snapshots: ConnectionSnapshot[]) => void): () => void;
```

All command inputs are parsed in the main process. All command responses and pushed event payloads are parsed in preload before entering the renderer. IPC handlers map internal exceptions to sanitized application errors.

Deleting a profile with an active connection first disconnects it. Profile names need not be unique; IDs are authoritative.

## 7. Renderer Experience

The existing Servers dashboard becomes a live profile list. Metrics are derived from snapshots: ready connections, discovered tools, and saved profiles. Each row shows profile name, transport, discovered tool count, lifecycle state, and context-appropriate actions.

**Add server** opens a right-side Sheet. The form uses visible labels, inline validation, a transport selector, and transport-specific fields. Saving leaves the profile disconnected and closes the Sheet. The dashboard then offers Connect.

Rows expose Connect when disconnected or failed, Disconnect while active, and Refresh when ready. Buttons are disabled while an incompatible transition is running. Failure text is visible in the row and does not rely on color. An empty profile collection renders the existing accessible empty state with a real Add server action.

The UI does not show demonstration rows once live profile loading is wired. Initial load uses skeletons; profile-load failure presents a retry action without erasing persisted data.

## 8. Error Behavior

- Invalid form input is rejected before IPC and revalidated in main.
- Spawn, URL, protocol, and initialization failures produce a failed snapshot with a sanitized message.
- Catalog-specific discovery failures remain attached to that catalog and do not hide successful metadata.
- A disconnect close error is reported, but the local session is removed so the UI cannot remain permanently stuck in closing.
- Event listeners are unsubscribed when the Vue feature unmounts.
- Duplicate rapid Connect requests for one profile share the in-flight transition and cannot create orphan processes.

## 9. Testing

Unit tests cover profile validation and atomic persistence, lifecycle transitions, duplicate connect handling, capability gating, successful discovery, partial catalog failure, refresh, disconnect, and error sanitization.

Integration tests use the official SDK's in-memory transport with controlled MCP fixtures where practical. One STDIO fixture proves process launch and teardown. Streamable HTTP transport behavior is adapter-tested with a local loopback fixture or a controlled fetch implementation; tests never use public network services.

Renderer tests cover add-profile validation, empty/loading/error/populated states, live event updates, and row actions. Electron end-to-end tests add and connect to a bundled STDIO fixture, verify real discovered counts, disconnect, restart, and verify that the saved profile remains while the session does not auto-connect.

## 10. Completion Criteria

- Demonstration fixtures are no longer imported by the dashboard.
- A non-secret STDIO or Streamable HTTP profile can be saved and survives restart.
- Connect performs real SDK initialization and automatic capability-supported discovery.
- Unsupported catalogs are distinct from empty and failed catalogs.
- Discovery results and lifecycle updates cross only validated typed IPC.
- Disconnect closes owned resources, including spawned STDIO processes.
- Renderer, main-process, integration, packaged Electron, and persistence-restart tests pass.
- No secret-bearing configuration is accepted or persisted in this slice.

## 11. Deferred Work

- Environment variables, custom headers, bearer tokens, OAuth, and platform secret storage.
- Legacy SSE fallback.
- Inspector detail pages and tool execution.
- Trace capture and Connection Doctor diagnostics.
- Automatic reconnect and background health checks.
