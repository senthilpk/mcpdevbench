// Loopback-only OAuth-protected MCP server fixture for Task 7 (integration + E2E coverage).
//
// Serves, from a single plain-http `127.0.0.1` listener on an ephemeral port:
//   - RFC 9728 protected-resource metadata at /.well-known/oauth-protected-resource(/mcp)
//   - RFC 8414 authorization-server metadata at /.well-known/oauth-authorization-server
//   - /authorize (PKCE S256 + redirect_uri + state + resource validation, 302 redirect)
//   - /token (authorization_code and refresh_token grants)
//   - /revoke (RFC 7009 -- records every call so tests can assert on it)
//   - /mcp (bearer-gated Streamable HTTP MCP endpoint, real @modelcontextprotocol/server McpServer)
//
// Plain http (not https) is allowed here per SEP-2207's loopback exemption
// (assertSecureTokenEndpoint) -- see task-7-notes.md. No TLS, no public network access.
import http from 'node:http';
import { Readable } from 'node:stream';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { z } from 'zod';

/** Must exactly match LOOPBACK_REDIRECT_URI in src/main/oauth/loopback-callback-server.ts. */
const EXPECTED_REDIRECT_URI = 'http://127.0.0.1:51782/__mcpdevbench_oauth_v1/callback';

const CODE_TTL_MS = 60_000;
const TOKEN_TTL_SECONDS = 3600;

function base64UrlSha256(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function buildMcpServer() {
  const server = new McpServer({ name: 'protected-catalog-fixture', version: '1.0.0' });

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Echo a message for discovery tests.',
      inputSchema: z.object({ message: z.string() }),
    },
    async ({ message }) => ({ content: [{ type: 'text', text: message }] }),
  );

  server.registerResource(
    'fixture-readme',
    'fixture://readme',
    { title: 'Fixture readme', mimeType: 'text/plain' },
    async (uri) => ({ contents: [{ uri: uri.href, text: 'MCPDevBench protected fixture resource' }] }),
  );

  server.registerPrompt(
    'review-catalog',
    {
      title: 'Review catalog',
      description: 'Create a catalog review request.',
      argsSchema: z.object({ focus: z.string() }),
    },
    ({ focus }) => ({
      messages: [{ role: 'user', content: { type: 'text', text: `Review ${focus}` } }],
    }),
  );

  return server;
}

async function nodeRequestToFetchRequest(req, base) {
  const url = new URL(req.url, base);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const controller = new AbortController();
  req.on('close', () => controller.abort());
  return new Request(url, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
    signal: controller.signal,
  });
}

async function sendFetchResponse(res, response) {
  const headers = {};
  for (const [key, value] of response.headers) headers[key] = value;
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(text);
}

/**
 * Starts the fixture. Resolves once listening; call `close()` to tear down.
 * `revocationCalls` is a live array the caller can inspect after a sign-out.
 */
export async function startProtectedMcpFixture() {
  /** @type {Map<string, { codeChallenge: string, redirectUri: string, resource: string, expiresAt: number }>} */
  const authorizationCodes = new Map();
  /** @type {Set<string>} */
  const validAccessTokens = new Set();
  /** @type {Set<string>} */
  const validRefreshTokens = new Set();
  /** @type {Set<string>} */
  const revokedTokens = new Set();
  const revocationCalls = [];
  const discoveryHits = { protectedResource: 0, authorizationServer: 0 };

  // Each real MCP connection (probe, interactive, reconnect, ...) is an independent
  // Streamable HTTP session -- a single shared transport instance only ever represents
  // one session, so a second client's bare `initialize` (no `mcp-session-id` yet) would
  // be rejected as belonging to the wrong session. Mirror the standard multi-session
  // server pattern instead: a fresh McpServer + transport pair per session, keyed by the
  // session id the transport assigns on `initialize`.
  /** @type {Map<string, { transport: WebStandardStreamableHTTPServerTransport, connected: Promise<void> }>} */
  const sessionsById = new Map();

  function createSessionEntry() {
    const entry = { transport: undefined, connected: undefined };
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomBytes(16).toString('hex'),
      enableJsonResponse: true,
      onsessioninitialized: (sessionId) => sessionsById.set(sessionId, entry),
      onsessionclosed: (sessionId) => sessionsById.delete(sessionId),
    });
    entry.transport = transport;
    entry.connected = buildMcpServer().connect(transport);
    return entry;
  }

  let origin = '';

  function issueTokens() {
    const accessToken = `access_${randomBytes(24).toString('base64url')}`;
    const refreshToken = `refresh_${randomBytes(24).toString('base64url')}`;
    validAccessTokens.add(accessToken);
    validRefreshTokens.add(refreshToken);
    return { accessToken, refreshToken };
  }

  async function handleAuthorize(url, res) {
    const params = url.searchParams;
    const responseType = params.get('response_type');
    const codeChallenge = params.get('code_challenge');
    const codeChallengeMethod = params.get('code_challenge_method');
    const redirectUri = params.get('redirect_uri');
    const state = params.get('state');
    const resource = params.get('resource');

    if (
      responseType !== 'code' ||
      !codeChallenge ||
      codeChallengeMethod !== 'S256' ||
      redirectUri !== EXPECTED_REDIRECT_URI ||
      !resource
    ) {
      sendJson(res, 400, { error: 'invalid_request' });
      return;
    }

    const code = `code_${randomBytes(24).toString('base64url')}`;
    authorizationCodes.set(code, {
      codeChallenge,
      redirectUri,
      resource,
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    const location = new URL(redirectUri);
    location.searchParams.set('code', code);
    if (state !== null) location.searchParams.set('state', state);
    res.writeHead(302, { Location: location.toString() });
    res.end();
  }

  async function handleToken(req, res) {
    const bodyText = await readBody(req);
    const params = new URLSearchParams(bodyText);
    const grantType = params.get('grant_type');

    if (grantType === 'authorization_code') {
      const code = params.get('code');
      const codeVerifier = params.get('code_verifier');
      const redirectUri = params.get('redirect_uri');
      const record = code ? authorizationCodes.get(code) : undefined;
      if (!record || !codeVerifier || record.expiresAt < Date.now()) {
        sendJson(res, 400, { error: 'invalid_grant' });
        return;
      }
      authorizationCodes.delete(code);
      if (record.redirectUri !== redirectUri || base64UrlSha256(codeVerifier) !== record.codeChallenge) {
        sendJson(res, 400, { error: 'invalid_grant' });
        return;
      }
      const { accessToken, refreshToken } = issueTokens();
      sendJson(res, 200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
      });
      return;
    }

    if (grantType === 'refresh_token') {
      const refreshToken = params.get('refresh_token');
      if (!refreshToken || !validRefreshTokens.has(refreshToken) || revokedTokens.has(refreshToken)) {
        sendJson(res, 400, { error: 'invalid_grant' });
        return;
      }
      const accessToken = `access_${randomBytes(24).toString('base64url')}`;
      validAccessTokens.add(accessToken);
      sendJson(res, 200, {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: TOKEN_TTL_SECONDS,
      });
      return;
    }

    sendJson(res, 400, { error: 'unsupported_grant_type' });
  }

  async function handleRevoke(req, res) {
    const bodyText = await readBody(req);
    const params = new URLSearchParams(bodyText);
    const token = params.get('token') ?? '';
    const tokenTypeHint = params.get('token_type_hint') ?? undefined;
    const clientId = params.get('client_id') ?? undefined;
    revocationCalls.push({ token, tokenTypeHint, clientId });
    revokedTokens.add(token);
    validAccessTokens.delete(token);
    validRefreshTokens.delete(token);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  }

  function isBearerValid(req) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return false;
    const token = header.slice('Bearer '.length);
    return validAccessTokens.has(token) && !revokedTokens.has(token);
  }

  async function handleMcp(req, res) {
    if (!isBearerValid(req)) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end(JSON.stringify({ error: 'invalid_token' }));
      return;
    }
    const sessionIdHeader = req.headers['mcp-session-id'];
    const existing = typeof sessionIdHeader === 'string' ? sessionsById.get(sessionIdHeader) : undefined;
    const entry = existing ?? createSessionEntry();
    await entry.connected;
    const request = await nodeRequestToFetchRequest(req, origin);
    const response = await entry.transport.handleRequest(request);
    await sendFetchResponse(res, response);
  }

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', origin || 'http://127.0.0.1');
        if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
          discoveryHits.protectedResource += 1;
          sendJson(res, 200, {
            resource: `${origin}/mcp`,
            authorization_servers: [origin],
          });
          return;
        }
        if (url.pathname === '/.well-known/oauth-authorization-server') {
          discoveryHits.authorizationServer += 1;
          sendJson(res, 200, {
            issuer: origin,
            // `OAuthCoordinator` (src/main/oauth/oauth-coordinator.ts) refuses to open any
            // non-`https:` URL in the real system browser -- a deliberate, unconditional
            // security property with no loopback exemption (unlike the SDK's own
            // `assertSecureTokenEndpoint`, which the token/revocation endpoints below rely
            // on). To satisfy that check without standing up real TLS, this is the only
            // endpoint advertised with an `https:` *string*; the underlying listener is the
            // same plain-http loopback server as everything else -- see driveBrowser() in
            // the integration test and the E2E test for the matching test-side transport.
            authorization_endpoint: `${origin.replace('http://', 'https://')}/authorize`,
            token_endpoint: `${origin}/token`,
            revocation_endpoint: `${origin}/revoke`,
            client_id_metadata_document_supported: true,
            code_challenge_methods_supported: ['S256'],
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
          });
          return;
        }
        if (url.pathname === '/authorize') {
          await handleAuthorize(url, res);
          return;
        }
        if (url.pathname === '/token' && req.method === 'POST') {
          await handleToken(req, res);
          return;
        }
        if (url.pathname === '/revoke' && req.method === 'POST') {
          await handleRevoke(req, res);
          return;
        }
        if (url.pathname === '/mcp') {
          await handleMcp(req, res);
          return;
        }
        res.writeHead(404);
        res.end();
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'server_error', error_description: String(error) }));
      }
    })();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    resourceUrl: `${origin}/mcp`,
    revocationCalls,
    discoveryHits,
    hasValidAccessToken: (token) => validAccessTokens.has(token) && !revokedTokens.has(token),
    async close() {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    },
  };
}
