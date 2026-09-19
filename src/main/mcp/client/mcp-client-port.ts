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

export interface McpClientPort {
  connect(): Promise<void>;
  close(): Promise<void>;
  metadata(): McpServerMetadata;
  listTools(): Promise<ToolSummary[]>;
  listResources(): Promise<ResourceSummary[]>;
  listResourceTemplates(): Promise<ResourceTemplateSummary[]>;
  listPrompts(): Promise<PromptSummary[]>;
}

export type McpClientFactory = (profile: ServerProfile) => McpClientPort;
