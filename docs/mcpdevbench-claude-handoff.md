# MCPDevBench SDK-Native OAuth Handoff

## Objective

Execute the committed SDK-native OAuth implementation plan end to end for the Electron/TypeScript/Vue MCPDevBench application.

Repository: `/Users/senthilpk/github/senthilpk/mcpdevbench`

Current branch: `main`

The user previously chose direct work on `main` and has now asked Claude to execute the plan. Do not create a worktree or feature branch unless the user changes that instruction.

## Authoritative Artifacts

Read these in order rather than reconstructing the product or design from this handoff:

1. Product requirements: `docs/prd.md`
2. Approved OAuth design: `docs/superpowers/specs/2026-09-19-sdk-native-oauth-design.md`
3. Executable test-first plan: `docs/superpowers/plans/2026-09-19-sdk-native-oauth.md`
4. Existing connection design: `docs/superpowers/specs/2026-09-19-connection-discovery-design.md`

The latest commits are:

```text
8c62eb4 docs: plan SDK-native OAuth implementation
0a36598 docs: add product requirements
8c2c73a docs: design SDK-native OAuth
31a0a9c ci: publish OAuth client metadata
f91ecb4 fix: make connection disconnect idempotent
```

The worktree was clean at handoff time.

## Decisions Already Made

- Use `@modelcontextprotocol/client` 2.0's native `OAuthClientProvider`; do not hand-roll OAuth protocol behavior.
- OAuth runs only in Electron's main process. Never expose tokens, verifiers, callback parameters, discovery metadata, or authorization URLs to the renderer.
- Default hosted CIMD URL: `https://senthilpk.github.io/mcpdevbench/oauth/client-id.json`
- Exact redirect URI: `http://127.0.0.1:51782/__mcpdevbench_oauth_v1/callback`
- Use the system browser through Electron `shell.openExternal`; no embedded login window.
- Bind a fixed loopback listener before opening the browser. Only one interactive authorization attempt may exist application-wide.
- The SDK validates callback issuer but explicitly does not validate OAuth `state`; MCPDevBench must validate `state` before calling `transport.finishAuth(searchParams)`.
- Use CIMD only for this slice. Do not silently fall back to Dynamic Client Registration.
- Store grants by canonical MCP resource URL and authorization-server issuer.
- Encrypt persisted records with Electron `safeStorage`. If encryption is unavailable, or Linux selects `basic_text`, use session-only memory and show a visible warning.
- Disconnect preserves authorization. Sign out disconnects, attempts RFC 7009 revocation, and clears local credentials regardless of remote revocation outcome.
- Create a fresh SDK client and Streamable HTTP transport after authorization finishes.
- Public Streamable HTTP and STDIO flows must remain unchanged.
- Preserve the existing Systems Light UI and shadcn-vue conventions.

## Hosted Metadata Status

The GitHub Pages endpoint is already deployed and was verified to return HTTP 200, `application/json`, the exact client ID, and CORS support:

`https://senthilpk.github.io/mcpdevbench/oauth/client-id.json`

The source is `site/oauth/client-id.json`; publishing workflow is `.github/workflows/pages.yml`.

## LocalMCP Context

The motivating protected resource is `http://localhost:8000/mcp`. Earlier inspection showed:

- It responds with an RFC 9728 OAuth challenge.
- Authorization server: `https://auth.twosionflexa.aws.tveyes.com/`
- The authorization server advertises `client_id_metadata_document_supported: true`.
- It supports authorization code, refresh tokens, and PKCE S256.

Do not bake these endpoints or scopes into production code. The implementation and automated tests must use discovery and local deterministic fixtures.

## Existing Architecture

- SDK boundary: `src/main/mcp/client/mcp-client-adapter.ts`
- Lifecycle owner: `src/main/mcp/connections/connection-manager.ts`
- Shared contracts: `src/shared/domain/servers.ts` and `src/shared/contracts/servers.ts`
- IPC: `src/main/ipc/register-server-ipc.ts`
- Preload API: `src/preload/api.ts`
- Electron composition: `src/main/app/lifecycle.ts`
- Renderer workspace: `src/renderer/features/servers/use-server-workspace.ts`
- Main row UI: `src/renderer/components/domain/ServerTable.vue`

Follow those existing ownership boundaries. The implementation plan specifies all new modules, tests, interfaces, and commits.

## Execution Instructions

Execute `docs/superpowers/plans/2026-09-19-sdk-native-oauth.md` task by task using strict red-green-refactor:

1. Write each failing test first and run it to observe the intended failure.
2. Implement only enough production code to pass.
3. Run the task-specific suite and typecheck.
4. Commit at each task boundary using the commit message in the plan.
5. Continue through all seven tasks without pausing between them unless a destructive/security-sensitive decision or genuinely broken plan requires user input.
6. Run the complete verification named in Task 7 before claiming completion.
7. Do not push or publish without explicit user authorization.

If the plan and spec conflict, the spec is authoritative. Record any necessary ruling in the execution ledger rather than silently deviating.

## Suggested Skills

- `superpowers:executing-plans` - the user selected inline execution.
- `superpowers:test-driven-development` - required before production changes.
- `superpowers:systematic-debugging` - use for unexpected failures instead of speculative patches.
- `superpowers:verification-before-completion` - required before completion claims.
- `superpowers:requesting-code-review` - run the final whole-branch review described by the execution workflow.
- `superpowers:finishing-a-development-branch` - use after implementation and verification, while respecting the user's direct-on-main choice.

## Guardrails

- Use `apply_patch` for manual file edits.
- Do not revert unrelated user changes if any appear while working.
- Do not weaken issuer validation, callback state validation, loopback binding, CIMD URL validation, or secure-storage fallback rules just to make a test pass.
- Never log or surface raw OAuth errors containing callback parameters or credentials.
- Do not introduce custom headers, bearer-token configuration, DCR, DPoP, enterprise-managed auth, step-up UX, or a general OAuth debugger in this slice.
