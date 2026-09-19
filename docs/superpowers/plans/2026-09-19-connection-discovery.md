# Connection And Discovery Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace demonstration dashboard data with persisted non-secret MCP server profiles, real STDIO and Streamable HTTP sessions, automatic capability-gated metadata discovery, and validated live renderer updates.

**Architecture:** Application-owned Zod contracts define the only values allowed across Electron boundaries. A JSON profile store persists non-secret profiles. A main-process connection manager owns SDK adapters and lifecycle state; the SDK remains isolated behind a port. Typed IPC exposes profile/session commands and a snapshot event. Vue owns only view state and renders live snapshots.

**Tech Stack:** Electron Forge, TypeScript, Vue 3, Zod 4, `@modelcontextprotocol/client`, `@modelcontextprotocol/server` for controlled fixtures, Vitest, Vue Test Utils, Playwright

**Spec:** `docs/superpowers/specs/2026-09-19-connection-discovery-design.md`

## Global Constraints

- Keep all MCP clients, transports, child processes, filesystem access, and SDK errors in the main process.
- Accept only non-secret profile fields: no environment variables, headers, tokens, cookies, OAuth, or arbitrary fetch configuration.
- Support STDIO and Streamable HTTP only; never attempt legacy SSE fallback.
- Invoke STDIO commands directly through the SDK transport, never through a shell.
- Validate every IPC input in main and every response/event payload in preload.
- Use application-owned shared domain types; `src/shared` must not import Electron, Vue, filesystem modules, or the MCP SDK.
- Use one active session per profile and close the previous session before reconnecting.
- Represent unsupported, empty, and failed catalogs as distinct states.
- Persist profiles under Electron user data using temp-file-plus-rename atomic writes.
- Do not auto-connect persisted profiles at startup.
- Keep direct dependency versions exact and commit `package-lock.json`.
- Preserve Systems Light tokens and existing renderer accessibility behavior.

## Review Focus

- Duplicate rapid Connect requests: one profile must create at most one live SDK client and no orphan process.
- Corrupt profile JSON: loading must return a visible recoverable error and must not overwrite the corrupt file.
- Capability mismatch: unsupported catalogs must not issue SDK list calls and must not appear as empty or failed.
- Partial discovery failure: successful catalogs remain visible while only the failed catalog reports failure.
- Shutdown during active STDIO work: application shutdown must await client close so the spawned process is terminated.

## Planned File Structure

```text
src/shared/
  domain/servers.ts
  contracts/servers.ts
src/main/
  profiles/json-profile-store.ts
  mcp/client/mcp-client-adapter.ts
  mcp/connections/connection-manager.ts
  ipc/register-server-ipc.ts
src/preload/api.ts
src/renderer/features/servers/
  AddServerSheet.vue
  ServerDashboard.vue
  use-server-workspace.ts
tests/
  fixtures/mcp/catalog-server.mjs
  main/profile-store.test.ts
  main/mcp-client-adapter.test.ts
  main/connection-manager.test.ts
  main/server-ipc.test.ts
  renderer/AddServerSheet.test.ts
  renderer/ServerDashboard.test.ts
  e2e/app.spec.ts
```

---

### Task 1: Define Server Domain And IPC Contracts

**Files:**
- Create: `src/shared/domain/servers.ts`
- Create: `src/shared/contracts/servers.ts`
- Create: `tests/shared/server-contracts.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `ServerProfile`, `SaveServerProfileInput`, `ConnectionSnapshot`, `CatalogSnapshot<T>`, normalized catalog entry types, Zod schemas, and `serverChannels`.

- [ ] **Step 1: Install exact MCP packages**

```bash
npm install --save-exact @modelcontextprotocol/client
npm install --save-dev --save-exact @modelcontextprotocol/server
```

Expected: both direct dependency values are exact and the lockfile changes.

- [ ] **Step 2: Write failing contract tests**

Create `tests/shared/server-contracts.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  connectionSnapshotSchema,
  saveServerProfileInputSchema,
} from '@/shared/contracts/servers';

describe('server contracts', () => {
  it('rejects secret-bearing and shell-shaped profile input', () => {
    expect(() => saveServerProfileInputSchema.parse({
      name: 'unsafe', transport: 'stdio', command: 'node server.js', args: [], env: { TOKEN: 'secret' },
    })).toThrow();
  });

  it('accepts only absolute HTTP endpoints', () => {
    expect(() => saveServerProfileInputSchema.parse({ name: 'x', transport: 'streamable-http', url: '/mcp' })).toThrow();
    expect(saveServerProfileInputSchema.parse({ name: 'x', transport: 'streamable-http', url: 'https://example.test/mcp' })).toMatchObject({ transport: 'streamable-http' });
  });

  it('distinguishes unsupported, empty, and failed catalogs', () => {
    const base = { connectionId: 'c1', profileId: 'p1', state: 'ready', tools: { status: 'ready', items: [] }, resources: { status: 'unsupported', items: [] }, resourceTemplates: { status: 'failed', items: [], message: 'bad template catalog' }, prompts: { status: 'ready', items: [] } };
    expect(connectionSnapshotSchema.parse(base).resourceTemplates.status).toBe('failed');
  });
});
```

- [ ] **Step 3: Verify RED**

Run: `npm test -- tests/shared/server-contracts.test.ts`

Expected: FAIL because the server contracts do not exist.

- [ ] **Step 4: Implement domain types and strict schemas**

In `src/shared/domain/servers.ts`, export the exact discriminated profile union from the spec plus:

```ts
export type ConnectionState = 'connecting' | 'initializing' | 'discovering' | 'ready' | 'closing' | 'disconnected' | 'failed';
export type CatalogSnapshot<T> =
  | { status: 'unsupported'; items: [] }
  | { status: 'ready'; items: T[] }
  | { status: 'failed'; items: []; message: string };

export type ToolSummary = { name: string; description?: string; inputSchema: unknown; outputSchema?: unknown };
export type ResourceSummary = { uri: string; name: string; description?: string; mimeType?: string };
export type ResourceTemplateSummary = { uriTemplate: string; name: string; description?: string; mimeType?: string };
export type PromptSummary = { name: string; description?: string; arguments: { name: string; description?: string; required?: boolean }[] };
```

`ConnectionSnapshot` has the four catalog properties, optional server metadata, and optional `{ code: string; message: string }` failure. Create matching `.strict()` Zod schemas in `src/shared/contracts/servers.ts`; reject unknown keys. Define channels:

```ts
export const serverChannels = {
  profilesList: 'servers:profiles:list', profilesSave: 'servers:profiles:save', profilesDelete: 'servers:profiles:delete',
  connectionsList: 'servers:connections:list', connect: 'servers:connect', disconnect: 'servers:disconnect', refresh: 'servers:refresh',
  connectionsChanged: 'servers:connections:changed',
} as const;
```

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/shared/server-contracts.test.ts && npm run typecheck`

```bash
git add package.json package-lock.json src/shared/domain/servers.ts src/shared/contracts/servers.ts tests/shared/server-contracts.test.ts
git commit -m "feat: define server connection contracts"
```

---

### Task 2: Persist Non-Secret Profiles Atomically

**Files:**
- Create: `src/main/profiles/profile-store.ts`
- Create: `src/main/profiles/json-profile-store.ts`
- Create: `tests/main/profile-store.test.ts`

**Interfaces:**
- Consumes: `ServerProfile`, `SaveServerProfileInput`, `serverProfileSchema`.
- Produces: `ProfileStore` and `JsonProfileStore` with `list()`, `save(input)`, and `delete(profileId)`.

- [ ] **Step 1: Write failing persistence tests**

Use a temporary directory in `tests/main/profile-store.test.ts`. Tests must prove:

```ts
it('persists and reloads profiles without auto-generated secret fields', async () => {
  const saved = await store.save({ name: 'Local', transport: 'stdio', command: 'node', args: ['server.mjs'] });
  expect((await new JsonProfileStore(file).list())[0]).toEqual(saved);
});

it('does not overwrite corrupt profile data', async () => {
  await writeFile(file, '{broken', 'utf8');
  await expect(store.list()).rejects.toThrow('Unable to read saved server profiles');
  expect(await readFile(file, 'utf8')).toBe('{broken');
});

it('serializes concurrent saves without losing either profile', async () => {
  await Promise.all([store.save(stdioInput), store.save(httpInput)]);
  expect(await store.list()).toHaveLength(2);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/main/profile-store.test.ts`

Expected: FAIL because `JsonProfileStore` does not exist.

- [ ] **Step 3: Implement the store**

`ProfileStore`:

```ts
export interface ProfileStore {
  list(): Promise<ServerProfile[]>;
  save(input: SaveServerProfileInput): Promise<ServerProfile>;
  delete(profileId: string): Promise<void>;
}
```

Use a promise queue to serialize mutations, `randomUUID()` for IDs, document shape `{ version: 1, profiles: ServerProfile[] }`, `mkdir({ recursive: true })`, write `${file}.tmp`, then `rename`. Treat `ENOENT` as an empty list only. Parse all other reads with the document schema and throw `ProfileStoreError('Unable to read saved server profiles')` without writing.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- tests/main/profile-store.test.ts && npm test`

```bash
git add src/main/profiles tests/main/profile-store.test.ts
git commit -m "feat: persist non-secret server profiles"
```

---

### Task 3: Isolate The MCP SDK And Discover Catalogs

**Files:**
- Create: `src/main/mcp/client/mcp-client-port.ts`
- Create: `src/main/mcp/client/mcp-client-adapter.ts`
- Create: `src/main/mcp/discovery/discover-catalogs.ts`
- Create: `tests/main/discover-catalogs.test.ts`
- Create: `tests/main/mcp-client-adapter.test.ts`

**Interfaces:**
- Produces: `McpClientPort`, `McpClientFactory`, `McpClientAdapter`, and `discoverCatalogs(client)`.

- [ ] **Step 1: Write failing capability/discovery tests**

Define a fake `McpClientPort` whose list methods record calls. Cover:

```ts
it('never calls unsupported catalogs', async () => {
  const client = fakeClient({ capabilities: { tools: {} } });
  const result = await discoverCatalogs(client);
  expect(client.calls).toEqual(['listTools']);
  expect(result.resources.status).toBe('unsupported');
});

it('retains successful catalogs when one catalog fails', async () => {
  const client = fakeClient({ capabilities: { tools: {}, prompts: {} }, promptsError: new Error('prompt failure') });
  const result = await discoverCatalogs(client);
  expect(result.tools).toMatchObject({ status: 'ready', items: [{ name: 'echo' }] });
  expect(result.prompts).toMatchObject({ status: 'failed', items: [], message: 'Unable to discover prompts' });
});
```

Adapter tests verify STDIO receives `{ command, args, cwd }`, HTTP rejects non-http URLs defensively, `connect()` exposes server version/capabilities/instructions, and `close()` calls `terminateSession()` for HTTP before client close.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/main/discover-catalogs.test.ts tests/main/mcp-client-adapter.test.ts`

- [ ] **Step 3: Implement the SDK port and adapter**

The port exposes:

```ts
export interface McpClientPort {
  connect(): Promise<void>;
  close(): Promise<void>;
  metadata(): { serverName?: string; serverVersion?: string; protocolVersion?: string; instructions?: string; capabilities: Record<string, unknown> };
  listTools(): Promise<ToolSummary[]>;
  listResources(): Promise<ResourceSummary[]>;
  listResourceTemplates(): Promise<ResourceTemplateSummary[]>;
  listPrompts(): Promise<PromptSummary[]>;
}
export type McpClientFactory = (profile: ServerProfile) => McpClientPort;
```

`McpClientAdapter` imports `Client` and `StreamableHTTPClientTransport` from `@modelcontextprotocol/client`, and `StdioClientTransport` from `@modelcontextprotocol/client/stdio`. Construct with client options `{ listMaxPages: 64 }`. Use no-argument SDK list methods so v2 aggregates all pages. Normalize SDK objects immediately and discard extra SDK fields.

`discoverCatalogs` checks `capabilities.tools`, `capabilities.resources`, and `capabilities.prompts`. Resource support triggers both resources and templates calls. Sanitize all catalog errors to fixed user messages; never return raw stack traces.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- tests/main/discover-catalogs.test.ts tests/main/mcp-client-adapter.test.ts && npm run typecheck`

```bash
git add src/main/mcp tests/main/discover-catalogs.test.ts tests/main/mcp-client-adapter.test.ts
git commit -m "feat: add MCP client discovery adapter"
```

---

### Task 4: Own Connection Lifecycle In Main

**Files:**
- Create: `src/main/mcp/connections/connection-manager.ts`
- Create: `tests/main/connection-manager.test.ts`

**Interfaces:**
- Consumes: `ProfileStore`, `McpClientFactory`, `discoverCatalogs`.
- Produces: `ConnectionManager` with `list`, `connect`, `disconnect`, `refresh`, `disconnectProfile`, `closeAll`, and `subscribe`.

- [ ] **Step 1: Write failing lifecycle tests**

Cover exact transition sequences, duplicate rapid connect, reconnect close ordering, refresh, missing IDs, discovery partial failure, and shutdown:

```ts
it('deduplicates rapid connects for one profile', async () => {
  const [first, second] = await Promise.all([manager.connect('p1'), manager.connect('p1')]);
  expect(factory).toHaveBeenCalledTimes(1);
  expect(first.connectionId).toBe(second.connectionId);
});

it('closes every client during shutdown', async () => {
  await manager.connect('p1');
  await manager.connect('p2');
  await manager.closeAll();
  expect(clients.every((client) => client.closeCalled)).toBe(true);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/main/connection-manager.test.ts`

- [ ] **Step 3: Implement lifecycle ownership**

Keep private maps by connection ID and profile ID plus an in-flight connect promise by profile ID. Publish cloned snapshots on `connecting`, `initializing`, `discovering`, each catalog completion, `ready`, `closing`, `disconnected`, and `failed`. `connect()` returns the current snapshot immediately after the connecting state is created while the lifecycle continues asynchronously; duplicate callers receive the same connection snapshot and do not create another client.

`disconnect()` removes the active-profile mapping in `finally`, even when close throws. `refresh()` is permitted only in `ready`. `closeAll()` awaits `Promise.allSettled` and clears every map. Subscribers receive the full sorted snapshot array and return an unsubscribe function.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- tests/main/connection-manager.test.ts && npm test`

```bash
git add src/main/mcp/connections tests/main/connection-manager.test.ts
git commit -m "feat: manage MCP connection lifecycle"
```

---

### Task 5: Expose Validated IPC And Wire Application Shutdown

**Files:**
- Create: `src/main/ipc/register-server-ipc.ts`
- Create: `tests/main/server-ipc.test.ts`
- Modify: `src/main/app/lifecycle.ts`
- Modify: `src/preload/api.ts`
- Modify: `tests/setup/renderer.ts`
- Modify: `src/renderer/env.d.ts`

**Interfaces:**
- Produces the exact preload API from the spec and pushes validated `connectionsChanged` arrays.

- [ ] **Step 1: Write failing IPC tests**

Test handler registration, main-side input rejection, response parsing, delete-before-disconnect behavior, event broadcasting, and listener cleanup. The preload listener test must prove that invoking the returned unsubscribe calls `ipcRenderer.removeListener` with the same wrapped callback.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/main/server-ipc.test.ts`

- [ ] **Step 3: Implement IPC and preload**

`registerServerIpc({ store, connections, webContents })` registers every `serverChannels` handler. Parse scalar IDs with `z.string().min(1)`. Parse all output with shared schemas before returning. Convert known store/session errors to messages safe for renderer display.

In preload, invoke commands and parse their results. Implement events as:

```ts
onConnectionsChanged(listener) {
  const wrapped = (_event: IpcRendererEvent, value: unknown) => listener(connectionSnapshotsSchema.parse(value));
  ipcRenderer.on(serverChannels.connectionsChanged, wrapped);
  return () => ipcRenderer.removeListener(serverChannels.connectionsChanged, wrapped);
}
```

Create store and manager after `app.whenReady()` using `join(app.getPath('userData'), 'server-profiles.json')`. If `MCPDEVBENCH_E2E_USER_DATA` is set, call `app.setPath('userData', value)` before `whenReady()` solely to isolate E2E persistence. Register IPC before creating the window. On `before-quit`, prevent the first quit, await `closeAll()`, then call `app.quit()` once with a guard.

Update renderer test setup with typed mocks for every new API method.

- [ ] **Step 4: Verify GREEN and commit**

Run: `npm test -- tests/main/server-ipc.test.ts tests/main && npm run typecheck`

```bash
git add src/main/app/lifecycle.ts src/main/ipc/register-server-ipc.ts src/preload/api.ts src/renderer/env.d.ts tests/main/server-ipc.test.ts tests/setup/renderer.ts
git commit -m "feat: expose server connection IPC"
```

---

### Task 6: Build The Live Server Workspace

**Files:**
- Create: `src/renderer/features/servers/use-server-workspace.ts`
- Create: `src/renderer/features/servers/AddServerSheet.vue`
- Create: `src/renderer/features/servers/ServerDashboard.vue`
- Create: `tests/renderer/AddServerSheet.test.ts`
- Create: `tests/renderer/ServerDashboard.test.ts`
- Modify: `src/renderer/features/dashboard/DashboardView.vue`
- Modify: `src/renderer/components/domain/ServerTable.vue`
- Modify: `src/renderer/components/domain/EmptyServerState.vue`
- Modify: `src/renderer/components/domain/ConnectionStatus.vue`
- Delete: `src/renderer/features/dashboard/server-fixtures.ts`
- Modify: `tests/renderer/DashboardView.test.ts`
- Modify: `tests/renderer/ServerTable.test.ts`

**Interfaces:**
- Consumes: typed preload profile/session API.
- Produces: live loading/error/empty/populated Servers experience and Add Server Sheet.

- [ ] **Step 1: Write failing composable and form tests**

Form tests cover required names, a whitespace-free executable command, argument parsing as one argument per line, absolute HTTP URL validation, and no secret fields. Dashboard tests cover loading skeletons, corrupt-store error with Retry, empty state with active Add server, save, event update, connect, disconnect, refresh, and unsubscription on unmount.

```ts
it('switches transport fields without retaining hidden values', async () => {
  const wrapper = mount(AddServerSheet, { props: { open: true } });
  await wrapper.get('[name="command"]').setValue('node');
  await wrapper.get('[name="transport"]').setValue('streamable-http');
  expect(wrapper.find('[name="command"]').exists()).toBe(false);
  expect(wrapper.get('[name="url"]').exists()).toBe(true);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/renderer/AddServerSheet.test.ts tests/renderer/ServerDashboard.test.ts`

- [ ] **Step 3: Implement workspace state**

`useServerWorkspace()` exposes readonly `profiles`, `connections`, `loading`, `error`, derived row models/metrics, and async commands. On mount, subscribe first, then load profiles and connections to avoid an event/list race. On unmount, unsubscribe. Match profiles to the newest connection by `profileId`.

Map lifecycle states to visible labels: connecting/initializing/discovering -> `Connecting`, ready -> `Connected`, closing -> `Disconnecting`, disconnected -> `Idle`, failed -> `Error`. Extend the domain status union without changing compact status styling.

- [ ] **Step 4: Implement Add Server Sheet and dashboard**

Use existing Sheet, Input, Button, Empty, Skeleton, and native labeled select/textarea controls. The primary Save button is enabled only for locally valid input and shows a pending state. Emit `save` with the exact `SaveServerProfileInput` union.

Refactor `ServerTable` to accept live row models and emit `connect`, `disconnect`, `refresh`, and `delete`. Tool count is `—` unless tools are ready. Show a short failure message below the server name. Empty state receives an Add Server callback and renders a real button.

Delete `server-fixtures.ts`; no fallback demonstration data is permitted.

- [ ] **Step 5: Verify GREEN and commit**

Run: `npm test -- tests/renderer && npm run typecheck`

```bash
git add src/renderer tests/renderer
git commit -m "feat: connect live server workspace"
```

---

### Task 7: Prove Real STDIO Discovery And Restart Persistence

**Files:**
- Create: `tests/fixtures/mcp/catalog-server.mjs`
- Modify: `tests/e2e/app.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `tests/e2e/screenshots/systems-light-1280x800.png`
- Modify: `tests/e2e/screenshots/systems-light-960x640.png`

**Interfaces:**
- Consumes: completed live connection workflow.
- Produces: packaged real-SDK acceptance evidence.

- [ ] **Step 1: Create controlled SDK server fixture**

Use `McpServer` and `StdioServerTransport` from `@modelcontextprotocol/server` to register two tools, one resource, one resource template, and one prompt. Write logs to stderr only; stdout is reserved for MCP.

- [ ] **Step 2: Extend E2E tests**

Launch Electron with a unique temp directory through `MCPDEVBENCH_E2E_USER_DATA`. In the UI:

1. Open Add server.
2. Save a STDIO profile using `node` and the absolute fixture path.
3. Click Connect.
4. Await Connected and assert tool count `2` plus resource/template/prompt summary text.
5. Click Refresh and verify the row remains ready.
6. Click Disconnect and verify Idle.
7. Close and relaunch with the same user-data directory.
8. Assert the profile remains and state is Idle without any child process auto-launch.

Retain the isolation assertion `typeof window.require === 'undefined'`, minimum-width overflow assertion, and screenshot capture.

- [ ] **Step 3: Run package and E2E**

Run: `npm run package && npm run test:e2e`

Expected: all Electron tests pass against the controlled real SDK server.

- [ ] **Step 4: Inspect both screenshots**

Verify no overlap at 960x640, live row actions fit without horizontal overflow, form labels/errors are legible, statuses do not rely on color, and no demonstration profiles appear.

- [ ] **Step 5: Run complete verification and commit**

Run:

```bash
npm run typecheck
npm test
npm run package
npm run test:e2e
```

```bash
git add tests/fixtures tests/e2e playwright.config.ts
git commit -m "test: verify real MCP discovery workflow"
```

## Completion Criteria

- Server dashboard imports no demonstration fixtures.
- Non-secret profiles persist atomically and corrupt files are preserved.
- Real SDK clients connect over STDIO and Streamable HTTP.
- Discovery is initiated in main, capability-gated, fully paginated by SDK v2, and normalized.
- Unsupported, empty, and failed catalogs remain distinct.
- Duplicate Connect cannot create multiple clients for one profile.
- All active sessions close during disconnect and application shutdown.
- Every preload response/event is runtime validated.
- Packaged Electron proves live STDIO discovery and persistence without auto-connect.
