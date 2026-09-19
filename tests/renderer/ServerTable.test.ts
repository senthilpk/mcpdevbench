import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ServerSummary } from '@/renderer/components/domain/ServerTable.vue';
import ServerTable from '@/renderer/components/domain/ServerTable.vue';

const servers: ServerSummary[] = [
  { id: 'tveyes', name: 'TVEyes Local', transport: 'STDIO', tools: 12, state: 'connected' as const },
  { id: 'search', name: 'Search MCP', transport: 'HTTP', tools: 8, state: 'idle' as const },
  { id: 'analytics', name: 'Analytics', transport: 'HTTP', tools: 4, state: 'degraded' as const },
  { id: 'broken', name: 'Broken Fixture', transport: 'STDIO', tools: 0, state: 'error' as const },
];

describe('ServerTable', () => {
  it('renders semantic headers and every server state', () => {
    const wrapper = mount(ServerTable, { props: { servers } });
    expect(wrapper.get('table').attributes('aria-label')).toBe('Configured servers');
    expect(wrapper.findAll('tbody tr')).toHaveLength(4);
    for (const label of ['Connected', 'Idle', 'Degraded', 'Error']) {
      expect(wrapper.text()).toContain(label);
    }
  });

  it('renders an accessible empty state without an active command', () => {
    const wrapper = mount(ServerTable, { props: { servers: [] } });
    expect(wrapper.get('[data-testid="empty-servers"]').text()).toContain('No servers configured');
    expect(wrapper.find('button').exists()).toBe(false);
  });
});
