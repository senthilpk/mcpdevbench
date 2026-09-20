import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ServerDashboard from '@/renderer/features/servers/ServerDashboard.vue';
import type { ConnectionSnapshot } from '@/shared/domain/servers';

const emptyCatalog = { status: 'ready' as const, items: [] };
const oauthProfile = { id: 'p1', name: 'OAuth Server', transport: 'streamable-http' as const, url: 'https://example.com' };
const waitingConnection: ConnectionSnapshot = {
  connectionId: 'c1', profileId: 'p1', state: 'authorizing',
  tools: emptyCatalog, resources: emptyCatalog, resourceTemplates: emptyCatalog, prompts: emptyCatalog,
  authorization: { status: 'waiting', storage: 'persistent', canReopenBrowser: true, canCancel: true },
};
const connectedOAuthConnection: ConnectionSnapshot = {
  connectionId: 'c1', profileId: 'p1', state: 'ready',
  tools: emptyCatalog, resources: emptyCatalog, resourceTemplates: emptyCatalog, prompts: emptyCatalog,
  authorization: { status: 'authorized', storage: 'persistent', canReopenBrowser: false, canCancel: false },
};

describe('ServerDashboard', () => {
  beforeEach(() => {
    vi.mocked(window.mcpdevbench.listProfiles).mockResolvedValue([]);
    vi.mocked(window.mcpdevbench.listConnections).mockResolvedValue([]);
    vi.mocked(window.mcpdevbench.onConnectionsChanged).mockReturnValue(vi.fn());
    window.mcpdevbench.reopenAuthorization = vi.fn();
    window.mcpdevbench.cancelAuthorization = vi.fn();
    window.mcpdevbench.signOut = vi.fn().mockResolvedValue({ localCredentialsRemoved: true, revocation: 'revoked' });
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

  it('reopens and cancels a pending browser authorization through the preload API', async () => {
    vi.mocked(window.mcpdevbench.listProfiles).mockResolvedValueOnce([oauthProfile]);
    vi.mocked(window.mcpdevbench.listConnections).mockResolvedValueOnce([waitingConnection]);
    const wrapper = mount(ServerDashboard, { global: { stubs: { teleport: { template: '<div><slot /></div>' } } } });
    await flushPromises();
    await wrapper.get('button[aria-label="Open browser again for OAuth Server"]').trigger('click');
    expect(window.mcpdevbench.reopenAuthorization).toHaveBeenCalledWith('c1');
    await wrapper.get('button[aria-label="Cancel authorization for OAuth Server"]').trigger('click');
    expect(window.mcpdevbench.cancelAuthorization).toHaveBeenCalledWith('c1');
  });

  it('does not sign out when the confirmation is declined', async () => {
    vi.mocked(window.mcpdevbench.listProfiles).mockResolvedValueOnce([oauthProfile]);
    vi.mocked(window.mcpdevbench.listConnections).mockResolvedValueOnce([connectedOAuthConnection]);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const wrapper = mount(ServerDashboard, { global: { stubs: { teleport: { template: '<div><slot /></div>' } } } });
    await flushPromises();
    await wrapper.get('button[aria-label="Sign out OAuth Server"]').trigger('click');
    expect(confirmSpy).toHaveBeenCalled();
    expect(window.mcpdevbench.signOut).not.toHaveBeenCalled();
  });

  it('signs out after confirmation and shows a non-blocking warning attributed to the server on revocation failure', async () => {
    vi.mocked(window.mcpdevbench.listProfiles).mockResolvedValueOnce([oauthProfile]);
    vi.mocked(window.mcpdevbench.listConnections).mockResolvedValueOnce([connectedOAuthConnection]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.mcpdevbench.signOut = vi.fn().mockResolvedValue({
      localCredentialsRemoved: true,
      revocation: 'failed',
      warning: 'Local sign-out succeeded, but revoking access remotely failed.',
    });
    const wrapper = mount(ServerDashboard, { global: { stubs: { teleport: { template: '<div><slot /></div>' } } } });
    await flushPromises();
    await wrapper.get('button[aria-label="Sign out OAuth Server"]').trigger('click');
    await flushPromises();
    expect(window.mcpdevbench.signOut).toHaveBeenCalledWith('p1');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('OAuth Server: Local sign-out succeeded, but revoking access remotely failed.');
  });

  it('clears a stale sign-out warning once an unrelated action runs', async () => {
    const otherProfile = { id: 'p2', name: 'Other Server', transport: 'stdio' as const, command: 'node', args: [] };
    vi.mocked(window.mcpdevbench.listProfiles).mockResolvedValueOnce([oauthProfile, otherProfile]);
    vi.mocked(window.mcpdevbench.listConnections).mockResolvedValueOnce([connectedOAuthConnection]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    window.mcpdevbench.signOut = vi.fn().mockResolvedValue({
      localCredentialsRemoved: true,
      revocation: 'failed',
      warning: 'Local sign-out succeeded, but revoking access remotely failed.',
    });
    const wrapper = mount(ServerDashboard, { global: { stubs: { teleport: { template: '<div><slot /></div>' } } } });
    await flushPromises();
    await wrapper.get('button[aria-label="Sign out OAuth Server"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('OAuth Server: Local sign-out succeeded, but revoking access remotely failed.');

    await wrapper.get('button[aria-label="Connect Other Server"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).not.toContain('Local sign-out succeeded');
  });
});
