import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ServerDashboard from '@/renderer/features/servers/ServerDashboard.vue';

describe('ServerDashboard', () => {
  beforeEach(() => {
    vi.mocked(window.mcpdevbench.listProfiles).mockResolvedValue([]);
    vi.mocked(window.mcpdevbench.listConnections).mockResolvedValue([]);
    vi.mocked(window.mcpdevbench.onConnectionsChanged).mockReturnValue(vi.fn());
  });

  it('renders an empty state with a real Add server action', async () => {
    const wrapper = mount(ServerDashboard, { global: { stubs: { teleport: { template: '<div><slot /></div>' } } } });
    await flushPromises();
    expect(wrapper.get('[data-testid="empty-servers"]').text()).toContain('No servers configured');
    expect(wrapper.get('button').text()).toContain('Add server');
  });

  it('renders saved profiles and connects them', async () => {
    vi.mocked(window.mcpdevbench.listProfiles).mockResolvedValueOnce([
      { id: 'p1', name: 'Fixture', transport: 'stdio', command: 'node', args: [] },
    ]);
    const wrapper = mount(ServerDashboard, { global: { stubs: { teleport: { template: '<div><slot /></div>' } } } });
    await flushPromises();
    expect(wrapper.text()).toContain('Fixture');
    await wrapper.get('button[aria-label="Connect Fixture"]').trigger('click');
    expect(window.mcpdevbench.connect).toHaveBeenCalledWith('p1');
  });

  it('shows profile load failures and unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn();
    vi.mocked(window.mcpdevbench.onConnectionsChanged).mockReturnValueOnce(unsubscribe);
    vi.mocked(window.mcpdevbench.listProfiles).mockRejectedValueOnce(new Error('corrupt'));
    const wrapper = mount(ServerDashboard, { global: { stubs: { teleport: { template: '<div><slot /></div>' } } } });
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('Unable to load saved server profiles');
    wrapper.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
