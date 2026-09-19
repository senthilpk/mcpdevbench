export type StdioServerProfile = {
  id: string;
  name: string;
  transport: 'stdio';
  command: string;
  args: string[];
  cwd?: string;
};

export type HttpServerProfile = {
  id: string;
  name: string;
  transport: 'streamable-http';
  url: string;
};

export type ServerProfile = StdioServerProfile | HttpServerProfile;
export type SaveServerProfileInput = Omit<StdioServerProfile, 'id'> | Omit<HttpServerProfile, 'id'>;

export type ConnectionState =
  | 'connecting'
  | 'initializing'
  | 'discovering'
  | 'ready'
  | 'closing'
  | 'disconnected'
  | 'failed';

export type CatalogSnapshot<T> =
  | { status: 'unsupported'; items: [] }
  | { status: 'ready'; items: T[] }
  | { status: 'failed'; items: []; message: string };

export type ToolSummary = {
  name: string;
  description?: string;
  inputSchema: unknown;
  outputSchema?: unknown;
};

export type ResourceSummary = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type ResourceTemplateSummary = {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type PromptArgumentSummary = { name: string; description?: string; required?: boolean };
export type PromptSummary = { name: string; description?: string; arguments: PromptArgumentSummary[] };

export type ConnectionSnapshot = {
  connectionId: string;
  profileId: string;
  state: ConnectionState;
  serverName?: string;
  serverVersion?: string;
  protocolVersion?: string;
  instructions?: string;
  tools: CatalogSnapshot<ToolSummary>;
  resources: CatalogSnapshot<ResourceSummary>;
  resourceTemplates: CatalogSnapshot<ResourceTemplateSummary>;
  prompts: CatalogSnapshot<PromptSummary>;
  failure?: { code: string; message: string };
};
