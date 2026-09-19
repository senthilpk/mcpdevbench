export type StdioServerProfile = {
  id: string;
  name: string;
  transport: 'stdio';
  command: string;
  args: string[];
  cwd?: string | undefined;
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
  | 'failed'
  | 'authorization-required'
  | 'authorizing'
  | 'completing-authorization';

export type AuthorizationStorage = 'persistent' | 'session-only';

export type AuthorizationSnapshot = {
  status: 'required' | 'waiting' | 'completing' | 'authorized';
  storage: AuthorizationStorage;
  canReopenBrowser: boolean;
  canCancel: boolean;
  warning?: string | undefined;
};

export type SignOutResult = {
  localCredentialsRemoved: true;
  revocation: 'revoked' | 'unavailable' | 'failed';
  warning?: string | undefined;
};

export type CatalogSnapshot<T> =
  | { status: 'unsupported'; items: [] }
  | { status: 'ready'; items: T[] }
  | { status: 'failed'; items: []; message: string };

export type ToolSummary = {
  name: string;
  description?: string | undefined;
  inputSchema: unknown;
  outputSchema?: unknown;
};

export type ResourceSummary = {
  uri: string;
  name: string;
  description?: string | undefined;
  mimeType?: string | undefined;
};

export type ResourceTemplateSummary = {
  uriTemplate: string;
  name: string;
  description?: string | undefined;
  mimeType?: string | undefined;
};

export type PromptArgumentSummary = { name: string; description?: string | undefined; required?: boolean | undefined };
export type PromptSummary = { name: string; description?: string | undefined; arguments: PromptArgumentSummary[] };

export type ConnectionSnapshot = {
  connectionId: string;
  profileId: string;
  state: ConnectionState;
  serverName?: string | undefined;
  serverVersion?: string | undefined;
  protocolVersion?: string | undefined;
  instructions?: string | undefined;
  tools: CatalogSnapshot<ToolSummary>;
  resources: CatalogSnapshot<ResourceSummary>;
  resourceTemplates: CatalogSnapshot<ResourceTemplateSummary>;
  prompts: CatalogSnapshot<PromptSummary>;
  failure?: { code: string; message: string } | undefined;
  authorization?: AuthorizationSnapshot | undefined;
};
