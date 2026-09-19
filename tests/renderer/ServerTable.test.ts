import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { ServerRow } from '@/renderer/features/servers/use-server-workspace';
import ServerTable from '@/renderer/components/domain/ServerTable.vue';

const servers: ServerRow[] = [
  { id: 'tveyes', name: 'TVEyes Local', transport: 'STDIO', tools: 12, state: 'connected', connectionId: 'c1' },
  { id: 'search', name: 'Search MCP', transport: 'HTTP', tools: 8, state: 'idle' },
  { id: 'analytics', name: 'Analytics', transport: 'HTTP', tools: 4, state: 'degraded' },
  { id: 'broken', name: 'Broken Fixture', transport: 'STDIO', tools: 0, state: 'error' },
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

  it('renders an accessible empty state with an active add command', () => {
    const wrapper = mount(ServerTable, { props: { servers: [] } });
    expect(wrapper.get('[data-testid="empty-servers"]').text()).toContain('No servers configured');
    expect(wrapper.get('button').text()).toContain('Add server');
  });
});
