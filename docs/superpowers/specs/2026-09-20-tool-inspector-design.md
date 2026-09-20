# MCPDevBench Tool Inspector Design

Status: Proposed for implementation

Date: 2026-09-20

## 1. Objective

Let a developer see and actually call the tools a connected MCP server exposes, without leaving
MCPDevBench. Today a connected server's row shows only a tool count; there is no way to see what a
tool does, what arguments it expects, or what it returns. This slice adds a dedicated inspector
page per server profile that lists its discovered tools, lets the user type JSON arguments for one
and call it, and shows the real result returned by the server.

This is the tools-only first slice of a broader Inspector. Resources (read on demand) and prompts
(fill arguments, preview generated messages) are deferred to a fast-follow slice once this one is
built and reviewed — they share most of this slice's UI shape (list + detail + invoke) and IPC
pattern, so building tools well first makes the other two cheap.

## 2. User Workflow

1. A server row that is `connected` shows a new **View** action alongside its existing actions.
2. Clicking it navigates to `/servers/:profileId`, a dedicated page for that server profile.
3. The page lists every tool discovered for the active connection (name, description, and its
   JSON Schema input shape shown for reference).
4. Selecting a tool opens a call form: a JSON textarea for the arguments (pre-populated with an
   empty object), and a **Call** button.
5. Calling a tool sends the typed arguments to the real MCP server and shows the result: content
   blocks (text rendered directly; anything else pretty-printed as JSON) and, if present,
   structured content.
6. A tool that runs and reports `isError: true` is not a failure — its content renders normally,
   with a visual flag (not a blocking error state), since that is real output from the server.
7. A tool call that never reaches the server (disconnected mid-call, transport error, malformed
   JSON caught before sending) shows a distinct, sanitized error banner instead of a result.
8. Visiting the page for a profile that is not currently connected shows a "Connect first" state
   instead of an empty or broken tool list.
9. There is no confirmation step before calling a tool. MCPDevBench is a developer tool used by
   someone who deliberately connected to a server to exercise it; MCP tool metadata does not
   reliably distinguish read from write operations, so a confirmation would add friction without
   real protection.

STDIO and Streamable HTTP (public or OAuth-protected) profiles behave identically here — the
inspector only needs an active, `ready` connection; it has no transport- or auth-specific logic of
its own.

## 3. Scope

Tools only, in this slice. No resource reading, no prompt execution, no tool-call history
persisted across navigations or restarts (the result panel holds only the most recent call for the
currently selected tool; navigating away clears it). No auto-generated form fields from JSON
Schema — arguments are entered as raw JSON, validated against basic JSON syntax client-side before
the call is made. No cancellation of an in-flight call and no MCPDevBench-side timeout beyond
whatever the transport already enforces.

## 4. Shared Domain Model

New types in `src/shared/domain/servers.ts`, normalized from the MCP SDK's real
`CallToolResult`/`ContentBlock` shapes the same way `ToolSummary`/`ResourceSummary` already
normalize their SDK counterparts — the renderer never receives an SDK type directly.

```ts
type ToolTextContent = { type: 'text'; text: string };
type ToolImageContent = { type: 'image'; data: string; mimeType: string };
type ToolAudioContent = { type: 'audio'; data: string; mimeType: string };
type ToolResourceLinkContent = { type: 'resource_link'; uri: string; name: string; mimeType?: string };
type ToolEmbeddedResourceContent = { type: 'resource'; uri: string; mimeType?: string; text?: string };

type ToolContentBlock =
  | ToolTextContent
  | ToolImageContent
  | ToolAudioContent
  | ToolResourceLinkContent
  | ToolEmbeddedResourceContent;

type ToolCallResult = {
  content: ToolContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
};
```

`structuredContent` is `unknown` and passed through as opaque JSON — MCPDevBench does not
interpret it, only displays it pretty-printed, matching how tool `inputSchema`/`outputSchema`
already cross the boundary as `unknown` today.

## 5. Main-Process Architecture

### MCP Client Adapter

`McpClientPort` gains one method:

```ts
callTool(name: string, args: unknown): Promise<ToolCallResult>;
```

`McpClientAdapter` is the only place that calls the SDK's `Client.callTool({ name, arguments: args })`
and maps its real `CallToolResult` into the normalized `ToolCallResult` shape above. A transport or
protocol-level failure (the call never completing) propagates as a thrown error; a tool that ran
and returned `isError: true` is a normal, successful `ToolCallResult` — the `isError` flag is data,
not an exception.

### Connection Manager

```ts
callTool(connectionId: string, name: string, args: unknown): Promise<ToolCallResult>;
```

Requires the session to be `ready`, the same guard `refresh()` already uses; throws a plain,
sanitized error otherwise (a connection that isn't ready has no tools available to call). Does not
otherwise touch the connection's lifecycle state — a tool call is a side operation on an existing
ready session, not a state transition.

No new "get one connection" read path is added: the renderer already holds the full live
connection list (`listConnections`/`onConnectionsChanged`), and the inspector page derives its
server's connection by filtering that existing reactive state for the matching `profileId`.

## 6. IPC And Preload API

One new channel, following the exact existing pattern (validate the request in main, validate the
response in preload, no generic invoke passthrough):

```ts
callTool(connectionId: string, name: string, args: unknown): Promise<ToolCallResult>;
```

The request schema validates `connectionId`/`name` as non-empty strings and `args` as
`z.unknown()` (the tool's own JSON Schema is the real validation authority; MCPDevBench does not
duplicate it). The response schema validates the full `ToolCallResult` shape, `.strict()` on every
object level, matching every other contract in `src/shared/contracts/servers.ts`.

## 7. Renderer Experience

A new route `/servers/:profileId` (vue-router; today's app has exactly one route, so this is the
first per-item route) renders `src/renderer/features/inspector/ServerInspector.vue`. Layout: a
tool list on one side (name, description, a collapsed/expandable view of its input schema for
reference) and, once a tool is selected, a call form (JSON textarea, pre-populated `{}`) plus a
result panel on the other side. Reuses existing UI primitives (`Table`, `Button`, existing text
styles) — no new dependency.

`ServerTable.vue` gains one new icon-button action, visible only when `server.state === 'connected'`
(an "eye"/"view" icon, `aria-label="View {name}"`), navigating to the route. The existing
Connect/Refresh/Disconnect/Delete/OAuth actions are unaffected.

Client-side JSON validation happens before the IPC call: a syntax error in the textarea is shown
inline immediately, without a round trip. A call-level failure (thrown error) renders a sanitized
error banner distinct from a normal `isError: true` result, which renders its content normally
with a visual (not blocking) flag. A profile with no active `ready` connection shows a "Connect
first" empty state instead of attempting to list tools.

## 8. Error Behavior

- Navigating to the inspector for a disconnected/never-connected profile: friendly empty state, no
  IPC call attempted.
- Malformed JSON in the arguments textarea: caught and shown inline before any IPC call.
- A tool call that throws (disconnect mid-call, transport error): sanitized error banner; the
  underlying error message is never surfaced raw to the renderer (same sanitization discipline as
  every other main-process error already crossing IPC in this app).
- A tool call that resolves with `isError: true`: not an error state in the UI — its content
  renders normally with a visual flag, since it is real, useful protocol-level output.

## 9. Testing

Unit tests: `McpClientAdapter.callTool` (real result mapping, transport-failure propagation),
`ConnectionManager.callTool` (ready-guard, not-ready rejection). IPC/preload tests following the
existing `register-server-ipc.test.ts`/preload pattern (request/response schema validation, no
unvalidated passthrough). Renderer tests for `ServerInspector.vue` (tool list rendering, JSON
validation, success rendering including `isError: true`, call-failure rendering, disconnected empty
state) and the new `ServerTable.vue` action button (visibility only when connected).

Electron E2E: extend the existing STDIO fixture test (`tests/e2e/app.spec.ts`) to navigate to the
connected fixture's inspector page and call its real `echo` tool, asserting the actual returned
text — cheap, real, end-to-end coverage of the whole new path using a fixture that already exists.

## 10. Completion Criteria

- A connected server's discovered tools are listed with name, description, and input schema.
- A tool can be called with user-supplied JSON arguments and its real result is shown.
- `isError: true` results render as data, not as an application error.
- A call-level failure (transport/disconnect) is sanitized and visually distinct from a tool-level
  error result.
- STDIO and Streamable HTTP (public and OAuth-protected) connections behave identically.
- A disconnected profile's inspector page shows a clear empty state rather than an error.
- Unit, IPC, renderer, and Electron E2E verification pass; `npm run typecheck` is clean.

## 11. Deferred Work

- Resources (read on demand) and prompts (argument fill + generated-message preview) — the planned
  fast-follow slices.
- Auto-generated form fields derived from a tool's JSON Schema (raw JSON textarea only, this
  slice).
- Tool-call history persisted across navigation or application restart.
- Cancellation of an in-flight tool call, or an MCPDevBench-specific call timeout.
- Rendering image/audio content blocks as actual media (shown as pretty-printed JSON with their
  base64 payload in this slice, not decoded/displayed inline).
- A confirmation step before calling a tool.
