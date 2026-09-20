import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type OAuthClientProvider,
  type Transport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import {
  McpAuthorizationRequiredError,
  McpCimdUnsupportedError,
  type McpClientPort,
  type McpServerMetadata,
} from '@/main/mcp/client/mcp-client-port';
import type {
  PromptSummary,
  ResourceSummary,
  ResourceTemplateSummary,
  ServerProfile,
  ToolCallResult,
  ToolContentBlock,
  ToolSummary,
} from '@/shared/domain/servers';

/**
 * The exact message the SDK's `auth()` throws when an authorization server does not
 * advertise CIMD support and this application's provider cannot fall back to Dynamic
 * Client Registration (it never implements `saveClientInformation`). The SDK does not
 * export a dedicated error class or code for this case, so matching on the message is
 * the only available signal.
 * ponytail: fragile message-matching; if the SDK ever adds a dedicated error class or
 * `OAuthErrorCode` for "CIMD unsupported, no DCR fallback", switch to checking that instead.
 */
const CIMD_UNSUPPORTED_MESSAGE = 'OAuth client information must be saveable for dynamic registration';

type SdkClientLike = {
  connect(transport: Transport): Promise<void>;
  close(): Promise<void>;
  getServerCapabilities(): Record<string, unknown> | undefined;
  getServerVersion(): { name: string; version: string } | undefined;
  getNegotiatedProtocolVersion(): string | undefined;
  getInstructions(): string | undefined;
  listTools(): Promise<{ tools: Array<{ name: string; description?: string | undefined; inputSchema: unknown; outputSchema?: unknown }> }>;
  listResources(): Promise<{ resources: Array<{ uri: string; name: string; description?: string | undefined; mimeType?: string | undefined }> }>;
  listResourceTemplates(): Promise<{ resourceTemplates: Array<{ uriTemplate: string; name: string; description?: string | undefined; mimeType?: string | undefined }> }>;
  listPrompts(): Promise<{ prompts: Array<{ name: string; description?: string | undefined; arguments?: Array<{ name: string; description?: string | undefined; required?: boolean | undefined }> | undefined }> }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> | undefined }): Promise<{
    content: Array<Record<string, unknown> & { type: string }>;
    structuredContent?: unknown;
    isError?: boolean | undefined;
  }>;
};

type FinishAuth = (params: URLSearchParams) => Promise<void>;

type AdapterBundle = {
  client: SdkClientLike;
  transport: Transport;
  terminateSession?: (() => Promise<void>) | undefined;
  /** Only present for `streamable-http` bundles constructed with an `authProvider`. */
  finishAuth?: FinishAuth | undefined;
};

export type AdapterDependencies = {
  create(profile: ServerProfile, authProvider?: OAuthClientProvider): AdapterBundle;
};

const defaultDependencies: AdapterDependencies = {
  create(profile, authProvider) {
    const client = new Client({ name: 'MCPDevBench', version: '0.1.0' }, { listMaxPages: 64 });
    if (profile.transport === 'stdio') {
      // `authProvider` is intentionally never read here -- STDIO transports never receive one.
      const transport = new StdioClientTransport({
        command: profile.command,
        args: profile.args,
        ...(profile.cwd ? { cwd: profile.cwd } : {}),
      });
      return { client, transport };
    }
    const url = parseHttpUrl(profile.url);
    const transport = new StreamableHTTPClientTransport(url, authProvider ? { authProvider } : undefined);
    return {
      client,
      transport,
      terminateSession: () => transport.terminateSession(),
      finishAuth: authProvider ? (params: URLSearchParams) => transport.finishAuth(params) : undefined,
    };
  },
};

export class McpClientAdapter implements McpClientPort {
  private readonly bundle: AdapterBundle;

  constructor(
    profile: ServerProfile,
    dependencies: AdapterDependencies = defaultDependencies,
    authProvider?: OAuthClientProvider,
  ) {
    if (profile.transport === 'streamable-http') parseHttpUrl(profile.url);
    this.bundle = dependencies.create(profile, profile.transport === 'streamable-http' ? authProvider : undefined);
  }

  async connect(): Promise<void> {
    try {
      await this.bundle.client.connect(this.bundle.transport);
    } catch (error) {
      throw mapSdkAuthError(error);
    }
  }

  async finishAuthorization(params: URLSearchParams): Promise<void> {
    if (!this.bundle.finishAuth) {
      throw new Error('finishAuthorization is only supported for streamable-http connections with an authorization provider');
    }
    // `transport.finishAuth()` itself throws the SDK's own `UnauthorizedError("Failed to
    // authorize")` on a failed code exchange -- this adapter is the sole SDK-error boundary,
    // so that must be converted here too, not left to whatever happens to catch it upstream.
    try {
      await this.bundle.finishAuth(params);
    } catch (error) {
      throw mapSdkAuthError(error);
    }
  }

  async close(): Promise<void> {
    if (this.bundle.terminateSession) await this.bundle.terminateSession();
    await this.bundle.client.close();
  }

  metadata(): McpServerMetadata {
    const server = this.bundle.client.getServerVersion();
    return {
      serverName: server?.name,
      serverVersion: server?.version,
      protocolVersion: this.bundle.client.getNegotiatedProtocolVersion(),
      instructions: this.bundle.client.getInstructions(),
      capabilities: this.bundle.client.getServerCapabilities() ?? {},
    };
  }

  async listTools(): Promise<ToolSummary[]> {
    const { tools } = await this.bundle.client.listTools();
    return tools.map(({ name, description, inputSchema, outputSchema }) => ({
      name, ...(description ? { description } : {}), inputSchema, ...(outputSchema ? { outputSchema } : {}),
    }));
  }

  async listResources(): Promise<ResourceSummary[]> {
    const { resources } = await this.bundle.client.listResources();
    return resources.map(({ uri, name, description, mimeType }) => ({
      uri, name, ...(description ? { description } : {}), ...(mimeType ? { mimeType } : {}),
    }));
  }

  async listResourceTemplates(): Promise<ResourceTemplateSummary[]> {
    const { resourceTemplates } = await this.bundle.client.listResourceTemplates();
    return resourceTemplates.map(({ uriTemplate, name, description, mimeType }) => ({
      uriTemplate, name, ...(description ? { description } : {}), ...(mimeType ? { mimeType } : {}),
    }));
  }

  async listPrompts(): Promise<PromptSummary[]> {
    const { prompts } = await this.bundle.client.listPrompts();
    return prompts.map(({ name, description, arguments: promptArguments }) => ({
      name,
      ...(description ? { description } : {}),
      arguments: (promptArguments ?? []).map(({ name: argumentName, description: argumentDescription, required }) => ({
        name: argumentName,
        ...(argumentDescription ? { description: argumentDescription } : {}),
        ...(required === undefined ? {} : { required }),
      })),
    }));
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
    const result = await this.bundle.client.callTool(args !== undefined ? { name, arguments: args } : { name });
    return {
      content: result.content.map(mapContentBlock),
      ...(result.structuredContent !== undefined ? { structuredContent: result.structuredContent } : {}),
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
    };
  }
}

export const createMcpClient = (profile: ServerProfile, authProvider?: OAuthClientProvider): McpClientPort =>
  new McpClientAdapter(profile, defaultDependencies, authProvider);

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('HTTP profile URL must use http or https');
  }
  return url;
}

/**
 * The single place that recognizes the SDK's own `UnauthorizedError` (thrown both from
 * `client.connect()` on a 401 and from `transport.finishAuth()` on a failed code exchange)
 * and the CIMD-unsupported message, converting either to this adapter's branded errors.
 * Any other error is returned unchanged.
 */
function mapSdkAuthError(error: unknown): unknown {
  if (error instanceof UnauthorizedError) return new McpAuthorizationRequiredError();
  if (error instanceof Error && error.message === CIMD_UNSUPPORTED_MESSAGE) return new McpCimdUnsupportedError();
  return error;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function mapContentBlock(block: Record<string, unknown> & { type: string }): ToolContentBlock {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: asString(block.text) ?? '' };
    case 'image':
      return { type: 'image', data: asString(block.data) ?? '', mimeType: asString(block.mimeType) ?? '' };
    case 'audio':
      return { type: 'audio', data: asString(block.data) ?? '', mimeType: asString(block.mimeType) ?? '' };
    case 'resource_link': {
      const description = asString(block.description);
      const mimeType = asString(block.mimeType);
      return {
        type: 'resource_link',
        uri: asString(block.uri) ?? '',
        name: asString(block.name) ?? '',
        ...(description !== undefined ? { description } : {}),
        ...(mimeType !== undefined ? { mimeType } : {}),
      };
    }
    case 'resource': {
      const resource = (block.resource ?? {}) as Record<string, unknown>;
      const mimeType = asString(resource.mimeType);
      const text = asString(resource.text);
      const blob = asString(resource.blob);
      return {
        type: 'resource',
        uri: asString(resource.uri) ?? '',
        ...(mimeType !== undefined ? { mimeType } : {}),
        ...(text !== undefined ? { text } : {}),
        ...(blob !== undefined ? { blob } : {}),
      };
    }
    default:
      return { type: 'text', text: '' };
  }
}
