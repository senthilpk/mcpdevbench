# MCPDevBench v0.1 Design

Status: Proposed for implementation

Date: 2026-09-18

## 1. Objective

MCPDevBench v0.1 is a local-first desktop application that acts as a real MCP client. It helps a developer connect to an MCP server, inspect the server's declared capabilities, run tools, observe protocol traffic, diagnose connection failures, and preserve successful interactions as regression tests.

The release is optimized for two outcomes:

- Time from "the server does not work" to a specific diagnosis is under five minutes.
- Time from a local MCP server to a working Claude or Codex configuration is under ten minutes.

## 2. Release Contract

Version 0.1 succeeds when a developer can:

1. Connect to an MCP server over STDIO or Streamable HTTP.
2. Observe MCP initialization and protocol negotiation.
3. Inspect the server identity, instructions, capabilities, tools, resources, resource templates, and prompts.
4. Execute a tool and inspect its result.
5. View an ordered, redacted trace of the connection and tool call.
6. Diagnose which connection layer failed and receive an actionable recommendation.
7. Save a successful tool interaction as a deterministic regression test.
8. Run saved tests after restarting the application.
9. Generate setup configuration and verification steps for Claude and Codex.

Basic demo recording is excluded from v0.1. OAuth authorization flows, Client-Initiated Metadata Discovery emulation, tunnels, AI evaluations, and broad client compatibility testing remain later work.

## 3. Technology Decisions

The application uses:

- Electron Forge for development, packaging, installers, signing, and publishing.
- Electron Forge's Vite TypeScript template, with pinned toolchain versions.
- TypeScript in the main, preload, renderer, and shared packages.
- Vue 3 using the Composition API and `<script setup>`.
- Vue Router for feature navigation.
- Pinia only for renderer-owned presentation state.
- The official MCP TypeScript client SDK for protocol and transport behavior.
- SQLite for structured local persistence.
- Electron `safeStorage` for secrets.
- Vitest for unit and integration tests.
- Playwright's Electron support for critical end-to-end workflows.
- npm as the initial package manager.

Electron Forge's Vite plugin is currently marked experimental. Forge and plugin versions must therefore be pinned, with upgrades made deliberately and verified by package and smoke tests.

## 4. Process Architecture

```text
Vue renderer
  Views, forms, navigation, presentation state
              |
       typed preload API
              |
Electron main process
  IPC validation
  Connection manager
  MCP client sessions
  Discovery service
  Tool runner
  Trace collector
  Connection Doctor
  Test runner
  Client configuration generator
  Persistence and secrets
              |
      MCP TypeScript SDK
        /             \
     STDIO       Streamable HTTP
```

All MCP and operating-system authority resides in the main process. The Vue renderer never receives an MCP SDK client, transport, child-process handle, raw secret, or unrestricted filesystem capability.

Electron windows use:

```text
contextIsolation: true
nodeIntegration: false
sandbox: true
```

The preload layer exposes a small typed command and event API. Every renderer request is validated at runtime in the main process. Responses use application-owned data-transfer types rather than SDK types.

## 5. Source Boundaries

```text
src/
  main/
    app/              Electron lifecycle and window creation
    ipc/              Runtime-validated command and query handlers
    mcp/
      connections/    Session lifecycle and transport selection
      discovery/      Capability-driven metadata discovery
      tools/          Tool execution
      tracing/        Ordered protocol and diagnostic events
      diagnostics/    Connection Doctor checks
    projects/         Saved servers, tests, runs, and settings
    security/         Secret storage and redaction

  preload/
    api.ts            Narrow typed renderer API

  renderer/
    app/              Router, shell, and shared presentation state
    features/
      connections/
      inspector/
      playground/
      traces/
      doctor/
      tests/
      client-config/

  shared/
    contracts/        IPC request, response, and event schemas
    domain/           Transport-neutral application types
```

The `shared/domain` layer must not import Electron, Vue, SQLite, or the MCP SDK. This keeps persisted records and renderer contracts stable when infrastructure libraries change.

## 6. Connection And Discovery Lifecycle

A connection is represented outside the main process by an opaque `connectionId`.

```text
Disconnected
    -> Connecting
    -> Initializing
    -> Discovering
    -> Ready
    -> Closing
    -> Disconnected

Any active state may transition to Failed.
```

For each connection attempt, MCPDevBench:

1. Validates the saved or ad hoc server profile.
2. Creates a new MCP client and the selected transport.
3. Connects, causing the client to perform initialization and protocol negotiation.
4. Captures server identity, instructions, negotiated protocol version, and declared capabilities.
5. Initiates `tools/list`, `resources/list`, `resources/templates/list`, and `prompts/list` only when the negotiated server capabilities support them.
6. Follows pagination until each supported catalog is complete.
7. Publishes normalized catalog snapshots to the renderer.
8. Listens for supported list-change notifications and refreshes only the affected catalog.
9. Allows manual refresh as a recovery action.

Discovery is client-initiated. The renderer does not issue individual list calls or infer support from failures.

Each connection owns its transport and client. Reconnecting creates a fresh session and cleanly closes the old one. Closing a STDIO session also terminates the spawned process through the SDK transport lifecycle. Closing a Streamable HTTP session attempts server-side session termination before closing the client.

Legacy SSE fallback is excluded from v0.1. A server requiring legacy SSE receives a clear unsupported-transport diagnosis.

## 7. Trace Model

The trace is one ordered event stream per connection attempt. Events include:

- Lifecycle transitions.
- Outbound MCP requests.
- Inbound MCP responses and errors.
- Notifications in either direction.
- STDERR and process-exit events for STDIO servers.
- HTTP status, relevant headers, and transport failures for Streamable HTTP.
- Diagnostic checks and recommendations.

Every event has an event ID, monotonic sequence number, wall-clock timestamp, elapsed duration where applicable, connection ID, category, direction, summary, and redacted structured payload.

Redaction occurs before persistence or renderer delivery. Header names and environment variable names are retained where useful, but configured secret values, authorization headers, cookies, access tokens, refresh tokens, and known credentials are replaced with a stable redaction marker.

The initial implementation may wrap or instrument SDK transport boundaries, but protocol behavior remains delegated to the official SDK. Trace instrumentation must not implement a second MCP parser.

## 8. Tool Playground And Saved Tests

The Playground generates an input form from a selected tool's JSON Schema and also offers a raw JSON editor. Both modes produce the same validated argument object.

A tool invocation records:

- Connection and server identity.
- Tool name and discovered definition fingerprint.
- Input arguments.
- Structured and content results.
- MCP error information.
- Duration and trace references.

Only completed interactions can be saved as tests. The user chooses assertions derived from the observed result; v0.1 supports exact JSON equality, selected JSON-path equality, content-block type checks, and successful completion. Secrets are never copied into test fixtures.

The test runner reconnects using the selected server profile, rediscovers the tool, warns if its definition fingerprint changed, executes the saved input, and reports pass, fail, error, or skipped. Test data survives application restart.

## 9. Connection Doctor

Doctor consumes facts from the connection attempt and may perform explicit safe probes. It reports the deepest successful layer and the first actionable failure across:

```text
Configuration
  -> Process spawn or URL validation
  -> DNS
  -> TCP
  -> TLS
  -> HTTP
  -> Authentication
  -> MCP initialization
  -> Protocol negotiation
  -> Capability discovery
```

Checks that do not apply to a transport are marked not applicable, not successful. Each failed check provides evidence, a concise explanation, and one or more corrective actions. Doctor must distinguish application validation failures, transport failures, MCP protocol errors, timeouts, user cancellation, and unsupported behavior.

Diagnostic probes must not invoke server tools or otherwise cause domain side effects.

## 10. Persistence And Secret Handling

SQLite stores:

- Server profiles without plaintext secrets.
- Discovery snapshots and definition fingerprints.
- Saved tests and assertions.
- Test runs and compact outcomes.
- Connection and trace metadata.
- Application settings and schema version.

Redacted trace payloads are stored as JSON files under Electron's application-data directory and referenced from SQLite. This prevents large traces from bloating routine database queries while preserving transactional metadata.

Bearer tokens and sensitive environment-variable values are encrypted with Electron `safeStorage`. Database records contain opaque secret references. If secure storage is unavailable, MCPDevBench must refuse persistent secret storage and offer session-only use; it must not silently fall back to plaintext.

Database migrations begin with the first schema version and run before feature services start.

## 11. IPC Contract

IPC is organized around task-level operations, not generic filesystem, SQL, HTTP, or MCP passthrough calls. Representative commands are:

- Save, list, and delete server profiles.
- Connect, cancel connection, reconnect, and disconnect.
- Read a discovery snapshot.
- Invoke a tool and cancel an invocation.
- Read or subscribe to trace events.
- Run Connection Doctor.
- Save, list, run, and delete tests.
- Generate a client configuration.

Long-running commands return an operation ID and publish typed progress events. Every subscription returns an unsubscribe function. Window destruction cancels renderer-owned subscriptions but does not silently leave orphaned STDIO processes.

## 12. Error And Recovery Model

Application errors use stable codes and structured details. User-facing messages are derived from those codes rather than displaying raw exception strings.

Expected recoveries include:

- A connection timeout can be cancelled or retried.
- A failed discovery method leaves other supported catalogs usable.
- A terminated STDIO server records STDERR and exit status, then marks the session failed.
- A dropped HTTP connection marks the session stale and offers an explicit reconnect.
- A malformed server response is preserved in redacted trace evidence when safely available.
- A database migration failure prevents normal startup and offers the log location; it does not reset user data automatically.
- Renderer reload or crash does not leak child processes.

The main process owns cancellation and timeout policy. Initial defaults are 30 seconds for connection and discovery requests and 60 seconds for tool calls, with user cancellation available wherever an operation can block.

## 13. Client Configuration Generator

Version 0.1 supports explicitly versioned Claude and Codex configuration templates. Generation uses a normalized server profile and never embeds stored secrets directly unless the target format requires a value and the user explicitly requests temporary reveal or copy.

Each generated result includes:

- The configuration snippet.
- Where it belongs.
- Required environment variables or credentials.
- Restart or reload steps.
- A verification step.
- The template's supported client version and last-verified date.

Configuration generation is deterministic and does not claim that a client was tested unless an actual verification was performed.

## 14. Verification Strategy

Unit tests cover domain transitions, capability gating, pagination, redaction, fingerprints, assertion evaluation, error mapping, and configuration generation.

Integration tests use controlled MCP fixtures for:

- Valid STDIO and Streamable HTTP servers.
- Every combination of supported discovery capabilities.
- Paginated catalogs and list-change notifications.
- Slow, malformed, crashing, and protocol-incompatible servers.
- Tool success, MCP error, timeout, and cancellation.
- Known Doctor failures at each applicable layer.
- Persistence across process restart.

End-to-end tests launch the packaged Electron application and verify the critical paths:

1. Connect and automatically discover capabilities.
2. Run a tool and inspect its trace.
3. Diagnose a broken fixture.
4. Save an interaction as a test, restart, and rerun it.
5. Generate Claude and Codex configuration.

Packaging smoke tests run for each supported operating system in CI. Version 0.1 may begin with macOS as the development platform, but release claims are made only for platforms that build and pass smoke tests in CI.

## 15. Acceptance Criteria

- A valid STDIO or Streamable HTTP server can be configured and connected within 30 seconds.
- Initialization and all capability-supported metadata discovery are initiated automatically by MCPDevBench.
- Unsupported catalogs are shown as unsupported rather than failed or empty.
- Every tool call has an inspectable ordered trace with request, response or error, and duration.
- Known broken-server fixtures are assigned to the correct Doctor failure layer in at least 90 percent of fixture cases, with no false success beyond the failed layer.
- A successful tool interaction can be saved, survives restart, and can be rerun without editing.
- No configured secret appears in renderer payloads, persisted traces, exported diagnostics, or test fixtures.
- Generated Claude and Codex instructions identify their supported client version and are copy-pasteable apart from explicitly identified secret placeholders.
- The packaged application passes the critical end-to-end workflow on every platform claimed as supported.

## 16. Deferred Decisions

The following are intentionally excluded from this implementation cycle:

- OAuth authorization and Client-Initiated Metadata Discovery emulation.
- Legacy SSE transport fallback.
- Remote tunnels.
- AI-model evaluation and multi-model comparison.
- External-client automation and a compatibility database.
- Demo recording and documentation generation.
- Team sync, cloud services, and enterprise policy controls.
- A standalone CLI or separate MCP engine process.

The domain and service boundaries leave room for a future CLI or background engine, but v0.1 does not add abstractions solely for those possibilities.
