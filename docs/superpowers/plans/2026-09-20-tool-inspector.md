# Tool Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a developer list the tools a connected MCP server exposes, call one with JSON arguments, and see the real result, from a dedicated per-server page.

**Architecture:** New shared `ToolCallResult`/`ToolContentBlock` domain types and one new IPC channel (`callTool`) extend the existing connection-lifecycle contracts. `McpClientAdapter` gains the only new SDK surface (`Client.callTool`); `ConnectionManager` exposes it guarded on `ready`, mirroring `refresh()`. The renderer gets one new route (`/servers/:profileId`) rendering a new `ServerInspector.vue`, reachable from a new "View" action on a connected server's row.

**Tech Stack:** `@modelcontextprotocol/client` 2.0.0 (`Client.callTool`), Vue 3, vue-router 5 (first per-item route in this app), Zod 4, Vitest 5, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-tool-inspector-design.md`

## Global Constraints

- Tools only in this slice. No resources, no prompts, no auto-generated form fields (raw JSON textarea for arguments), no tool-call history across navigation, no cancellation/timeout beyond the transport's own.
- No confirmation step before calling a tool.
- `McpClientAdapter` remains the only module that imports the MCP SDK's `Client`/transport types.
- A tool call that runs and returns `isError: true` is a normal, successful `ToolCallResult` — never thrown as an exception, never shown as an application error.
- A tool call that never reaches the server (thrown error) must never leak a raw SDK/transport error message to the renderer.
- STDIO and Streamable HTTP (public or OAuth-protected) connections behave identically — the inspector has no transport-specific logic.
- Do not add a product dependency.
- Every existing test file this plan touches is extended, never replaced; every existing passing test must keep passing unmodified.

---

### Task 1: Shared Tool-Call Domain Types And Contracts

**Files:**
- Modify: `src/shared/domain/servers.ts`
- Modify: `src/shared/contracts/servers.ts`
- Test: `tests/shared/server-contracts.test.ts`

**Interfaces:**
- Produces: `ToolContentBlock` (5-variant union), `ToolCallResult`, `toolCallResultSchema`, `callToolRequestSchema`, `callToolResponseSchema`, `serverChannels.callTool`.
- Consumes: existing `ToolSummary` (unchanged), existing `serverChannels` object and `.strict()` schema conventions.

- [ ] **Step 1: Write failing contract tests**

Add to `tests/shared/server-contracts.test.ts` (append inside the existing `describe('server contracts', ...)` block, after the last existing `it(...)`):

```ts
  it('parses a text tool-call result', () => {
    const result = toolCallResultSchema.parse({
      content: [{ type: 'text', text: 'hello' }],
    });
    expect(result).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('parses every tool content block variant', () => {
    const content = [
      { type: 'text', text: 'hi' },
      { type: 'image', data: 'YWJj', mimeType: 'image/png' },
      { type: 'audio', data: 'YWJj', mimeType: 'audio/wav' },
      { type: 'resource_link', uri: 'file:///a.txt', name: 'a' },
      { type: 'resource', uri: 'file:///b.txt', text: 'contents' },
    ];
    expect(toolCallResultSchema.parse({ content }).content).toEqual(content);
  });

  it('parses structuredContent and isError on a tool-call result', () => {
    const result = toolCallResultSchema.parse({
      content: [],
      structuredContent: { count: 3 },
      isError: true,
    });
    expect(result).toEqual({ content: [], structuredContent: { count: 3 }, isError: true });
  });

  it('rejects an unknown field on a tool content block', () => {
    expect(() => toolCallResultSchema.parse({
      content: [{ type: 'text', text: 'hi', extra: 'nope' }],
    })).toThrow();
  });

  it('validates a callTool request payload', () => {
    expect(callToolRequestSchema.parse({
      connectionId: 'c1', name: 'echo', arguments: { message: 'hi' },
    })).toEqual({ connectionId: 'c1', name: 'echo', arguments: { message: 'hi' } });
    expect(callToolRequestSchema.parse({ connectionId: 'c1', name: 'echo' })).toEqual({
      connectionId: 'c1', name: 'echo',
    });
    expect(() => callToolRequestSchema.parse({ connectionId: '', name: 'echo' })).toThrow();
  });
```

Add these two imports to the top of the file's existing `import { ... } from '@/shared/contracts/servers';` statement:

```ts
  callToolRequestSchema,
  toolCallResultSchema,
```

(Insert alphabetically among the existing named imports in that statement.)

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `npm test -- tests/shared/server-contracts.test.ts`

Expected: FAIL because `toolCallResultSchema`/`callToolRequestSchema` do not exist yet.

- [ ] **Step 3: Add the shared domain types**

In `src/shared/domain/servers.ts`, insert immediately after the existing `PromptSummary` type definition (before `ConnectionSnapshot`):

```ts
export type ToolTextContent = { type: 'text'; text: string };
export type ToolImageContent = { type: 'image'; data: string; mimeType: string };
export type ToolAudioContent = { type: 'audio'; data: string; mimeType: string };
export type ToolResourceLinkContent = {
  type: 'resource_link';
  uri: string;
  name: string;
  description?: string | undefined;
  mimeType?: string | undefined;
};
export type ToolEmbeddedResourceContent = {
  type: 'resource';
  uri: string;
  mimeType?: string | undefined;
  text?: string | undefined;
  blob?: string | undefined;
};

export type ToolContentBlock =
  | ToolTextContent
  | ToolImageContent
  | ToolAudioContent
  | ToolResourceLinkContent
  | ToolEmbeddedResourceContent;

export type ToolCallResult = {
  content: ToolContentBlock[];
  structuredContent?: unknown;
  isError?: boolean | undefined;
};
```

- [ ] **Step 4: Add the shared Zod schemas and IPC channel**

In `src/shared/contracts/servers.ts`, insert immediately after the existing `promptSummarySchema` definition (before `catalogSchema`):

```ts
const toolTextContentSchema = z.object({ type: z.literal('text'), text: z.string() }).strict();
const toolImageContentSchema = z.object({
  type: z.literal('image'), data: z.string(), mimeType: z.string(),
}).strict();
const toolAudioContentSchema = z.object({
  type: z.literal('audio'), data: z.string(), mimeType: z.string(),
}).strict();
const toolResourceLinkContentSchema = z.object({
  type: z.literal('resource_link'),
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
}).strict();
const toolEmbeddedResourceContentSchema = z.object({
  type: z.literal('resource'),
  uri: z.string(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
}).strict();

const toolContentBlockSchema = z.discriminatedUnion('type', [
  toolTextContentSchema,
  toolImageContentSchema,
  toolAudioContentSchema,
  toolResourceLinkContentSchema,
  toolEmbeddedResourceContentSchema,
]);

export const toolCallResultSchema = z.object({
  content: z.array(toolContentBlockSchema),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
}).strict();

export const callToolRequestSchema = z.object({
  connectionId: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const callToolResponseSchema = toolCallResultSchema;
```

Add one new entry to the existing `serverChannels` object literal (insert after the `refresh` entry):

```ts
  callTool: 'servers:tool:call',
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- tests/shared/server-contracts.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/domain/servers.ts src/shared/contracts/servers.ts tests/shared/server-contracts.test.ts
git commit -m "feat: define tool-call contracts"
```

### Task 2: Main-Process Tool Calling

**Files:**
- Modify: `src/main/mcp/client/mcp-client-port.ts`
- Modify: `src/main/mcp/client/mcp-client-adapter.ts`
- Modify: `src/main/mcp/connections/connection-manager.ts`
- Test: `tests/main/mcp-client-adapter.test.ts`
- Test: `tests/main/connection-manager.test.ts`

**Interfaces:**
- Consumes: `ToolCallResult` (Task 1); the real SDK's `Client.callTool(params: { name, arguments? }): Promise<CallToolResult>`.
- Produces: `McpClientPort.callTool(name, args?)`, `McpClientAdapter.callTool(name, args?)`, `ConnectionManager.callTool(connectionId, name, args?)`.

- [ ] **Step 1: Write failing adapter tests**

Add to `tests/main/mcp-client-adapter.test.ts`, inside the existing `describe('McpClientAdapter', ...)` block, after the last existing `it(...)`:

```ts
  it('maps a successful tool call into the normalized result shape', async () => {
    const client = fakeSdkClient({
      callTool: vi.fn().mockResolvedValue({
        content: [
          { type: 'text', text: 'hi', annotations: { audience: ['user'] } },
          { type: 'resource_link', uri: 'file:///a.txt', name: 'a', extra: 'ignored' },
          { type: 'resource', resource: { uri: 'file:///b.txt', text: 'body' } },
        ],
        structuredContent: { count: 1 },
      }),
    });
    const deps: AdapterDependencies = { create: () => ({ client, transport: {} as never }) };
    const adapter = new McpClientAdapter({ id: 'p1', name: 'x', transport: 'stdio', command: 'node', args: [] }, deps);
    const result = await adapter.callTool('echo', { message: 'hi' });
    expect(client.callTool).toHaveBeenCalledWith({ name: 'echo', arguments: { message: 'hi' } });
    expect(result).toEqual({
      content: [
        { type: 'text', text: 'hi' },
        { type: 'resource_link', uri: 'file:///a.txt', name: 'a' },
        { type: 'resource', uri: 'file:///b.txt', text: 'body' },
      ],
      structuredContent: { count: 1 },
    });
  });

  it('passes through isError on a tool-level failure without throwing', async () => {
    const client = fakeSdkClient({
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'boom' }], isError: true }),
    });
    const deps: AdapterDependencies = { create: () => ({ client, transport: {} as never }) };
    const adapter = new McpClientAdapter({ id: 'p1', name: 'x', transport: 'stdio', command: 'node', args: [] }, deps);
    await expect(adapter.callTool('boom')).resolves.toEqual({
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    });
  });

  it('propagates a transport failure from callTool unchanged', async () => {
    const client = fakeSdkClient({ callTool: vi.fn().mockRejectedValue(new Error('disconnected')) });
    const deps: AdapterDependencies = { create: () => ({ client, transport: {} as never }) };
    const adapter = new McpClientAdapter({ id: 'p1', name: 'x', transport: 'stdio', command: 'node', args: [] }, deps);
    await expect(adapter.callTool('echo')).rejects.toThrow('disconnected');
  });
```

Add `callTool: vi.fn()` to the `fakeSdkClient()` helper's default object (the one defined near the top of the file — add it as one more property alongside the existing `listPrompts: async () => ({ prompts: [] }),` line, before the `...overrides,` spread).

Add `callTool: vi.fn()` to the two inline client object literals that do NOT use the `fakeSdkClient()` helper: the one in the `'normalizes negotiated metadata and catalog entries'` test, and the one in the `'terminates an HTTP session before closing the client'` test (each already has a `listPrompts: async () => ({ prompts: [] })` line — add `callTool: vi.fn(),` next to it in both places). This keeps every existing `SdkClientLike`-shaped fake structurally valid once `callTool` becomes part of that type.

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `npm test -- tests/main/mcp-client-adapter.test.ts`

Expected: FAIL — `adapter.callTool` does not exist, and/or a TypeScript error that `SdkClientLike`/the two inline literals are missing `callTool` once you add the type in Step 3 (if you add the type before adding the fakes, expect a type error instead of a runtime "not a function" error — either is an acceptable RED here).

- [ ] **Step 3: Extend the port and implement in the adapter**

In `src/main/mcp/client/mcp-client-port.ts`, add one import and one interface method. Update the domain import list to include `ToolCallResult`:

```ts
import type {
  PromptSummary,
  ResourceSummary,
  ResourceTemplateSummary,
  ServerProfile,
  ToolCallResult,
  ToolSummary,
} from '@/shared/domain/servers';
```

Add to the `McpClientPort` interface (after `listPrompts`, before the optional `finishAuthorization?`):

```ts
  callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult>;
```

In `src/main/mcp/client/mcp-client-adapter.ts`:

Update the domain import list to include `ToolCallResult` and `ToolContentBlock`:

```ts
import type {
  PromptSummary,
  ResourceSummary,
  ResourceTemplateSummary,
  ServerProfile,
  ToolCallResult,
  ToolContentBlock,
  ToolSummary,
} from '@/shared/domain/servers';
```

Add one field to the `SdkClientLike` type (after the existing `listPrompts` line):

```ts
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content: Array<
      | { type: 'text'; text: string; [key: string]: unknown }
      | { type: 'image'; data: string; mimeType: string; [key: string]: unknown }
      | { type: 'audio'; data: string; mimeType: string; [key: string]: unknown }
      | { type: 'resource_link'; uri: string; name: string; description?: string; mimeType?: string; [key: string]: unknown }
      | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string; blob?: string }; [key: string]: unknown }
    >;
    structuredContent?: unknown;
    isError?: boolean;
  }>;
```

Add a `callTool` method to the `McpClientAdapter` class (after `listPrompts`, before the closing brace of the class):

```ts
  async callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
    const result = await this.bundle.client.callTool({ name, arguments: args });
    return {
      content: result.content.map(mapContentBlock),
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
    };
  }
```

Add this function at the bottom of the file, alongside the existing `parseHttpUrl`/`mapSdkAuthError` helper functions:

```ts
function mapContentBlock(block: {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  name?: string;
  description?: string;
  resource?: { uri: string; mimeType?: string; text?: string; blob?: string };
}): ToolContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text ?? '' };
    case 'image':
      return { type: 'image', data: block.data ?? '', mimeType: block.mimeType ?? '' };
    case 'audio':
      return { type: 'audio', data: block.data ?? '', mimeType: block.mimeType ?? '' };
    case 'resource_link':
      return {
        type: 'resource_link',
        uri: block.uri ?? '',
        name: block.name ?? '',
        ...(block.description ? { description: block.description } : {}),
        ...(block.mimeType ? { mimeType: block.mimeType } : {}),
      };
    case 'resource':
      return {
        type: 'resource',
        uri: block.resource?.uri ?? '',
        ...(block.resource?.mimeType ? { mimeType: block.resource.mimeType } : {}),
        ...(block.resource?.text !== undefined ? { text: block.resource.text } : {}),
        ...(block.resource?.blob !== undefined ? { blob: block.resource.blob } : {}),
      };
    default:
      return { type: 'text', text: '' };
  }
}
```

- [ ] **Step 4: Run adapter tests and verify GREEN**

Run: `npm test -- tests/main/mcp-client-adapter.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing manager tests**

Add to `tests/main/connection-manager.test.ts`, inside the existing top-level `describe(...)` block (find one with existing `refresh`/`disconnect` tests — add these as new `it(...)` entries near the existing `'disconnects and refreshes only known ready connections'` test):

```ts
  it('calls a tool on a ready connection and returns the normalized result', async () => {
    const client = createClient();
    client.callTool = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'hi' }] });
    const manager = new ConnectionManager(createStore(), () => client);
    const started = await manager.connect('p1');
    await vi.waitFor(() => expect(manager.list()[0]?.state).toBe('ready'));
    const result = await manager.callTool(started.connectionId, 'echo', { message: 'hi' });
    expect(client.callTool).toHaveBeenCalledWith('echo', { message: 'hi' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }] });
  });

  it('rejects a tool call when the connection is not ready', async () => {
    const client = createClient();
    client.connect = vi.fn(() => new Promise(() => {})); // never resolves; connection stays 'connecting'/'initializing'
    const manager = new ConnectionManager(createStore(), () => client);
    const started = await manager.connect('p1');
    await expect(manager.callTool(started.connectionId, 'echo')).rejects.toThrow('Connection is not ready');
  });

  it('rejects a tool call for an unknown connection id', async () => {
    const manager = new ConnectionManager(createStore(), () => createClient());
    await expect(manager.callTool('missing', 'echo')).rejects.toThrow('Connection not found');
  });
```

Add `callTool: vi.fn()` to the `createClient()` helper's returned object (the shared `McpClientPort`-shaped fake near the top of the file — add it next to the existing `finishAuthorization: vi.fn(),` line). This is the only object literal in this file that constructs a full `McpClientPort`, so this one change keeps every existing test in the file structurally valid once `callTool` becomes part of the interface.

- [ ] **Step 6: Run manager tests and verify RED**

Run: `npm test -- tests/main/connection-manager.test.ts`

Expected: FAIL — `manager.callTool` does not exist.

- [ ] **Step 7: Implement `ConnectionManager.callTool`**

In `src/main/mcp/connections/connection-manager.ts`, add `ToolCallResult` to the existing domain type import list:

```ts
import type {
  AuthorizationSnapshot,
  AuthorizationStorage,
  ConnectionSnapshot,
  ConnectionState,
  ServerProfile,
  SignOutResult,
  ToolCallResult,
} from '@/shared/domain/servers';
```

Add a `callTool` method to the `ConnectionManager` class (after `refresh`, before `reopenAuthorization`):

```ts
  async callTool(connectionId: string, name: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
    const session = this.requireSession(connectionId);
    if (session.snapshot.state !== 'ready') throw new Error('Connection is not ready');
    return session.client.callTool(name, args);
  }
```

Add `callTool: () => Promise.reject(new Error('Connection not initialized yet')),` to the `INERT_CLIENT` object literal (next to the existing `finishAuthorization` line) — this placeholder must satisfy the full `McpClientPort` interface once `callTool` is added to it.

- [ ] **Step 8: Run the task suite and typecheck**

Run: `npm test -- tests/main/mcp-client-adapter.test.ts tests/main/connection-manager.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/mcp tests/main/mcp-client-adapter.test.ts tests/main/connection-manager.test.ts
git commit -m "feat: call MCP tools from the connection manager"
```

### Task 3: IPC And Preload Wiring

**Files:**
- Modify: `src/main/ipc/register-server-ipc.ts`
- Modify: `src/preload/api.ts`
- Test: `tests/main/server-ipc.test.ts`

**Interfaces:**
- Consumes: `ToolCallResult`, `callToolRequestSchema`, `callToolResponseSchema`, `serverChannels.callTool` (Task 1); `ConnectionManager.callTool` (Task 2).
- Produces: `MCPDevBenchApi.callTool(connectionId, name, args?)`.

- [ ] **Step 1: Write failing IPC tests**

`tests/main/server-ipc.test.ts` already has a shared `createConnections()` helper (returns a fake `ConnectionService`), a `storeStub()` helper, and captures registered IPC handlers via a hoisted `electron.handlers` map (`electron.handlers.get(serverChannels.X)`). Add `callTool: vi.fn(async () => ({ content: [] }))` to the object `createConnections()` returns (alongside the existing `signOut: vi.fn(...)` line), so every existing test using this helper keeps working once `callTool` becomes part of the fake's shape.

The existing first test in the file (`'registers commands, validates save input, and returns parsed output'`) asserts an exact handler count: `expect(electron.handlers.size).toBe(10);` — update this to `11` once the new handler is registered in Step 3, or this existing test will fail for an unrelated reason.

Add two new tests inside the existing `describe('reopenAuthorization / cancelAuthorization / signOut IPC handlers', ...)` block (rename it to also mention `callTool`, or add a new adjacent `describe('callTool IPC handler', ...)` block — either is fine, match whichever reads better once you're editing the file):

```ts
  it('validates and forwards a callTool request, and parses the response', async () => {
    const connections = createConnections();
    connections.callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'hi' }] }));
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    const result = await electron.handlers.get(serverChannels.callTool)?.(
      {}, { connectionId: 'c1', name: 'echo', arguments: { message: 'hi' } },
    );
    expect(connections.callTool).toHaveBeenCalledWith('c1', 'echo', { message: 'hi' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }] });
  });

  it('rejects a malformed callTool request before it reaches the connection manager', async () => {
    const connections = createConnections();
    registerServerIpc({ store: storeStub(), connections, webContents: { getAllWebContents: () => [] } });
    await expect(electron.handlers.get(serverChannels.callTool)?.({}, { connectionId: '', name: 'echo' })).rejects.toThrow();
    expect(connections.callTool).not.toHaveBeenCalled();
  });
```

Add one more test inside the existing `describe('preload server API', ...)` block, alongside the existing `'parses reopenAuthorization/cancelAuthorization/signOut responses...'` test:

```ts
  it('parses a callTool response before returning it', async () => {
    const api = createMcpDevBenchApi();
    electron.invoke.mockResolvedValueOnce({ content: [{ type: 'text', text: 'hi' }] });
    await expect(api.callTool('c1', 'echo', { message: 'hi' })).resolves.toEqual({ content: [{ type: 'text', text: 'hi' }] });
    expect(electron.invoke).toHaveBeenCalledWith(serverChannels.callTool, { connectionId: 'c1', name: 'echo', arguments: { message: 'hi' } });
  });
```

- [ ] **Step 2: Run IPC tests and verify RED**

Run: `npm test -- tests/main/server-ipc.test.ts`

Expected: FAIL — `serverChannels.callTool` handler is not registered.

- [ ] **Step 3: Add the IPC handler**

In `src/main/ipc/register-server-ipc.ts`, add to the contracts import list:

```ts
  callToolRequestSchema,
  callToolResponseSchema,
```

Add `ToolCallResult` to the domain type import list. Add a `callTool` method to the `ConnectionService` type (after `refresh`):

```ts
  callTool(connectionId: string, name: string, args?: Record<string, unknown>): Promise<ToolCallResult>;
```

Add a handler inside `registerServerIpc` (after the existing `serverChannels.refresh` handler, before `serverChannels.reopenAuthorization`):

```ts
  ipcMain.handle(serverChannels.callTool, async (_event, value: unknown) => {
    const { connectionId, name, arguments: toolArguments } = callToolRequestSchema.parse(value);
    return callToolResponseSchema.parse(await connections.callTool(connectionId, name, toolArguments));
  });
```

- [ ] **Step 4: Run IPC tests and verify GREEN**

Run: `npm test -- tests/main/server-ipc.test.ts`

Expected: PASS.

- [ ] **Step 5: Add the preload method**

In `src/preload/api.ts`, add to the contracts import list:

```ts
  callToolResponseSchema,
```

Add `ToolCallResult` to the domain type import list. Add to the `MCPDevBenchApi` type (after `refresh`):

```ts
  callTool(connectionId: string, name: string, args?: Record<string, unknown>): Promise<ToolCallResult>;
```

Add to the `createMcpDevBenchApi()` object literal (after the existing `refresh` entry):

```ts
  callTool: async (connectionId, name, args) =>
    callToolResponseSchema.parse(await ipcRenderer.invoke(serverChannels.callTool, { connectionId, name, arguments: args })),
```

- [ ] **Step 6: Run the task suite and typecheck**

Run: `npm test -- tests/main/server-ipc.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/register-server-ipc.ts src/preload/api.ts tests/main/server-ipc.test.ts
git commit -m "feat: expose tool calling through IPC"
```

### Task 4: Renderer Wiring — Route, Workspace, Row Action

**Files:**
- Modify: `src/renderer/app/router.ts`
- Modify: `src/renderer/features/servers/use-server-workspace.ts`
- Modify: `src/renderer/components/domain/ServerTable.vue`
- Modify: `src/renderer/features/servers/ServerDashboard.vue`
- Modify: `tests/setup/renderer.ts`
- Test: `tests/renderer/ServerTable.test.ts`

**Interfaces:**
- Consumes: `window.mcpdevbench.callTool` (Task 3).
- Produces: `useServerWorkspace().callTool(connectionId, name, args?)`, `ServerTable`'s `view` emit, route `/servers/:profileId` with a `profileId` prop.

This task wires navigation and the data path; Task 5 builds the page the route points to (`InspectorView`/`ServerInspector`, referenced here by import path only).

- [ ] **Step 1: Add `callTool` to the shared renderer test mock**

In `tests/setup/renderer.ts`, add every currently-missing `window.mcpdevbench` method so future test files never need to patch it per-test again — replace the whole `value: { ... }` object with:

```ts
  value: {
    getHealth: vi.fn().mockResolvedValue({
      status: 'ready',
      app: 'MCPDevBench',
    }),
    listProfiles: vi.fn().mockResolvedValue([]),
    saveProfile: vi.fn(),
    deleteProfile: vi.fn(),
    listConnections: vi.fn().mockResolvedValue([]),
    connect: vi.fn(),
    disconnect: vi.fn(),
    refresh: vi.fn(),
    reopenAuthorization: vi.fn(),
    cancelAuthorization: vi.fn(),
    signOut: vi.fn(),
    callTool: vi.fn(),
    onConnectionsChanged: vi.fn().mockReturnValue(vi.fn()),
  },
```

- [ ] **Step 2: Write a failing test for the new row action**

Add to `tests/renderer/ServerTable.test.ts`, inside the existing `describe('ServerTable', ...)` block (the first one, with the plain `servers` array — not the OAuth-controls block):

```ts
  it('shows a View action only for connected servers and emits the profile id', async () => {
    const wrapper = mount(ServerTable, { props: { servers } });
    expect(wrapper.get('button[aria-label="View TVEyes Local"]').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="View Search MCP"]').exists()).toBe(false);
    await wrapper.get('button[aria-label="View TVEyes Local"]').trigger('click');
    expect(wrapper.emitted('view')).toEqual([['tveyes']]);
  });
```

- [ ] **Step 3: Run the test and verify RED**

Run: `npm test -- tests/renderer/ServerTable.test.ts`

Expected: FAIL — no `view` emit, no "View" button.

- [ ] **Step 4: Add `callTool` to the workspace composable**

In `src/renderer/features/servers/use-server-workspace.ts`, add a function alongside the existing `reopenAuthorization`/`cancelAuthorization`/`signOut` functions:

```ts
  const callTool = (connectionId: string, name: string, args?: Record<string, unknown>) =>
    window.mcpdevbench.callTool(connectionId, name, args);
```

Add `callTool` to the returned object (in the final `return { ... }` statement, alongside `reopenAuthorization, cancelAuthorization, signOut,`).

- [ ] **Step 5: Add the View action to `ServerTable.vue`**

Add `Eye` to the existing `@lucide/vue` import line (alphabetically among `ExternalLink, LogOut, Plug, RefreshCw, Trash2, Unplug, X`).

Add `view: [profileId: string];` to the `defineEmits<{ ... }>()` type (alongside the existing `refresh`/`delete` entries).

Add a new button inside the existing `<template v-if="server.connectionId && server.state === 'connected'">` block, as the FIRST button inside that template (before the existing Refresh button):

```html
              <Button size="icon-sm" variant="ghost" :aria-label="`View ${server.name}`" @click="$emit('view', server.id)"><Eye /></Button>
```

- [ ] **Step 6: Run the test and verify GREEN**

Run: `npm test -- tests/renderer/ServerTable.test.ts`

Expected: PASS. Also re-run the full renderer suite once (`npm test -- tests/renderer`) to confirm the OAuth-controls block's slot-count tests (which use different, non-`connected` states) are unaffected.

- [ ] **Step 7: Wire navigation in `ServerDashboard.vue`**

Add an import: `import { useRouter } from 'vue-router';`

Add, alongside the existing `const addOpen = ref(false);` declarations: `const router = useRouter();`

Add a handler function alongside the existing `save`/`run` functions:

```ts
function viewServer(profileId: string): void {
  void router.push(`/servers/${profileId}`);
}
```

Add `@view="viewServer"` to the existing `<ServerTable ... />` element in the template, alongside its other event bindings (`@connect`, `@disconnect`, etc.).

- [ ] **Step 8: Add the route**

In `src/renderer/app/router.ts`, add an import for the not-yet-created view (this makes the file temporarily fail to build until Task 5 creates it — that's expected and resolved by the very next task; do not skip creating the route entry now, since Task 5's own tests depend on it existing):

```ts
import InspectorView from '@/renderer/features/inspector/InspectorView.vue';
```

Add a second entry to the `routes` array:

```ts
    { path: '/servers/:profileId', component: InspectorView, props: true },
```

- [ ] **Step 9: Run typecheck**

Run: `npm run typecheck`

Expected: FAIL at this point, specifically because `@/renderer/features/inspector/InspectorView.vue` does not exist yet — this is expected; Task 5 creates it immediately next. Do not attempt to make this pass within this task.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/app/router.ts src/renderer/features/servers/use-server-workspace.ts src/renderer/components/domain/ServerTable.vue src/renderer/features/servers/ServerDashboard.vue tests/setup/renderer.ts tests/renderer/ServerTable.test.ts
git commit -m "feat: add server inspector navigation"
```

### Task 5: Server Inspector Page

**Files:**
- Create: `src/renderer/features/inspector/InspectorView.vue`
- Create: `src/renderer/features/inspector/ServerInspector.vue`
- Test: `tests/renderer/ServerInspector.test.ts`

**Interfaces:**
- Consumes: `useServerWorkspace()` (Task 4's `callTool`, plus existing `profiles`/`connections`), `ToolCallResult`/`ToolSummary` (Task 1), the `/servers/:profileId` route (Task 4).
- Produces: the actual inspector UI the route in Task 4 renders.

- [ ] **Step 1: Write failing tests**

Create `tests/renderer/ServerInspector.test.ts`:

```ts
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ServerInspector from '@/renderer/features/inspector/ServerInspector.vue';
import type { ConnectionSnapshot, ServerProfile } from '@/shared/domain/servers';

const profile: ServerProfile = { id: 'p1', name: 'Fixture Server', transport: 'stdio', command: 'node', args: [] };
const readyConnection: ConnectionSnapshot = {
  connectionId: 'c1',
  profileId: 'p1',
  state: 'ready',
  tools: {
    status: 'ready',
    items: [
      { name: 'echo', description: 'Echo a message', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } },
    ],
  },
  resources: { status: 'unsupported', items: [] },
  resourceTemplates: { status: 'unsupported', items: [] },
  prompts: { status: 'unsupported', items: [] },
};

async function mountInspector() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] });
  const wrapper = mount(ServerInspector, { props: { profileId: 'p1' }, global: { plugins: [router] } });
  await flushPromises();
  return wrapper;
}

describe('ServerInspector', () => {
  beforeEach(() => {
    vi.mocked(window.mcpdevbench.listProfiles).mockResolvedValue([profile]);
    vi.mocked(window.mcpdevbench.listConnections).mockResolvedValue([readyConnection]);
  });

  it('shows a connect-first state when the server is not connected', async () => {
    vi.mocked(window.mcpdevbench.listConnections).mockResolvedValue([]);
    const wrapper = await mountInspector();
    expect(wrapper.text()).toContain('Connect this server to see and call its tools.');
  });

  it('lists the discovered tools for a ready connection', async () => {
    const wrapper = await mountInspector();
    expect(wrapper.text()).toContain('echo');
    expect(wrapper.text()).toContain('Echo a message');
  });

  it('shows a JSON parse error inline without calling the tool', async () => {
    const wrapper = await mountInspector();
    await wrapper.get('button').trigger('click'); // selects the only listed tool
    await wrapper.get('textarea').setValue('{not json');
    await wrapper.get('button:not([aria-label])').trigger('click'); // the Call button has no aria-label; matches by exclusion is fragile -- see note below
    expect(window.mcpdevbench.callTool).not.toHaveBeenCalled();
  });

  it('calls the tool with parsed arguments and renders a text result', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({ content: [{ type: 'text', text: 'hello back' }] });
    const wrapper = await mountInspector();
    await wrapper.get('button').trigger('click');
    await wrapper.get('textarea').setValue('{"message":"hi"}');
    await wrapper.get('button[type="button"]:last-of-type').trigger('click');
    await flushPromises();
    expect(window.mcpdevbench.callTool).toHaveBeenCalledWith('c1', 'echo', { message: 'hi' });
    expect(wrapper.text()).toContain('hello back');
  });

  it('renders isError results as data, not as an application error', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockResolvedValue({ content: [{ type: 'text', text: 'bad input' }], isError: true });
    const wrapper = await mountInspector();
    await wrapper.get('button').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('button[type="button"]:last-of-type').trigger('click');
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('bad input');
    expect(wrapper.text()).toContain('Tool reported an error');
  });

  it('shows a sanitized error banner when the call itself fails', async () => {
    vi.mocked(window.mcpdevbench.callTool).mockRejectedValue(new Error('ECONNRESET raw transport detail'));
    const wrapper = await mountInspector();
    await wrapper.get('button').trigger('click');
    await wrapper.get('textarea').setValue('{}');
    await wrapper.get('button[type="button"]:last-of-type').trigger('click');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).not.toContain('ECONNRESET');
  });
});
```

The tool-selection and Call-button selectors above (`wrapper.get('button')` for the first tool row, `'button[type="button"]:last-of-type'` for Call) are deliberately loose because the exact DOM has not been written yet. Once you write `ServerInspector.vue` in Step 3, come back and tighten every selector in this test file to something explicit and unambiguous (e.g. give the Call button `aria-label="Call echo"` or a `data-testid="call-tool"`, and give each tool-list button a `data-testid` derived from the tool name) — do not leave the loose selectors above in the committed version of this test file. This is expected, ordinary test-writing iteration, not a deviation from TDD: write the loose version to get RED for the right reason, then firm up selectors alongside the GREEN implementation so the final committed test is unambiguous.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/renderer/ServerInspector.test.ts`

Expected: FAIL — the component does not exist yet.

- [ ] **Step 3: Implement `InspectorView.vue`**

Create `src/renderer/features/inspector/InspectorView.vue`:

```vue
<script setup lang="ts">
import ServerInspector from '@/renderer/features/inspector/ServerInspector.vue';

defineProps<{ profileId: string }>();
</script>

<template>
  <ServerInspector :profile-id="profileId" />
</template>
```

- [ ] **Step 4: Implement `ServerInspector.vue`**

Create `src/renderer/features/inspector/ServerInspector.vue`:

```vue
<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowLeft } from '@lucide/vue';
import { Button } from '@/renderer/components/ui/button';
import { useServerWorkspace } from '@/renderer/features/servers/use-server-workspace';
import type { ToolCallResult, ToolSummary } from '@/shared/domain/servers';

const props = defineProps<{ profileId: string }>();
const workspace = useServerWorkspace();

const profile = computed(() => workspace.profiles.value.find((item) => item.id === props.profileId));
const connection = computed(() => workspace.connections.value.find((item) => item.profileId === props.profileId));
const tools = computed<ToolSummary[]>(() =>
  connection.value?.tools.status === 'ready' ? connection.value.tools.items : []);

const selectedTool = ref<ToolSummary>();
const argumentsText = ref('{}');
const argumentsError = ref<string>();
const callPending = ref(false);
const callError = ref<string>();
const result = ref<ToolCallResult>();

function selectTool(tool: ToolSummary): void {
  selectedTool.value = tool;
  argumentsText.value = '{}';
  argumentsError.value = undefined;
  callError.value = undefined;
  result.value = undefined;
}

async function callTool(): Promise<void> {
  const tool = selectedTool.value;
  const connectionId = connection.value?.connectionId;
  if (!tool || !connectionId) return;
  argumentsError.value = undefined;
  callError.value = undefined;

  let parsedArguments: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(argumentsText.value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Arguments must be a JSON object');
    }
    parsedArguments = parsed as Record<string, unknown>;
  } catch (error) {
    argumentsError.value = error instanceof Error ? error.message : 'Invalid JSON';
    return;
  }

  callPending.value = true;
  result.value = undefined;
  try {
    result.value = await workspace.callTool(connectionId, tool.name, parsedArguments);
  } catch {
    callError.value = 'Unable to call the tool';
  } finally {
    callPending.value = false;
  }
}
</script>

<template>
  <section class="mx-auto w-full max-w-7xl px-6 py-6 lg:px-8">
    <RouterLink to="/" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" aria-hidden="true" /> Back to servers
    </RouterLink>
    <h2 class="mt-3 text-2xl font-semibold">{{ profile?.name ?? 'Server' }}</h2>

    <div
      v-if="connection?.state !== 'ready'"
      class="mt-6 border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground"
    >
      Connect this server to see and call its tools.
    </div>
    <div v-else class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      <div class="border border-border bg-card">
        <ul>
          <li v-for="tool in tools" :key="tool.name">
            <button
              type="button"
              :data-testid="`tool-${tool.name}`"
              class="w-full border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-muted/60"
              :class="selectedTool?.name === tool.name && 'bg-muted'"
              @click="selectTool(tool)"
            >
              <div class="font-mono text-sm font-medium">{{ tool.name }}</div>
              <div v-if="tool.description" class="mt-1 text-xs text-muted-foreground">{{ tool.description }}</div>
            </button>
          </li>
        </ul>
        <p v-if="tools.length === 0" class="px-4 py-6 text-center text-sm text-muted-foreground">
          This server has no tools.
        </p>
      </div>

      <div v-if="selectedTool" class="border border-border bg-card p-4">
        <h3 class="font-mono text-sm font-medium">{{ selectedTool.name }}</h3>
        <details class="mt-2 text-xs text-muted-foreground">
          <summary class="cursor-pointer">Input schema</summary>
          <pre class="mt-2 overflow-auto">{{ JSON.stringify(selectedTool.inputSchema, null, 2) }}</pre>
        </details>

        <label class="mt-4 block text-xs font-medium uppercase text-muted-foreground" :for="`args-${selectedTool.name}`">
          Arguments (JSON)
        </label>
        <textarea
          :id="`args-${selectedTool.name}`"
          v-model="argumentsText"
          rows="6"
          class="mt-1 w-full border border-border bg-background p-2 font-mono text-xs"
        />
        <p v-if="argumentsError" class="mt-1 text-xs text-destructive">{{ argumentsError }}</p>

        <Button class="mt-3" data-testid="call-tool" :disabled="callPending" @click="callTool">
          {{ callPending ? 'Calling…' : 'Call' }}
        </Button>

        <p v-if="callError" role="alert" class="mt-3 text-sm text-destructive">{{ callError }}</p>

        <div v-if="result" class="mt-4 border-t border-border pt-4">
          <p v-if="result.isError" class="mb-2 text-xs font-medium text-warning">Tool reported an error</p>
          <div v-for="(block, index) in result.content" :key="index" class="mb-2 text-sm">
            <p v-if="block.type === 'text'" class="whitespace-pre-wrap">{{ block.text }}</p>
            <pre v-else class="overflow-auto text-xs">{{ JSON.stringify(block, null, 2) }}</pre>
          </div>
          <details v-if="result.structuredContent !== undefined" class="mt-2 text-xs text-muted-foreground">
            <summary class="cursor-pointer">Structured content</summary>
            <pre class="mt-2 overflow-auto">{{ JSON.stringify(result.structuredContent, null, 2) }}</pre>
          </details>
        </div>
      </div>
      <div v-else class="flex items-center justify-center border border-dashed border-border p-6 text-sm text-muted-foreground">
        Select a tool to call it.
      </div>
    </div>
  </section>
</template>
```

- [ ] **Step 5: Tighten the test file's selectors**

Go back to `tests/renderer/ServerInspector.test.ts` and replace the loose selectors from Step 1 with the concrete `data-testid`s now in the template: `wrapper.get('[data-testid="tool-echo"]')` for selecting the tool, `wrapper.get('[data-testid="call-tool"]')` for the Call button.

- [ ] **Step 6: Run the tests and verify GREEN**

Run: `npm test -- tests/renderer/ServerInspector.test.ts && npm run typecheck`

Expected: PASS. Typecheck must now be clean overall (Task 4's route import resolves).

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS, every existing test file unaffected.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/features/inspector tests/renderer/ServerInspector.test.ts
git commit -m "feat: add the server inspector page"
```

### Task 6: End-To-End Verification

**Files:**
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: the complete stack from Tasks 1-5, and the existing `tests/fixtures/mcp/catalog-server.mjs` STDIO fixture, which already registers an `echo` tool taking `{ message: string }` and echoing it back as a text content block — read the fixture file directly to confirm this before writing Step 2.

- [ ] **Step 1: Read the existing STDIO E2E test**

Read `tests/e2e/app.spec.ts`'s first test (`'discovers a real STDIO server and preserves its profile across restart'`) in full before writing anything — you are extending this exact flow, reusing its existing `userDataDir`/`launch`/`row` setup, not writing a new, separate test from scratch.

- [ ] **Step 2: Write the failing E2E extension**

Insert new steps into the existing first test, immediately after the existing `await expect(row).toContainText('Connected');` assertion that follows the Connect click (before the `Refresh` step), matching the file's existing style exactly:

```ts
    await row.getByRole('button', { name: 'View Catalog Fixture' }).click();
    await expect(page.getByRole('heading', { name: 'Catalog Fixture' })).toBeVisible();
    await page.getByTestId('tool-echo').click();
    await page.locator('textarea').fill('{"message":"hello from the inspector"}');
    await page.getByTestId('call-tool').click();
    await expect(page.getByText('hello from the inspector')).toBeVisible();
    await page.getByRole('link', { name: 'Back to servers' }).click();
    await expect(page.getByRole('heading', { name: 'Servers' })).toBeVisible();
```

- [ ] **Step 3: Run the E2E test and verify RED**

Run: `npm run test:e2e -- --grep "discovers a real STDIO server"`

Expected: FAIL until `npm run package`/the Vite build picks up Tasks 1-5's changes — if this fails only because the built `.vite/build/main.js`/renderer bundle is stale, rebuild first (`npm run package`) and re-run; the test itself should genuinely fail before Tasks 1-5 exist, and pass once they're built and packaged.

- [ ] **Step 4: Run the full verification suite**

Run: `npm test && npm run typecheck && npm run package && npm run test:e2e`

Expected: all four commands PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/app.spec.ts
git commit -m "test: verify the server inspector end to end"
```
