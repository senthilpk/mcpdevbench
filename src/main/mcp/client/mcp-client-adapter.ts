import {
  Client,
  StreamableHTTPClientTransport,
  type Transport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { McpClientPort, McpServerMetadata } from '@/main/mcp/client/mcp-client-port';
import type {
  PromptSummary,
  ResourceSummary,
  ResourceTemplateSummary,
  ServerProfile,
  ToolSummary,
} from '@/shared/domain/servers';

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
};

type AdapterBundle = {
  client: SdkClientLike;
  transport: Transport;
  terminateSession?: (() => Promise<void>) | undefined;
};

export type AdapterDependencies = {
  create(profile: ServerProfile): AdapterBundle;
};

const defaultDependencies: AdapterDependencies = {
  create(profile) {
    const client = new Client({ name: 'MCPDevBench', version: '0.1.0' }, { listMaxPages: 64 });
    if (profile.transport === 'stdio') {
      const transport = new StdioClientTransport({
        command: profile.command,
        args: profile.args,
        ...(profile.cwd ? { cwd: profile.cwd } : {}),
      });
      return { client, transport };
    }
    const url = parseHttpUrl(profile.url);
    const transport = new StreamableHTTPClientTransport(url);
    return { client, transport, terminateSession: () => transport.terminateSession() };
  },
};

export class McpClientAdapter implements McpClientPort {
  private readonly bundle: AdapterBundle;

  constructor(profile: ServerProfile, dependencies: AdapterDependencies = defaultDependencies) {
    if (profile.transport === 'streamable-http') parseHttpUrl(profile.url);
    this.bundle = dependencies.create(profile);
  }

  async connect(): Promise<void> {
    await this.bundle.client.connect(this.bundle.transport);
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
}

export const createMcpClient = (profile: ServerProfile): McpClientPort => new McpClientAdapter(profile);

function parseHttpUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('HTTP profile URL must use http or https');
  }
  return url;
}
