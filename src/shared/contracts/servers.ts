import { z } from 'zod';

const nameSchema = z.string().trim().min(1).max(120);
const httpUrlSchema = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'http:' || protocol === 'https:';
}, 'URL must use http or https');

export const stdioServerProfileSchema = z.object({
  id: z.string().min(1),
  name: nameSchema,
  transport: z.literal('stdio'),
  command: z.string().trim().min(1).regex(/^\S+$/, 'Command must be one executable without shell syntax'),
  args: z.array(z.string()),
  cwd: z.string().trim().min(1).optional(),
}).strict();

export const httpServerProfileSchema = z.object({
  id: z.string().min(1),
  name: nameSchema,
  transport: z.literal('streamable-http'),
  url: httpUrlSchema,
}).strict();

export const serverProfileSchema = z.discriminatedUnion('transport', [
  stdioServerProfileSchema,
  httpServerProfileSchema,
]);

export const saveServerProfileInputSchema = z.discriminatedUnion('transport', [
  stdioServerProfileSchema.omit({ id: true }),
  httpServerProfileSchema.omit({ id: true }),
]);

const toolSummarySchema = z.object({
  name: z.string(), description: z.string().optional(), inputSchema: z.unknown(), outputSchema: z.unknown().optional(),
}).strict();
const resourceSummarySchema = z.object({
  uri: z.string(), name: z.string(), description: z.string().optional(), mimeType: z.string().optional(),
}).strict();
const resourceTemplateSummarySchema = z.object({
  uriTemplate: z.string(), name: z.string(), description: z.string().optional(), mimeType: z.string().optional(),
}).strict();
const promptSummarySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  arguments: z.array(z.object({
    name: z.string(), description: z.string().optional(), required: z.boolean().optional(),
  }).strict()),
}).strict();

const toolTextContentSchema = z.object({ type: z.literal('text'), text: z.string() }).strict();
const toolImageContentSchema = z.object({
  type: z.literal('image'), data: z.string(), mimeType: z.string(),
}).strict();
const toolAudioContentSchema = z.object({
  type: z.literal('audio'), data: z.string(), mimeType: z.string(),
}).strict();
const toolResourceLinkContentSchema = z.object({
  type: z.literal('resource_link'),
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
}).strict();
const toolEmbeddedResourceContentSchema = z.object({
  type: z.literal('resource'),
  uri: z.string(),
  mimeType: z.string().optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
}).strict();

const toolContentBlockSchema = z.discriminatedUnion('type', [
  toolTextContentSchema,
  toolImageContentSchema,
  toolAudioContentSchema,
  toolResourceLinkContentSchema,
  toolEmbeddedResourceContentSchema,
]);

export const toolCallResultSchema = z.object({
  content: z.array(toolContentBlockSchema),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
}).strict();

export const callToolRequestSchema = z.object({
  connectionId: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const callToolResponseSchema = toolCallResultSchema;

const catalogSchema = <T extends z.ZodType>(item: T) => z.discriminatedUnion('status', [
  z.object({ status: z.literal('unsupported'), items: z.tuple([]) }).strict(),
  z.object({ status: z.literal('ready'), items: z.array(item) }).strict(),
  z.object({ status: z.literal('failed'), items: z.tuple([]), message: z.string() }).strict(),
]);

export const authorizationSnapshotSchema = z.object({
  status: z.enum(['required', 'waiting', 'completing', 'authorized']),
  storage: z.enum(['persistent', 'session-only']),
  canReopenBrowser: z.boolean(),
  canCancel: z.boolean(),
  warning: z.string().optional(),
}).strict();

export const signOutResultSchema = z.object({
  localCredentialsRemoved: z.literal(true),
  revocation: z.enum(['revoked', 'unavailable', 'failed']),
  warning: z.string().optional(),
}).strict();

export const connectionSnapshotSchema = z.object({
  connectionId: z.string().min(1),
  profileId: z.string().min(1),
  state: z.enum([
    'connecting', 'initializing', 'discovering', 'ready', 'closing', 'disconnected', 'failed',
    'authorization-required', 'authorizing', 'completing-authorization',
  ]),
  serverName: z.string().optional(),
  serverVersion: z.string().optional(),
  protocolVersion: z.string().optional(),
  instructions: z.string().optional(),
  tools: catalogSchema(toolSummarySchema),
  resources: catalogSchema(resourceSummarySchema),
  resourceTemplates: catalogSchema(resourceTemplateSummarySchema),
  prompts: catalogSchema(promptSummarySchema),
  failure: z.object({ code: z.string(), message: z.string() }).strict().optional(),
  authorization: authorizationSnapshotSchema.optional(),
}).strict();

export const serverProfilesSchema = z.array(serverProfileSchema);
export const connectionSnapshotsSchema = z.array(connectionSnapshotSchema);

export const serverChannels = {
  profilesList: 'servers:profiles:list',
  profilesSave: 'servers:profiles:save',
  profilesDelete: 'servers:profiles:delete',
  connectionsList: 'servers:connections:list',
  connect: 'servers:connect',
  disconnect: 'servers:disconnect',
  refresh: 'servers:refresh',
  callTool: 'servers:tool:call',
  connectionsChanged: 'servers:connections:changed',
  reopenAuthorization: 'servers:authorization:reopen',
  cancelAuthorization: 'servers:authorization:cancel',
  signOut: 'servers:sign-out',
} as const;

export const reopenAuthorizationRequestSchema = z.string().min(1);
export const reopenAuthorizationResponseSchema = connectionSnapshotSchema;

export const cancelAuthorizationRequestSchema = z.string().min(1);
export const cancelAuthorizationResponseSchema = connectionSnapshotSchema;

export const signOutRequestSchema = z.string().min(1);
export const signOutResponseSchema = signOutResultSchema;
