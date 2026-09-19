import type { McpClientPort } from '@/main/mcp/client/mcp-client-port';
import type {
  CatalogSnapshot,
  PromptSummary,
  ResourceSummary,
  ResourceTemplateSummary,
  ToolSummary,
} from '@/shared/domain/servers';

export type DiscoverySnapshot = {
  tools: CatalogSnapshot<ToolSummary>;
  resources: CatalogSnapshot<ResourceSummary>;
  resourceTemplates: CatalogSnapshot<ResourceTemplateSummary>;
  prompts: CatalogSnapshot<PromptSummary>;
};

const unsupported = (): { status: 'unsupported'; items: [] } => ({ status: 'unsupported', items: [] });

async function discover<T>(label: string, operation: () => Promise<T[]>): Promise<CatalogSnapshot<T>> {
  try {
    return { status: 'ready', items: await operation() };
  } catch {
    return { status: 'failed', items: [], message: `Unable to discover ${label}` };
  }
}

export async function discoverCatalogs(client: McpClientPort): Promise<DiscoverySnapshot> {
  const capabilities = client.metadata().capabilities;
  const tools = 'tools' in capabilities ? discover('tools', () => client.listTools()) : unsupported();
  const resources = 'resources' in capabilities ? discover('resources', () => client.listResources()) : unsupported();
  const resourceTemplates = 'resources' in capabilities
    ? discover('resource templates', () => client.listResourceTemplates())
    : unsupported();
  const prompts = 'prompts' in capabilities ? discover('prompts', () => client.listPrompts()) : unsupported();

  const [toolsResult, resourcesResult, templatesResult, promptsResult] = await Promise.all([
    tools, resources, resourceTemplates, prompts,
  ]);
  return {
    tools: toolsResult,
    resources: resourcesResult,
    resourceTemplates: templatesResult,
    prompts: promptsResult,
  };
}
