import type { OAuthClientProvider } from '@modelcontextprotocol/client';
import type {
  PromptSummary,
  ResourceSummary,
  ResourceTemplateSummary,
  ServerProfile,
  ToolSummary,
} from '@/shared/domain/servers';

export type McpServerMetadata = {
  serverName?: string | undefined;
  serverVersion?: string | undefined;
  protocolVersion?: string | undefined;
  instructions?: string | undefined;
  capabilities: Record<string, unknown>;
};

/**
 * Thrown by {@link McpClientPort.connect} when the SDK determined interactive OAuth
 * authorization is required (the SDK's own `UnauthorizedError`, detected inside
 * `McpClientAdapter`). Application code outside the adapter must never see the SDK's
 * own error class -- this branded error is the sanitized boundary signal instead.
 */
export class McpAuthorizationRequiredError extends Error {
  override readonly name = 'McpAuthorizationRequiredError';

  constructor() {
    super('The MCP server requires interactive OAuth authorization.');
  }
}

/**
 * Thrown by {@link McpClientPort.connect} when the authorization server does not
 * support MCPDevBench's hosted Client ID Metadata Document (CIMD) and this
 * application does not fall back to Dynamic Client Registration.
 */
export class McpCimdUnsupportedError extends Error {
  override readonly name = 'McpCimdUnsupportedError';

  constructor() {
    super("The authorization server cannot accept MCPDevBench's hosted client identity.");
  }
}

export interface McpClientPort {
  connect(): Promise<void>;
  close(): Promise<void>;
  metadata(): McpServerMetadata;
  listTools(): Promise<ToolSummary[]>;
  listResources(): Promise<ResourceSummary[]>;
  listResourceTemplates(): Promise<ResourceTemplateSummary[]>;
  listPrompts(): Promise<PromptSummary[]>;
  /**
   * Completes an interactive OAuth callback on this port's transport. Only meaningful for
   * `streamable-http` profiles constructed with an `authProvider`; optional so ports that
   * never participate in OAuth (STDIO, and every pre-existing test double) need not implement it.
   */
  finishAuthorization?(params: URLSearchParams): Promise<void>;
}

/** `authProvider` is attached to the transport only for `streamable-http` profiles; `stdio` profiles ignore it entirely. */
export type McpClientFactory = (profile: ServerProfile, authProvider?: OAuthClientProvider) => McpClientPort;
