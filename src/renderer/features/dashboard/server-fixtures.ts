import type { ServerSummary } from '@/renderer/components/domain/ServerTable.vue';

// Visual demonstration data only; these records are not runtime server state.
export const demonstrationServers: ServerSummary[] = [
  { id: 'tveyes', name: 'TVEyes Local', transport: 'STDIO', tools: 12, state: 'connected' },
  { id: 'search', name: 'Search MCP', transport: 'HTTP', tools: 8, state: 'idle' },
  { id: 'analytics', name: 'Analytics', transport: 'HTTP', tools: 4, state: 'degraded' },
  { id: 'broken', name: 'Broken Fixture', transport: 'STDIO', tools: 0, state: 'error' },
];

export const demonstrationMetrics = [
  { label: 'Connected', value: 1 },
  { label: 'Tools', value: 24 },
  { label: 'Tests', value: 18 },
] as const;
