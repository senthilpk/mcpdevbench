import { McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const server = new McpServer({ name: 'catalog-fixture', version: '1.0.0' });

server.registerTool(
  'echo',
  {
    title: 'Echo',
    description: 'Echo a message for discovery tests.',
    inputSchema: z.object({ message: z.string() }),
  },
  async ({ message }) => ({ content: [{ type: 'text', text: message }] }),
);

server.registerTool(
  'inspect-catalog',
  {
    title: 'Inspect catalog',
    description: 'Return a stable fixture result.',
  },
  async () => ({ content: [{ type: 'text', text: 'catalog-ready' }] }),
);

server.registerResource(
  'fixture-readme',
  'fixture://readme',
  { title: 'Fixture readme', mimeType: 'text/plain' },
  async (uri) => ({ contents: [{ uri: uri.href, text: 'MCPDevBench fixture resource' }] }),
);

server.registerResource(
  'fixture-item',
  new ResourceTemplate('fixture://items/{id}', { list: undefined }),
  { title: 'Fixture item', mimeType: 'application/json' },
  async (uri, { id }) => ({
    contents: [{ uri: uri.href, text: JSON.stringify({ id }) }],
  }),
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

await server.connect(new StdioServerTransport());
console.error('catalog fixture connected');
